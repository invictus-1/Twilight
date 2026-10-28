import type { SearchHit, SearchResults, Snippet } from '@shared/types'
import * as db from './db'
import { listDocs, readDoc, writingFolder } from './docs'

// Search everything: every live message in every chat (SQLite, newest first) and every document
// in the writing folder. Documents are read once and kept by modified time, so searching as you
// type re-reads only files that changed.

const MAX_CHAT_HITS = 120
const MAX_DOC_HITS = 60
const docCache = new Map<string, { mtime: number; text: string; lower: string }>()

/** About a line's worth of text around the match, cut at word boundaries. */
function snippet(text: string, at: number, length: number): Snippet {
  const flat = (s: string): string => s.replace(/\s+/g, ' ')
  let start = Math.max(0, at - 60)
  let end = Math.min(text.length, at + length + 100)
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  if (end < text.length) end = text.lastIndexOf(' ', end) > at + length ? text.lastIndexOf(' ', end) : end
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(),
    match: text.slice(at, at + length),
    after: flat(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : '')
  }
}

function searchChats(query: string, lower: string): { hits: SearchHit[]; total: number } {
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = db
    .handle()
    .prepare(
      `SELECT n.id, n.conversation_id, n.parent_id, n.role, n.text, n.created_at, c.title
       FROM nodes n JOIN conversations c ON c.id = n.conversation_id
       WHERE n.deleted_at IS NULL AND c.deleted_at IS NULL AND n.role IN ('user', 'assistant') AND n.text LIKE ? ESCAPE '\\'
       ORDER BY n.created_at DESC LIMIT 600`
    )
    .all(like) as { id: string; conversation_id: string; parent_id: string; role: 'user' | 'assistant'; text: string; created_at: number; title: string }[]
  // A message under a deleted one is gone from its chat too; check each against its chat's live tree.
  const live = new Map<string, Map<string, db.NodeRow>>()
  const reachable = (convId: string, nodeId: string): boolean => {
    let nodes = live.get(convId)
    if (!nodes) live.set(convId, (nodes = db.loadNodes(convId)))
    for (let n = nodes.get(nodeId); n; n = n.parent_id ? nodes.get(n.parent_id) : undefined) if (n.role === 'root') return true
    return false
  }
  const hits: SearchHit[] = []
  let total = 0
  for (const r of rows) {
    // LIKE folds ASCII case only; this finds the exact place (and drops a rare false match).
    const at = r.text.toLowerCase().indexOf(lower)
    if (at < 0 || !reachable(r.conversation_id, r.id)) continue
    total++
    if (hits.length < MAX_CHAT_HITS)
      hits.push({ kind: 'chat', conversationId: r.conversation_id, nodeId: r.id, title: r.title, role: r.role, at: r.created_at, snippet: snippet(r.text, at, query.length) })
  }
  return { hits, total }
}

async function searchDocs(query: string, lower: string): Promise<{ hits: SearchHit[]; total: number }> {
  const docs = await listDocs().catch(() => [])
  const found: (SearchHit & { kind: 'doc' })[] = []
  // Keyed by folder too, so switching writing folders never shows another folder's text.
  const folder = writingFolder()
  const keep = new Set<string>()
  for (const d of docs) {
    const key = `${folder}|${d.path}`
    keep.add(key)
    let cached = docCache.get(key)
    if (!cached || cached.mtime !== d.mtime) {
      const text = await readDoc(d.path).then((c) => c.text, () => '')
      cached = { mtime: d.mtime, text, lower: text.toLowerCase() }
      docCache.set(key, cached)
    }
    const name = d.path.toLowerCase().includes(lower)
    const at = cached.lower.indexOf(lower)
    if (at < 0 && !name) continue
    let count = 0
    for (let i = at; i >= 0 && count < 999; i = cached.lower.indexOf(lower, i + lower.length)) count++
    found.push({
      kind: 'doc',
      path: d.path,
      count,
      line: at < 0 ? 0 : cached.text.slice(0, at).split('\n').length,
      snippet: at < 0 ? { before: '', match: '', after: cached.text.slice(0, 140).replace(/\s+/g, ' ') } : snippet(cached.text, at, query.length)
    })
  }
  for (const key of docCache.keys()) if (!keep.has(key)) docCache.delete(key)
  found.sort((a, b) => b.count - a.count)
  return { hits: found.slice(0, MAX_DOC_HITS), total: found.length }
}

export async function searchAll(query: string): Promise<SearchResults> {
  const started = Date.now()
  const q = query.trim()
  if (q.length < 2) return { query, chats: [], docs: [], chatTotal: 0, docTotal: 0, ms: 0 }
  const lower = q.toLowerCase()
  const chats = searchChats(q, lower)
  const docs = await searchDocs(q, lower)
  return { query, chats: chats.hits, docs: docs.hits, chatTotal: chats.total, docTotal: docs.total, ms: Date.now() - started }
}
