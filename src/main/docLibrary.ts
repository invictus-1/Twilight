import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import Database from 'better-sqlite3'
import type { LibraryHit, LibrarySettings, LibraryStatus } from '@shared/docLibrary'
import { kvGet, kvSet } from './db'
import { getApiKey, getProvider } from './providers'

// The document library's index: every .md and .txt file in the folders you add, cut into
// passages of a few paragraphs, in a full-text index of its own (library.db, rebuilt from your
// files whenever needed, so backups leave it out). Only files that changed are read again.
// With an embedding model chosen, each passage also gets a vector, and a search blends word
// matches with matches by meaning. Each passage also keeps the headings it sits under (its
// section), which are searched with it and shown beside it, so a passage that never names its
// chapter still says where it is.

const EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash'])
const TARGET = 1000
const MAX = 1600
const BATCH = 48
// Bumped when the passages table changes shape; the index is then rebuilt from the files.
const SCHEMA = '2'

const DEFAULTS: LibrarySettings = { folders: [], embedProviderId: null, embedModelId: null, passages: 8, scoutProviderId: null, scoutModelId: null, scoutWords: 2500 }

export function librarySettings(): LibrarySettings {
  return { ...DEFAULTS, ...kvGet<Partial<LibrarySettings>>('docLibrary.settings') }
}

