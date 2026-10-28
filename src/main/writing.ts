import type { WebContents } from 'electron'
import type { ChatSettings, StreamEvent, WritingRequest } from '@shared/types'
import { getDefaults } from './chat'
import type { NodeRow } from './db'
import { getApiKey, getProvider, implFor } from './providers'
import { describeAnthropicError } from './providers/anthropic'

// Writing tools (Rewrite, Tighten, Expand, Ask …) run on a selected passage and stream back a
// replacement, which the editor shows as a suggestion to accept or reject. The system prompt is
// fixed so it caches; the passage and its surroundings go last.

const SYSTEM = `You are a line editor working inside a writer's manuscript.
You receive a passage marked <passage>, the text around it, and an instruction.
Reply with only the replacement text for the passage: no preamble, no quotation marks, no commentary.
Keep the author's voice, tense, point of view and markdown formatting unless the instruction says otherwise.`

const running = new Map<string, AbortController>()

export function stopWritingTool(requestId: string): void {
  running.get(requestId)?.abort()
}

export function runWritingTool(contents: WebContents, requestId: string, req: WritingRequest): void {
  const defaults = getDefaults()
  const config = getProvider(defaults.providerId)
  // Quick edits favour speed: low effort, short output, a 5-minute cache.
  const settings: ChatSettings = {
    ...defaults,
    effort: config.kind === 'anthropic' ? 'low' : defaults.effort,
    cacheTtl: '5m',
    maxTokens: 8000
  }
  const prompt =
    `<manuscript title="${req.title.replace(/"/g, "'")}">\n<before>\n${req.before}\n</before>\n` +
    `<passage>\n${req.passage}\n</passage>\n<after>\n${req.after}\n</after>\n</manuscript>\n\n` +
    `Instruction: ${req.instruction}`
  const history: NodeRow[] = [
    {
      id: requestId, conversation_id: 'writing', parent_id: null, role: 'user', text: prompt, content: null,
      thinking: null, model: null, provider_id: null, usage: null, status: 'done', error: null,
      active_child_id: null, created_at: Date.now()
    }
  ]
  const controller = new AbortController()
  running.set(requestId, controller)
  const emit = (event: StreamEvent): void => {
    if (!contents.isDestroyed()) contents.send('twilight:stream', event)
  }
  const finish = (text: string, status: 'done' | 'error' | 'stopped', error?: string, modelId?: string): void =>
    emit({
      kind: 'done',
      conversationId: 'writing',
      nodeId: requestId,
      node: {
        id: requestId, parentId: null, role: 'assistant', text: text.trim(), status, error,
        modelId, createdAt: Date.now(), siblingIndex: 0, siblingCount: 1
      }
    })

  void (async () => {
    let text = ''
    try {
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        system: SYSTEM,
        history,
        settings,
        signal: controller.signal,
        onText: (delta) => {
          text += delta
          emit({ kind: 'text', conversationId: 'writing', nodeId: requestId, delta })
        },
        onThinking: () => {}
      })
      finish(result.text, controller.signal.aborted ? 'stopped' : result.error ? 'error' : 'done', result.error, result.modelId)
    } catch (err) {
      finish(text, 'error', describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err)))
    } finally {
      running.delete(requestId)
    }
  })()
}
