import type { ChatSettings, ModelInfo, ProviderConfig, Usage } from '@shared/types'
import type { NodeRow } from '../db'

export interface GenerateRequest {
  config: ProviderConfig
  apiKey?: string
  /** The conversation's frozen system prompt. */
  system: string
  /** The active path below the root, oldest first, ending with the user turn to answer. */
  history: NodeRow[]
  settings: ChatSettings
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

/** Text blocks stored for a user turn, or for assistant turns from other providers. */
export function textBlocks(node: NodeRow): { type: 'text'; text: string }[] {
  if (node.content) {
    const parsed = JSON.parse(node.content) as { type: string; text?: string }[]
    const texts = parsed.filter((b) => b.type === 'text' && typeof b.text === 'string')
    if (texts.length) return texts as { type: 'text'; text: string }[]
  }
  return [{ type: 'text', text: node.text }]
}
