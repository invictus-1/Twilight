import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Attachment, ChatSettings, ConversationView, DeletionView, Pane, SendTarget, StreamEvent } from '@shared/types'
import { modelKey, pickModelDefaults, type ModelDefaults } from '@shared/modelDefaults'
import * as db from './db'
import { signalDone } from './doneNotice'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { appendLog } from './logs'
import { describeAnthropicError } from './providers/anthropic'
import { toWorkspace, workspaceSystemPrompt } from './workspaces'
import { getPersona } from './library'
import { CHOICES_INSTRUCTION, CHOICES_TOOL_INSTRUCTION } from '@shared/choices'
import { CLOCK_OPEN, clockBlock, instructionBlock, isContextText } from '@shared/attachments'
import { DECLINED, IMAGE_TOOL, type ToolApproval, type ToolApprovalResponse } from '@shared/mcp'
import { allowTool, callTool, chatTools, type ChatTool } from './mcp'
import { generateImage, imageConfig, IMAGE_TOOL_DEF } from './images'
import type { McpCallResult } from './mcp/client'
import type { ClientCall, ClientOutcome, ClientToolDef } from './providers/types'
import { keepFresh, librarySettings, searchLibrary } from './docLibrary'
import { LIBRARY_OPEN, libraryBlock } from '@shared/docLibrary'
import { modelInfo } from './providers'

const DEFAULT_SETTINGS: ChatSettings = {
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  systemPrompt: '',
  effort: null,
  thinkingDisplay: 'summarized',
  caching: true,
  cacheTtl: '1h',
  showThinking: false,
  temperature: null,
  maxTokens: null,
  messageLimit: null,
  extraParams: '',
  choiceCards: false,
  choiceTool: false,
  choiceFenced: true,
  choicePlain: true,
  choiceInstructions: true,
  webSearch: false,
  webFetch: false,
  dateTime: false,
  mcpServers: [],
  imageGen: false,
  library: false,
  pendingInstruction: ''
}

/** The system prompt actually sent: the pane's own, plus the choice how-to when choices are on and it's wanted. */
function systemFor(settings: ChatSettings, legacy: string): string {
  const base = settings.systemPrompt || legacy
  if (!settings.choiceCards || !settings.choiceInstructions) return base
  // One how-to at most, so the model is never told two ways at once. Plain options come from your
  // own prompt, so they have none.
  const howTo = settings.choiceTool ? CHOICES_TOOL_INSTRUCTION : settings.choiceFenced ? CHOICES_INSTRUCTION : ''
  return [base, howTo].filter(Boolean).join('\n\n')
}

/** Settings as stored, with any field added since they were saved filled from the defaults. */
const normalize = (stored: Partial<ChatSettings>): ChatSettings => ({ ...DEFAULT_SETTINGS, ...stored })

/**
 * With a recent-message limit, sends only the newest messages. The cut moves in steps of half the
 * limit rather than every turn, so the cached prefix survives several turns between moves (a cut
 * that slides every turn would miss the cache every turn).
 */
export function trimHistory<T extends { role: string }>(history: T[], limit: number | null): T[] {
  if (!limit || history.length <= limit) return history
  const step = Math.max(2, Math.floor(limit / 2))
  let cut = Math.ceil((history.length - limit) / step) * step
  while (cut < history.length - 1 && history[cut].role !== 'user') cut++
  return history.slice(cut)
}

/** Split compare state stored on the conversation: pane B's leaf and settings. */
interface SplitState {
  leafId: string
  settings: ChatSettings
}

/** Running generations, keyed `${conversationId}:${pane}`. */
const running = new Map<string, AbortController>()
const runKey = (id: string, pane: Pane): string => `${id}:${pane}`

export function isRunning(id: string, pane?: Pane): boolean {
  return pane ? running.has(runKey(id, pane)) : running.has(runKey(id, 'a')) || running.has(runKey(id, 'b'))
}

export function getDefaults(): ChatSettings {
  return normalize(db.kvGet<Partial<ChatSettings>>('defaults') ?? {})
}

export function setDefaults(patch: Partial<ChatSettings>): ChatSettings {
  db.kvSet('defaults', { ...db.kvGet<Partial<ChatSettings>>('defaults'), ...patch })
  return getDefaults()
}

function splitOf(conv: db.ConversationRow): SplitState | null {
  if (!conv.split) return null
  const split = JSON.parse(conv.split) as SplitState
  return { ...split, settings: normalize(split.settings) }
}

