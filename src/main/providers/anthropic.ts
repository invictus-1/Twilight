import Anthropic from '@anthropic-ai/sdk'
import type { ModelInfo, ModelOptions, ProviderConfig } from '@shared/types'
import type { NodeRow } from '../db'
import { mergeExtraParams, textBlocks, type GenerateRequest, type GenerateResult, type Provider } from './types'

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

/** Claude Opus 5.5 and Haiku 5.5 default to medium effort; the rest of the current family to high. */
const MEDIUM_DEFAULT = /^claude-(opus-5-5|haiku-5-5)/

type Capabilities = Record<string, { supported?: boolean; types?: Record<string, { supported?: boolean }> } & Record<string, unknown>>

/**
 * Reads a model's options from the Models API capability tree: the effort levels it lists (in the
 * API's own names and order) and whether it takes adaptive thinking. Falls back to known rules
 * for responses without capabilities.
 */
export function anthropicOptions(id: string, caps: Capabilities | undefined, maxOutput?: number): ModelOptions {
  let efforts: string[]
  let adaptive: boolean
  if (caps) {
    const effort = caps.effort as (Record<string, { supported?: boolean }> & { supported?: boolean }) | undefined
    efforts = effort?.supported
      ? Object.entries(effort).filter(([k, v]) => k !== 'supported' && typeof v === 'object' && v?.supported).map(([k]) => k)
      : []
    adaptive = !!caps.thinking?.types?.adaptive?.supported
  } else {
    adaptive = !NO_ADAPTIVE_THINKING.test(id)
    efforts = adaptive ? ['low', 'medium', 'high', 'xhigh', 'max'] : []
  }
  return {
    efforts,
    effortParam: efforts.length ? 'anthropic' : null,
    defaultEffort: efforts.length ? (MEDIUM_DEFAULT.test(id) ? 'medium' : 'high') : undefined,
    effortsFromProvider: !!caps,
    adaptiveThinking: adaptive,
    temperature: false,
    maxOutput,
    caching: true
  }
}

export const anthropicProvider: Provider = {
  async listModels(config: ProviderConfig, apiKey?: string): Promise<ModelInfo[]> {
    if (!apiKey) return []
    const client = new Anthropic({ apiKey })
    const models: ModelInfo[] = []
    for await (const m of client.models.list({ limit: 100 })) {
      const extra = m as unknown as { max_input_tokens?: number; max_tokens?: number; capabilities?: Capabilities }
      models.push({
        id: m.id,
        providerId: config.id,
        name: m.display_name,
        local: false,
        contextWindow: extra.max_input_tokens,
        options: anthropicOptions(m.id, extra.capabilities, extra.max_tokens)
      })
    }
    return models
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!req.apiKey) throw new Error('Add an Anthropic API key in Settings → Providers.')
    const client = new Anthropic({ apiKey: req.apiKey })
    const { settings } = req
    const model = settings.modelId
    const options = req.options ?? anthropicOptions(model, undefined)
    const ttl = settings.cacheTtl
    const cache = settings.caching ? { cache_control: { type: 'ephemeral', ttl } } : {}
    const started = Date.now()

    const body: Record<string, unknown> = {
      model,
      // Claude needs max_tokens; "model default" means the model's maximum, capped at 64k.
      max_tokens: Math.min(settings.maxTokens ?? 64000, options.maxOutput ?? 128000),
      messages: toMessages(req.history),
      ...cache
    }
    if (req.system) body.system = [{ type: 'text', text: req.system, ...cache }]
    if (options.adaptiveThinking) body.thinking = { type: 'adaptive', display: settings.thinkingDisplay }
    // Only levels this model lists; a level from another model would be rejected.
    if (settings.effort && options.efforts.includes(settings.effort)) body.output_config = { effort: settings.effort }
    const betas: string[] = []
    if (SUPPORTS_FALLBACK.test(model)) {
      betas.push('server-side-fallback-2026-07-01')
      body.fallbacks = 'default'
    }
    mergeExtraParams(body, settings.extraParams ?? '')

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
