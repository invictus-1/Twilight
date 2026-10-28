// Writer insights, the main-process side. A scan reads every markdown file in the writing folder
// (in a worker thread, skipping files that haven't changed) and keeps each file's analysis. Words
// written are measured as growth between scans and booked to the day and hour they happened:
//   - the first scan of a folder is a baseline, so a finished manuscript isn't "written today";
//   - a new file counts as written, unless it's over IMPORT_LIMIT words (an import, not a day's work);
//   - shrinking a file books removed words, never negative writing.
// Scans run at launch, when the folder changes on disk (debounced), and on Rescan.

import type { WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import {
  ACHIEVEMENTS,
  STOPWORDS,
  type AchievementStats,
  type DayCount,
  type DocAnalysis,
  type InsightsSummary,
  type TrackedCharacter
} from '@shared/insights'
import type { InsightsEvent } from '@shared/types'
import createWorker from './insights.worker?nodeWorker'
import * as db from './db'
import * as docs from './docs'
import * as judge from './judge'

const IMPORT_LIMIT = 20_000
const COLORS = ['#c4a0ff', '#7dd3fc', '#ffb48a', '#5fd3a8', '#f9a8d4', '#9497ff', '#f5c76a', '#a3e635', '#fb7185', '#67e8f9']

const listeners = new Set<WebContents>()
let cache: InsightsSummary | null = null
let scanning: Promise<void> | null = null
/** The scan queued behind the running one; everyone asking mid-scan shares it. */
let queued: Promise<void> | null = null
let watcher: FSWatcher | null = null
let watchTimer: NodeJS.Timeout | undefined

export function emitInsights(event: InsightsEvent): void {
  for (const wc of listeners) {
    if (wc.isDestroyed()) listeners.delete(wc)
    else wc.send('twilight:insights', event)
  }
}

// ——— The worker ———

let worker: ReturnType<typeof createWorker> | null = null
let nextId = 0
const pending = new Map<number, { resolve: (a: DocAnalysis) => void; reject: (e: Error) => void }>()

function analyze(file: string, characters: TrackedCharacter[]): Promise<DocAnalysis> {
  if (!worker) {
    worker = createWorker({})
    worker.on('message', (m: { id: number; analysis?: DocAnalysis; error?: string }) => {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.analysis) p?.resolve(m.analysis)
      else p?.reject(new Error(m.error ?? 'Analysis failed'))
    })
    worker.on('error', (err) => {
      for (const p of pending.values()) p.reject(err)
      pending.clear()
      worker = null
    })
    worker.unref()
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ id, file, characters })
  })
}

// ——— Dates ———

const pad = (n: number): string => String(n).padStart(2, '0')
export const dayOf = (d = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number)
  return dayOf(new Date(y, m - 1, d + n))
}

// ——— Characters ———

export function getCharacters(): TrackedCharacter[] {
  return db.kvGet<TrackedCharacter[]>('insights.characters') ?? []
}

export async function setCharacters(list: TrackedCharacter[]): Promise<InsightsSummary> {
  const clean = list
    .map((c, i) => ({ name: c.name.trim(), aliases: c.aliases.map((a) => a.trim()).filter(Boolean), color: c.color || COLORS[i % COLORS.length] }))
    .filter((c) => c.name)
  db.kvSet('insights.characters', clean)
  db.kvSet('insights.charactersSeeded', true)
  cache = null
  await scan()
  return summary()
}

const charsKey = (list: TrackedCharacter[]): string => createHash('sha1').update(JSON.stringify(list.map((c) => [c.name, c.aliases]))).digest('hex').slice(0, 12)

// ——— Scanning ———

interface Row {
  path: string
  mtime: number
  size: number
  words: number
  chars_key: string
  analysis: string
}

/**
 * Scans the writing folder. Asked for mid-scan, it resolves after a scan that starts later, so a
 * change made just now (a new character list, a saved file) is always in the result.
 */
