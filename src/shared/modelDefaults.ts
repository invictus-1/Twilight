import type { ChatSettings } from './types'

/**
 * What a model's own defaults can hold: how it's asked, never what it's told. The system prompt
 * and the chat's tools belong to the chat, so a model brings only these when it's picked.
 */
export const MODEL_DEFAULT_KEYS = ['effort', 'thinkingDisplay', 'showThinking', 'temperature', 'maxTokens', 'extraParams', 'confidence', 'samplers'] as const satisfies readonly (keyof ChatSettings)[]

/** Each model's saved defaults, by provider and model id. */
export type ModelDefaults = Record<string, Partial<ChatSettings>>

export const modelKey = (providerId: string, modelId: string): string => `${providerId}:${modelId}`

/** Only the keys a model's defaults may carry, from a settings object. */
export function pickModelDefaults(settings: Partial<ChatSettings>): Partial<ChatSettings> {
  const out: Partial<ChatSettings> = {}
  for (const k of MODEL_DEFAULT_KEYS) if (settings[k] !== undefined) (out as Record<string, unknown>)[k] = settings[k]
  return out
}
