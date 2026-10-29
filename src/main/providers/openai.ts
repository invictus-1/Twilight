import { CHOICES_TOOL } from '@shared/choices'
import { isContextText } from '@shared/attachments'
import type { ModelInfo, ModelOptions, ProviderConfig } from '@shared/types'
import type { NodeRow } from '../db'
import { mergeExtraParams, textBlocks, wantsChoiceTool, type GenerateRequest, type GenerateResult, type Provider } from './types'

/** A stored image or PDF block (Claude's format). */
type Block = { type: string; title?: string; source?: { media_type?: string; data?: string } }

/** A tool call as stored with the reply, replayed in the next request. */
interface StoredCall {
  id: string
  name: string
  arguments: string
}

function storedCalls(content: string | null): StoredCall[] {
  if (!content) return []
  const block = (JSON.parse(content) as { type: string; calls?: StoredCall[] }[]).find((b) => b.type === 'tool_calls')
  return block?.calls ?? []
}

// OpenAI-compatible chat servers: Ollama, LM Studio, llama.cpp, vLLM and the like. Local servers
// reuse their KV cache for an unchanged prefix, so the same append-only history applies here.

function headers(apiKey?: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }
}

function base(config: ProviderConfig): string {
  return (config.baseUrl ?? '').replace(/\/+$/, '')
}

export function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(url)
}

interface ListedModel {
  id: string
  name?: string
  context_length?: number
  /** OpenRouter lists the request parameters each model accepts. */
  supported_parameters?: string[]
  top_provider?: { max_completion_tokens?: number }
  architecture?: { input_modalities?: string[] }
}

/** Abilities a server reports (OpenRouter lists them; most local servers don't). */
function openaiCapabilities(m: ListedModel): string[] {
  const caps = ['Text', 'Streaming']
  const params = m.supported_parameters ?? []
  if (m.architecture?.input_modalities?.includes('image')) caps.push('Vision')
  if (params.includes('tools')) caps.push('Tools')
  if (params.includes('reasoning')) caps.push('Reasoning')
  if (params.includes('structured_outputs')) caps.push('Structured output')
  return caps
}

/**
 * OpenAI-compatible servers don't report effort levels, so they get the standard reasoning_effort
 * names (which servers may ignore for models without reasoning). OpenRouter is the exception: it
 * lists each model's supported parameters, and takes reasoning as { effort }.
 */
function openaiOptions(m: ListedModel, openRouter: boolean): ModelOptions {
  const supports = (p: string): boolean => !m.supported_parameters || m.supported_parameters.includes(p)
  const reasons = openRouter ? supports('reasoning') : true
  return {
    efforts: reasons ? ['low', 'medium', 'high'] : [],
    effortParam: reasons ? (openRouter ? 'openrouter' : 'reasoning_effort') : null,
    effortsFromProvider: openRouter && !!m.supported_parameters,
    adaptiveThinking: false,
    temperature: supports('temperature'),
    maxOutput: m.top_provider?.max_completion_tokens,
    // Local servers reuse their own cache for an unchanged prefix; there's nothing to switch.
    caching: false
  }
}

