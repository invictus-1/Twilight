import { compactionOf, summaryText } from './compactionBlocks'
import Anthropic from '@anthropic-ai/sdk'
import type { ChatSettings, ModelInfo, ModelOptions, ProviderConfig } from '@shared/types'
import type { NodeRow } from '../db'
import { CHOICES_TOOL } from '@shared/choices'
import { isContextText } from '@shared/attachments'
import { domainOf } from '@shared/webTools'
import { MAX_TOOL_ROUNDS, TOO_MANY_ROUNDS, mergeExtraParams, textBlocks, wantsChoiceTool, type ClientOutcome, type ClientToolDef, type GenerateRequest, type GenerateResult, type Provider } from './types'

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

/**
 * Results of Anthropic's server tools: web search and fetch, and the code the newer versions run
 * to filter what they find. They come back in the reply and are replayed with it.
 */
const SERVER_RESULTS = new Set([
  'web_search_tool_result',
  'web_fetch_tool_result',
  'code_execution_tool_result',
  'bash_code_execution_tool_result',
  'text_editor_code_execution_tool_result'
])
/**
 * Block types replayed from a stored reply; anything else (another provider's bookkeeping, a
 * picture Twilight made) is left out. tool_results marks where Twilight ran a round of tools.
 */
const REPLAYED = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'server_tool_use', 'tool_results', ...SERVER_RESULTS])
const isDocument = (b: Block): boolean => b.type === 'image' || b.type === 'document' || (b.type === 'text' && typeof b.text === 'string' && isContextText(b.text))

/**
 * Keeps a reply's server tool calls (each with its result) while their tool is in the request.
 * With a tool switched off they're left out, and so are web citations on the text, which point
 * into the search results; the cache starts over then anyway, since the tools list changed.
 */
function keepServerTools(blocks: Block[], tools: ReadonlySet<string>): Block[] {
  const answered = new Set(blocks.filter((b) => SERVER_RESULTS.has(b.type)).map((b) => b.tool_use_id))
  const allowed = (name: unknown): boolean => (name === 'web_search' || name === 'web_fetch' ? tools.has(name) : tools.size > 0)
  const kept = new Set(blocks.filter((b) => b.type === 'server_tool_use' && answered.has(b.id) && allowed(b.name)).map((b) => b.id))
  return blocks.flatMap((b): Block[] => {
    if (b.type === 'server_tool_use') return kept.has(b.id) ? [b] : []
    if (SERVER_RESULTS.has(b.type)) return kept.has(b.tool_use_id) ? [b] : []
    if (b.type === 'text' && !tools.has('web_search') && Array.isArray(b.citations) && b.citations.length) {
      const { citations: _, ...plain } = b
      return [plain as Block]
    }
    return [b]
  })
}

const resultText = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).map((b) => (b.type === 'text' ? String(b.text) : '')).join('\n') : ''

/**
 * A stored reply as the turns it took. Where Twilight ran tools in the middle of it, the reply
 * becomes the assistant's calls, a user turn with their results, and the assistant carrying on,
 * exactly as they were sent. A round whose tools are no longer offered (a server switched off)
 * is told as text instead, since the API takes calls only to tools in the request.
 */
export function replyTurns(blocks: Block[], available: ReadonlySet<string> | null = null): Message[] {
  const turns: Message[] = []
  let current: Block[] = []
  for (const b of blocks) {
    if (b.type !== 'tool_results') {
      current.push(b)
      continue
    }
    const results = (b.results ?? []) as Block[]
    const answered = new Set(results.map((r) => r.tool_use_id))
    const calls = current.filter((c) => c.type === 'tool_use' && answered.has(c.id))
    if (available && calls.some((c) => !available.has(String(c.name)))) {
      const names = new Map(calls.map((c) => [c.id, String(c.name)]))
      current = current.map((c) => (c.type === 'tool_use' && answered.has(c.id) ? { type: 'text', text: `(Called ${c.name} with ${JSON.stringify(c.input)})` } : c))
      turns.push({ role: 'assistant', content: current })
      turns.push({ role: 'user', content: results.map((r) => ({ type: 'text', text: `${names.get(r.tool_use_id) ?? 'The tool'} returned: ${resultText(r.content)}` })) })
    } else {
      turns.push({ role: 'assistant', content: current })
      turns.push({ role: 'user', content: results })
    }
    current = []
  }
  if (current.length) turns.push({ role: 'assistant', content: current })
  return turns
}

/**
 * The conversation in Claude's format. `serverTools` names the web tools in this request
 * (web_search, web_fetch): replies that used them replay their calls only while they're sent.
 */
