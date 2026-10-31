import { compactionOf, summaryText } from './compactionBlocks'
import { CHOICES_TOOL } from '@shared/choices'
import { isContextText } from '@shared/attachments'
import { isLocalUrl, isOpenRouter } from '@shared/webTools'
import type { ChatSettings, ModelInfo, ModelOptions, ProviderConfig, WebSource } from '@shared/types'
import type { NodeRow } from '../db'
import { readLogprobs, SAMPLER_FIELDS, TOP_ALTERNATIVES, type Samplers, type TokenProb } from '@shared/confidence'
import { savePictureFrom } from '../generated'
import { MAX_TOOL_ROUNDS, TOO_MANY_ROUNDS, mergeExtraParams, textBlocks, wantsChoiceTool, type ClientOutcome, type GenerateRequest, type GenerateResult, type Provider } from './types'

/** A stored image or PDF block (Claude's format). */
type Block = { type: string; title?: string; text?: string; source?: { media_type?: string; data?: string } }

/** A tool call as stored with the reply, replayed in the next request. */
interface StoredCall {
  id: string
  name: string
  arguments: string
}

/** A round of tools Twilight ran inside a reply: the text before the calls, the calls, their results. */
interface ToolRound {
  type: 'tool_round'
  text: string
  calls: StoredCall[]
  results: { id: string; content: string; isError?: boolean }[]
}

function storedRounds(content: string | null): ToolRound[] {
  if (!content || !content.includes('"tool_round"')) return []
  return (JSON.parse(content) as { type: string }[]).filter((b): b is ToolRound => b.type === 'tool_round')
}

/** A round as the messages it was sent as: the assistant's calls, then one tool message per result. */
function roundMessages(round: ToolRound, available: ReadonlySet<string> | null): Record<string, unknown>[] {
  if (available && round.calls.some((c) => !available.has(c.name))) {
    // Its tools aren't offered any more; told as text so the request stays valid.
    const told = round.calls.map((c) => `(Called ${c.name} with ${c.arguments})`).join('\n')
    const results = round.results.map((r) => `${round.calls.find((c) => c.id === r.id)?.name ?? 'The tool'} returned: ${r.content}`).join('\n\n')
    return [
      { role: 'assistant', content: [round.text, told].filter(Boolean).join('\n\n') },
      { role: 'user', content: results }
    ]
  }
  return [
    { role: 'assistant', content: round.text || null, tool_calls: round.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) },
    ...round.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content }))
  ]
}

/** OpenAI's tool messages take text only; pictures a tool returned are named instead. */
const outcomeText = (o: ClientOutcome): string => (o.images?.length ? `${o.text}\n(${o.images.length} picture${o.images.length === 1 ? '' : 's'} not shown)` : o.text) || '(no output)'

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

export const isLocal = isLocalUrl

/**
 * Web search through OpenRouter's web plugin ({ id: "web" } in `plugins`, documented at
 * openrouter.ai/docs/features/web-search). It searches once per request with the message itself
 * and adds the results to the prompt on OpenRouter's side, so the messages sent stay the same.
 * Other servers have no such field; web fetch has no OpenRouter counterpart here.
 */
export function openRouterPlugins(baseUrl: string | undefined, settings: Pick<ChatSettings, 'webSearch'>): Record<string, unknown>[] | null {
  return settings.webSearch && isOpenRouter(baseUrl) ? [{ id: 'web', max_results: 5 }] : null
}

/** Pulls url_citation annotations (OpenAI's format, which OpenRouter's results use) into sources. */
function addCitations(into: WebSource[], annotations: unknown): void {
  if (!Array.isArray(annotations)) return
  for (const a of annotations as { type?: string; url_citation?: { url?: string; title?: string } }[]) {
    const url = a.type === 'url_citation' ? a.url_citation?.url : undefined
    if (url && !into.some((s) => s.url === url)) into.push({ url, title: a.url_citation?.title ?? '' })
  }
}