export function scan(): Promise<void> {
  if (scanning) {
    queued ??= scanning.then(() => {
      queued = null
      return scan()
    })
    return queued
  }
  scanning = runScan()
    .catch((err) => console.error('insights scan failed', err))
    .finally(() => {
      scanning = null
      emitInsights({ kind: 'updated' })
    })
  emitInsights({ kind: 'updated' })
  return scanning
}

async function runScan(): Promise<void> {
  const h = db.handle()
  const folder = docs.writingFolder()
  // A different folder starts a new baseline; the history of days written stays.
  if (db.kvGet<string>('insights.folder') !== folder) {
    h.prepare('DELETE FROM doc_stats').run()
    db.kvSet('insights.folder', folder)
    db.kvDelete('insights.baselined')
  }
  const baseline = !db.kvGet<boolean>('insights.baselined')
  const characters = getCharacters()
  const key = charsKey(characters)
  const list = await docs.listDocs()
  const known = new Map((h.prepare('SELECT path, mtime, size, words, chars_key FROM doc_stats').all() as Row[]).map((r) => [r.path, r]))
  const upsert = h.prepare(
    'INSERT INTO doc_stats (path, mtime, size, words, chars_key, analysis) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, words = excluded.words, chars_key = excluded.chars_key, analysis = excluded.analysis'
  )
  const todo = list.filter((d) => {
    const row = known.get(d.path)
    return !row || row.mtime !== d.mtime || row.size !== d.size || row.chars_key !== key
  })
  let written = 0
  let removed = 0
  let done = 0
  for (const d of todo) {
    let analysis: DocAnalysis
    try {
      analysis = await analyze(join(folder, d.path), characters)
    } catch {
      continue // unreadable right now (mid-save); the next scan picks it up
    }
    const row = known.get(d.path)
    if (row) {
      const delta = analysis.words - row.words
      if (delta > 0) written += delta
      else removed -= delta
    } else if (!baseline && analysis.words <= IMPORT_LIMIT) written += analysis.words
    upsert.run(d.path, d.mtime, d.size, analysis.words, key, JSON.stringify(analysis))
    if (++done % 4 === 0 || done === todo.length) emitInsights({ kind: 'progress', done, total: todo.length })
  }
  const present = new Set(list.map((d) => d.path))
  for (const path of known.keys()) if (!present.has(path)) h.prepare('DELETE FROM doc_stats WHERE path = ?').run(path)

  if (written || removed) {
    const now = new Date()
    h.prepare(
      'INSERT INTO writing_days (day, written, removed) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET written = written + excluded.written, removed = removed + excluded.removed'
    ).run(dayOf(now), written, removed)
    const hours = db.kvGet<number[]>('insights.hours') ?? Array(24).fill(0)
    hours[now.getHours()] += written
    db.kvSet('insights.hours', hours)
  }
  if (baseline) {
    db.kvSet('insights.baselined', true)
    if (!db.kvGet<string>('insights.since')) db.kvSet('insights.since', dayOf())
  }
  db.kvSet('insights.scannedAt', Date.now())
  cache = null

  // The first time there are names to go on, track the most mentioned ones; after that the list is yours.
  if (!db.kvGet<boolean>('insights.charactersSeeded') && characters.length === 0) {
    const seeds = summary().suggestions.filter((s) => s.count >= 20).slice(0, 12)
    if (seeds.length) {
      db.kvSet('insights.characters', seeds.map((s, i) => ({ name: s.name, aliases: [], color: COLORS[i % COLORS.length] })))
      db.kvSet('insights.charactersSeeded', true)
      void scan() // queued behind this one, to count the new list
    }
  }
  unlockAchievements(baseline)
}

// ——— Achievements ———

