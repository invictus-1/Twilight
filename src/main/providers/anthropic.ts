import Anthropic from '@anthropic-ai/sdk'
import type { ModelInfo, ProviderConfig } from '@shared/types'
import type { NodeRow } from '../db'
import { textBlocks, type GenerateRequest, type GenerateResult, type Provider } from './types'

// Prompt caching is a prefix match, so every request is built to be the previous request plus
// the new turns: frozen system prompt first (with its own breakpoint), then the history with
// each assistant turn replayed exactly as the API returned it, then the new user turn. The
// top-level cache_control moves the second breakpoint to the end of the conversation.

/** Models older than the 4.6 generation take budget_tokens thinking, which Twilight does not send. */
const NO_ADAPTIVE_THINKING = /^claude-(3|haiku-4-5|sonnet-4-5|sonnet-4$|sonnet-4-2|opus-4$|opus-4-1|opus-4-2|opus-4-5)/
/** Models that accept the server-side refusal fallback. */
const SUPPORTS_FALLBACK = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/

type Block = { type: string; [key: string]: unknown }
type Message = { role: 'user' | 'assistant'; content: Block[] }

function toMessages(history: NodeRow[]): Message[] {
  const messages: Message[] = []
  for (const node of history) {
    let role: 'user' | 'assistant'
    let content: Block[]
    if (node.role === 'user') {
      role = 'user'
      content = node.content ? (JSON.parse(node.content) as Block[]) : [{ type: 'text', text: node.text }]
    } else if (node.role === 'assistant') {
      if (!node.text && !node.content) continue // an empty failed turn adds nothing
      role = 'assistant'
      // Replay Claude's own blocks unchanged (thinking blocks included) so the prefix and any
      // preserved thinking stay valid. Other providers store plain text blocks.
      content = node.content
        ? (JSON.parse(node.content) as Block[]).filter((b) => b.type !== 'fallback')
        : textBlocks(node)
      if (node.status !== 'done') content = content.filter((b) => b.type === 'text')
      if (!content.length) continue
    } else continue
    const last = messages[messages.length - 1]
    if (last && last.role === role) last.content.push(...content)
    else messages.push({ role, content })
  }
  return messages
}

export const anthropicProvider: Provider = {
  async listModels(config: ProviderConfig, apiKey?: string): Promise<ModelInfo[]> {
    if (!apiKey) return []
    const client = new Anthropic({ apiKey })
    const models: ModelInfo[] = []
    for await (const m of client.models.list({ limit: 100 })) {
      models.push({
        id: m.id,
        providerId: config.id,
        name: m.display_name,
        local: false,
        contextWindow: (m as unknown as { max_input_tokens?: number }).max_input_tokens
      })
    }
    return models
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!req.apiKey) throw new Error('Add an Anthropic API key in Settings → Providers.')
    const client = new Anthropic({ apiKey: req.apiKey })
    const { settings } = req
    const model = settings.modelId
    const ttl = settings.cacheTtl
    const started = Date.now()

    const body: Record<string, unknown> = {
      model,
      max_tokens: settings.maxTokens,
      messages: toMessages(req.history),
      cache_control: { type: 'ephemeral', ttl }
    }
    if (req.system) body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral', ttl } }]
    if (!NO_ADAPTIVE_THINKING.test(model)) body.thinking = { type: 'adaptive', display: 'summarized' }
    if (settings.effort) body.output_config = { effort: settings.effort }
    const betas: string[] = []
    if (SUPPORTS_FALLBACK.test(model)) {
      betas.push('server-side-fallback-2026-07-01')
      body.fallbacks = 'default'
    }

    const stream = client.beta.messages.stream(
      { ...body, betas } as unknown as Parameters<typeof client.beta.messages.stream>[0],
      { signal: req.signal }
    )

    let text = ''
    let thinking = ''
    try {
      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue
        if (event.delta.type === 'text_delta') {
          text += event.delta.text
          req.onText(event.delta.text)
        } else if (event.delta.type === 'thinking_delta') {
          thinking += event.delta.thinking
          req.onThinking(event.delta.thinking)
        }
      }
    } catch (err) {
      if (req.signal.aborted) {
        return {
          text,
          thinking: thinking || undefined,
          content: text ? [{ type: 'text', text }] : null,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: Date.now() - started },
          modelId: model
        }
      }
      throw err
    }

    const final = await stream.finalMessage()
    const finalText = final.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const finalThinking = final.content
      .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
      .map((b) => b.thinking)
      .join('\n\n')
    const usage = final.usage
    return {
      text: finalText,
      thinking: finalThinking || undefined,
      content: final.content,
      modelId: final.model,
      usage: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        ms: Date.now() - started
      },
      error: final.stop_reason === 'refusal' ? 'The model declined this request.' : undefined
    }
  }
}

export function describeAnthropicError(err: unknown): string | undefined {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check it in Settings → Providers.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Wait a moment and regenerate.'
  if (err instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection."
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ''}: ${err.message}`
  return undefined
}
