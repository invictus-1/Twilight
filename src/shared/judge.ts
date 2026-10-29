import type { Attachment, Usage } from './types'

// The Judge compares two passages written from the same prompt and context. Passages are shown
// to the judge blind, as X and Y, and (by default) judged twice with the order swapped, because
// judges lean toward whichever passage comes first. Scores from both runs are mapped back to A
// and B and averaged; if the two orders disagree on the winner, that's reported as too close.

export interface RubricCriterion {
  id: string
  name: string
  /** Relative weight in the overall score. */
  weight: number
  /** What the judge looks for, in concrete terms. */
  guide: string
}

export interface Rubric {
  id: string
  name: string
  description: string
  criteria: RubricCriterion[]
  builtIn?: boolean
}

export interface JudgeInput {
  title: string
  passageA: string
  passageB: string
  /** Who wrote each passage (e.g. model names); hidden from the judge, revealed after scoring. */
  labelA: string
  labelB: string
  /** The prompt both passages answered. */
  authorPrompt: string
  /** The writing system prompt both models had. */
  systemPrompt: string
  /** Canon and reference documents, sent in full. */
  contextDocs: Attachment[]
  /** Anything else the author wants judged or answered. */
  extraInstructions: string
  judgeProviderId: string
  judgeModelId: string
  effort: string | null
  rubricId: string
  bothOrders: boolean
  /** Passages C, D… for a round: every pair is then judged as its own judgment. Drafts only. */
  morePassages?: { passage: string; label: string }[]
}

/** The most passages a round takes (15 pairs). */
export const MAX_PASSAGES = 6

export const passageLetter = (i: number): string => String.fromCharCode(65 + i)

/** Every pair of n passages, in reading order: A–B, A–C, …, B–C, … */
export function roundPairs(n: number): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j])
  return pairs
}

export type JudgeOrder = 'AB' | 'BA'

/** One judging pass: X/Y scores as the judge gave them, before mapping back to A/B. */
export interface RunScores {
  criteria: Record<string, { X: number | null; Y: number | null }>
  overall: { X: number | null; Y: number | null }
  winner: 'X' | 'Y' | 'tie'
  confidence?: string
}

export interface JudgeRun {
  order: JudgeOrder
  status: 'streaming' | 'done' | 'error' | 'stopped'
  text: string
  scores?: RunScores
  error?: string
  modelId?: string
  usage?: Usage
}

export interface Judgment {
  id: string
  createdAt: number
  input: JudgeInput
  rubric: Rubric
  runs: JudgeRun[]
  /** Set on every pair of a round of more than two passages. */
  roundId?: string
  /** The round's own title, before the pair was added to it. */
  roundTitle?: string
}

export interface JudgmentSummary {
  id: string
  title: string
  createdAt: number
  status: 'running' | 'done' | 'error'
  winner: 'A' | 'B' | 'tie' | 'close' | null
  roundId?: string
}

export interface LeaderboardEntry {
  label: string
  judgments: number
  wins: number
  losses: number
  /** Ties and too-close calls. */
  ties: number
  /** Mean of this label's overall score across its judgments. */
  averageScore: number | null
  rating: number
}

export interface Leaderboard {
  /** Null for the tally across every judgment. */
  roundId: string | null
  roundTitle: string | null
  entries: LeaderboardEntry[]
  /** Judgments that went into the tally. */
  counted: number
  /** Judgments still running, not counted yet. */
  running: number
  /** A round's own judgments, oldest first, so the round view can list them; empty for the overall tally. */
  judgments: (JudgmentSummary & { labelA: string; labelB: string })[]
}

/** One finished, labelled judgment as the leaderboard sees it. */
export interface LeaderboardMatch {
  labelA: string
  labelB: string
  winner: 'A' | 'B' | 'tie' | 'close'
  overallA: number | null
  overallB: number | null
  createdAt: number
}

export const ELO_START = 1000
export const ELO_K = 24

/**
 * Tallies judgments by passage label. Ratings are Elo-style, replayed oldest first so the same
 * judgments always give the same ratings; a tie or a too-close call counts as half a win each.
 */
