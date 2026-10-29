// The AI pages of Writer insights. Each runs only when asked, with the model chosen on the page,
// and sends text only to that model's provider.
//   - Story analysis: a quick pass over a sample of excerpts, or a deep scan of every word in
//     chunks. A chunk's result is kept by the hash of its text (and the model), so a rescan only
//     pays for text that changed; the results are merged here, then one call writes the themes.
//   - Focus: a few things to work on, from the style numbers and recent passages.
//   - Insights: observations about habits, from the numbers alone (no manuscript text is sent).

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { costOf } from '@shared/pricing'
import type { AiConfig, AiState, FocusResult, StoryAnalysis, StoryEstimate, WritingNotes } from '@shared/insights'
import type { ChatSettings } from '@shared/types'
import { getDefaults } from './chat'
import * as db from './db'
import * as docs from './docs'
import { emitInsights, summary } from './insights'
import { appendLog } from './logs'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { describeAnthropicError } from './providers/anthropic'

const CHUNK_WORDS = 15_000
const SAMPLE_EXCERPTS = 10
const EXCERPT_WORDS = 2_500
const HISTORY = 30

const CATEGORIES = ['Adult Content', 'Drama', 'Action', 'Romance', 'Slice of Life', 'War/Conflict', 'Worldbuilding', 'Sci-Fi', 'Fantasy', 'Mystery', 'Horror', 'Comedy']

const PRIVATE_FICTION =
  "The text is the author's own private fiction and may include adult or violent material. Describe and classify it neutrally and accurately, as an editor would; don't refuse, soften, summarise around, or comment on the content."

const CHUNK_RULES = `You classify one passage of a long work of fiction for the author's statistics. ${PRIVATE_FICTION}

Answer with only a JSON object, no other text:
{"breakdown": {"<category>": <percent>, ...}, "genres": ["<genre>", ...], "tags": [{"name": "<broad tag>", "sub": ["<specific tag>", ...]}], "themes": ["<short theme name>", ...], "summary": "<one or two sentences on what happens>"}

- breakdown: how this passage's words divide between these categories, as whole percents summing to 100: ${CATEGORIES.join(', ')}. Use another category only when none fits.
- genres: every genre the passage belongs to (standard names: Drama, Romance, Action, Fantasy, Sci-Fi, Slice of Life, Adventure, Mystery, Horror, Comedy, War/Conflict, Adult Content, …).
- tags: up to 8 broad content tags, each with up to 6 specific subtags.
- themes: up to 5 short theme names.`

const QUICK_RULES = `You analyse a long work of fiction from excerpts sampled across it. ${PRIVATE_FICTION}

Answer with only a JSON object, no other text:
{"breakdown": {"<category>": <percent>, ...}, "genres": {"<genre>": <0-100 how strongly present>, ...}, "tags": [{"name": "<broad tag>", "sub": ["<specific tag>", ...]}], "themes": [{"name": "<theme>", "description": "<two sentences, specific to this work>"}], "tone": "<one sentence>", "summary": "<three or four sentences on what the work is about>"}

- breakdown: how the work divides between these categories, as whole percents summing to 100: ${CATEGORIES.join(', ')}.
- genres: up to 10, strongest first. tags: up to 12, each with up to 8 subtags. themes: 4 to 8.`

const THEME_RULES = `You write the closing analysis of a long work of fiction from its chunk-by-chunk summaries and the themes counted across them. ${PRIVATE_FICTION}

Answer with only a JSON object, no other text:
{"themes": [{"name": "<theme>", "description": "<two sentences, specific to this work>"}], "tone": "<one sentence>", "summary": "<three or four sentences on what the work is about>"}

Give 4 to 8 themes, most important first.`

const FOCUS_RULES = `You are a candid, encouraging writing coach. From the author's prose statistics and a few recent passages of their own private fiction, pick the 3 to 5 things that would most improve the writing. ${PRIVATE_FICTION}

Answer with only a JSON object, no other text:
{"strength": "<one sentence on what the writing already does well>", "areas": [{"title": "<short name>", "why": "<two sentences>", "evidence": ["<a quote under 25 words from the passages>", ...], "exercise": "<one concrete thing to try in the next session>"}]}`

