import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ChatSettings, ConversationView, Pane, SendTarget, StreamEvent } from '@shared/types'
import * as db from './db'
import { getApiKey, getProvider, implFor } from './providers'
import { describeAnthropicError } from './providers/anthropic'

const DEFAULT_SETTINGS: ChatSettings = {
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  systemPrompt: '',
  effort: null,
  cacheTtl: '1h',
  showThinking: false,
  temperature: null,
  maxTokens: 64000
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
  return { ...DEFAULT_SETTINGS, ...db.kvGet<Partial<ChatSettings>>('defaults') }
}

export function setDefaults(patch: Partial<ChatSettings>): ChatSettings {
  db.kvSet('defaults', { ...db.kvGet<Partial<ChatSettings>>('defaults'), ...patch })
  return getDefaults()
}

function splitOf(conv: db.ConversationRow): SplitState | null {
  return conv.split ? (JSON.parse(conv.split) as SplitState) : null
}

function setSplit(id: string, split: SplitState | null): void {
  db.updateConversation(id, { split: split ? JSON.stringify(split) : null })
}

function settingsFor(conv: db.ConversationRow, pane: Pane): ChatSettings {
  const split = splitOf(conv)
  return pane === 'b' && split ? split.settings : (JSON.parse(conv.settings) as ChatSettings)
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
    settings: JSON.parse(conv.settings),
    started: !!conv.started,
    path: toViews(db.activePath(conv, nodes)),
    split: split ? { settings: split.settings, path: toViews(db.ancestors(nodes, split.leafId)) } : null
  }
}

export function create(): ConversationView {
  return view(db.createConversation(getDefaults()).id)
}

export function updateSettings(id: string, patch: Partial<ChatSettings>, pane: Pane = 'a'): ConversationView {
  const conv = db.getConversation(id)
  // The system prompt is part of the cached prefix (and shared by both panes); once the chat
  // starts it stays as sent.
  if (conv.started || pane === 'b') delete patch.systemPrompt
  const split = splitOf(conv)
  if (pane === 'b' && split) setSplit(id, { ...split, settings: { ...split.settings, ...patch } })
  else db.updateConversation(id, { settings: JSON.stringify({ ...settingsFor(conv, 'a'), ...patch }) })
  return view(id)
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New chat'
}

export function send(contents: WebContents, id: string, text: string, target: SendTarget = 'a'): ConversationView {
  let conv = db.getConversation(id)
  const targets = panes(target, conv)
  if (targets.some((p) => isRunning(id, p))) throw new Error('A reply is still streaming in this chat.')
  if (!conv.started) {
    db.updateNode(conv.root_id, { text: settingsFor(conv, 'a').systemPrompt })
    db.updateConversation(id, { started: 1, title: titleFrom(text) })
    conv = db.getConversation(id)
  }
  const nodes = db.loadNodes(id)
  const userNodes = targets.map((pane) => {
    const user = db.insertNode(
      {
        id: randomUUID(),
        conversation_id: id,
        parent_id: leafOf(conv, nodes, pane),
        role: 'user',
        text,
        content: JSON.stringify([{ type: 'text', text }]),
        thinking: null,
        model: null,
        provider_id: null,
        usage: null,
        status: 'done',
        error: null
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
      const history = db.ancestors(nodes, userNodeId).filter((n) => n.role !== 'root')
      const config = getProvider(settings.providerId)
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        system: nodes.get(conv.root_id)?.text ?? '',
        history,
        settings,
        signal: controller.signal,
        onText: (delta) => {
          markStarted()
          text += delta
          emit({ kind: 'text', conversationId, nodeId: assistant.id, delta })
        },
        onThinking: (delta) => {
          markStarted()
          thinking += delta
          emit({ kind: 'thinking', conversationId, nodeId: assistant.id, delta })
        }
      })
      db.updateNode(assistant.id, {
        text: result.text,
        thinking: result.thinking ?? null,
        content: result.content ? JSON.stringify(result.content) : null,
        model: result.modelId,
        usage: JSON.stringify({ ...result.usage, cacheTtl: settings.cacheTtl }),
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
      if (row) emit({ kind: 'done', conversationId, nodeId: assistant.id, node: db.toView(row, nodes) })
    }
  })()
  return started
}
