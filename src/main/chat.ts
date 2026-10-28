import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ChatSettings, ConversationView, StreamEvent } from '@shared/types'
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

const running = new Map<string, AbortController>()

export function getDefaults(): ChatSettings {
  return { ...DEFAULT_SETTINGS, ...db.kvGet<Partial<ChatSettings>>('defaults') }
}

export function setDefaults(patch: Partial<ChatSettings>): ChatSettings {
  db.kvSet('defaults', { ...db.kvGet<Partial<ChatSettings>>('defaults'), ...patch })
  return getDefaults()
}

export function view(id: string): ConversationView {
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  const path = db
    .activePath(conv, nodes)
    .slice(1)
    .map((n) => db.toView(n, nodes))
  return { id, title: conv.title, settings: JSON.parse(conv.settings), started: !!conv.started, path }
}

export function create(): ConversationView {
  return view(db.createConversation(getDefaults()).id)
}

export function updateSettings(id: string, patch: Partial<ChatSettings>): ConversationView {
  const conv = db.getConversation(id)
  const current = JSON.parse(conv.settings) as ChatSettings
  // The system prompt is part of the cached prefix; once the chat starts it stays as sent.
  if (conv.started) delete patch.systemPrompt
  db.updateConversation(id, { settings: JSON.stringify({ ...current, ...patch }) })
  return view(id)
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New chat'
}

export function send(contents: WebContents, id: string, text: string): ConversationView {
  if (running.has(id)) throw new Error('A reply is still streaming in this chat.')
  const conv = db.getConversation(id)
  const nodes = db.loadNodes(id)
  const path = db.activePath(conv, nodes)
  if (!conv.started) {
    const settings = JSON.parse(conv.settings) as ChatSettings
    db.updateNode(conv.root_id, { text: settings.systemPrompt })
    db.updateConversation(id, { started: 1, title: titleFrom(text) })
  }
  const user = db.insertNode({
    id: randomUUID(),
    conversation_id: id,
    parent_id: path[path.length - 1].id,
    role: 'user',
    text,
    content: JSON.stringify([{ type: 'text', text }]),
    thinking: null,
    model: null,
    provider_id: null,
    usage: null,
    status: 'done',
    error: null
  })
  generate(contents, id, user.id)
  return view(id)
}

export function regenerate(contents: WebContents, id: string, assistantNodeId: string): ConversationView {
  if (running.has(id)) throw new Error('A reply is still streaming in this chat.')
  const node = db.loadNodes(id).get(assistantNodeId)
  if (!node?.parent_id) throw new Error('Nothing to regenerate.')
  generate(contents, id, node.parent_id)
  return view(id)
}

export function switchBranch(id: string, nodeId: string, direction: -1 | 1): ConversationView {
  const nodes = db.loadNodes(id)
  const node = nodes.get(nodeId)
  if (!node?.parent_id) return view(id)
  const siblings = db.childrenOf(nodes, node.parent_id)
  const target = siblings[siblings.findIndex((s) => s.id === nodeId) + direction]
  if (target) db.setActiveChild(node.parent_id, target.id)
  return view(id)
}

export function stop(id: string): void {
  running.get(id)?.abort()
}

/** Starts a reply to `userNodeId` as a new branch and streams it to the renderer. */
function generate(contents: WebContents, conversationId: string, userNodeId: string): void {
  const conv = db.getConversation(conversationId)
  const settings = JSON.parse(conv.settings) as ChatSettings
  const assistant = db.insertNode({
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
  })
  const controller = new AbortController()
  running.set(conversationId, controller)

  const emit = (event: StreamEvent): void => {
    if (!contents.isDestroyed()) contents.send('twilight:stream', event)
  }

  void (async () => {
    let text = ''
    let thinking = ''
    try {
      const nodes = db.loadNodes(conversationId)
      const history: db.NodeRow[] = []
      for (let n = nodes.get(userNodeId); n && n.role !== 'root'; n = n.parent_id ? nodes.get(n.parent_id) : undefined) {
        history.unshift(n)
      }
      const config = getProvider(settings.providerId)
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        system: nodes.get(conv.root_id)?.text ?? '',
        history,
        settings,
        signal: controller.signal,
        onText: (delta) => {
          text += delta
          emit({ kind: 'text', conversationId, nodeId: assistant.id, delta })
        },
        onThinking: (delta) => {
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
      running.delete(conversationId)
      db.touchConversation(conversationId)
      const nodes = db.loadNodes(conversationId)
      const row = nodes.get(assistant.id)
      if (row) emit({ kind: 'done', conversationId, nodeId: assistant.id, node: db.toView(row, nodes) })
    }
  })()
}
