import type { ChatSettings, ModelInfo, ModelOptions, ProviderConfig, Usage } from '@shared/types'
import type { NodeRow } from '../db'

export interface GenerateRequest {
  config: ProviderConfig
  apiKey?: string
  /** The conversation's frozen system prompt. */
  system: string
  /** The active path below the root, oldest first, ending with the user turn to answer. */
  history: NodeRow[]
  settings: ChatSettings
  /** What the model accepts, when known. */
  options?: ModelOptions
  signal: AbortSignal
  onText(delta: string): void
  onThinking(delta: string): void
  /** A web search or page read has started ("Searching: …"). */
  onActivity?(label: string): void
  /** Tools Twilight runs itself (MCP servers, pictures), offered after the built-in ones. */
  clientTools?: ClientToolDef[]
  /** Runs a round of calls to those tools (asking you first where needed). */
  runTools?(calls: ClientCall[]): Promise<ClientOutcome[]>
}

export interface ClientToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ClientCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ClientOutcome {
  id: string
  text: string
  /** Pictures a tool returned, passed back to models that can see them. */
  images?: { mediaType: string; data: string }[]
  isError?: boolean
  /** A picture Twilight made, shown in the reply. */
  generated?: { file: string; prompt: string }
}

/** A reply that keeps calling tools is stopped after this many rounds. */
export const MAX_TOOL_ROUNDS = 25
export const TOO_MANY_ROUNDS = `Stopped: more than ${MAX_TOOL_ROUNDS} rounds of tool calls in one reply.`

export interface GenerateResult {
  text: string
  thinking?: string
  /** Provider-native content blocks, stored so the next request replays them byte-for-byte. */
  content: unknown
  usage: Usage
  modelId: string
  /** Set when the model finished without a normal answer (e.g. a refusal). */
  error?: string
}

export interface Provider {
  listModels(config: ProviderConfig, apiKey?: string): Promise<ModelInfo[]>
  generate(request: GenerateRequest): Promise<GenerateResult>
}

/** Choices are on and may be offered as a present_choices tool call. */
export const wantsChoiceTool = (settings: ChatSettings): boolean => settings.choiceCards && settings.choiceTool

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Merges the user's extra-parameters JSON into a request body: objects merge, everything else replaces. */
export function mergeExtraParams(body: Record<string, unknown>, extra: string): void {
  if (!extra.trim()) return
  let parsed: unknown
  try {
    parsed = JSON.parse(extra)
  } catch {
    throw new Error("The extra request parameters aren't valid JSON. Fix them in Model settings.")
  }
  if (!isPlainObject(parsed)) throw new Error('The extra request parameters must be a JSON object, like {"top_k": 40}.')
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value) && isPlainObject(target[key])) merge(target[key] as Record<string, unknown>, value)
      else target[key] = value
    }
  }
  merge(body, parsed)
}

/** Text blocks stored for a user turn, or for assistant turns from other providers. */
export function textBlocks(node: NodeRow): { type: 'text'; text: string }[] {
  if (node.content) {
    const parsed = JSON.parse(node.content) as { type: string; text?: string }[]
    // A Claude reply that used the web splits its text around searches and citations; the stored
    // text is that put back together.
    if (parsed.some((b) => b.type === 'server_tool_use')) return [{ type: 'text', text: node.text }]
    const texts = parsed.filter((b) => b.type === 'text' && typeof b.text === 'string')
    if (texts.length) return texts as { type: 'text'; text: string }[]
  }
  return [{ type: 'text', text: node.text }]
}