function setSplit(id: string, split: SplitState | null): void {
  db.updateConversation(id, { split: split ? JSON.stringify(split) : null })
}

function settingsFor(conv: db.ConversationRow, pane: Pane): ChatSettings {
  const split = splitOf(conv)
  return pane === 'b' && split ? split.settings : normalize(JSON.parse(conv.settings))
}

/** The node a pane's next message attaches to. */
function leafOf(conv: db.ConversationRow, nodes: Map<string, db.NodeRow>, pane: Pane): string {
  const split = splitOf(conv)
  if (pane === 'b' && split && nodes.has(split.leafId)) return split.leafId
  const path = db.activePath(conv, nodes)
  return path[path.length - 1].id
}

function panes(target: SendTarget, conv: db.ConversationRow): Pane[] {
  if (!splitOf(conv)) return ['a']
  return target === 'both' ? ['a', 'b'] : [target]
}

export function view(id: string): ConversationView {
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  const toViews = (rows: db.NodeRow[]): ConversationView['path'] => rows.slice(1).map((n) => db.toView(n, nodes))
  const split = splitOf(conv)
  return {
    id,
    title: conv.title,
    settings: settingsFor(conv, 'a'),
    started: !!conv.started,
    path: toViews(db.activePath(conv, nodes)),
    split: split ? { settings: split.settings, path: toViews(db.ancestors(nodes, split.leafId)) } : null
  }
}

/** The settings a model starts with whenever it's picked (Model settings → Save as this model's defaults). */
function modelDefaultsFor(providerId: string, modelId: string): Partial<ChatSettings> {
  return pickModelDefaults(db.kvGet<ModelDefaults>('modelDefaults')?.[modelKey(providerId, modelId)] ?? {})
}

/**
 * A new chat takes the defaults, overlaid with its workspace's system prompt and model, then with
 * the persona's when one is given. A persona's prompt stands in for the workspace's own, under
 * the workspace's name and description when the workspace adds them.
 */
export function create(folderId: string | null = null, personaId: string | null = null, reuseId: string | null = null): ConversationView {
  const settings = getDefaults()
  const row = folderId ? db.getFolder(folderId) : undefined
  const ws = row ? toWorkspace(row) : null
  if (ws) {
    settings.systemPrompt = workspaceSystemPrompt(ws) || settings.systemPrompt
    if (ws.providerId && ws.modelId) {
      settings.providerId = ws.providerId
      settings.modelId = ws.modelId
    }
    if (ws.choiceCards) settings.choiceCards = true
  }
  const persona = personaId ? getPersona(personaId) : undefined
  if (personaId && !persona) throw new Error('That persona no longer exists.')
  if (persona) {
    settings.systemPrompt = ws ? workspaceSystemPrompt({ ...ws, systemPrompt: persona.systemPrompt }) : persona.systemPrompt
    if (persona.providerId && persona.modelId) {
      settings.providerId = persona.providerId
      settings.modelId = persona.modelId
    }
    if (persona.choiceCards) settings.choiceCards = true
  }
  Object.assign(settings, modelDefaultsFor(settings.providerId, settings.modelId))
  // An untouched chat is set up afresh rather than leaving an empty one behind.
  const reuse = reuseId ? db.listConversations().find((c) => c.id === reuseId) : undefined
  if (reuse && !reuse.started && !reuse.split && db.loadNodes(reuse.id).size <= 1) {
    db.updateConversation(reuse.id, { settings: JSON.stringify(settings) })
    db.fileConversation(reuse.id, { folder_id: folderId })
    return view(reuse.id)
  }
  return view(db.createConversation(settings, folderId).id)
}

/**
 * Any setting can change at any time, the system prompt included, separately for each split pane.
 * The interface warns that a system prompt or model change restarts the prompt cache.
 */
export function updateSettings(id: string, patch: Partial<ChatSettings>, pane: Pane = 'a'): ConversationView {
  const conv = db.getConversation(id)
  const split = splitOf(conv)
  // Once the chat has started, a replaced system prompt is kept (the last 20), with when it changed.
  const before = pane === 'b' && split ? split.settings : settingsFor(conv, 'a')
  // Picking another model brings that model's own defaults; anything set in the same change wins.
  // A different model starts its own prompt cache anyway, so these never cost a cached one.
  const providerId = patch.providerId ?? before.providerId
  const modelId = patch.modelId ?? before.modelId
  if (providerId !== before.providerId || modelId !== before.modelId) patch = { ...modelDefaultsFor(providerId, modelId), ...patch }
  if (conv.started && patch.systemPrompt !== undefined && patch.systemPrompt !== before.systemPrompt && before.systemPrompt.trim()) {
    patch = { ...patch, promptHistory: [...(before.promptHistory ?? []), { text: before.systemPrompt, until: Date.now() }].slice(-20) }
  }
  if (pane === 'b' && split) setSplit(id, { ...split, settings: { ...split.settings, ...patch } })
  else db.updateConversation(id, { settings: JSON.stringify({ ...settingsFor(conv, 'a'), ...patch }) })
  return view(id)
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New chat'
}

