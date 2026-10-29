import type { Usage } from './types'

// What a reply cost, in order of trust: the provider's own figure (OpenRouter reports one), then
// your own price list (Settings → Prices), then Anthropic's first-party list prices below. Prices
// are USD per million tokens. Local models cost nothing; anything else unknown returns null so the
// interface shows tokens without a price.

interface Price {
  input: number
  output: number
  /** Cache-read price as a fraction of input. */
  readMultiplier: number
}

/** A price of your own, matched by model id; `*` matches anything ("openai/gpt-*"). */
export interface CustomPrice {
  model: string
  input: number
  output: number
  /** Per million cache-read tokens; empty means a tenth of input. */
  cacheRead?: number | null
  /** Per million cache-write tokens; empty means the usual multiple of input. */
  cacheWrite?: number | null
}

/** Anthropic list prices as of 2026-10, with a readable pattern for the Prices page. */
export const BUILT_IN_PRICES: { pattern: string; re: RegExp; price: Price }[] = [
  { pattern: 'claude-fable-5-1, claude-mythos-5-1', re: /^claude-(fable|mythos)-5-1/, price: { input: 10, output: 50, readMultiplier: 0.025 } },
  { pattern: 'claude-fable-5, claude-mythos-5', re: /^claude-(fable|mythos)-5/, price: { input: 10, output: 50, readMultiplier: 0.1 } },
  { pattern: 'claude-opus-5-5', re: /^claude-opus-5-5/, price: { input: 4, output: 20, readMultiplier: 0.05 } },
  { pattern: 'claude-opus-5, 4-8, 4-7, 4-6', re: /^claude-opus-(5|4-8|4-7|4-6)/, price: { input: 5, output: 25, readMultiplier: 0.1 } },
  { pattern: 'claude-sonnet-5-5, claude-sonnet-5', re: /^claude-sonnet-(5-5|5)/, price: { input: 2, output: 10, readMultiplier: 0.1 } },
  { pattern: 'claude-sonnet-4-6', re: /^claude-sonnet-4-6/, price: { input: 3, output: 15, readMultiplier: 0.1 } },
  { pattern: 'claude-haiku-5-5', re: /^claude-haiku-5-5/, price: { input: 0.1, output: 0.5, readMultiplier: 0.1 } },
  { pattern: 'claude-haiku-4-5', re: /^claude-haiku-4-5/, price: { input: 1, output: 5, readMultiplier: 0.1 } }
]

let custom: { re: RegExp; price: CustomPrice }[] = []

const wildcard = (pattern: string): RegExp =>
  new RegExp(`^${pattern.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')

/** Sets your own price list (the main process and the window each hold a copy). */
export function setCustomPrices(list: CustomPrice[]): void {
  custom = list.filter((p) => p.model.trim() && Number.isFinite(p.input) && Number.isFinite(p.output)).map((price) => ({ re: wildcard(price.model), price }))
}

/** Your price for a model, if one of your patterns matches it (the first match wins). */
export function customPriceFor(modelId: string | undefined): CustomPrice | null {
  if (!modelId) return null
  return custom.find((c) => c.re.test(modelId))?.price ?? null
}

export function priceFor(modelId: string | undefined): Price | null {
  if (!modelId) return null
  return BUILT_IN_PRICES.find((b) => b.re.test(modelId))?.price ?? null
}

/** Cost of one response in USD, or null when the model's price is unknown. */
export function costOf(modelId: string | undefined, usage: Usage | undefined, local: boolean): number | null {
  if (!usage) return null
  if (typeof usage.costUsd === 'number') return usage.costUsd
  const writeMultiplier = usage.cacheTtl === '1h' ? 2 : 1.25
  const mine = customPriceFor(modelId)
  if (mine) {
    const read = mine.cacheRead ?? mine.input * 0.1
    const write = mine.cacheWrite ?? mine.input * writeMultiplier
    return (usage.input * mine.input + usage.cacheWrite * write + usage.cacheRead * read + usage.output * mine.output) / 1_000_000
  }
  if (local) return 0
  const p = priceFor(modelId)
  if (!p) return null
  let input = p.input
  let output = p.output
  // Claude Haiku 5.5 bills prompts over 100K tokens at the higher tier.
  if (/^claude-haiku-5-5/.test(modelId ?? '') && usage.input + usage.cacheRead + usage.cacheWrite > 100_000) {
    input = 0.5
    output = 2.5
  }
  return (
    (usage.input * input +
      usage.cacheWrite * input * writeMultiplier +
      usage.cacheRead * input * p.readMultiplier +
      usage.output * output) /
    1_000_000
  )
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}
