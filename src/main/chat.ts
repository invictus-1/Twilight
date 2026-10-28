import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Attachment, ChatSettings, ConversationView, DeletionView, Pane, SendTarget, StreamEvent } from '@shared/types'
import * as db from './db'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { appendLog } from './logs'
import { describeAnthropicError } from './providers/anthropic'
import { toWorkspace, workspaceSystemPrompt } from './workspaces'
import { CHOICES_INSTRUCTION, CHOICES_TOOL_INSTRUCTION } from '@shared/choices'

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
  choiceInstructions: true
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

/** A new chat takes the defaults, overlaid with its workspace's system prompt and model. */
export function create(folderId: string | null = null): ConversationView {
  const settings = getDefaults()
  const row = folderId ? db.getFolder(folderId) : undefined
  if (row) {
    const ws = toWorkspace(row)
    settings.systemPrompt = workspaceSystemPrompt(ws) || settings.systemPrompt
    if (ws.providerId && ws.modelId) {
      settings.providerId = ws.providerId
      settings.modelId = ws.modelId
    }
    if (ws.choiceCards) settings.choiceCards = true
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
  const content = [
    ...attachments.map((a) => ({ type: 'text', text: `<document name="${escapeAttr(a.name)}">\n${a.text}\n</document>` })),
    ...(text ? [{ type: 'text', text }] : [])
  ]
  const nodes = db.loadNodes(id)
  const userNodes = targets.map((pane) => {
    const user = db.insertNode(
      {
        id: randomUUID(),
        conversation_id: id,
        parent_id: leafOf(conv, nodes, pane),
        role: 'user',
        text,
        content: JSON.stringify(content),
        thinking: null,
        model: null,
        provider_id: null,
        usage: null,
        status: 'done',
        error: null,
        attachments: attachments.length ? JSON.stringify(attachments.map((a) => ({ name: a.name, chars: a.text.length }))) : null
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

export function regenerate(contents: WebContents, id: string, assistantNodeId: string, pane: Pane = 'a'): ConversationView {
  if (isRunning(id, pane)) throw new Error('A reply is still streaming in this pane.')
  const node = db.loadNodes(id).get(assistantNodeId)
  if (!node?.parent_id) throw new Error('Nothing to regenerate.')
  generate(contents, id, node.parent_id, pane)
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

export function editMessage(contents: WebContents, id: string, nodeId: string, text: string, pane: Pane = 'a'): ConversationView {
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
    // Keep its attached documents; replace what was typed.
    const blocks = node.content ? (JSON.parse(node.content) as { type: string; text?: string }[]) : []
    const docs = blocks.filter((b) => b.type === 'text' && b.text?.startsWith('<document name='))
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
  if (node.role === 'user') generate(contents, id, edited.id, pane)
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

  void (async () => {
    let text = ''
    let thinking = ''
    try {
      if (after) await after
      const nodes = db.loadNodes(conversationId)
      const history = trimHistory(
        db.ancestors(nodes, userNodeId).filter((n) => n.role !== 'root'),
        settings.messageLimit
      )
      const config = getProvider(settings.providerId)
      const requestedAt = Date.now()
      let firstTokenAt = 0
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
          text += delta
          emit({ kind: 'text', conversationId, nodeId: assistant.id, delta })
        },
        onThinking: (delta) => {
          first()
          thinking += delta
          emit({ kind: 'thinking', conversationId, nodeId: assistant.id, delta })
        }
      })
      db.updateNode(assistant.id, {
        text: result.text,
        thinking: result.thinking ?? null,
        content: result.content ? JSON.stringify(result.content) : null,
        model: result.modelId,
        usage: JSON.stringify({ ...result.usage, cacheTtl: settings.cacheTtl, ttftMs: firstTokenAt ? firstTokenAt - requestedAt : undefined }),
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
        emit({ kind: 'done', conversationId, nodeId: assistant.id, node: db.toView(row, nodes) })
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