const escapeAttr = (s: string): string => s.replace(/"/g, "'")

export function send(
  contents: WebContents,
  id: string,
  text: string,
  target: SendTarget = 'a',
  attachments: Attachment[] = []
): ConversationView {
  let conv = db.getConversation(id)
  const targets = panes(target, conv)
  if (targets.some((p) => isRunning(id, p))) throw new Error('A reply is still streaming in this chat.')
  if (!conv.started) {
    db.updateConversation(id, { started: 1, title: titleFrom(text || attachments[0]?.name || 'New chat') })
    conv = db.getConversation(id)
  }
  // Attached files go into the message itself, in full, ahead of what was typed. They become
  // part of the history like any message, so later turns read them from cache.
  // Images and PDFs go as the files themselves, in Claude's block format (the OpenAI-compatible
  // provider converts them).
  const content = [
    ...attachments.map((a) =>
      a.kind === 'image' && a.data
        ? { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }
        : a.kind === 'pdf' && a.data
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }
          : { type: 'text', text: `<document name="${escapeAttr(a.name)}">\n${a.text}\n</document>` }
    ),
    ...(text ? [{ type: 'text', text }] : [])
  ]
  const nodes = db.loadNodes(id)
  const userNodes = targets.map((pane) => {
    // A queued instruction change goes in front of this message, once, in this pane; the date and
    // time (when on) in front of that. Both are stored with the message, so later requests replay
    // them unchanged.
    const paneSettings = settingsFor(conv, pane)
    const pending = paneSettings.pendingInstruction.trim()
    if (pending) updateSettings(id, { pendingInstruction: '' }, pane)
    const context = [
      ...(paneSettings.dateTime ? [{ type: 'text', text: clockBlock(new Date()) }] : []),
      ...(pending ? [{ type: 'text', text: instructionBlock(pending) }] : [])
    ]
    const user = db.insertNode(
      {
        id: randomUUID(),
        conversation_id: id,
        parent_id: leafOf(conv, nodes, pane),
        role: 'user',
        text,
        content: JSON.stringify([...context, ...content]),
        thinking: null,
        model: null,
        provider_id: null,
        usage: null,
        status: 'done',
        error: null,
        attachments: attachments.length
          ? JSON.stringify(attachments.map((a) => ({ name: a.name, chars: a.text.length, kind: a.kind ?? 'text', bytes: a.data ? Math.floor((a.data.length * 3) / 4) : a.text.length })))
          : null
      },
      { activate: pane === 'a' }
    )
    if (pane === 'b') setSplit(id, { ...splitOf(db.getConversation(id))!, leafId: user.id })
    return { pane, userId: user.id }
  })

  // Two requests with an identical prefix fired together both pay full price: neither can read
  // a cache the other is still writing. When both panes use the same model, B starts once A's
  // first token arrives, so B reads A's cache.
  let after: Promise<void> | undefined
  const sameModel =
    targets.length === 2 &&
    settingsFor(conv, 'a').modelId === settingsFor(conv, 'b').modelId &&
    settingsFor(conv, 'a').providerId === settingsFor(conv, 'b').providerId
  for (const { pane, userId } of userNodes) {
    const started = generate(contents, id, userId, pane, after)
    if (sameModel && pane === 'a') after = started
  }
  return view(id)
}

/** A new reply as another version: to a reply's message, or straight to a message of yours. */
export function regenerate(contents: WebContents, id: string, nodeId: string, pane: Pane = 'a'): ConversationView {
  if (isRunning(id, pane)) throw new Error('A reply is still streaming in this pane.')
  const node = db.loadNodes(id).get(nodeId)
  const userId = node?.role === 'user' ? node.id : node?.parent_id
  if (!userId) throw new Error('Nothing to regenerate.')
  generate(contents, id, userId, pane)
  return view(id)
}