export function toMessages(history: NodeRow[], serverTools: ReadonlySet<string> = new Set(), clientTools: ReadonlySet<string> | null = null): Message[] {
  const messages: Message[] = []
  const add = (role: 'user' | 'assistant', content: Block[]): void => {
    const last = messages[messages.length - 1]
    if (last && last.role === role) last.content.push(...content)
    else messages.push({ role, content })
  }
  for (const node of history) {
    // A summary stands in for everything before it: Claude's own block goes back as it came, one
    // written by another model as text; what it carried (documents, instruction changes) follows.
    const summary = compactionOf(node)
    if (summary) {
      if (summary.local) add('user', [{ type: 'text', text: summaryText(summary.text) }, ...(summary.carried as Block[])])
      else {
        add('assistant', [summary.block as Block])
        if (summary.carried.length) add('user', summary.carried as Block[])
      }
      continue
    }
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
        ? keepServerTools((JSON.parse(node.content) as Block[]).filter((b) => REPLAYED.has(b.type)), serverTools)
        : textBlocks(node)
      if (node.status !== 'done') content = content.filter((b) => b.type === 'text')
      if (!content.length) continue
      for (const turn of replyTurns(content, clientTools)) add(turn.role, turn.content)
      continue
    } else continue
    add(role, content)
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

/** Models whose web tools filter results with code before they reach the context (the 20260209 versions). */
const DYNAMIC_FILTERING = /^claude-(opus-5|fable-5|opus-4-[678]|sonnet-5|sonnet-4-6)/

/**
 * The tools a request offers, in a fixed order: the choice tool, then web search, then web fetch.
 * Tools sit at the very start of the cached prefix, so they're the same on every turn while the
 * switches stay put. Server tools run on Anthropic's side; max_uses caps each reply's searches
 * and page reads (searches are billed per use), and max_content_tokens keeps one long page from
 * filling the context.
 */
export function anthropicTools(settings: ChatSettings, clientTools: ClientToolDef[] = []): Record<string, unknown>[] {
  const dynamic = DYNAMIC_FILTERING.test(settings.modelId)
  const tools: Record<string, unknown>[] = []
  if (wantsChoiceTool(settings)) tools.push(CHOICES_TOOL)
  if (settings.webSearch) tools.push({ type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 })
  if (settings.webFetch) tools.push({ type: dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: 5, max_content_tokens: 20000 })
  // MCP tools and pictures come last, in the order chatTools() gives (fixed while the switches stay put).
  for (const t of clientTools) tools.push({ name: t.name, description: t.description, input_schema: t.input_schema })
  return tools
}

/** A round of results in Claude's format, stored in the reply and replayed as it is. */
export function toolResultsBlock(outcomes: ClientOutcome[]): Block {
  return {
    type: 'tool_results',
    results: outcomes.map((o) => ({
      type: 'tool_result',
      tool_use_id: o.id,
      content: [
        { type: 'text', text: o.text || '(no output)' },
        ...(o.images ?? []).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }))
      ],
      ...(o.isError ? { is_error: true } : {})
    }))
  }
}

/** The request body (all but the stream flag) and the betas it needs. */
export function anthropicRequest(req: Pick<GenerateRequest, 'system' | 'history' | 'settings' | 'options' | 'clientTools'>): { body: Record<string, unknown>; betas: string[] } {
  const { settings } = req
  const model = settings.modelId
  const options = req.options ?? anthropicOptions(model, undefined)
  const ttl = settings.cacheTtl
  const cache = settings.caching ? { cache_control: { type: 'ephemeral', ttl } } : {}
  const tools = anthropicTools(settings, req.clientTools)
  const serverTools = new Set(tools.map((t) => t.name as string).filter((n) => n === 'web_search' || n === 'web_fetch'))
  const clientTools = new Set((req.clientTools ?? []).map((t) => t.name))

  const body: Record<string, unknown> = {
    model,
    // Claude needs max_tokens; "model default" means the model's maximum, capped at 64k.
    max_tokens: Math.min(settings.maxTokens ?? 64000, options.maxOutput ?? 128000),
    messages: toMessages(req.history, serverTools, clientTools),
    ...cache
  }
  if (req.system) body.system = [{ type: 'text', text: req.system, ...cache }]
  if (options.adaptiveThinking) body.thinking = { type: 'adaptive', display: settings.thinkingDisplay }
  // Only levels this model lists; a level from another model would be rejected.
  if (settings.effort && options.efforts.includes(settings.effort)) body.output_config = { effort: settings.effort }
  // The choice tool's input is a few short labels: the API's default buffering (which validates
  // the JSON before streaming it) is worth more here than eager input streaming.
  if (tools.length) body.tools = tools
  const betas: string[] = []
  if (SUPPORTS_FALLBACK.test(model)) {
    betas.push('server-side-fallback-2026-07-01')
    body.fallbacks = 'default'
  }
  mergeExtraParams(body, settings.extraParams ?? '')
  return { body, betas }
}