const NOTES_RULES = `You read a writer's own statistics (how much and when they write, their prose numbers, their characters) and point out what's interesting: habits, rhythms, trends, imbalances, things worth celebrating. Be specific to the numbers; no generic advice.

Answer with only a JSON object, no other text:
{"observations": [{"title": "<short headline>", "text": "<two or three sentences>"}], "nextStep": "<one suggestion for the coming week>"}

Give 4 to 6 observations.`

// ——— State ———

let controller: AbortController | null = null
let running: AiState['running'] = null
let lastError: string | null = null

function config(): AiConfig {
  const saved = db.kvGet<Partial<AiConfig>>('insights.ai.config')
  const d = getDefaults()
  return { providerId: d.providerId, modelId: d.modelId, effort: null, parallel: 3, ...saved }
}

export function setConfig(cfg: AiConfig): AiState {
  db.kvSet('insights.ai.config', { ...cfg, parallel: Math.min(10, Math.max(1, Math.round(cfg.parallel || 3))) })
  return state()
}

type History = AiState['history']

/** Every result kept, newest first; results from before history existed are folded in once. */
function history(): History {
  const saved = db.kvGet<History>('insights.ai.history')
  if (saved) return saved
  const latest = db.kvGet<Record<string, StoryAnalysis>>('insights.ai.story') ?? {}
  const focus = db.kvGet<FocusResult>('insights.ai.focus')
  const notes = db.kvGet<WritingNotes>('insights.ai.notes')
  return { story: Object.values(latest).sort((a, b) => b.at - a.at), focus: focus ? [focus] : [], notes: notes ? [notes] : [] }
}

function remember<K extends keyof History>(kind: K, result: History[K][number]): void {
  const h = history()
  // The first time, the folded-in latest result can be this very one: keep it once.
  const rest = (h[kind] as { at: number }[]).filter((r) => r.at !== result.at)
  db.kvSet('insights.ai.history', { ...h, [kind]: [result, ...rest].slice(0, HISTORY) })
}

/** Forgets one earlier result (by its time); the latest of each kind stays until replaced. */
export function forget(kind: keyof History, at: number): AiState {
  const h = history()
  db.kvSet('insights.ai.history', { ...h, [kind]: (h[kind] as { at: number }[]).filter((r) => r.at !== at) })
  return state()
}

export function state(): AiState {
  return {
    config: config(),
    story: db.kvGet<Record<string, StoryAnalysis>>('insights.ai.story') ?? {},
    focus: db.kvGet<FocusResult>('insights.ai.focus') ?? null,
    notes: db.kvGet<WritingNotes>('insights.ai.notes') ?? null,
    history: history(),
    running,
    error: lastError
  }
}

function publish(): void {
  emitInsights({ kind: 'ai', state: state() })
}

export function stop(): void {
  controller?.abort()
}

// ——— Calling the model ———

interface CallResult {
  json: unknown
  costUsd: number | null
  model: string
}

/** Pulls the JSON object out of a reply (bare, or in a fenced block). */
export function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text)?.[1]
  const raw = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(raw)
}

