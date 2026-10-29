import type { ModelOptions, ProviderConfig } from '@shared/types'
import { anthropicClient } from '../providers/anthropic'

// One step of the agent's conversation: send the transcript and the tools, stream the text, and
// return the reply's blocks and the tool calls in it. The transcript is kept in Claude's block
// format (text, tool_use, tool_result) and converted for OpenAI-compatible servers. Like the chat,
// it only ever grows at the end, and stored replies are sent back exactly as they came, so each
// step reads the one before from the prompt cache.

export type Block = { type: string; [key: string]: unknown }
export interface Msg {
  role: 'user' | 'assistant'
  content: Block[]
}
export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}
export interface StepResult {
  content: Block[]
  text: string
  calls: ToolCall[]
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /** Set when the model stopped early (out of tokens, refused). */
  error?: string
}

export interface StepRequest {
  config: ProviderConfig
  apiKey?: string
  modelId: string
  options?: ModelOptions
  system: string
  messages: Msg[]
  tools: ToolDef[]
  /** Claude's own web search and fetch, run on Anthropic's side. */
  web?: boolean
  signal: AbortSignal
  onText(delta: string): void
}

const callsOf = (content: Block[]): ToolCall[] =>
  content.filter((b) => b.type === 'tool_use').map((b) => ({ id: String(b.id), name: String(b.name), input: (b.input as Record<string, unknown>) ?? {} }))
const textOf = (content: Block[]): string =>
  content
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text))
    .join('')

export function step(req: StepRequest): Promise<StepResult> {
  return req.config.kind === 'anthropic' ? stepAnthropic(req) : stepOpenAI(req)
}

async function stepAnthropic(req: StepRequest): Promise<StepResult> {
  if (!req.apiKey) throw new Error('Add an Anthropic API key in Settings → Model providers.')
  const client = anthropicClient(req.config, req.apiKey)
  const cache = { cache_control: { type: 'ephemeral' as const } }
  const messages = req.messages.map((m) => ({
    ...m,
    // A session that started on another provider keeps its raw call arguments; Claude doesn't take
    // them. With web tools off, earlier searches are left out (the tools list changed anyway).
    content: (req.web ? m.content : m.content.filter((b) => !WEB_BLOCKS.has(b.type))).map((b) =>
      b.type === 'tool_use' && 'raw' in b ? (({ raw: _r, ...rest }) => rest)(b) : b
    )
  }))
  const body: Record<string, unknown> = {
    model: req.modelId,
    max_tokens: Math.min(32000, req.options?.maxOutput ?? 32000),
    system: [{ type: 'text', text: req.system, ...cache }],
    tools: [...req.tools, ...(req.web ? codeWebTools(req.modelId) : [])],
    messages,
    // The second breakpoint follows the end of the transcript, step after step.
    ...cache
  }
  if (req.options?.adaptiveThinking) body.thinking = { type: 'adaptive', display: 'summarized' }
  // A long run of searches pauses the turn; it's resumed with what came so far, a few times at most.
  const content: Block[] = []
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let stop: string | null = null
  for (let round = 0; round < 4; round++) {
    const sent = content.length ? [...messages, { role: 'assistant', content: [...content] }] : messages
    const stream = client.messages.stream({ ...body, messages: sent } as never, { signal: req.signal })
    stream.on('text', (delta) => req.onText(delta))
    const final = await stream.finalMessage()
    // Stored whole (thinking included) and replayed unchanged, as tool use with thinking requires.
    content.push(...(final.content as unknown as Block[]))
    const u = final.usage
    usage.input += u.input_tokens
    usage.output += u.output_tokens
    usage.cacheRead += u.cache_read_input_tokens ?? 0
    usage.cacheWrite += u.cache_creation_input_tokens ?? 0
    stop = final.stop_reason
    if (stop !== 'pause_turn') break
  }
  return {
    content,
    text: textOf(content),
    calls: callsOf(content),
    usage,
    error: stop === 'max_tokens' ? 'The reply ran out of room before it finished.' : stop === 'refusal' ? 'The model declined to continue.' : undefined
  }
}

const WEB_BLOCKS = new Set(['server_tool_use', 'web_search_tool_result', 'web_fetch_tool_result', 'code_execution_tool_result', 'bash_code_execution_tool_result', 'text_editor_code_execution_tool_result'])

/** Claude's web tools for a Code session, the versions that filter results on newer models. */
export function codeWebTools(modelId: string): Record<string, unknown>[] {
  const dynamic = /^claude-(opus-5|fable-5|opus-4-[678]|sonnet-5|sonnet-4-6)/.test(modelId)
  return [
    { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 },
    { type: dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: 5, max_content_tokens: 20000 }
  ]
}

/** The transcript as OpenAI-style messages: tool results become "tool" messages after the call. */
export function toOpenAI(system: string, messages: Msg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'assistant') {
      const calls = m.content.filter((b) => b.type === 'tool_use')
      out.push({
        role: 'assistant',
        content: textOf(m.content) || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.raw === 'string' ? c.raw : JSON.stringify(c.input ?? {}) } })) }
          : {})
      })
      continue
    }
    for (const b of m.content.filter((x) => x.type === 'tool_result')) out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) })
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text))
      .join('\n\n')
    if (text) out.push({ role: 'user', content: text })
  }
  return out
}

async function stepOpenAI(req: StepRequest): Promise<StepResult> {
  const base = (req.config.baseUrl ?? '').replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {}) },
    body: JSON.stringify({
      model: req.modelId,
      messages: toOpenAI(req.system, req.messages),
      tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: req.signal
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${req.config.name} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  let text = ''
  const calls: { id: string; name: string; raw: string }[] = []
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let finish = ''
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
        choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
      }
      const choice = chunk.choices?.[0]
      if (choice?.delta?.content) {
        text += choice.delta.content
        req.onText(choice.delta.content)
      }
      for (const part of choice?.delta?.tool_calls ?? []) {
        const call = (calls[part.index ?? 0] ??= { id: '', name: '', raw: '' })
        if (part.id) call.id = part.id
        if (part.function?.name) call.name += part.function.name
        if (part.function?.arguments) call.raw += part.function.arguments
      }
      if (choice?.finish_reason) finish = choice.finish_reason
      if (chunk.usage) {
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
        usage.input = (chunk.usage.prompt_tokens ?? 0) - cached
        usage.cacheRead = cached
        usage.output = chunk.usage.completion_tokens ?? 0
      }
    }
  }
  const made = calls.filter(Boolean).map((c, i) => {
    let input: Record<string, unknown> = {}
    try {
      input = c.raw ? (JSON.parse(c.raw) as Record<string, unknown>) : {}
    } catch {
      input = { __unreadable: c.raw }
    }
    // The raw arguments are kept so the next request sends them back exactly.
    return { type: 'tool_use', id: c.id || `call_${i}`, name: c.name, input, raw: c.raw }
  })
  const content: Block[] = [...(text ? [{ type: 'text', text }] : []), ...made]
  return { content, text, calls: callsOf(content), usage, error: finish === 'length' ? 'The reply ran out of room before it finished.' : undefined }
}