/**
 * A reply's text as one string. Text that follows a search or another tool call starts a new
 * paragraph; text split only by citations joins straight on.
 */
export function replyText(blocks: { type: string; text?: string }[]): string {
  let out = ''
  let broke = false
  for (const b of blocks) {
    if (b.type !== 'text') {
      if (b.type !== 'thinking' && b.type !== 'redacted_thinking') broke = true
      continue
    }
    if (broke && out && b.text) out += '\n\n'
    out += b.text ?? ''
    if (b.text) broke = false
  }
  return out
}

/** A short line for a server tool call as it starts. */
function activityLabel(name: string, input: { query?: string; url?: string }): string | null {
  if (name === 'web_search') return `Searching: ${input.query ?? ''}`
  if (name === 'web_fetch') return `Reading: ${input.url ? domainOf(input.url) : ''}`
  return null
}

/** A long run of searches pauses the turn (pause_turn); it's resumed this many times at most. */
const MAX_CONTINUATIONS = 4

/** What goes back to the API from the reply so far: Twilight's own blocks (pictures made) left out. */
const sendable = (content: Block[]): Message[] => replyTurns(content.filter((b) => REPLAYED.has(b.type)))

async function generateAnthropic(req: GenerateRequest): Promise<GenerateResult> {
  if (!req.apiKey) throw new Error('Add an Anthropic API key in Settings → Providers.')
  const client = anthropicClient(req.config, req.apiKey)
  const model = req.settings.modelId
  const started = Date.now()
  const { body, betas } = anthropicRequest(req)
  const messages = body.messages as Message[]

  // Everything the reply has produced so far, across continuations. A paused turn is resumed by
  // sending it back as the assistant turn; the next response carries on from there.
  const content: Block[] = []
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 }
  let text = ''
  let thinking = ''
  // Text after a tool call starts a new paragraph, as replyText() joins it.
  let broke = false
  let stopReason: string | null = null
  let finalModel = model
  const clientNames = new Set((req.clientTools ?? []).map((t) => t.name))
  let toolRounds = 0
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const sent = content.length ? [...messages, ...sendable(content)] : messages
    const stream = client.beta.messages.stream(
      { ...body, messages: sent, betas } as unknown as Parameters<typeof client.beta.messages.stream>[0],
      { signal: req.signal }
    )
    // Server tool inputs stream as JSON fragments; the line shows once the input is complete.
    const inputs = new Map<number, { name: string; json: string }>()
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block
          if (block.type === 'text') {
            if (broke && text) {
              text += '\n\n'
              req.onText('\n\n')
            }
            broke = false
          } else if (block.type === 'server_tool_use') {
            inputs.set(event.index, { name: block.name, json: '' })
            broke = true
          } else if (block.type !== 'thinking' && block.type !== 'redacted_thinking') broke = true
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            text += event.delta.text
            req.onText(event.delta.text)
          } else if (event.delta.type === 'thinking_delta') {
            thinking += event.delta.thinking
            req.onThinking(event.delta.thinking)
          } else if (event.delta.type === 'input_json_delta') {
            const call = inputs.get(event.index)
            if (call) call.json += event.delta.partial_json
          }
        } else if (event.type === 'content_block_stop') {
          const call = inputs.get(event.index)
          if (!call) continue
          inputs.delete(event.index)
          let input: { query?: string; url?: string } = {}
          try {
            input = JSON.parse(call.json || '{}')
          } catch {
            // A cut-off input shows without its terms.
          }
          const label = activityLabel(call.name, input)
          if (label) req.onActivity?.(label)
        }
      }
    } catch (err) {
      if (req.signal.aborted) {
        // The rounds already run stay with the reply (shown under it); a stopped reply replays as text.
        return {
          text,
          thinking: thinking || undefined,
          content: content.length ? [...content, ...(text ? [{ type: 'text', text }] : [])] : text ? [{ type: 'text', text }] : null,
          usage: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, ms: Date.now() - started },
          modelId: finalModel
        }
      }
      throw err
    }
    const final = await stream.finalMessage()
    content.push(...(final.content as unknown as Block[]))
    finalModel = final.model
    const u = final.usage
    usage.input += u.input_tokens
    usage.output += u.output_tokens
    usage.cacheRead += u.cache_read_input_tokens ?? 0
    usage.cacheWrite += u.cache_creation_input_tokens ?? 0
    usage.webSearches += u.server_tool_use?.web_search_requests ?? 0
    stopReason = final.stop_reason
    // Calls to Twilight's own tools: run them, add the round, and let the reply carry on. A call
    // to present_choices among them ends the reply instead (its answer is your next message).
    const calls = (final.content as unknown as Block[]).filter((b) => b.type === 'tool_use')
    if (stopReason === 'tool_use' && req.runTools && calls.length && calls.every((c) => clientNames.has(String(c.name)))) {
      const asked = calls.map((c) => ({ id: String(c.id), name: String(c.name), input: (c.input ?? {}) as Record<string, unknown> }))
      if (++toolRounds > MAX_TOOL_ROUNDS) {
        content.push(toolResultsBlock(asked.map((c) => ({ id: c.id, text: TOO_MANY_ROUNDS, isError: true }))))
        break
      }
      const outcomes = await req.runTools(asked)
      content.push(toolResultsBlock(outcomes))
      for (const o of outcomes) if (o.generated) content.push({ type: 'generated_image', ...o.generated })
      broke = true
      if (req.signal.aborted) break
      round = -1 // a new round of the conversation, so pause_turn continuations count afresh
      continue
    }
    if (stopReason !== 'pause_turn') break
  }

  const finalThinking = content
    .filter((b) => b.type === 'thinking')
    .map((b) => b.thinking as string)
    .join('\n\n')
  return {
    text: replyText(content as { type: string; text?: string }[]),
    thinking: finalThinking || undefined,
    content,
    modelId: finalModel,
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      ms: Date.now() - started,
      ...(usage.webSearches ? { webSearches: usage.webSearches } : {}),
      ...(stopReason === 'max_tokens' ? { cutOff: true } : {})
    },
    error: stopReason === 'refusal' ? 'The model declined this request.' : undefined
  }
}