// ——— Deleting, restoring and editing messages ———
// Deletion is soft and recorded, so it can always be undone. "single" removes one message and
// moves its replies up to its parent; "below" removes it and everything under it. Because the
// conversation is a tree, a restore never collides with what was written since: a restored
// branch simply comes back as another version beside it.

export function deleteMessage(id: string, nodeId: string, kind: 'single' | 'below', pane: Pane = 'a'): ConversationView {
  if (isRunning(id)) throw new Error('Wait for the reply to finish (or stop it) before deleting.')
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  const node = nodes.get(nodeId)
  if (!node?.parent_id) throw new Error('That message is already gone.')
  const parentId = node.parent_id
  const moved = kind === 'single' ? db.childrenOf(nodes, nodeId).map((c) => c.id) : []
  for (const child of moved) db.setParent(child, parentId)
  db.recordDeletion({
    id: randomUUID(),
    conversation_id: id,
    node_id: nodeId,
    kind,
    moved_children: moved.length ? JSON.stringify(moved) : null,
    created_at: Date.now()
  })
  // Keep each pane's thread pointing at messages that still exist.
  const after = db.loadNodes(id)
  if (nodes.get(parentId)?.active_child_id === nodeId) {
    const keep = node.active_child_id && moved.includes(node.active_child_id) ? node.active_child_id : db.childrenOf(after, parentId).at(-1)?.id
    if (keep) db.setActiveChild(parentId, keep)
    else db.clearActiveChild(parentId)
  }
  const split = splitOf(conv)
  if (split && !after.has(split.leafId)) setSplit(id, { ...split, leafId: parentId })
  return view(id)
}

export function listDeletions(id: string): DeletionView[] {
  const all = db.loadAllNodes(id)
  const subtreeSize = (nodeId: string): number => {
    let n = 1
    for (const row of all.values()) if (row.parent_id === nodeId) n += subtreeSize(row.id)
    return n
  }
  return db.listDeletions(id).flatMap((d) => {
    const node = all.get(d.node_id)
    if (!node || (node.role !== 'user' && node.role !== 'assistant')) return []
    const text = node.text.replace(/\s+/g, ' ').trim()
    return [
      {
        id: d.id,
        kind: d.kind,
        createdAt: d.created_at,
        role: node.role,
        preview: text.length > 140 ? `${text.slice(0, 137)}…` : text || '(empty)',
        count: d.kind === 'single' ? 1 : subtreeSize(d.node_id)
      }
    ]
  })
}

export function viewDeletion(id: string, deletionId: string): ConversationView['path'] {
  const d = db.getDeletion(deletionId)
  if (!d || d.conversation_id !== id) throw new Error('That deletion no longer exists.')
  const all = db.loadAllNodes(id)
  const path: db.NodeRow[] = []
  for (let n = all.get(d.node_id); n; n = d.kind === 'below' && n.active_child_id ? all.get(n.active_child_id) : undefined) path.push(n)
  return path.map((n) => db.toView(n, all))
}

export function restoreDeletion(id: string, deletionId: string, pane: Pane = 'a'): ConversationView {
  if (isRunning(id)) throw new Error('Wait for the reply to finish before restoring.')
  const d = db.getDeletion(deletionId)
  if (!d || d.conversation_id !== id || d.restored_at) return view(id)
  const all = db.loadAllNodes(id)
  const node = all.get(d.node_id)
  if (!node?.parent_id) return view(id)
  db.markRestored(d)
  // Put moved replies back under it, unless something else has adopted them since.
  for (const child of d.moved_children ? (JSON.parse(d.moved_children) as string[]) : []) {
    if (all.get(child)?.parent_id === node.parent_id) db.setParent(child, node.id)
  }
  // Show what came back: it becomes the active version where it was.
  const split = splitOf(db.getConversation(id))
  if (pane === 'b' && split) setSplit(id, { ...split, leafId: db.descend(db.loadNodes(id), node.id) })
  else for (let n: db.NodeRow | undefined = node; n?.parent_id; n = all.get(n.parent_id)) db.setActiveChild(n.parent_id, n.id)
  return view(id)
}