interface ListedModel {
  id: string
  name?: string
  context_length?: number
  /** OpenRouter lists the request parameters each model accepts. */
  supported_parameters?: string[]
  top_provider?: { max_completion_tokens?: number }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

/** Abilities a server reports (OpenRouter lists them; most local servers don't). */
function openaiCapabilities(m: ListedModel): string[] {
  const caps = ['Text', 'Streaming']
  const params = m.supported_parameters ?? []
  if (m.architecture?.input_modalities?.includes('image')) caps.push('Vision')
  if (m.architecture?.output_modalities?.includes('image')) caps.push('Image output')
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
    caching: false,
    imageOutput: !!m.architecture?.output_modalities?.includes('image')
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
    const clientNames = new Set((req.clientTools ?? []).map((t) => t.name))
    const messages: Record<string, unknown>[] = []
    if (req.system) messages.push({ role: 'system', content: req.system })
    let pendingCalls: StoredCall[] = []
    for (const node of req.history) {
      if (node.role !== 'user' && node.role !== 'assistant') continue
      // A summary stands in for everything before it, as one message with what it carried.
      const summary = compactionOf(node)
      if (summary) {
        const carried = summary.carried as Block[]
        const text = [summaryText(summary.text), ...carried.filter((b) => b.type === 'text').map((b) => b.text as string)].join('\n\n')
        const media = mediaParts({ ...node, role: 'user', content: JSON.stringify(carried) })
        messages.push({ role: 'user', content: media.length ? [...media, { type: 'text', text }] : text })
        continue
      }
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
      const rounds = node.role === 'assistant' ? storedRounds(node.content) : []
      if (rounds.length && node.status !== 'done') {
        if (node.text) messages.push({ role: 'assistant', content: node.text })
        continue
      }
      for (const round of rounds) messages.push(...roundMessages(round, clientNames))
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
    const tools = [
      ...(wantsChoiceTool(settings) ? [{ name: CHOICES_TOOL.name, description: CHOICES_TOOL.description, input_schema: CHOICES_TOOL.input_schema }] : []),
      ...(req.clientTools ?? [])
    ]
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    // OpenRouter reports what each request cost when asked; that beats any price list.
    if (isOpenRouter(base(req.config))) body.usage = { include: true }
    // An image model draws only when asked for pictures as well as text.
    if (req.options?.imageOutput) body.modalities = ['image', 'text']
    const plugins = openRouterPlugins(base(req.config), settings)
    if (plugins) body.plugins = plugins
    // Local power tools: each token's probability and its runners-up, and the samplers you set.
    if (settings.confidence) {
      body.logprobs = true
      body.top_logprobs = TOP_ALTERNATIVES
    }
    for (const [key, field] of Object.entries(SAMPLER_FIELDS) as [keyof Samplers, string][]) {
      const v = settings.samplers?.[key]
      if (v != null) body[field] = v
    }
    // Branching from a word: the reply so far goes as the assistant's own unfinished message,
    // which llama.cpp (and servers like it) continue rather than answer.
    if (req.prefill) messages.push({ role: 'assistant', content: req.prefill })
    mergeExtraParams(body, settings.extraParams ?? '')

    let text = req.prefill ?? ''
    if (req.prefill) req.onText(req.prefill)
    const tokens: TokenProb[] = []
    let thinking = ''
    // This round's text and tool calls; calls arrive in pieces, keyed by index: the id and name
    // first, the arguments in fragments.
    let roundText = ''
    let calls: StoredCall[] = []
    const rounds: ToolRound[] = []
    const generated: { type: 'generated_image'; file: string; prompt: string }[] = []
    const pictures: string[] = []
    const sources: WebSource[] = []
    const usage: { input: number; output: number; cacheRead: number; cacheWrite: number; ms: number; costUsd?: number; cutOff?: boolean } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0 }
    try {
      for (;;) {
        roundText = ''
        calls = []
        const res = await fetch(`${base(req.config)}/chat/completions`, {
          method: 'POST',
          headers: headers(req.apiKey),
          body: JSON.stringify({ ...body, messages: [...messages, ...rounds.flatMap((r) => roundMessages(r, null))] }),
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
                  annotations?: unknown
                  images?: { image_url?: { url?: string } }[]
                }
                message?: { annotations?: unknown; images?: { image_url?: { url?: string } }[] }
                logprobs?: { content?: unknown }
                finish_reason?: string | null
              }[]
              usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number }
            }
            const delta = chunk.choices?.[0]?.delta
            if (settings.confidence && !rounds.length) tokens.push(...readLogprobs(chunk.choices?.[0]?.logprobs?.content))
            // "length": it hit the max output tokens mid-thought, so the reply can offer Continue.
            if (chunk.choices?.[0]?.finish_reason === 'length') usage.cutOff = true
            addCitations(sources, delta?.annotations)
            addCitations(sources, chunk.choices?.[0]?.message?.annotations)
            // Pictures an image model answers with come as data: URLs beside the text.
            for (const img of [...(delta?.images ?? []), ...(chunk.choices?.[0]?.message?.images ?? [])]) {
              const url = img.image_url?.url
              if (url && !pictures.includes(url)) pictures.push(url)
            }
            const reasoning = delta?.reasoning_content ?? delta?.reasoning
            if (reasoning) {
              thinking += reasoning
              req.onThinking(reasoning)
            }
            if (delta?.content) {
              // Text after a round of tools starts a new paragraph.
              const part = rounds.length && !roundText && text ? `\n\n${delta.content}` : delta.content
              roundText += delta.content
              text += part
              req.onText(part)
            }
            for (const part of delta?.tool_calls ?? []) {
              const call = (calls[part.index ?? 0] ??= { id: '', name: '', arguments: '' })
              if (part.id) call.id = part.id
              if (part.function?.name) call.name += part.function.name
              if (part.function?.arguments) call.arguments += part.function.arguments
            }
            if (chunk.usage) {
              // Each round is its own request; the reply's usage is all of them.
              const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
              usage.input += (chunk.usage.prompt_tokens ?? 0) - cached
              usage.cacheRead += cached
              usage.output += chunk.usage.completion_tokens ?? 0
              if (typeof chunk.usage.cost === 'number') usage.costUsd = (usage.costUsd ?? 0) + chunk.usage.cost
            }
          }
        }
        const asked = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${rounds.length}_${i}` }))
        // Calls to Twilight's own tools are run and the reply carries on; anything else (a
        // present_choices call) ends it.
        if (!req.runTools || !asked.length || !asked.every((c) => clientNames.has(c.name))) break
        if (rounds.length >= MAX_TOOL_ROUNDS) {
          rounds.push({ type: 'tool_round', text: roundText, calls: asked, results: asked.map((c) => ({ id: c.id, content: TOO_MANY_ROUNDS, isError: true })) })
          roundText = ''
          calls = []
          break
        }
        const outcomes = await req.runTools(
          asked.map((c) => {
            let input: Record<string, unknown> = {}
            try {
              input = c.arguments ? (JSON.parse(c.arguments) as Record<string, unknown>) : {}
            } catch {
              input = { __unreadable: c.arguments }
            }
            return { id: c.id, name: c.name, input }
          })
        )
        rounds.push({ type: 'tool_round', text: roundText, calls: asked, results: outcomes.map((o) => ({ id: o.id, content: outcomeText(o), ...(o.isError ? { isError: true } : {}) })) })
        generated.push(...outcomes.flatMap((o) => (o.generated ? [{ type: 'generated_image' as const, ...o.generated }] : [])))
        roundText = ''
        calls = []
        if (req.signal.aborted) break
      }
    } catch (err) {
      if (!req.signal.aborted) throw err
    }
    // Saved with the reply and shown under it; the prompt kept with each is what you asked.
    const asked = [...req.history].reverse().find((n) => n.role === 'user')?.text ?? ''
    for (const url of pictures) {
      try {
        generated.push({ type: 'generated_image', file: await savePictureFrom(url), prompt: asked })
      } catch {
        // A picture that can't be read or saved is left out; the reply's text stays.
      }
    }
    usage.ms = Date.now() - started
    const made = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }))
    // Sources are kept for showing under the reply; text, tool rounds and calls are replayed.
    return {
      text,
      thinking: thinking || undefined,
      content: [
        ...rounds,
        ...generated,
        { type: 'text', text: rounds.length ? roundText : text },
        ...(made.length ? [{ type: 'tool_calls', calls: made }] : []),
        ...(sources.length ? [{ type: 'web_sources', sources }] : [])
      ],
      usage,
      modelId: settings.modelId,
      ...(tokens.length ? { logprobs: tokens } : {})
    }
  }
}
