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
}

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

/** Choices are on and offered as a present_choices tool call rather than written in the reply. */
export const wantsChoiceTool = (settings: ChatSettings): boolean => settings.choiceCards && settings.choiceMode === 'tool'

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
    const texts = parsed.filter((b) => b.type === 'text' && typeof b.text === 'string')
    if (texts.length) return texts as { type: 'text'; text: string }[]
  }
  return [{ type: 'text', text: node.text }]
}