async function call(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<CallResult> {
  const cfg = config()
  const provider = getProvider(cfg.providerId)
  const options = modelOptions(cfg.providerId, cfg.modelId)
  const settings: ChatSettings = {
    ...getDefaults(),
    providerId: cfg.providerId,
    modelId: cfg.modelId,
    systemPrompt: '',
    effort: cfg.effort,
    maxTokens,
    messageLimit: null,
    temperature: null,
    extraParams: '',
    webSearch: false,
    webFetch: false,
    choiceCards: false
  }
  const result = await implFor(provider).generate({
    config: provider,
    apiKey: getApiKey(provider.id),
    system,
    history: [
      {
        id: 'insights', conversation_id: 'insights', parent_id: null, role: 'user', text: user,
        content: JSON.stringify([{ type: 'text', text: user }]), thinking: null, model: null, provider_id: null,
        usage: null, status: 'done', error: null, active_child_id: null, created_at: Date.now()
      }
    ],
    settings,
    options,
    signal,
    onText: () => undefined,
    onThinking: () => undefined
  })
  if (signal.aborted) throw new Error('Stopped.')
  if (result.error) throw new Error(result.error)
  appendLog({ kind: 'insights', model: result.modelId, response: result.text })
  let json: unknown
  try {
    json = parseJson(result.text)
  } catch {
    throw new Error("The model's answer wasn't the JSON Twilight asked for. Try again, or pick another model.")
  }
  const local = provider.kind === 'openai' && /localhost|127\.0\.0\.1/.test(provider.baseUrl ?? '')
  return { json, costUsd: costOf(result.modelId, result.usage, local), model: result.modelId }
}

/** Runs one job at a time, with progress and errors published to the page. */
async function job<T>(kind: 'story' | 'focus' | 'notes', scope: string | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<AiState> {
  if (running) throw new Error('Another analysis is running. Stop it first, or wait for it to finish.')
  controller = new AbortController()
  running = { kind, done: 0, total: 1, scope }
  lastError = null
  publish()
  try {
    await work(controller.signal)
  } catch (err) {
    lastError = controller.signal.aborted ? null : (describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err)))
  } finally {
    running = null
    controller = null
    publish()
  }
  return state()
}

function progress(done: number, total: number): void {
  if (running) running = { ...running, done, total }
  publish()
}

// ——— Text ———

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length

/** A quick 32-bit hash of a paragraph (FNV-1a), for choosing where chunks end. */
function fnv(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/**
 * Splits text into chunks of about `size` words at paragraph breaks. Where a chunk ends is decided
 * by the paragraphs themselves (one whose hash hits a pattern, once the chunk is big enough), not
 * by counting from the top, so an edit only changes the chunk it's in: the rest keep their exact
 * text, and a rescan doesn't pay for them again.
 */
function chunk(text: string, size: number): string[] {
  const min = size * 0.6
  const max = size * 1.5
  const out: string[] = []
  let current: string[] = []
  let words = 0
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue
    current.push(para)
    words += countWords(para)
    if (words >= max || (words >= min && fnv(para) % 12 === 0)) {
      out.push(current.join('\n\n'))
      current = []
      words = 0
    }
  }
  if (current.length) out.push(current.join('\n\n'))
  return out
}

async function sources(scope: string): Promise<{ path: string; text: string }[]> {
  const folder = docs.writingFolder()
  const list = scope ? [{ path: scope }] : (await docs.listDocs()).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  const out: { path: string; text: string }[] = []
  for (const d of list) {
    try {
      out.push({ path: d.path, text: await readFile(join(folder, d.path), 'utf8') })
    } catch {
      // A file that vanished since the listing is simply skipped.
    }
  }
  return out
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)
const chunkKey = (hash: string, model: string): string => `insights.ai.chunk:${model}:${hash}`

// ——— Story analysis ———

export async function estimate(mode: 'quick' | 'deep', scope: string): Promise<StoryEstimate> {
  const cfg = config()
  const texts = await sources(scope)
  const words = texts.reduce((n, t) => n + countWords(t.text), 0)
  const perCallWords = mode === 'quick' ? Math.min(words, SAMPLE_EXCERPTS * EXCERPT_WORDS) : 0
  let calls = 1
  let cached = 0
  let sendWords = perCallWords
  if (mode === 'deep') {
    const chunks = texts.flatMap((t) => chunk(t.text, CHUNK_WORDS))
    for (const c of chunks) {
      if (db.kvGet(chunkKey(hashOf(c), cfg.modelId))) cached++
      else sendWords += countWords(c)
    }
    calls = chunks.length - cached + 1
  }
  // About 1.35 tokens a word in, a short answer out per call.
  const usage = { input: Math.round(sendWords * 1.35), output: calls * 500, cacheRead: 0, cacheWrite: 0, ms: 0 }
  const provider = getProvider(cfg.providerId)
  const local = provider.kind === 'openai' && /localhost|127\.0\.0\.1/.test(provider.baseUrl ?? '')
  return { calls, cached, words, costUsd: costOf(cfg.modelId, usage, local) }
}

