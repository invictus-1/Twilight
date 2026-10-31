// Local-model power tools: how sure the model was of each token (from the server's logprobs),
// shown as a heatmap over the reply, with the runners-up a click away to branch from.

/** One token as the model wrote it: its text, its log probability, and the top alternatives. */
export interface TokenProb {
  t: string
  /** Natural log of the token's probability. */
  p: number
  /** The runners-up at this point, [text, logprob], most likely first. */
  alt: [string, number][]
}

/** A reply's tokens; `offset` is how many characters at its start came from a branch's prefix. */
export interface ReplyConfidence {
  offset: number
  tokens: TokenProb[]
}

/** Sampler settings llama.cpp, LM Studio and similar servers take; null leaves the server's default. */
export interface Samplers {
  topP: number | null
  topK: number | null
  minP: number | null
  repeatPenalty: number | null
  /** DRY repetition penalty multiplier (0 is off). */
  dry: number | null
  /** XTC: the chance of cutting the top choices. */
  xtc: number | null
  seed: number | null
}

export const NO_SAMPLERS: Samplers = { topP: null, topK: null, minP: null, repeatPenalty: null, dry: null, xtc: null, seed: null }

/** The request fields each sampler goes out as (llama.cpp's names, which LM Studio and vLLM share). */
export const SAMPLER_FIELDS: Record<keyof Samplers, string> = {
  topP: 'top_p',
  topK: 'top_k',
  minP: 'min_p',
  repeatPenalty: 'repeat_penalty',
  dry: 'dry_multiplier',
  xtc: 'xtc_probability',
  seed: 'seed'
}

/** How many alternatives each token keeps. */
export const TOP_ALTERNATIVES = 5

export const probability = (logprob: number): number => Math.exp(logprob)

/** The heat a token shows: 0 for a sure one, up to 1 for a long shot. */
export function heat(logprob: number): number {
  const p = probability(logprob)
  return p >= 0.9 ? 0 : Math.min(1, (0.9 - p) / 0.8)
}

/** Reads one streamed chunk's logprobs (OpenAI's chat format) into tokens. */
export function readLogprobs(content: unknown): TokenProb[] {
  if (!Array.isArray(content)) return []
  return (content as { token?: string; logprob?: number; top_logprobs?: { token?: string; logprob?: number }[] }[])
    .filter((c) => typeof c.token === 'string' && typeof c.logprob === 'number')
    .map((c) => ({
      t: c.token!,
      p: c.logprob!,
      alt: (c.top_logprobs ?? [])
        .filter((a) => typeof a.token === 'string' && typeof a.logprob === 'number' && a.token !== c.token)
        .slice(0, TOP_ALTERNATIVES)
        .map((a) => [a.token!, a.logprob!] as [string, number])
    }))
}