export function editMessage(contents: WebContents, id: string, nodeId: string, text: string, pane: Pane = 'a', send = true): ConversationView {
  if (isRunning(id, pane)) throw new Error('Wait for the reply to finish before editing.')
  const nodes = db.loadNodes(id)
  const node = nodes.get(nodeId)
  if (!node?.parent_id || (node.role !== 'user' && node.role !== 'assistant')) throw new Error("That message can't be edited.")
  const base = {
    id: randomUUID(),
    conversation_id: id,
    parent_id: node.parent_id,
    text,
    thinking: null,
    usage: null,
    status: 'done' as const,
    error: null
  }
  let edited: db.NodeRow
  if (node.role === 'user') {
    // Keep its attached documents; replace what was typed. The edited message is sent now, so it
    // takes the time now (when the pane sends it) instead of the original's.
    const blocks = node.content ? (JSON.parse(node.content) as { type: string; text?: string }[]) : []
    const kept = blocks.filter(
      (b) => b.type === 'image' || b.type === 'document' || (b.type === 'text' && !!b.text && isContextText(b.text) && !b.text.startsWith(CLOCK_OPEN) && !b.text.startsWith(LIBRARY_OPEN))
    )
    const docs = [...(settingsFor(db.getConversation(id), pane).dateTime ? [{ type: 'text', text: clockBlock(new Date()) }] : []), ...kept]
    edited = db.insertNode(
      { ...base, role: 'user', content: JSON.stringify([...docs, ...(text ? [{ type: 'text', text }] : [])]), model: null, provider_id: null, attachments: node.attachments ?? null },
      { activate: pane === 'a' }
    )
  } else {
    edited = db.insertNode(
      { ...base, role: 'assistant', content: JSON.stringify([{ type: 'text', text }]), model: node.model, provider_id: node.provider_id },
      { activate: pane === 'a' }
    )
  }
  const split = splitOf(db.getConversation(id))
  if (pane === 'b' && split) setSplit(id, { ...split, leafId: edited.id })
  // Saved without sending, it waits as the newest message for Send (or more edits).
  if (node.role === 'user' && send) generate(contents, id, edited.id, pane)
  return view(id)
}

export function switchBranch(id: string, nodeId: string, direction: -1 | 1, pane: Pane = 'a'): ConversationView {
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  const node = nodes.get(nodeId)
  if (!node?.parent_id) return view(id)
  const siblings = db.childrenOf(nodes, node.parent_id)
  const target = siblings[siblings.findIndex((s) => s.id === nodeId) + direction]
  if (!target) return view(id)
  const split = splitOf(conv)
  if (pane === 'b' && split) setSplit(id, { ...split, leafId: db.descend(nodes, target.id) })
  else db.setActiveChild(node.parent_id, target.id)
  return view(id)
}

export function cloneIntoSplit(id: string, nodeId?: string): ConversationView {
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  const leafId = nodeId && nodes.has(nodeId) ? nodeId : leafOf(conv, nodes, 'a')
  // B starts as an exact copy of A at that point: same history, system prompt and settings.
  setSplit(id, { leafId, settings: settingsFor(conv, 'a') })
  return view(id)
}

/**
 * A new chat holding the conversation up to `nodeId`, with the pane's settings and the same workspace. Every
 * message is copied byte-for-byte, stored blocks included, so the new chat's first request reads
 * the same prompt cache as the original.
 */
export function branchToNewChat(id: string, nodeId: string, pane: Pane = 'a'): ConversationView {
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  if (!nodes.has(nodeId)) throw new Error('That message is gone.')
  const fresh = db.createConversation(settingsFor(conv, pane), conv.folder_id)
  const oldRoot = nodes.get(conv.root_id)
  if (oldRoot?.text) db.updateNode(fresh.root_id, { text: oldRoot.text })
  let parent = fresh.root_id
  for (const n of db.ancestors(nodes, nodeId)) {
    if (n.role === 'root') continue
    const copy = db.insertNode({
      id: randomUUID(),
      conversation_id: fresh.id,
      parent_id: parent,
      role: n.role,
      text: n.text,
      content: n.content,
      thinking: n.thinking,
      model: n.model,
      provider_id: n.provider_id,
      usage: n.usage,
      status: n.status === 'streaming' ? 'stopped' : n.status,
      error: n.error,
      attachments: n.attachments ?? null,
      created_at: n.created_at
    })
    parent = copy.id
  }
  const title = conv.title.length > 52 ? `${conv.title.slice(0, 51)}…` : conv.title
  db.updateConversation(fresh.id, { started: 1, title: `${title} (branch)` })
  return view(fresh.id)
}

export function revealMessage(id: string, nodeId: string): ConversationView {
  const nodes = db.loadNodes(id)
  for (let n = nodes.get(nodeId); n?.parent_id; n = nodes.get(n.parent_id)) db.setActiveChild(n.parent_id, n.id)
  return view(id)
}