interface ChunkResult {
  breakdown: Record<string, number>
  genres: string[]
  tags: { name: string; sub: string[] }[]
  themes: string[]
  summary: string
}

const asRecord = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && n >= 0)) : {}
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : [])
const asTags = (v: unknown): { name: string; sub: string[] }[] =>
  Array.isArray(v) ? v.filter((t) => t && typeof t.name === 'string').map((t) => ({ name: String(t.name).trim(), sub: asStrings(t.sub ?? t.subtags) })) : []

/** Percents that sum to 100, largest first, tiny ones folded away. */
function normalise(weights: Map<string, number>): { name: string; percent: number }[] {
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1
  return [...weights]
    .map(([name, w]) => ({ name, percent: (w / total) * 100 }))
    .filter((x) => x.percent >= 0.5)
    .sort((a, b) => b.percent - a.percent)
}

export function runStory(mode: 'quick' | 'deep', scope: string): Promise<AiState> {
  return job('story', scope, async (signal) => {
    const cfg = config()
    const texts = await sources(scope)
    const words = texts.reduce((n, t) => n + countWords(t.text), 0)
    if (!words) throw new Error('There is no text to analyse yet.')
    let cost: number | null = 0
    const addCost = (c: number | null): void => void (cost = cost === null || c === null ? null : cost + c)
    let result: StoryAnalysis

    if (mode === 'quick') {
      // Excerpts spread evenly through the work, in reading order.
      const all = texts.flatMap((t) => chunk(t.text, EXCERPT_WORDS).map((text) => ({ path: t.path, text })))
      const step = Math.max(1, all.length / SAMPLE_EXCERPTS)
      const picked = Array.from({ length: Math.min(SAMPLE_EXCERPTS, all.length) }, (_, i) => all[Math.floor(i * step)])
      progress(0, 1)
      const user = picked.map((p, i) => `<excerpt n="${i + 1}" from="${p.path}">\n${p.text}\n</excerpt>`).join('\n\n')
      const r = await call(QUICK_RULES, user, 8000, signal)
      addCost(r.costUsd)
      const j = r.json as Record<string, unknown>
      const genres = asRecord(j.genres)
      result = {
        mode, scope, model: r.model, at: Date.now(), words, calls: 1, costUsd: cost,
        breakdown: normalise(new Map(Object.entries(asRecord(j.breakdown)))),
        genres: Object.entries(genres).map(([name, p]) => ({ name, percent: Math.min(100, p) })).sort((a, b) => b.percent - a.percent),
        tags: asTags(j.tags).map((t) => ({ name: t.name, subtags: t.sub })),
        themes: Array.isArray(j.themes) ? j.themes.filter((t) => t?.name).map((t) => ({ name: String(t.name), description: String(t.description ?? '') })) : [],
        tone: String(j.tone ?? ''),
        summary: String(j.summary ?? '')
      }
      progress(1, 1)
    } else {
      const chunks = texts.flatMap((t) => chunk(t.text, CHUNK_WORDS))
      const results: { words: number; r: ChunkResult }[] = new Array(chunks.length)
      let done = 0
      let calls = 0
      progress(0, chunks.length + 1)
      let next = 0
      const worker = async (): Promise<void> => {
        while (next < chunks.length && !signal.aborted) {
          const i = next++
          const text = chunks[i]
          const key = chunkKey(hashOf(text), cfg.modelId)
          let r = db.kvGet<ChunkResult>(key)
          if (!r) {
            const out = await call(CHUNK_RULES, text, 3000, signal)
            calls++
            addCost(out.costUsd)
            const j = out.json as Record<string, unknown>
            r = { breakdown: asRecord(j.breakdown), genres: asStrings(j.genres), tags: asTags(j.tags), themes: asStrings(j.themes), summary: String(j.summary ?? '') }
            db.kvSet(key, r)
          }
          results[i] = { words: countWords(text), r }
          progress(++done, chunks.length + 1)
        }
      }
      await Promise.all(Array.from({ length: cfg.parallel }, worker))
      if (signal.aborted) throw new Error('Stopped.')

      // Merge: categories weighted by words; genres by the share of words they appear in.
      const breakdown = new Map<string, number>()
      const genreWords = new Map<string, number>()
      const tagCount = new Map<string, { n: number; sub: Map<string, number> }>()
      const themeCount = new Map<string, number>()
      for (const { words: w, r } of results) {
        const sum = Object.values(r.breakdown).reduce((a, b) => a + b, 0) || 1
        for (const [k, v] of Object.entries(r.breakdown)) breakdown.set(k, (breakdown.get(k) ?? 0) + (v / sum) * w)
        for (const g of new Set(r.genres)) genreWords.set(g, (genreWords.get(g) ?? 0) + w)
        for (const t of r.tags) {
          const e = tagCount.get(t.name) ?? { n: 0, sub: new Map() }
          e.n++
          for (const s of t.sub) e.sub.set(s, (e.sub.get(s) ?? 0) + 1)
          tagCount.set(t.name, e)
        }
        for (const th of r.themes) themeCount.set(th, (themeCount.get(th) ?? 0) + 1)
      }
      const topThemes = [...themeCount].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => `${t} (${n} chunks)`)
      // The closing call reads every chunk's summary, in order, trimmed to a sane length.
      const summaries = results.map((x, i) => `${i + 1}. ${x.r.summary}`).join('\n')
      const user = `Themes counted across ${results.length} chunks: ${topThemes.join('; ')}\n\nChunk summaries, in reading order:\n${summaries.slice(-120_000)}`
      const fin = await call(THEME_RULES, user, 6000, signal)
      calls++
      addCost(fin.costUsd)
      const j = fin.json as Record<string, unknown>
      result = {
        mode, scope, model: fin.model, at: Date.now(), words, calls, costUsd: cost,
        breakdown: normalise(breakdown),
        genres: [...genreWords].map(([name, w]) => ({ name, percent: (w / words) * 100 })).sort((a, b) => b.percent - a.percent).slice(0, 12),
        tags: [...tagCount]
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, 12)
          .map(([name, e]) => ({ name, subtags: [...e.sub].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s) })),
        themes: Array.isArray(j.themes) ? j.themes.filter((t) => t?.name).map((t) => ({ name: String(t.name), description: String(t.description ?? '') })) : [],
        tone: String(j.tone ?? ''),
        summary: String(j.summary ?? '')
      }
      progress(chunks.length + 1, chunks.length + 1)
    }
    const all = db.kvGet<Record<string, StoryAnalysis>>('insights.ai.story') ?? {}
    db.kvSet('insights.ai.story', { ...all, [scope]: result })
    remember('story', result)
  })
}