export function tallyLeaderboard(matches: LeaderboardMatch[]): LeaderboardEntry[] {
  const table = new Map<string, LeaderboardEntry & { scores: number[] }>()
  const entry = (label: string): LeaderboardEntry & { scores: number[] } => {
    let e = table.get(label)
    if (!e) table.set(label, (e = { label, judgments: 0, wins: 0, losses: 0, ties: 0, averageScore: null, rating: ELO_START, scores: [] }))
    return e
  }
  for (const m of [...matches].sort((x, y) => x.createdAt - y.createdAt)) {
    const a = entry(m.labelA)
    const b = entry(m.labelB)
    const scoreA = m.winner === 'A' ? 1 : m.winner === 'B' ? 0 : 0.5
    const expectedA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400))
    const delta = ELO_K * (scoreA - expectedA)
    a.rating += delta
    b.rating -= delta
    a.judgments++
    b.judgments++
    if (scoreA === 1) {
      a.wins++
      b.losses++
    } else if (scoreA === 0) {
      b.wins++
      a.losses++
    } else {
      a.ties++
      b.ties++
    }
    if (m.overallA !== null) a.scores.push(m.overallA)
    if (m.overallB !== null) b.scores.push(m.overallB)
  }
  return [...table.values()]
    .map(({ scores, ...e }) => ({ ...e, averageScore: mean(scores) }))
    .sort((x, y) => y.rating - x.rating || y.wins - x.wins || x.label.localeCompare(y.label))
}

export interface Verdict {
  criteria: { id: string; name: string; weight: number; A: number | null; B: number | null }[]
  /** Weighted from the criteria, 1–10. */
  overallA: number | null
  overallB: number | null
  winner: 'A' | 'B' | 'tie' | 'close' | null
  /** How the runs agreed: both orders picked the same passage, or the order changed the result. */
  agreement: 'agree' | 'flipped' | 'single' | 'pending'
  runWinners: ('A' | 'B' | 'tie' | null)[]
}

const toAB = (order: JudgeOrder, xy: 'X' | 'Y'): 'A' | 'B' => (order === 'AB' ? (xy === 'X' ? 'A' : 'B') : xy === 'X' ? 'B' : 'A')

/** Pulls the judge's score block (the last ```json fence) out of its report. */
export function parseScores(text: string): RunScores | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)]
  const raw = blocks.at(-1)?.[1]
  if (!raw) return null
  try {
    const json = JSON.parse(raw) as {
      criteria?: { id: string; X: number | null; Y: number | null }[]
      overall?: { X: number | null; Y: number | null }
      winner?: string
      confidence?: string
    }
    const criteria: RunScores['criteria'] = {}
    for (const c of json.criteria ?? []) criteria[c.id] = { X: num(c.X), Y: num(c.Y) }
    const winner = json.winner === 'X' || json.winner === 'Y' ? json.winner : 'tie'
    return { criteria, overall: { X: num(json.overall?.X), Y: num(json.overall?.Y) }, winner, confidence: json.confidence }
  } catch {
    return null
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(10, v)) : null)

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Combines the runs into one verdict for A and B. */
export function computeVerdict(rubric: Rubric, runs: JudgeRun[]): Verdict {
  const scored = runs.filter((r) => r.scores)
  const criteria = rubric.criteria.map((c) => {
    const a: number[] = []
    const b: number[] = []
    for (const run of scored) {
      const s = run.scores!.criteria[c.id]
      if (!s) continue
      const sx = run.order === 'AB' ? s.X : s.Y
      const sy = run.order === 'AB' ? s.Y : s.X
      if (sx !== null) a.push(sx)
      if (sy !== null) b.push(sy)
    }
    return { id: c.id, name: c.name, weight: c.weight, A: mean(a), B: mean(b) }
  })
  const weighted = (side: 'A' | 'B'): number | null => {
    let total = 0
    let weight = 0
    for (const c of criteria) {
      const v = c[side]
      if (v === null) continue
      total += v * c.weight
      weight += c.weight
    }
    return weight ? total / weight : null
  }
  const overallA = weighted('A')
  const overallB = weighted('B')
  const runWinners = runs.map((r) => (r.scores ? (r.scores.winner === 'tie' ? 'tie' : toAB(r.order, r.scores.winner)) : null))
  const pending = runs.some((r) => r.status === 'streaming')
  let agreement: Verdict['agreement'] = pending ? 'pending' : scored.length < 2 ? 'single' : 'agree'
  if (agreement === 'agree' && runWinners[0] !== runWinners[1]) agreement = 'flipped'
  let winner: Verdict['winner'] = null
  if (!pending && overallA !== null && overallB !== null) {
    if (agreement === 'flipped') winner = 'close'
    else if (Math.abs(overallA - overallB) < 0.25) winner = 'tie'
    else winner = overallA > overallB ? 'A' : 'B'
  }
  return { criteria, overallA, overallB, winner, agreement, runWinners }
}