function unlockAchievements(quietly: boolean): void {
  const s = summary()
  const unlocked = db.kvGet<Record<string, number>>('insights.achievements') ?? {}
  const fresh: string[] = []
  for (const a of s.achievements) {
    if (!unlocked[a.def.id] && a.value >= a.def.target) {
      unlocked[a.def.id] = Date.now()
      fresh.push(a.def.name)
    }
  }
  if (!fresh.length) return
  db.kvSet('insights.achievements', unlocked)
  cache = null
  // What a first scan finds was earned before tracking began: it's unlocked without fanfare.
  if (!quietly) emitInsights({ kind: 'unlocked', names: fresh })
}

// ——— The summary the pages show ———

export function summary(): InsightsSummary {
  if (cache) return cache
  const h = db.handle()
  const rows = h.prepare('SELECT path, words, analysis FROM doc_stats').all() as Pick<Row, 'path' | 'words' | 'analysis'>[]
  const files = rows.map((r) => ({ path: r.path, a: JSON.parse(r.analysis) as DocAnalysis }))
  const characters = getCharacters()

  // Style, across every file.
  let words = 0, sentences = 0, sentenceWords = 0, longest = 0, dialogue = 0, adverbs = 0, paragraphs = 0
  const vocab = new Map<string, number>()
  const names = new Map<string, number>()
  const mentions = new Map<string, number>()
  const pairs = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string, n: number): void => void m.set(k, (m.get(k) ?? 0) + n)
  for (const { a } of files) {
    words += a.words
    sentences += a.sentences
    sentenceWords += a.sentenceWords
    longest = Math.max(longest, a.longestSentence)
    dialogue += a.dialogueWords
    adverbs += a.adverbs
    paragraphs += a.paragraphs
    for (const [k, n] of Object.entries(a.vocab)) bump(vocab, k, n)
    for (const [k, n] of Object.entries(a.names)) bump(names, k, n)
    for (const [k, n] of Object.entries(a.mentions)) bump(mentions, k, n)
    for (const [k, n] of Object.entries(a.pairs)) bump(pairs, k, n)
  }
  const sorted = (m: Map<string, number>, keep: (k: string) => boolean, n: number): { word: string; count: number }[] =>
    [...m].filter(([k]) => keep(k)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([word, count]) => ({ word, count }))
  const trackedNames = new Set(characters.flatMap((c) => [c.name, ...c.aliases]).map((n) => n.toLowerCase()))
  const totalMentions = [...mentions.values()].reduce((a, b) => a + b, 0)

  // Days.
  const dayRows = h.prepare('SELECT day, written FROM writing_days WHERE written > 0 ORDER BY day').all() as { day: string; written: number }[]
  const days: DayCount[] = dayRows.map((r) => ({ day: r.day, words: r.written }))
  const byDay = new Map(days.map((d) => [d.day, d.words]))
  const today = dayOf()
  const sumSince = (from: string): number => days.filter((d) => d.day >= from).reduce((a, d) => a + d.words, 0)
  const now = new Date()
  let streak = 0
  for (let d = byDay.has(today) ? today : addDays(today, -1); byDay.has(d); d = addDays(d, -1)) streak++
  let longestStreak = 0
  let run = 0
  let prev = ''
  for (const d of days) {
    run = prev && addDays(prev, 1) === d.day ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    prev = d.day
  }
  const bestDay = days.reduce<DayCount | null>((best, d) => (!best || d.words > best.words ? d : best), null)
  const hours = db.kvGet<number[]>('insights.hours') ?? Array(24).fill(0)

  const perFile = files
    .map(({ path, a }) => {
      const top = Object.entries(a.mentions).sort((x, y) => y[1] - x[1])[0]
      return {
        path,
        words: a.words,
        avgSentence: a.sentences ? a.sentenceWords / a.sentences : 0,
        dialoguePercent: a.words ? (a.dialogueWords / a.words) * 100 : 0,
        topCharacter: top?.[0] ?? null,
        topMentions: top?.[1] ?? 0
      }
    })
    .sort((x, y) => x.path.localeCompare(y.path, undefined, { numeric: true }))

  const style = {
    avgSentence: sentences ? sentenceWords / sentences : 0,
    longestSentence: longest,
    dialoguePercent: words ? (dialogue / words) * 100 : 0,
    adverbsPer1k: words ? (adverbs / words) * 1000 : 0,
    vocabulary: vocab.size,
    richness: words ? (vocab.size / words) * 100 : 0,
    paragraphs,
    topWords: sorted(vocab, (k) => k.length >= 3 && !STOPWORDS.has(k) && !trackedNames.has(k), 60),
    topAdverbs: sorted(vocab, (k) => k.length > 4 && k.endsWith('ly') && !STOPWORDS.has(k), 20)
  }
  const written = days.reduce((a, d) => a + d.words, 0)
  const stats: AchievementStats = {
    storyTotal: words,
    written,
    bestDay: bestDay?.words ?? 0,
    longestStreak,
    activeDays: days.length,
    characters: characters.length,
    vocabulary: vocab.size,
    nightWords: hours.slice(0, 4).reduce((a, b) => a + b, 0),
    dawnWords: hours.slice(5, 8).reduce((a, b) => a + b, 0),
    dialoguePercent: style.dialoguePercent,
    judgments: judge.listJudgments().length
  }
  const unlocked = db.kvGet<Record<string, number>>('insights.achievements') ?? {}

  cache = {
    scannedAt: db.kvGet<number>('insights.scannedAt') ?? null,
    scanning: !!scanning,
    folder: docs.writingFolder(),
    trackingSince: db.kvGet<string>('insights.since') ?? null,
    files: files.length,
    storyTotal: words,
    today: byDay.get(today) ?? 0,
    week: sumSince(addDays(today, -6)),
    month: sumSince(`${today.slice(0, 7)}-01`),
    year: sumSince(`${now.getFullYear()}-01-01`),
    written,
    activeDays: days.length,
    streak,
    longestStreak,
    bestDay,
    last14: Array.from({ length: 14 }, (_, i) => {
      const day = addDays(today, i - 13)
      return { day, words: byDay.get(day) ?? 0 }
    }),
    hours,
    days,
    style,
    perFile,
    characters: characters.map((c) => ({ ...c, mentions: mentions.get(c.name) ?? 0, share: totalMentions ? ((mentions.get(c.name) ?? 0) / totalMentions) * 100 : 0 })),
    pairs: [...pairs]
      .map(([k, scenes]) => {
        const [a, b] = k.split('|')
        return { a, b, scenes }
      })
      .sort((x, y) => y.scenes - x.scenes)
      .slice(0, 12),
    suggestions: [...names]
      .filter(([n, c]) => c >= 5 && !trackedNames.has(n.toLowerCase()))
      .sort((x, y) => y[1] - x[1])
      .slice(0, 24)
      .map(([name, count]) => ({ name, count })),
    achievements: ACHIEVEMENTS.map((def) => ({ def, value: stats[def.metric], unlockedAt: unlocked[def.id] ?? null }))
  }
  return cache
}

export function subscribe(wc: WebContents): InsightsSummary {
  listeners.add(wc)
  return { ...summary(), scanning: !!scanning }
}

// ——— Watching the folder ———

/** Rescans a few seconds after markdown in the writing folder changes (saves come in bursts). */
export function watchFolder(): void {
  watcher?.close()
  watcher = null
  try {
    watcher = watch(docs.writingFolder(), { recursive: true }, (_event, name) => {
      if (!name || !String(name).toLowerCase().endsWith('.md')) return
      clearTimeout(watchTimer)
      watchTimer = setTimeout(() => void scan(), 4000)
    })
  } catch {
    // The folder may not exist yet; the next folder change or launch sets the watch up.
  }
}

/** At launch: a scan once the window is up, then keep watching. */
export function start(): void {
  setTimeout(() => {
    void scan()
    watchFolder()
  }, 2500)
}