// ——— Focus and Insights ———

/** The last stretch of the most recently changed documents: what's being written now. */
async function recentPassages(count: number, words: number): Promise<string[]> {
  const folder = docs.writingFolder()
  const recent = (await docs.listDocs()).slice(0, count)
  const out: string[] = []
  for (const d of recent) {
    const text = await readFile(join(folder, d.path), 'utf8').catch(() => '')
    const paras = text.split(/\n\s*\n/)
    const kept: string[] = []
    let n = 0
    for (let i = paras.length - 1; i >= 0 && n < words; i--) {
      kept.unshift(paras[i])
      n += countWords(paras[i])
    }
    if (kept.join('').trim()) out.push(`<passage from="${d.path}">\n${kept.join('\n\n')}\n</passage>`)
  }
  return out
}

function styleLines(): string {
  const s = summary()
  const st = s.style
  return [
    `Words in the folder: ${s.storyTotal}`,
    `Average sentence: ${st.avgSentence.toFixed(1)} words (longest ${st.longestSentence})`,
    `Dialogue: ${st.dialoguePercent.toFixed(1)}% of words`,
    `Adverbs (-ly): ${st.adverbsPer1k.toFixed(1)} per 1,000 words; most used: ${st.topAdverbs.slice(0, 12).map((w) => `${w.word} ${w.count}`).join(', ')}`,
    `Vocabulary: ${st.vocabulary} different words (richness ${st.richness.toFixed(2)}%)`,
    `Most used words: ${st.topWords.slice(0, 25).map((w) => `${w.word} ${w.count}`).join(', ')}`
  ].join('\n')
}