export function closeSplit(id: string, keep: Pane): ConversationView {
  stop(id, 'b')
  const conv = db.getConversation(id)
  const split = splitOf(conv)
  if (split && keep === 'b') {
    stop(id, 'a')
    // Point pane A's thread down B's branch, and take B's settings. A's branch stays in the
    // tree, reachable from the version switcher.
    for (const n of db.ancestors(db.loadNodes(id), split.leafId)) if (n.parent_id) db.setActiveChild(n.parent_id, n.id)
    db.updateConversation(id, { settings: JSON.stringify(split.settings) })
  }
  setSplit(id, null)
  return view(id)
}

// ——— Tools Twilight runs during a reply ———

/** Approvals the replies are waiting on, by approval id. */
const approvals = new Map<string, (r: ToolApprovalResponse) => void>()

export function respondApproval(id: string, response: ToolApprovalResponse): void {
  approvals.get(id)?.(response)
}

/** The library as a tool, so a model that can call tools runs its own searches mid-reply. */
const LIBRARY_TOOL = {
  name: 'search_library',
  description:
    "Search the user's document library (their own writing and notes) for passages about something. Use it when the passages already given don't cover what you need: a character, a place, an earlier scene, a fact. Search again with other words if the first try misses.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look for, in plain words.' }, count: { type: 'integer', description: 'How many passages, 1 to 12. Default 6.' } },
    required: ['query']
  }
}

/**
 * Before a reply: the library's best passages for your message go into it, once (a regenerate
 * reuses them, so the request stays the same and the cache holds).
 */
async function addLibraryPassages(conversationId: string, userNodeId: string, settings: ChatSettings): Promise<boolean> {
  if (!settings.library || !librarySettings().folders.length) return false
  keepFresh()
  const row = db.loadNodes(conversationId).get(userNodeId)
  if (!row || row.role !== 'user') return false
  const blocks = row.content ? (JSON.parse(row.content) as { type: string; text?: string }[]) : [{ type: 'text', text: row.text }]
  if (blocks.some((b) => b.type === 'text' && b.text?.startsWith(LIBRARY_OPEN)) || !row.text.trim()) return false
  const hits = await searchLibrary(row.text)
  if (!hits.length) return false
  // Just before what you typed, after any other context.
  const at = blocks.length && blocks.at(-1)?.type === 'text' && !isContextText(blocks.at(-1)?.text ?? '') ? blocks.length - 1 : blocks.length
  blocks.splice(at, 0, { type: 'text', text: libraryBlock(hits) })
  db.updateNode(userNodeId, { content: JSON.stringify(blocks) })
  return true
}

const MAX_RESULT = 50_000
const MAX_PICTURES = 4