let index: Database.Database | null = null
function db(): Database.Database {
  if (index) return index
  index = new Database(join(app.getPath('userData'), 'library.db'))
  index.pragma('journal_mode = WAL')
  const version = (() => {
    try {
      return (index.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value
    } catch {
      return undefined
    }
  })()
  if (version !== SCHEMA) {
    index.exec(`
      DROP TRIGGER IF EXISTS passages_ai; DROP TRIGGER IF EXISTS passages_ad;
      DROP TABLE IF EXISTS passages_fts; DROP TABLE IF EXISTS passages; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS meta;
    `)
  }
  index.exec(`
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, folder TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passages (id INTEGER PRIMARY KEY, path TEXT NOT NULL, source TEXT NOT NULL, line INTEGER NOT NULL, section TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, vector BLOB);
    CREATE INDEX IF NOT EXISTS passages_path ON passages(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(section, text, content='passages', content_rowid='id', tokenize='porter unicode61');
    CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN INSERT INTO passages_fts(rowid, section, text) VALUES (new.id, new.section, new.text); END;
    CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN INSERT INTO passages_fts(passages_fts, rowid, section, text) VALUES ('delete', old.id, old.section, old.text); END;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  index.prepare("INSERT INTO meta(key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA)
  return index
}

const meta = (key: string): string | null => (db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
const setMeta = (key: string, value: string): void => void db().prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

let status: Omit<LibraryStatus, 'files' | 'passages' | 'embedded' | 'lastIndexed'> = { indexing: false, progress: null, error: null }

export function libraryStatus(): LibraryStatus {
  const count = (sql: string): number => (db().prepare(sql).get() as { n: number }).n
  const last = meta('lastIndexed')
  return {
    ...status,
    files: count('SELECT COUNT(*) AS n FROM files'),
    passages: count('SELECT COUNT(*) AS n FROM passages'),
    embedded: count('SELECT COUNT(*) AS n FROM passages WHERE vector IS NOT NULL'),
    lastIndexed: last ? Number(last) : null
  }
}

function announce(): void {
  const s = libraryStatus()
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('twilight:library', s)
}

export function setLibrarySettings(patch: Partial<LibrarySettings>): LibrarySettings {
  const before = librarySettings()
  const next = { ...before, ...patch, passages: Math.max(1, Math.min(24, patch.passages ?? before.passages)), scoutWords: Math.max(300, Math.min(20_000, patch.scoutWords ?? before.scoutWords)) }
  kvSet('docLibrary.settings', next)
  // Vectors from another model don't compare; they're made again.
  if (next.embedModelId !== before.embedModelId || next.embedProviderId !== before.embedProviderId) {
    db().prepare('UPDATE passages SET vector = NULL').run()
    vectors = null
  }
  void reindex()
  return next
}

/**
 * Passages of a few paragraphs, each with the line it starts on and the headings above it
 * ("Part one › The storm"). Long paragraphs are cut at sentences; a heading starts a new passage,
 * so a passage never straddles two scenes.
 */
export function chunk(text: string): { line: number; section: string; text: string }[] {
  const out: { line: number; section: string; text: string }[] = []
  const trail: string[] = []
  let section = ''
  const lines = text.split(/\r?\n/)
  let buf: string[] = []
  let start = 1
  let size = 0
  const flush = (): void => {
    const t = buf.join('\n').trim()
    if (t) out.push({ line: start, section, text: t })
    buf = []
    size = 0
  }
  let para: string[] = []
  let paraStart = 1
  const addPara = (): void => {
    const p = para.join('\n').trim()
    para = []
    if (!p) return
    if (size && size + p.length > TARGET) flush()
    if (!size) start = paraStart
    if (p.length > MAX) {
      // One very long paragraph becomes several passages, cut between sentences.
      flush()
      let piece = ''
      for (const sentence of p.split(/(?<=[.!?])\s+/)) {
        if (piece && piece.length + sentence.length > TARGET) {
          out.push({ line: paraStart, section, text: piece.trim() })
          piece = ''
        }
        piece += `${sentence} `
      }
      if (piece.trim()) out.push({ line: paraStart, section, text: piece.trim() })
      return
    }
    buf.push(p)
    size += p.length
  }
  lines.forEach((l, i) => {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)
    if (heading) {
      addPara()
      flush()
      trail.length = heading[1].length - 1
      trail[heading[1].length - 1] = heading[2].trim()
      section = trail.filter(Boolean).join(' › ')
    }
    if (!l.trim()) {
      addPara()
      paraStart = i + 2
    } else {
      if (!para.length) paraStart = i + 1
      para.push(l)
    }
  })
  addPara()
  flush()
  return out
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await walk(full, out)
    else if (EXTENSIONS.has(extname(e.name).toLowerCase())) out.push(full)
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

let running: Promise<void> | null = null
let again = false

/** Brings the index up to date with the folders (only changed files are read), then embeds what's new. */
export function reindex(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    status = { indexing: true, progress: null, error: null }
    announce()
    try {
      do {
        again = false
        await readFolders()
        await embedNew()
      } while (again)
      setMeta('lastIndexed', String(Date.now()))
    } catch (err) {
      status.error = (err as Error).message
    } finally {
      status = { ...status, indexing: false, progress: null }
      running = null
      vectors = null
      announce()
    }
  })()
  return running
}

async function readFolders(): Promise<void> {
  const { folders } = librarySettings()
  const found = new Map<string, string>()
  for (const folder of folders) {
    const files: string[] = []
    await walk(folder, files)
    for (const f of files) found.set(f, folder)
  }
  const known = new Map((db().prepare('SELECT path, mtime, size FROM files').all() as { path: string; mtime: number; size: number }[]).map((r) => [r.path, r]))
  const drop = db().prepare('DELETE FROM passages WHERE path = ?')
  const dropFile = db().prepare('DELETE FROM files WHERE path = ?')
  for (const path of known.keys()) {
    if (found.has(path)) continue
    db().transaction(() => {
      drop.run(path)
      dropFile.run(path)
    })()
  }
  const insert = db().prepare('INSERT INTO passages(path, source, line, section, text) VALUES (?, ?, ?, ?, ?)')
  const upsert = db().prepare('INSERT INTO files(path, folder, mtime, size) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET folder = excluded.folder, mtime = excluded.mtime, size = excluded.size')
  let done = 0
  for (const [path, folder] of found) {
    done++
    let info: import('node:fs').Stats
    try {
      info = await fs.stat(path)
    } catch {
      continue
    }
    const had = known.get(path)
    if (had && had.mtime === info.mtimeMs && had.size === info.size) continue
    const text = await fs.readFile(path, 'utf8').catch(() => '')
    const source = `${basename(folder)}/${relative(folder, path).replace(/\\/g, '/')}`
    db().transaction(() => {
      drop.run(path)
      for (const c of chunk(text)) insert.run(path, source, c.line, c.section, c.text)
      upsert.run(path, folder, info.mtimeMs, info.size)
    })()
    if (done % 20 === 0) {
      status.progress = { phase: 'reading', done, total: found.size }
      announce()
      await tick()
    }
  }
}

/** The embedding endpoint (OpenAI's shape, which Ollama, LM Studio and others share). */
async function embed(texts: string[]): Promise<Float32Array[]> {
  const { embedProviderId, embedModelId } = librarySettings()
  const provider = getProvider(embedProviderId ?? '')
  if (provider.kind === 'anthropic') throw new Error("Claude doesn't make embeddings; choose a model from a local server such as Ollama.")
  const key = getApiKey(provider.id)
  const res = await fetch(`${(provider.baseUrl ?? '').replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: embedModelId, input: texts })
  })
  if (!res.ok) throw new Error(`Embeddings from ${provider.name}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const json = (await res.json()) as { data?: { embedding: number[]; index?: number }[] }
  const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (rows.length !== texts.length) throw new Error(`Embeddings from ${provider.name} came back incomplete.`)
  return rows.map((r) => normalize(Float32Array.from(r.embedding)))
}

function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

async function embedNew(): Promise<void> {
  const { embedProviderId, embedModelId } = librarySettings()
  if (!embedProviderId || !embedModelId) return
  const total = (db().prepare('SELECT COUNT(*) AS n FROM passages WHERE vector IS NULL').get() as { n: number }).n
  const pick = db().prepare('SELECT id, section, text FROM passages WHERE vector IS NULL LIMIT ?')
  const put = db().prepare('UPDATE passages SET vector = ? WHERE id = ?')
  let done = 0
  for (;;) {
    const rows = pick.all(BATCH) as { id: number; section: string; text: string }[]
    if (!rows.length) break
    const vecs = await embed(rows.map((r) => (r.section ? `${r.section}\n\n${r.text}` : r.text)))
    db().transaction(() => rows.forEach((r, i) => put.run(Buffer.from(vecs[i].buffer), r.id)))()
    done += rows.length
    status.progress = { phase: 'embedding', done, total }
    announce()
  }
}

// Vectors for search by meaning, loaded once and kept until the index changes.
let vectors: { ids: Int32Array; dims: number; data: Float32Array } | null = null
function loadVectors(): typeof vectors {
  if (vectors) return vectors
  const rows = db().prepare('SELECT id, vector FROM passages WHERE vector IS NOT NULL').all() as { id: number; vector: Buffer }[]
  if (!rows.length) return null
  const dims = rows[0].vector.byteLength / 4
  const data = new Float32Array(rows.length * dims)
  const ids = new Int32Array(rows.length)
  rows.forEach((r, i) => {
    ids[i] = r.id
    data.set(new Float32Array(r.vector.buffer, r.vector.byteOffset, dims), i * dims)
  })
  vectors = { ids, dims, data }
  return vectors
}

/** The words of a message as a full-text query: any of them, each matched by its stem. */
function ftsQuery(text: string): string | null {
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}']{2,}/gu) ?? [])].slice(0, 40)
  return words.length ? words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ') : null
}

/**
 * The passages that best match a message: word matches (BM25) and, with an embedding model,
 * matches by meaning, blended by rank (reciprocal rank fusion) so neither swamps the other.
 */
export async function searchLibrary(text: string, count = librarySettings().passages): Promise<LibraryHit[]> {
  const scores = new Map<number, number>()
  const add = (ids: number[]): void => ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank)))
  const q = ftsQuery(text)
  if (q) add((db().prepare('SELECT rowid AS id FROM passages_fts WHERE passages_fts MATCH ? ORDER BY bm25(passages_fts) LIMIT 50').all(q) as { id: number }[]).map((r) => r.id))
  const { embedProviderId, embedModelId } = librarySettings()
  const v = embedProviderId && embedModelId ? loadVectors() : null
  if (v) {
    try {
      const [query] = await embed([text.slice(0, 4000)])
      if (query.length === v.dims) {
        const sims = new Float32Array(v.ids.length)
        for (let i = 0; i < v.ids.length; i++) {
          let s = 0
          const at = i * v.dims
          for (let d = 0; d < v.dims; d++) s += v.data[at + d] * query[d]
          sims[i] = s
        }
        const order = [...sims.keys()].sort((a, b) => sims[b] - sims[a]).slice(0, 50)
        add(order.map((i) => v.ids[i]))
      }
    } catch {
      // Search by meaning is a bonus; word search still answers if the embedding server is away.
    }
  }
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([id]) => id)
  const get = db().prepare('SELECT id, source, line, section, text FROM passages WHERE id = ?')
  return best.map((id) => get.get(id) as LibraryHit)
}

/** Files in the order a reader meets them: by folder and name, with numbers counted (Chapter 2 before Chapter 10). */
const storyOrder = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/**
 * Chosen passages as whole stretches of story: each grows to take in the passages just before and
 * after it in its file while the budget allows, stretches that meet become one, and they come back
 * in the order a reader meets them rather than by score.
 */
export function gather(ids: number[], budgetChars: number): LibraryHit[] {
  type Row = LibraryHit & { id: number; path: string }
  const get = db().prepare('SELECT id, path, source, line, section, text FROM passages WHERE id = ?')
  const inFile = db().prepare('SELECT id, path, source, line, section, text FROM passages WHERE path = ? ORDER BY line, id')
  // Each file's passages in order, read once.
  const files = new Map<string, Row[]>()
  const fileOf = (path: string): Row[] => {
    if (!files.has(path)) files.set(path, inFile.all(path) as Row[])
    return files.get(path) ?? []
  }
  const taken = new Map<number, Row>()
  let used = 0
  const take = (r: Row): boolean => {
    if (taken.has(r.id)) return true
    if (used + r.text.length > budgetChars && taken.size) return false
    taken.set(r.id, r)
    used += r.text.length
    return true
  }
  const picked = ids.map((id) => get.get(id) as Row | undefined).filter((r): r is Row => !!r)
  // The picks themselves first, best first; then their neighbours, one ring at a time.
  for (const r of picked) take(r)
  for (let ring = 1; ring <= 3; ring++) {
    for (const r of picked) {
      if (!taken.has(r.id)) continue
      const file = fileOf(r.path)
      const at = file.findIndex((x) => x.id === r.id)
      for (const x of [file[at - ring], file[at + ring]]) if (x) take(x)
    }
  }
  // Story order, with runs of neighbouring passages joined into one.
  const position = (r: Row): number => fileOf(r.path).findIndex((x) => x.id === r.id)
  const rows = [...taken.values()].sort((a, b) => storyOrder(a.source, b.source) || a.line - b.line || a.id - b.id)
  const out: (LibraryHit & { path: string; last: number })[] = []
  for (const r of rows) {
    const prev = out.at(-1)
    const pos = position(r)
    if (prev && prev.path === r.path && pos === prev.last + 1) {
      prev.text += `\n\n${r.text}`
      prev.last = pos
    } else out.push({ id: r.id, source: r.source, line: r.line, section: r.section, text: r.text, path: r.path, last: pos })
  }
  return out.map(({ id, source, line, section, text }) => ({ id, source, line, section, text }))
}

/** Every file the library has read, in story order, with when it last changed (for the story bible). */
export function libraryFiles(): { path: string; source: string; mtime: number }[] {
  const rows = db().prepare('SELECT f.path, f.mtime, (SELECT source FROM passages p WHERE p.path = f.path LIMIT 1) AS source FROM files f').all() as { path: string; mtime: number; source: string | null }[]
  return rows.filter((r) => r.source).map((r) => ({ path: r.path, source: r.source!, mtime: r.mtime })).sort((a, b) => storyOrder(a.source, b.source))
}

/** A file's passages in order, with the headings each sits under. */
export function passagesOf(path: string): { line: number; section: string; text: string }[] {
  return db().prepare('SELECT line, section, text FROM passages WHERE path = ? ORDER BY line, id').all(path) as { line: number; section: string; text: string }[]
}

/** Checks the folders now and then (on start, and when a chat uses the library after a while). */
export function keepFresh(): void {
  const last = Number(meta('lastIndexed') ?? 0)
  if (!running && Date.now() - last > 2 * 60 * 1000 && librarySettings().folders.length) void reindex()
}

