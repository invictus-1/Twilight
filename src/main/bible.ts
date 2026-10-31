import { BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  bibleBlock,
  isKind,
  mentioned,
  sameFact,
  sameName,
  type BibleEntry,
  type BibleFact,
  type BibleKind,
  type BibleState,
  type BibleStatus,
  type ContinuityIssue
} from '@shared/bible'
import { handle, kvGet, kvSet } from './db'
import { libraryFiles, passagesOf } from './docLibrary'
import { parseJson } from './insightsAi'
import { askSmall, scoutOn } from './scout'

// The story bible (see shared/bible.ts). A model (the scout's) reads the library documents you
// chose, a batch of passages at a time, and proposes entries and facts; nothing counts until you
// accept it, and what you turn down isn't proposed again. Chats get the accepted entries a message
// names, and the continuity watcher checks new writing against them.

const READ_SYSTEM = `You keep the story bible for a fiction writer: the characters, places, things, groups and lore of their story, each with short facts. You read numbered passages from the writer's own documents and report what they establish.

Report the facts that matter for keeping the story consistent: appearance, age, abilities, possessions, who is related to whom and how, where someone lives or is, what happened to them, the rules of the world. One short plain sentence each, naming who it is about ("Wren has grey eyes", "Rowan is Wren's older brother"), with the number of the passage it comes from. Leave out guesses, moods, passing actions that change nothing, and anything already among the known facts. Use a name exactly as the story does, and list other names for the same one as aliases.

Answer with JSON only, no other text:
{"entries": [{"name": "…", "kind": "character|place|thing|group|lore", "aliases": ["…"], "facts": [{"text": "…", "passage": 3}]}]}`

const CHECK_SYSTEM = `You are the continuity watcher for a fiction writer. You get established facts from their story bible, each numbered, and a new passage. Find where the passage contradicts a fact: it states or shows something that can't be true if the fact holds (eye colour, who is related to whom, someone being somewhere they can't be, a dead character acting, an object someone doesn't have). New details the facts don't cover are not contradictions, and neither is style. A fact marked "as of" a point in the story may have changed since; flag it only if nothing in the passage accounts for the change.

Report only clear contradictions; most passages have none. Quote the passage's own words exactly.

Answer with JSON only, no other text:
{"issues": [{"fact": "F3", "quote": "exact words from the passage", "says": "what the passage claims, as a short fact", "why": "one short sentence"}]}`

// About 2,500 tokens of passages a request: enough to see a scene whole, small enough to read
// carefully and answer quickly.
const BATCH_CHARS = 10_000
// Writing checked a piece at a time, at paragraph breaks.
const CHECK_CHARS = 8_000

interface Stored {
  on: boolean
  sources: string[]
  /** Each chosen file's change time when it was last read. */
  read: Record<string, number>
  lastRead: number | null
  /** Contradictions you marked as intended: fact id and the words, so they're not flagged again. */
  ignored: string[]
}
const stored = (): Stored => ({ on: false, sources: [], read: {}, lastRead: null, ignored: [], ...kvGet<Partial<Stored>>('bible') })
const save = (patch: Partial<Stored>): void => kvSet('bible', { ...stored(), ...patch })

export const bibleOn = (): boolean => stored().on

// ——— Entries ———

interface EntryRow {
  id: string
  kind: string
  name: string
  aliases: string
  notes: string
  status: BibleStatus
  created_at: number
  updated_at: number
}
interface FactRow {
  id: string
  entry_id: string
  text: string
  source: string
  line: number | null
  section: string
  status: BibleStatus
  created_at: number
}

// Read once and kept until something changes: every message a chat sends looks names up here.
let cache: BibleEntry[] | null = null
const changed = (): void => {
  cache = null
}

