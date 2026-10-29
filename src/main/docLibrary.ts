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
// matches with matches by meaning.

const EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash'])
const TARGET = 1000
const MAX = 1600
const BATCH = 48

const DEFAULTS: LibrarySettings = { folders: [], embedProviderId: null, embedModelId: null, passages: 8 }

export function librarySettings(): LibrarySettings {
  return { ...DEFAULTS, ...kvGet<Partial<LibrarySettings>>('docLibrary.settings') }
}

let index: Database.Database | null = null
function db(): Database.Database {
  if (index) return index
  index = new Database(join(app.getPath('userData'), 'library.db'))
  index.pragma('journal_mode = WAL')
  index.exec(`
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, folder TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passages (id INTEGER PRIMARY KEY, path TEXT NOT NULL, source TEXT NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL, vector BLOB);
    CREATE INDEX IF NOT EXISTS passages_path ON passages(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(text, content='passages', content_rowid='id', tokenize='porter unicode61');
    CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN INSERT INTO passages_fts(rowid, text) VALUES (new.id, new.text); END;
    CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN INSERT INTO passages_fts(passages_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
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
  const next = { ...before, ...patch, passages: Math.max(1, Math.min(24, patch.passages ?? before.passages)) }
  kvSet('docLibrary.settings', next)
  // Vectors from another model don't compare; they're made again.
  if (next.embedModelId !== before.embedModelId || next.embedProviderId !== before.embedProviderId) {
    db().prepare('UPDATE passages SET vector = NULL').run()
    vectors = null
  }
  void reindex()
  return next
}

/** Passages of a few paragraphs, each with the line it starts on. Long paragraphs are cut at sentences. */
export function chunk(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  const lines = text.split(/\r?\n/)
  let buf: string[] = []
  let start = 1
  let size = 0
  const flush = (): void => {
    const t = buf.join('\n').trim()
    if (t) out.push({ line: start, text: t })
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
          out.push({ line: paraStart, text: piece.trim() })
          piece = ''
        }
        piece += `${sentence} `
      }
      if (piece.trim()) out.push({ line: paraStart, text: piece.trim() })
      return
    }
    buf.push(p)
    size += p.length
  }
  lines.forEach((l, i) => {
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
  const insert = db().prepare('INSERT INTO passages(path, source, line, text) VALUES (?, ?, ?, ?)')
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
      for (const c of chunk(text)) insert.run(path, source, c.line, c.text)
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
  const pick = db().prepare('SELECT id, text FROM passages WHERE vector IS NULL LIMIT ?')
  const put = db().prepare('UPDATE passages SET vector = ? WHERE id = ?')
  let done = 0
  for (;;) {
    const rows = pick.all(BATCH) as { id: number; text: string }[]
    if (!rows.length) break
    const vecs = await embed(rows.map((r) => r.text))
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
  const get = db().prepare('SELECT source, line, text FROM passages WHERE id = ?')
  return best.map((id) => get.get(id) as LibraryHit)
}

/** Checks the folders now and then (on start, and when a chat uses the library after a while). */
export function keepFresh(): void {
  const last = Number(meta('lastIndexed') ?? 0)
  if (!running && Date.now() - last > 2 * 60 * 1000 && librarySettings().folders.length) void reindex()
}