/** An MCP result as text (and any pictures) for the model. */
function fromMcp(id: string, result: McpCallResult): ClientOutcome {
  const parts: string[] = []
  const images: { mediaType: string; data: string }[] = []
  for (const c of result.content ?? []) {
    if (c.type === 'text' && c.text) parts.push(c.text)
    else if (c.type === 'image' && c.data && c.mimeType && images.length < MAX_PICTURES && c.data.length < 5_000_000) images.push({ mediaType: c.mimeType, data: c.data })
    else if (c.type === 'resource' && c.resource?.text) parts.push(c.resource.text)
    else if (c.type === 'resource_link' || c.type === 'resource') parts.push(`(${c.type}: ${c.resource?.uri ?? ''})`)
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  let text = parts.join('\n\n')
  // One huge result would fill the context; the start is kept and the cut is said.
  if (text.length > MAX_RESULT) text = `${text.slice(0, MAX_RESULT)}\n\n(Cut: the result was ${text.length.toLocaleString()} characters; the first ${MAX_RESULT.toLocaleString()} are shown.)`
  return { id, text, ...(images.length ? { images } : {}), ...(result.isError ? { isError: true } : {}) }
}

/**
 * Runs a round of tool calls for a reply, one after another: each MCP call waits for your
 * approval unless its server lets calls through or you've allowed that tool, and stopping the
 * reply declines whatever is still waiting.
 */
function toolRunner(
  tools: ChatTool[],
  signal: AbortSignal,
  emit: (approval: ToolApproval | null) => void,
  activity: (label: string) => void
): (calls: ClientCall[]) => Promise<ClientOutcome[]> {
  const ask = (approval: ToolApproval): Promise<ToolApprovalResponse> =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve({ approve: false })
      const finish = (r: ToolApprovalResponse): void => {
        approvals.delete(approval.id)
        signal.removeEventListener('abort', onAbort)
        emit(null)
        resolve(r)
      }
      const onAbort = (): void => finish({ approve: false })
      signal.addEventListener('abort', onAbort, { once: true })
      approvals.set(approval.id, finish)
      emit(approval)
    })
  return async (calls) => {
    const out: ClientOutcome[] = []
    for (const call of calls) {
      if (signal.aborted) {
        out.push({ id: call.id, text: 'Stopped by the user before this ran.', isError: true })
        continue
      }
      if ('__unreadable' in call.input) {
        out.push({ id: call.id, text: "The call's arguments weren't valid JSON. Send them again.", isError: true })
        continue
      }
      try {
        if (call.name === LIBRARY_TOOL.name) {
          const query = String(call.input.query ?? '').trim()
          if (!query) throw new Error('Say what to look for in query.')
          activity(`Searching your library: ${query}`)
          const hits = await searchLibrary(query, Math.min(12, Math.max(1, Number(call.input.count) || 6)))
          out.push({ id: call.id, text: hits.length ? libraryBlock(hits) : 'Nothing in the library matched that.' })
          continue
        }
        if (call.name === IMAGE_TOOL) {
          const prompt = String(call.input.prompt ?? '').trim()
          if (!prompt) throw new Error('Describe the picture in prompt.')
          activity('Making a picture')
          const file = await generateImage(prompt, typeof call.input.size === 'string' ? call.input.size : undefined, signal)
          out.push({ id: call.id, text: 'The picture was made and is shown to the user under your reply.', generated: { file, prompt } })
          continue
        }
        const tool = tools.find((t) => t.name === call.name)
        if (!tool) throw new Error(`There's no tool called ${call.name}.`)
        if (tool.server.approval === 'ask' && !tool.server.allowedTools.includes(tool.tool)) {
          const answer = await ask({ id: randomUUID(), server: tool.server.name, tool: tool.tool, input: JSON.stringify(call.input, null, 2), readOnly: tool.readOnly })
          if (!answer.approve) {
            out.push({ id: call.id, text: DECLINED, isError: true })
            continue
          }
          if (answer.always) {
            allowTool(tool.server.id, tool.tool)
            tool.server.allowedTools.push(tool.tool)
          }
        }
        activity(`Using ${tool.server.name}: ${tool.tool}`)
        out.push(fromMcp(call.id, await callTool(tool.server, tool.tool, call.input, signal)))
      } catch (err) {
        out.push({ id: call.id, text: `The tool failed: ${(err as Error).message}`, isError: true })
      }
    }
    return out
  }
}

export function stop(id: string, target: SendTarget = 'both'): void {
  for (const pane of target === 'both' ? (['a', 'b'] as Pane[]) : [target]) running.get(runKey(id, pane))?.abort()
}

/**
 * Starts a reply to `userNodeId` as a new branch in `pane` and streams it to the renderer.
 * Resolves the returned promise at the first streamed token (or when the request ends).
 */