export function allEntries(): BibleEntry[] {
  if (cache) return cache
  const sql = handle()
  const facts = new Map<string, BibleFact[]>()
  for (const f of sql.prepare('SELECT * FROM bible_facts ORDER BY created_at, rowid').all() as FactRow[]) {
    const list = facts.get(f.entry_id) ?? []
    list.push({ id: f.id, entryId: f.entry_id, text: f.text, source: f.source, line: f.line, section: f.section, status: f.status, createdAt: f.created_at })
    facts.set(f.entry_id, list)
  }
  cache = (sql.prepare('SELECT * FROM bible_entries ORDER BY name COLLATE NOCASE').all() as EntryRow[]).map((e) => ({
    id: e.id,
    kind: isKind(e.kind) ? e.kind : 'lore',
    name: e.name,
    aliases: JSON.parse(e.aliases) as string[],
    notes: e.notes,
    status: e.status,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    facts: facts.get(e.id) ?? []
  }))
  return cache
}

/** The entries that count, each with only its accepted facts. */
function accepted(): BibleEntry[] {
  return allEntries()
    .filter((e) => e.status === 'accepted')
    .map((e) => ({ ...e, facts: e.facts.filter((f) => f.status === 'accepted') }))
}

function insertEntry(e: { kind: BibleKind; name: string; aliases: string[]; status: BibleStatus }): string {
  const id = randomUUID()
  const now = Date.now()
  handle()
    .prepare('INSERT INTO bible_entries (id, kind, name, aliases, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, e.kind, e.name, JSON.stringify(e.aliases), '', e.status, now, now)
  changed()
  return id
}

function insertFact(f: { entryId: string; text: string; source: string; line: number | null; section: string; status: BibleStatus }): string {
  const id = randomUUID()
  handle()
    .prepare('INSERT INTO bible_facts (id, entry_id, text, source, line, section, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, f.entryId, f.text, f.source, f.line, f.section, f.status, Date.now())
  changed()
  return id
}

/** Accept, remove (turned down: not proposed again) or restore entries and facts. Accepting an entry accepts the facts waiting on it. */
export function reviewBible(action: 'accept' | 'remove' | 'restore', ids: { entries?: string[]; facts?: string[] }): BibleState {
  const sql = handle()
  const status: BibleStatus = action === 'remove' ? 'removed' : 'accepted'
  const now = Date.now()
  sql.transaction(() => {
    for (const id of ids.entries ?? []) {
      sql.prepare('UPDATE bible_entries SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
      if (action === 'accept') sql.prepare("UPDATE bible_facts SET status = 'accepted' WHERE entry_id = ? AND status = 'proposed'").run(id)
    }
    for (const id of ids.facts ?? []) {
      sql.prepare('UPDATE bible_facts SET status = ? WHERE id = ?').run(status, id)
      // A fact can't count under an entry that doesn't.
      if (action !== 'remove') sql.prepare("UPDATE bible_entries SET status = 'accepted', updated_at = ? WHERE id = (SELECT entry_id FROM bible_facts WHERE id = ?) AND status = 'proposed'").run(now, id)
    }
  })()
  changed()
  announce()
  return bibleState()
}

export function editEntry(id: string, patch: { name?: string; kind?: BibleKind; aliases?: string[]; notes?: string }): BibleState {
  const sets: string[] = []
  const values: unknown[] = []
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    values.push(value)
  }
  if (patch.name?.trim()) put('name', patch.name.trim())
  if (patch.kind && isKind(patch.kind)) put('kind', patch.kind)
  if (patch.aliases) put('aliases', JSON.stringify(patch.aliases.map((a) => a.trim()).filter(Boolean)))
  if (patch.notes !== undefined) put('notes', patch.notes)
  if (sets.length) handle().prepare(`UPDATE bible_entries SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id)
  changed()
  announce()
  return bibleState()
}

export function editFact(id: string, text: string): BibleState {
  if (text.trim()) handle().prepare('UPDATE bible_facts SET text = ? WHERE id = ?').run(text.trim(), id)
  changed()
  announce()
  return bibleState()
}

/** An entry of your own, counted at once. */
export function addEntry(name: string, kind: BibleKind): BibleState {
  const existing = allEntries().find((e) => sameName(e.name, name))
  if (existing) {
    if (existing.status !== 'accepted') reviewBible('restore', { entries: [existing.id] })
  } else if (name.trim()) insertEntry({ kind, name: name.trim(), aliases: [], status: 'accepted' })
  announce()
  return bibleState()
}

/** A fact of your own (or from a chat or draft), counted at once. */
export function addFact(entryId: string, text: string, source = 'you'): BibleState {
  if (text.trim()) insertFact({ entryId, text: text.trim(), source, line: null, section: '', status: 'accepted' })
  announce()
  return bibleState()
}

// ——— Settings and state ———

export function setBibleSettings(patch: { on?: boolean; sources?: string[] }): BibleState {
  save(patch)
  announce()
  return bibleState()
}

let reading: BibleState['reading'] = null
let readingController: AbortController | null = null
let error: string | null = null

export function bibleState(): BibleState {
  const s = stored()
  const files = libraryFiles()
  return {
    settings: { on: s.on, sources: s.sources },
    entries: allEntries(),
    sources: files.map((f) => ({ path: f.path, source: f.source, chosen: s.sources.includes(f.path), current: s.read[f.path] === f.mtime })),
    reading,
    lastRead: s.lastRead,
    error,
    model: scoutOn()
  }
}

// ——— Reading documents ———

type Passage = { line: number; section: string; text: string }

/** Reads the chosen files that changed since they were last read (all of them the first time), and proposes what they establish. */
export async function readBible(): Promise<void> {
  if (reading) return
  error = null
  if (!scoutOn()) {
    error = 'The bible reads with the scout model: choose one in Settings → Documents.'
    return announce()
  }
  const s = stored()
  const files = libraryFiles().filter((f) => s.sources.includes(f.path) && s.read[f.path] !== f.mtime)
  const work = files.map((f) => ({ ...f, passages: passagesOf(f.path) }))
  readingController = new AbortController()
  reading = { done: 0, total: work.reduce((n, f) => n + f.passages.length, 0), file: '' }
  announce()
  try {
    for (const f of work) {
      reading.file = f.source
      for (let i = 0; i < f.passages.length; ) {
        const batch: Passage[] = []
        let size = 0
        while (i < f.passages.length && (batch.length === 0 || size + f.passages[i].text.length <= BATCH_CHARS)) {
          size += f.passages[i].text.length
          batch.push(f.passages[i++])
        }
        await readBatch(f.source, batch, readingController.signal)
        reading.done += batch.length
        announceSoon()
      }
      save({ read: { ...stored().read, [f.path]: f.mtime } })
    }
    save({ lastRead: Date.now() })
  } catch (err) {
    if (!readingController.signal.aborted) error = (err as Error).message
  } finally {
    reading = null
    readingController = null
    announce()
  }
}

export function stopBibleReading(): void {
  readingController?.abort()
}

async function readBatch(source: string, batch: Passage[], signal: AbortSignal): Promise<void> {
  const known = allEntries().filter((e) => e.status !== 'removed')
  const text = batch.map((p, i) => `[${i + 1}] ${source}${p.section ? ` › ${p.section}` : ''}, line ${p.line}\n${p.text}`).join('\n\n')
  const named = mentioned(text, known)
  const user = [
    known.length
      ? `Entries already in the bible:\n${known.slice(0, 400).map((e) => `- ${e.name} · ${e.kind}${e.aliases.length ? ` · also ${e.aliases.join(', ')}` : ''}`).join('\n')}`
      : 'The bible is empty so far.',
    named.length
      ? `Facts already known about who and what these passages name:\n${named
          .map((e) => `${e.name}:\n${e.facts.filter((f) => f.status !== 'removed').map((f) => `- ${f.text}`).join('\n') || '- (none yet)'}`)
          .join('\n\n')}`
      : '',
    `Passages:\n${text}`
  ]
    .filter(Boolean)
    .join('\n\n')
  const answer = parseJson(await askSmall(READ_SYSTEM, user, signal, 4000, 'bible')) as { entries?: unknown }
  merge(Array.isArray(answer.entries) ? answer.entries : [], batch, source)
}

/** Adds what a batch established as proposals, beside what's known: matched by name or alias, facts not repeated. */
export function merge(list: unknown[], batch: Passage[], source: string): void {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [])
  for (const raw of list as { name?: unknown; kind?: unknown; aliases?: unknown; facts?: unknown }[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) continue
    const aliases = strings(raw.aliases).filter((a) => !sameName(a, name))
    const names = [name, ...aliases]
    let entry = allEntries().find((e) => [e.name, ...e.aliases].some((n) => names.some((m) => sameName(n, m))))
    // Turned down: not proposed again, nor its facts.
    if (entry?.status === 'removed') continue
    if (!entry) {
      insertEntry({ kind: isKind(raw.kind) ? raw.kind : 'lore', name, aliases, status: 'proposed' })
      entry = allEntries().find((e) => sameName(e.name, name))!
    } else if (entry.status === 'proposed') {
      const more = aliases.filter((a) => ![entry!.name, ...entry!.aliases].some((n) => sameName(n, a)))
      if (more.length) {
        handle().prepare('UPDATE bible_entries SET aliases = ? WHERE id = ?').run(JSON.stringify([...entry.aliases, ...more]), entry.id)
        changed()
      }
    }
    for (const f of Array.isArray(raw.facts) ? (raw.facts as { text?: unknown; passage?: unknown }[]) : []) {
      const text = typeof f?.text === 'string' ? f.text.trim() : ''
      if (!text) continue
      const current = allEntries().find((e) => e.id === entry!.id)
      if (current?.facts.some((x) => sameFact(x.text, text))) continue
      const at = batch[Number(f.passage) - 1]
      insertFact({ entryId: entry.id, text, source, line: at?.line ?? null, section: at?.section ?? '', status: 'proposed' })
    }
  }
}

// ——— Into chats ———

/** The bible block for a message: the accepted entries it (or the reply before it) names. */
export function bibleContext(text: string): string | null {
  if (!bibleOn()) return null
  const named = mentioned(text, accepted()).filter((e) => e.facts.length || e.notes.trim())
  return named.length ? bibleBlock(named.slice(0, 12)) : null
}

// ——— The continuity watcher ———

const ignoreKey = (factId: string, quote: string): string => `${factId}\n${quote.toLowerCase().replace(/\s+/g, ' ').trim()}`

/** Finds `quote` in `text` with spacing and case aside, giving back the text's own words. */
function locate(text: string, quote: string): string | null {
  const words = quote.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i')
  return re.exec(text)?.[0] ?? null
}

async function checkPiece(text: string, entries: BibleEntry[], signal: AbortSignal): Promise<ContinuityIssue[]> {
  const named = mentioned(text, entries).filter((e) => e.facts.length).slice(0, 15)
  if (!named.length) return []
  const facts = named.flatMap((e) => e.facts.map((f) => ({ e, f })))
  const user = `Established facts:\n${facts.map((x, i) => `F${i + 1} · ${x.e.name} — ${x.f.text}${x.f.section ? ` (as of ${x.f.section})` : ''}`).join('\n')}\n\nThe new passage:\n<passage>\n${text}\n</passage>`
  const answer = parseJson(await askSmall(CHECK_SYSTEM, user, signal, 2000, 'continuity')) as { issues?: unknown }
  const ignored = new Set(stored().ignored)
  const out: ContinuityIssue[] = []
  for (const r of (Array.isArray(answer.issues) ? answer.issues : []) as { fact?: unknown; quote?: unknown; says?: unknown; why?: unknown }[]) {
    const at = facts[Number(String(r?.fact ?? '').replace(/^F/i, '')) - 1]
    const quote = typeof r?.quote === 'string' ? locate(text, r.quote) : null
    if (!at || !quote || ignored.has(ignoreKey(at.f.id, quote))) continue
    if (out.some((o) => o.factId === at.f.id && o.quote === quote)) continue
    out.push({
      id: randomUUID(),
      quote,
      says: typeof r.says === 'string' ? r.says.trim() : quote,
      why: typeof r.why === 'string' ? r.why.trim() : '',
      factId: at.f.id,
      factText: at.f.text,
      entryId: at.e.id,
      entryName: at.e.name
    })
  }
  return out
}

/** New writing checked against the accepted bible, a piece at a time; only pieces that name an entry are sent. */
export async function checkContinuity(text: string, signal: AbortSignal = new AbortController().signal): Promise<ContinuityIssue[]> {
  if (!bibleOn()) throw new Error('The story bible is off: switch it on in the Bible section.')
  if (!scoutOn()) throw new Error('The continuity watcher checks with the scout model: choose one in Settings → Documents.')
  const entries = accepted()
  const pieces: string[] = []
  let piece = ''
  for (const para of text.split(/\n{2,}/)) {
    if (piece && piece.length + para.length > CHECK_CHARS) {
      pieces.push(piece)
      piece = ''
    }
    piece = piece ? `${piece}\n\n${para}` : para
  }
  if (piece.trim()) pieces.push(piece)
  const out: ContinuityIssue[] = []
  for (const p of pieces) out.push(...(await checkPiece(p, entries, signal)))
  return out
}

/** What the watcher found in a chat's replies, by reply. */
export function continuityFor(nodeIds: string[]): Map<string, ContinuityIssue[]> {
  if (!nodeIds.length) return new Map()
  const rows = handle()
    .prepare(`SELECT node_id, data FROM continuity WHERE node_id IN (${nodeIds.map(() => '?').join(',')})`)
    .all(...nodeIds) as { node_id: string; data: string }[]
  return new Map(rows.map((r) => [r.node_id, JSON.parse(r.data) as ContinuityIssue[]]))
}

/** Checks a finished reply in the background and tells the window what it found. */
export async function watchReply(contents: WebContents, conversationId: string, nodeId: string, text: string): Promise<void> {
  const send = (issues: ContinuityIssue[] | null, problem?: string): void => {
    if (!contents.isDestroyed()) contents.send('twilight:continuity', { conversationId, nodeId, issues, ...(problem ? { error: problem } : {}) })
  }
  if (!bibleOn() || !scoutOn() || !text.trim()) return
  send(null)
  try {
    const issues = await checkContinuity(text)
    handle().prepare('INSERT OR REPLACE INTO continuity (node_id, data) VALUES (?, ?)').run(nodeId, JSON.stringify(issues))
    send(issues)
  } catch (err) {
    send([], (err as Error).message)
  }
}

/**
 * Settles a flagged contradiction. Update: the new text is right, so its claim becomes the fact
 * (the old one is kept as turned down). Ignore: intended, never flagged again. Fixed: the text
 * was changed. A chat reply's stored findings lose the issue either way.
 */
export function resolveContinuity(issue: ContinuityIssue, action: 'update' | 'ignore' | 'fixed', where: string, nodeId?: string): ContinuityIssue[] {
  if (action === 'update') {
    handle().prepare("UPDATE bible_facts SET status = 'removed' WHERE id = ?").run(issue.factId)
    insertFact({ entryId: issue.entryId, text: issue.says, source: where, line: null, section: '', status: 'accepted' })
    announce()
  } else if (action === 'ignore') save({ ignored: [...stored().ignored, ignoreKey(issue.factId, issue.quote)] })
  if (!nodeId) return []
  const left = (continuityFor([nodeId]).get(nodeId) ?? []).filter((i) => i.id !== issue.id)
  handle().prepare('INSERT OR REPLACE INTO continuity (node_id, data) VALUES (?, ?)').run(nodeId, JSON.stringify(left))
  return left
}

function announce(): void {
  const state = bibleState()
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('twilight:bible', state)
}

let soon: ReturnType<typeof setTimeout> | null = null
function announceSoon(): void {
  soon ??= setTimeout(() => {
    soon = null
    announce()
  }, 300)
}
