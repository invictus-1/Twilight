import Anthropic from '@anthropic-ai/sdk'
import type { ModelInfo, ModelOptions, ProviderConfig } from '@shared/types'
import type { NodeRow } from '../db'
import { CHOICES_TOOL } from '@shared/choices'
import { mergeExtraParams, textBlocks, wantsChoiceTool, type GenerateRequest, type GenerateResult, type Provider } from './types'

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

/** Block types replayed from a stored reply; anything else (another provider's bookkeeping) is left out. */
const REPLAYED = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use'])
const isDocument = (b: Block): boolean => b.type === 'text' && typeof b.text === 'string' && b.text.startsWith('<document name=')

export function toMessages(history: NodeRow[]): Message[] {
  const messages: Message[] = []
  for (const node of history) {
    let role: 'user' | 'assistant'
    let content: Block[]
    if (node.role === 'user') {
      role = 'user'
      content = node.content ? (JSON.parse(node.content) as Block[]) : [{ type: 'text', text: node.text }]
      // After a present_choices call, the reader's answer is that call's result. Tool results go
      // first in the turn; attached documents follow. Rebuilt the same way every time, so cached.
      const prev = messages.at(-1)
      const calls = prev?.role === 'assistant' ? prev.content.filter((b) => b.type === 'tool_use') : []
      if (calls.length) {
        const answer = content.filter((b) => b.type === 'text' && !isDocument(b)).map((b) => b.text as string).join('\n\n') || node.text
        content = [
          ...calls.map((call, i) => ({ type: 'tool_result', tool_use_id: call.id, content: i === 0 ? answer : 'Answered with the first call.' })),
          ...content.filter(isDocument)
        ]
      }
    } else if (node.role === 'assistant') {
      if (!node.text && !node.content) continue // an empty failed turn adds nothing
      role = 'assistant'
      // Replay Claude's own blocks unchanged (thinking blocks included) so the prefix and any
      // preserved thinking stay valid. Other providers store plain text blocks.
      content = node.content
        ? (JSON.parse(node.content) as Block[]).filter((b) => REPLAYED.has(b.type))
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

const CAP_LABELS: Record<string, string> = {
  image_input: 'Vision',
  pdf_input: 'PDF input',
  thinking: 'Thinking',
  effort: 'Effort',
  structured_outputs: 'Structured output',
  citations: 'Citations',
  code_execution: 'Code execution',
  context_management: 'Context editing',
  batch: 'Batch'
}

/** Every ability the Models API marks supported, in readable names (unknown keys prettified). */
function capabilityLabels(caps: Capabilities | undefined): string[] {
  const listed = caps
    ? Object.entries(caps)
        .filter(([, v]) => typeof v === 'object' && v?.supported)
        .map(([k]) => CAP_LABELS[k] ?? k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))
    : []
  return ['Text', 'Streaming', ...listed]
}

export const anthropicProvider: Provider = {
  listModels: (config, apiKey) => explainKey(apiKey, () => listAnthropicModels(config, apiKey)),
  generate: (req) => explainKey(req.apiKey, () => generateAnthropic(req))
}

/**
 * What a rejected key looks like, without showing it: only its public prefix and length. Claude
 * subscription sign-in tokens (sk-ant-oat…) are the usual mix-up; the API takes Console keys only.
 */
export function keyShape(key: string | undefined): string {
  if (!key) return 'No key is saved.'
  const size = `${key.length} characters`
  if (key.startsWith('sk-ant-oat'))
    return `The saved key is a Claude subscription sign-in token (it starts with sk-ant-oat, ${size}), which the API doesn't accept. Create an API key at console.anthropic.com → API keys and paste that instead.`
  if (!key.startsWith('sk-ant-'))
    return `The saved key doesn't start with sk-ant-, so it isn't an Anthropic API key (${size}). It may be from another service.`
  return `The saved key has the right shape (sk-ant-…, ${size}) but Anthropic doesn't recognise it: it may have been revoked or deleted, or be from a disabled workspace. Make a new one at console.anthropic.com → API keys.`
}

/** Attaches the key's shape to an authentication error, for describeAnthropicError. */
async function explainKey<T>(apiKey: string | undefined, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) Object.assign(err, { keyHint: keyShape(apiKey) })
    throw err
  }
}

async function listAnthropicModels(config: ProviderConfig, apiKey?: string): Promise<ModelInfo[]> {
  if (!apiKey) return []
  const client = anthropicClient(config, apiKey)
  const models: ModelInfo[] = []
  for await (const m of client.models.list({ limit: 100 })) {
    const extra = m as unknown as { max_input_tokens?: number; max_tokens?: number; capabilities?: Capabilities }
    models.push({
      id: m.id,
      providerId: config.id,
      name: m.display_name,
      local: false,
      contextWindow: extra.max_input_tokens,
      options: anthropicOptions(m.id, extra.capabilities, extra.max_tokens),
      capabilities: capabilityLabels(extra.capabilities)
    })
  }
  return models
}

async function generateAnthropic(req: GenerateRequest): Promise<GenerateResult> {
  if (!req.apiKey) throw new Error('Add an Anthropic API key in Settings → Providers.')
  const client = anthropicClient(req.config, req.apiKey)
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
  // Tools sit at the very start of the cached prefix, so the choice tool is sent on every turn
  // while the mode is on. Its input is a few short labels: the API's default buffering (which
  // validates the JSON before streaming it) is worth more here than eager input streaming.
  if (wantsChoiceTool(settings)) body.tools = [CHOICES_TOOL]
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

export const ANTHROPIC_DEFAULT_URL = 'https://api.anthropic.com'

/**
 * Every Anthropic client is built from Twilight's own settings only. The SDK otherwise reads
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN from the environment, which other tools (Claude Code
 * among them) set for themselves; inherited, they'd send Twilight's key to the wrong place.
 */
export function anthropicClient(config: ProviderConfig, apiKey: string): Anthropic {
  // The SDK adds /v1 itself; an endpoint written with it would become /v1/v1.
  const base = config.baseUrl?.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  return new Anthropic({ apiKey, authToken: null, baseURL: base || ANTHROPIC_DEFAULT_URL })
}

export function describeAnthropicError(err: unknown): string | undefined {
  if (err instanceof Anthropic.AuthenticationError) {
    const hint = (err as { keyHint?: string }).keyHint
    return `Anthropic rejected the API key (${err.status}). ${hint ?? 'Check it in Settings → Model providers.'}`
  }
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Wait a moment and regenerate.'
  if (err instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection."
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ''}: ${err.message}`
  return undefined
}