/**
 * Claude's own compaction: the conversation goes up as it stands with the `compaction` option, and
 * a summary block comes back instead of a reply. Same model, system prompt and settings as the
 * chat, so it reads what the chat reads. `instructions`, when given, replace Claude's summary prompt.
 */
export async function compactAnthropic(req: {
  config: ProviderConfig
  apiKey?: string
  system: string
  history: NodeRow[]
  settings: ChatSettings
  options?: ModelOptions
  instructions: string
  /** Stops it (Cancel beside Compacting…). */
  signal?: AbortSignal
}): Promise<{ block: Block; text: string }> {
  const { body, betas } = anthropicRequest(req)
  // The summary gets the model's whole output allowance, not the chat's own limit: with thinking
  // counted against it, a big chat's summary ran out of room at a reply-sized limit.
  const room = req.options?.maxOutput ?? 64000
  body.max_tokens = room
  const client = anthropicClient(req.config, req.apiKey ?? '')
  const instructions = req.instructions.trim()
  // Streamed, as a long summary on a big chat can run past what an unstreamed call may take.
  const res = (await explainKey(req.apiKey, () =>
    client.beta.messages
      .stream({ ...body, betas: [...betas, 'compact-2026-09-04'], compaction: { type: 'summarize', ...(instructions ? { instructions } : {}) } } as unknown as Parameters<typeof client.beta.messages.stream>[0], { signal: req.signal })
      .finalMessage()
  )) as unknown as { content: Block[]; stop_reason: string | null }
  const raw = res.content.find((b) => b.type === 'compaction')
  // A compaction block with no content is the API's way of saying the summary failed.
  const text = raw && typeof raw.content === 'string' ? raw.content : ''
  if (res.stop_reason !== 'compaction' || !raw || !text.trim()) {
    const why: Record<string, string> = {
      max_tokens: `The summary ran out of room: it reached the model's limit of ${room.toLocaleString()} output tokens before it was finished. Try shorter summary instructions, or lower the effort in Model settings, and compact again.`,
      refusal: "Claude declined to write this summary. Try again with Claude's own summary prompt (leave Summary instructions empty in Settings → General), or compact with another model.",
      tool_use: 'The model called a tool instead of writing the summary. Add "Do not call tools" to your summary instructions and try again.',
      model_context_window_exceeded: 'There was no room left in the context for the summary. Try shorter summary instructions.'
    }
    throw new Error(
      (res.stop_reason && why[res.stop_reason]) ??
        (res.stop_reason === 'compaction'
          ? "Claude couldn't produce a summary this time (it came back empty). Try again, or try Claude's own summary prompt."
          : `No summary came back (the reply ended with "${res.stop_reason ?? 'nothing'}"). Try again in a moment.`)
    )
  }
  const { type: _type, ...rest } = raw
  // Kept with its type first (how Twilight finds it again) and otherwise exactly as it came.
  return { block: { type: 'compaction', ...rest }, text }
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