function generate(contents: WebContents, conversationId: string, userNodeId: string, pane: Pane, after?: Promise<void>): Promise<void> {
  const conv = db.getConversation(conversationId)
  const settings = settingsFor(conv, pane)
  const assistant = db.insertNode(
    {
      id: randomUUID(),
      conversation_id: conversationId,
      parent_id: userNodeId,
      role: 'assistant',
      text: '',
      content: null,
      thinking: null,
      model: settings.modelId,
      provider_id: settings.providerId,
      usage: null,
      status: 'streaming',
      error: null
    },
    { activate: pane === 'a' }
  )
  if (pane === 'b') {
    const split = splitOf(db.getConversation(conversationId))
    if (split) setSplit(conversationId, { ...split, leafId: assistant.id })
  }
  const controller = new AbortController()
  running.set(runKey(conversationId, pane), controller)

  let markStarted!: () => void
  const started = new Promise<void>((resolve) => (markStarted = resolve))

  const emit = (event: StreamEvent): void => {
    if (!contents.isDestroyed()) contents.send('twilight:stream', event)
  }

  // Set when the library added passages to your message, so the window shows them.
  let asked = false
  void (async () => {
    let text = ''
    let thinking = ''
    try {
      if (after) await after
      const askedChanged = await addLibraryPassages(conversationId, userNodeId, settings).catch(() => false)
      if (askedChanged) asked = true
      const nodes = db.loadNodes(conversationId)
      const history = trimHistory(
        db.ancestors(nodes, userNodeId).filter((n) => n.role !== 'root'),
        settings.messageLimit
      )
      const config = getProvider(settings.providerId)
      // MCP tools from the servers on for this chat, then pictures; a server that won't connect
      // fails the reply with its reason.
      const mcpTools = settings.mcpServers.length ? await chatTools(settings.mcpServers) : []
      // The library tool goes to models that can call tools (Claude, or one its provider lists with tools).
      const toolsOk = config.kind === 'anthropic' || !!modelInfo(settings.providerId, settings.modelId)?.capabilities?.includes('Tools')
      const clientTools: ClientToolDef[] = [
        ...mcpTools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        ...(settings.imageGen && imageConfig() ? [IMAGE_TOOL_DEF] : []),
        ...(settings.library && toolsOk && librarySettings().folders.length ? [LIBRARY_TOOL] : [])
      ]
      const requestedAt = Date.now()
      let firstTokenAt = 0
      // How long it thought: from the request to the reply's first words (or its end).
      let firstTextAt = 0
      const first = (): void => {
        if (!firstTokenAt) firstTokenAt = Date.now()
        markStarted()
      }
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        // This pane's own system prompt (chats from before it was editable kept it on the root).
        system: systemFor(settings, nodes.get(conv.root_id)?.text ?? ''),
        options: modelOptions(settings.providerId, settings.modelId),
        history,
        settings,
        signal: controller.signal,
        onText: (delta) => {
          first()
          if (!firstTextAt) firstTextAt = Date.now()
          text += delta
          emit({ kind: 'text', conversationId, nodeId: assistant.id, delta })
        },
        onThinking: (delta) => {
          first()
          thinking += delta
          emit({ kind: 'thinking', conversationId, nodeId: assistant.id, delta })
        },
        onActivity: (label) => {
          // The prompt has been read (and cached) by now, but no token has come: tok/s keeps
          // timing from the first real one.
          markStarted()
          emit({ kind: 'activity', conversationId, nodeId: assistant.id, label })
        },
        ...(clientTools.length
          ? {
              clientTools,
              runTools: toolRunner(
                mcpTools,
                controller.signal,
                (approval) => emit({ kind: 'approval', conversationId, nodeId: assistant.id, approval }),
                (label) => {
                  markStarted()
                  emit({ kind: 'activity', conversationId, nodeId: assistant.id, label })
                }
              )
            }
          : {})
      })
      db.updateNode(assistant.id, {
        text: result.text,
        thinking: result.thinking ?? null,
        content: result.content ? JSON.stringify(result.content) : null,
        model: result.modelId,
        usage: JSON.stringify({ ...result.usage, cacheTtl: settings.cacheTtl, ttftMs: firstTokenAt ? firstTokenAt - requestedAt : undefined, thinkMs: thinking ? (firstTextAt || Date.now()) - requestedAt : undefined }),
        status: controller.signal.aborted ? 'stopped' : result.error ? 'error' : 'done',
        error: result.error ?? null
      })
    } catch (err) {
      const message = describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err))
      db.updateNode(assistant.id, { text, thinking: thinking || null, status: 'error', error: message })
    } finally {
      markStarted()
      running.delete(runKey(conversationId, pane))
      db.touchConversation(conversationId)
      const nodes = db.loadNodes(conversationId)
      const row = nodes.get(assistant.id)
      if (row) {
        const askedRow = asked ? nodes.get(userNodeId) : undefined
        emit({ kind: 'done', conversationId, nodeId: assistant.id, node: db.toView(row, nodes), ...(askedRow ? { asked: db.toView(askedRow, nodes) } : {}) })
        signalDone(contents, db.getConversation(conversationId).title, Date.now() - row.created_at)
        appendLog({
          kind: 'chat',
          conversationId,
          title: db.getConversation(conversationId).title,
          pane,
          provider: settings.providerId,
          model: row.model,
          effort: settings.effort ?? undefined,
          cacheTtl: settings.cacheTtl,
          temperature: settings.temperature ?? undefined,
          system: systemFor(settings, nodes.get(conv.root_id)?.text ?? '') || undefined,
          messageLimit: settings.messageLimit ?? undefined,
          turnsBefore: db.ancestors(nodes, userNodeId).length - 2,
          prompt: nodes.get(userNodeId)?.text,
          attachments: nodes.get(userNodeId)?.attachments ? JSON.parse(nodes.get(userNodeId)!.attachments!) : undefined,
          response: row.text,
          thinking: row.thinking ?? undefined,
          usage: row.usage ? JSON.parse(row.usage) : undefined,
          status: row.status,
          error: row.error ?? undefined
        })
      }
    }
  })()
  return started
}
