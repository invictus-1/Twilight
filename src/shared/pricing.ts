import type { Usage } from './types'

// Anthropic first-party list prices, USD per million tokens (as of 2026-10). Local models cost
// nothing. Unknown models return null so the UI shows tokens without a price.

interface Price {
  input: number
  output: number
  /** Cache-read price as a fraction of input. */
  readMultiplier: number
}

const PRICES: [RegExp, Price][] = [
  [/^claude-(fable|mythos)-5-1/, { input: 10, output: 50, readMultiplier: 0.025 }],
  [/^claude-(fable|mythos)-5/, { input: 10, output: 50, readMultiplier: 0.1 }],
  [/^claude-opus-5-5/, { input: 4, output: 20, readMultiplier: 0.05 }],
  [/^claude-opus-(5|4-8|4-7|4-6)/, { input: 5, output: 25, readMultiplier: 0.1 }],
  [/^claude-sonnet-(5-5|5)/, { input: 2, output: 10, readMultiplier: 0.1 }],
  [/^claude-sonnet-4-6/, { input: 3, output: 15, readMultiplier: 0.1 }],
  [/^claude-haiku-5-5/, { input: 0.1, output: 0.5, readMultiplier: 0.1 }],
  [/^claude-haiku-4-5/, { input: 1, output: 5, readMultiplier: 0.1 }]
]

export function priceFor(modelId: string | undefined): Price | null {
  if (!modelId) return null
  return PRICES.find(([re]) => re.test(modelId))?.[1] ?? null
}

/** Cost of one response in USD, or null when the model's price is unknown. */
export function costOf(modelId: string | undefined, usage: Usage | undefined, local: boolean): number | null {
  if (!usage) return null
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
  const writeMultiplier = usage.cacheTtl === '1h' ? 2 : 1.25
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