export function runFocus(): Promise<AiState> {
  return job('focus', undefined, async (signal) => {
    const passages = await recentPassages(3, 1200)
    if (!passages.length) throw new Error('There is no writing to look at yet.')
    progress(0, 1)
    const r = await call(FOCUS_RULES, `Prose statistics:\n${styleLines()}\n\nRecent passages:\n${passages.join('\n\n')}`, 4000, signal)
    const j = r.json as Record<string, unknown>
    const result: FocusResult = {
      model: r.model,
      at: Date.now(),
      strength: String(j.strength ?? ''),
      areas: Array.isArray(j.areas)
        ? j.areas.filter((a) => a?.title).map((a) => ({ title: String(a.title), why: String(a.why ?? ''), evidence: asStrings(a.evidence).slice(0, 3), exercise: String(a.exercise ?? '') }))
        : []
    }
    db.kvSet('insights.ai.focus', result)
    remember('focus', result)
    progress(1, 1)
  })
}

export function runNotes(): Promise<AiState> {
  return job('notes', undefined, async (signal) => {
    const s = summary()
    const weekdays = Array(7).fill(0)
    for (const d of s.days) {
      const [y, m, day] = d.day.split('-').map(Number)
      weekdays[new Date(y, m - 1, day).getDay()] += d.words
    }
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const numbers = [
      `Tracking since ${s.trackingSince}; ${s.written} words written on ${s.activeDays} days; current streak ${s.streak}, longest ${s.longestStreak}; best day ${s.bestDay?.words ?? 0} words on ${s.bestDay?.day ?? 'n/a'}.`,
      `Today ${s.today}, this week ${s.week}, this month ${s.month}, this year ${s.year}.`,
      `Last 14 days: ${s.last14.map((d) => `${d.day} ${d.words}`).join(', ')}`,
      `By weekday: ${weekdays.map((w, i) => `${names[i]} ${w}`).join(', ')}`,
      `By hour: ${s.hours.map((w, h) => `${h}:00 ${w}`).filter((x) => !x.endsWith(' 0')).join(', ') || 'no data yet'}`,
      `Documents: ${s.files}; largest: ${[...s.perFile].sort((a, b) => b.words - a.words).slice(0, 8).map((f) => `${f.path} ${f.words}`).join(', ')}`,
      styleLines(),
      `Characters by mentions: ${s.characters.map((c) => `${c.name} ${c.mentions} (${c.share.toFixed(0)}%)`).join(', ') || 'none tracked'}`,
      `Most paired: ${s.pairs.slice(0, 8).map((p) => `${p.a}+${p.b} ${p.scenes}`).join(', ') || 'none'}`
    ].join('\n')
    progress(0, 1)
    const r = await call(NOTES_RULES, numbers, 3000, signal)
    const j = r.json as Record<string, unknown>
    const result: WritingNotes = {
      model: r.model,
      at: Date.now(),
      observations: Array.isArray(j.observations) ? j.observations.filter((o) => o?.title).map((o) => ({ title: String(o.title), text: String(o.text ?? '') })) : [],
      nextStep: String(j.nextStep ?? '')
    }
    db.kvSet('insights.ai.notes', result)
    remember('notes', result)
    progress(1, 1)
  })
}