export const openaiProvider: Provider = {
  async listModels(config: ProviderConfig, apiKey?: string): Promise<ModelInfo[]> {
    const res = await fetch(`${base(config)}/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error(`${config.name}: ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { data?: ListedModel[] }
    const openRouter = /openrouter\.ai/i.test(base(config))
    return (json.data ?? [])
      .map((m) => ({
        id: m.id,
        providerId: config.id,
        name: m.name ?? m.id,
        local: isLocal(base(config)),
        contextWindow: m.context_length,
        options: openaiOptions(m, openRouter),
        capabilities: openaiCapabilities(m)
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // Images and PDFs are stored as Claude-format blocks; here they become content parts.
    const mediaParts = (node: NodeRow): Record<string, unknown>[] =>
      node.role !== 'user' || !node.content
        ? []
        : (JSON.parse(node.content) as Block[]).flatMap((b): Record<string, unknown>[] =>
            b.type === 'image'
              ? [{ type: 'image_url', image_url: { url: `data:${b.source?.media_type};base64,${b.source?.data}` } }]
              : b.type === 'document' && b.source?.media_type === 'application/pdf'
                ? [{ type: 'file', file: { filename: b.title ?? 'document.pdf', file_data: `data:application/pdf;base64,${b.source.data}` } }]
                : []
          )
    const withMedia = (node: NodeRow, text: string): string | Record<string, unknown>[] => {
      const media = mediaParts(node)
      return media.length ? [...media, ...(text ? [{ type: 'text', text }] : [])] : text
    }
    const { settings } = req
    const started = Date.now()
    const messages: Record<string, unknown>[] = []
    if (req.system) messages.push({ role: 'system', content: req.system })
    let pendingCalls: StoredCall[] = []
    for (const node of req.history) {
      if (node.role !== 'user' && node.role !== 'assistant') continue
      const blocks = textBlocks(node)
      if (node.role === 'user' && pendingCalls.length) {
        // The reader's answer to a present_choices call goes back as the call's result; attached
        // documents follow as an ordinary user message.
        const answer = blocks.filter((b) => !isContextText(b.text)).map((b) => b.text).join('\n\n') || node.text
        pendingCalls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: i === 0 ? answer : 'Answered with the first call.' }))
        pendingCalls = []
        const docs = blocks.filter((b) => isContextText(b.text)).map((b) => b.text).join('\n\n')
        if (docs || mediaParts(node).length) messages.push({ role: 'user', content: withMedia(node, docs) })
        continue
      }
      const text = blocks.map((b) => b.text).join('\n\n')
      const calls = node.role === 'assistant' && node.status === 'done' ? storedCalls(node.content) : []
      if (!text && !calls.length && !mediaParts(node).length) continue
      if (calls.length) {
        messages.push({ role: 'assistant', content: text || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) })
        pendingCalls = calls
      } else messages.push({ role: node.role, content: withMedia(node, text) })
    }

    const body: Record<string, unknown> = {
      model: settings.modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    }
    // max_tokens only when chosen: local servers cap output at their own context size, and a
    // large default can exceed a small context window and fail the request.
    if (settings.maxTokens != null) body.max_tokens = settings.maxTokens
    if (settings.temperature != null && req.options?.temperature !== false) body.temperature = settings.temperature
    if (settings.effort) {
      if (req.options?.effortParam === 'openrouter') body.reasoning = { effort: settings.effort }
      else body.reasoning_effort = settings.effort
    }
    if (wantsChoiceTool(settings)) {
      body.tools = [{ type: 'function', function: { name: CHOICES_TOOL.name, description: CHOICES_TOOL.description, parameters: CHOICES_TOOL.input_schema } }]
    }
    // OpenRouter reports what each request cost when asked; that beats any price list.
    if (/openrouter\.ai/i.test(base(req.config))) body.usage = { include: true }
    mergeExtraParams(body, settings.extraParams ?? '')

    let text = ''
    let thinking = ''
    // Tool calls arrive in pieces, keyed by index: the id and name first, the arguments in fragments.
    const calls: StoredCall[] = []
    const usage: { input: number; output: number; cacheRead: number; cacheWrite: number; ms: number; costUsd?: number } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0 }
    try {
      const res = await fetch(`${base(req.config)}/chat/completions`, {
        method: 'POST',
        headers: headers(req.apiKey),
        body: JSON.stringify(body),
        signal: req.signal
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        throw new Error(`${req.config.name} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          const chunk = JSON.parse(data) as {
            choices?: {
              delta?: {
                content?: string
                reasoning_content?: string
                reasoning?: string
                tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
              }
            }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number }
          }
          const delta = chunk.choices?.[0]?.delta
          const reasoning = delta?.reasoning_content ?? delta?.reasoning
          if (reasoning) {
            thinking += reasoning
            req.onThinking(reasoning)
          }
          if (delta?.content) {
            text += delta.content
            req.onText(delta.content)
          }
          for (const part of delta?.tool_calls ?? []) {
            const call = (calls[part.index ?? 0] ??= { id: '', name: '', arguments: '' })
            if (part.id) call.id = part.id
            if (part.function?.name) call.name += part.function.name
            if (part.function?.arguments) call.arguments += part.function.arguments
          }
          if (chunk.usage) {
            const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
            usage.input = (chunk.usage.prompt_tokens ?? 0) - cached
            usage.cacheRead = cached
            usage.output = chunk.usage.completion_tokens ?? 0
            if (typeof chunk.usage.cost === 'number') usage.costUsd = chunk.usage.cost
          }
        }
      }
    } catch (err) {
      if (!req.signal.aborted) throw err
    }
    usage.ms = Date.now() - started
    const made = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }))
    return {
      text,
      thinking: thinking || undefined,
      content: made.length ? [{ type: 'text', text }, { type: 'tool_calls', calls: made }] : [{ type: 'text', text }],
      usage,
      modelId: settings.modelId
    }
  }
}
