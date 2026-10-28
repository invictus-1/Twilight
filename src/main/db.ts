import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { ChatSettings, NodeStatus, NodeView, Usage } from '@shared/types'

// Conversations are trees. Every conversation has one hidden root node whose text is the
// frozen system prompt; each node remembers which child is active, so the visible thread
// is "follow active_child_id from the root". Nothing is ever overwritten: regenerating or
// editing adds a sibling, which keeps every request an append to the previous one.

export interface NodeRow {
  id: string
  conversation_id: string
  parent_id: string | null
  role: 'root' | 'user' | 'assistant'
  text: string
  /** Provider-native content blocks (JSON), replayed unchanged on later requests. */
  content: string | null
  thinking: string | null
  model: string | null
  provider_id: string | null
  usage: string | null
  status: NodeStatus
  error: string | null
  active_child_id: string | null
  created_at: number
}

export interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  root_id: string
  settings: string
  started: number
  /** Split compare: pane B's leaf node and settings (JSON), or null. */
  split: string | null
  folder_id: string | null
  pinned: number
}

export interface FolderRow {
  id: string
  name: string
  created_at: number
  collapsed: number
}

export function listFolders(): FolderRow[] {
  return db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all() as FolderRow[]
}

export function createFolder(name: string): FolderRow {
  const row: FolderRow = { id: randomUUID(), name, created_at: Date.now(), collapsed: 0 }
  db.prepare('INSERT INTO folders (id, name, created_at, collapsed) VALUES (@id, @name, @created_at, @collapsed)').run(row)
  return row
}

export function updateFolder(id: string, fields: Partial<Pick<FolderRow, 'name' | 'collapsed'>>): void {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`)
  if (sets.length) db.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = @id`).run({ ...fields, id })
}

/** Removes a folder; its chats are kept and move back to Recent. */
export function deleteFolder(id: string): void {
  db.transaction(() => {
    db.prepare('UPDATE conversations SET folder_id = NULL WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  })()
}

/** Filing and pinning don't count as activity, so they leave updated_at alone. */
export function fileConversation(id: string, fields: { folder_id?: string | null; pinned?: number }): void {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`)
  if (sets.length) db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = @id`).run({ ...fields, id })
}

let db: Database.Database

export function openDatabase(file: string): void {
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      root_id TEXT NOT NULL,
      settings TEXT NOT NULL,
      started INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      parent_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      content TEXT,
      thinking TEXT,
      model TEXT,
      provider_id TEXT,
      usage TEXT,
      status TEXT NOT NULL,
      error TEXT,
      active_child_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS nodes_conversation ON nodes(conversation_id);
    CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(updated_at DESC);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const columns = (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map((c) => c.name)
  if (!columns.includes('split')) db.exec('ALTER TABLE conversations ADD COLUMN split TEXT')
  if (!columns.includes('folder_id')) db.exec('ALTER TABLE conversations ADD COLUMN folder_id TEXT')
  if (!columns.includes('pinned')) db.exec('ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0
    );
  `)
  // A crash mid-stream leaves "streaming" rows behind; they are stopped, not lost.
  db.prepare(`UPDATE nodes SET status = 'stopped' WHERE status = 'streaming'`).run()
}

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : undefined
}

export function kvSet(key: string, value: unknown): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  )
}

export function kvDelete(key: string): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key)
}

export function listConversations(): ConversationRow[] {
  return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as ConversationRow[]
}

export function getConversation(id: string): ConversationRow {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined
  if (!row) throw new Error(`Conversation ${id} not found`)
  return row
}

export function createConversation(settings: ChatSettings, folderId: string | null = null): ConversationRow {
  const now = Date.now()
  const id = randomUUID()
  const rootId = randomUUID()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at, root_id, settings, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, 'New chat', now, now, rootId, JSON.stringify(settings), folderId)
    db.prepare(
      `INSERT INTO nodes (id, conversation_id, parent_id, role, status, created_at) VALUES (?, ?, NULL, 'root', 'done', ?)`
    ).run(rootId, id, now)
  })()
  return getConversation(id)
}

export function updateConversation(
  id: string,
  fields: Partial<Pick<ConversationRow, 'title' | 'settings' | 'started' | 'split'>>
): void {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`)
  db.prepare(`UPDATE conversations SET ${[...sets, 'updated_at = @now'].join(', ')} WHERE id = @id`).run({
    ...fields,
    now: Date.now(),
    id
  })
}

export function deleteConversation(id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function loadNodes(conversationId: string): Map<string, NodeRow> {
  const rows = db.prepare('SELECT * FROM nodes WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as NodeRow[]
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * Adds a node. By default it becomes its parent's active child (pane A's thread follows it);
 * pane B passes activate: false so its new branches never redirect pane A.
 */
export function insertNode(
  node: Omit<NodeRow, 'active_child_id' | 'created_at'> & { created_at?: number },
  { activate = true }: { activate?: boolean } = {}
): NodeRow {
  const row: NodeRow = { active_child_id: null, created_at: Date.now(), ...node }
  db.transaction(() => {
    db.prepare(
      `INSERT INTO nodes (id, conversation_id, parent_id, role, text, content, thinking, model, provider_id, usage, status, error, active_child_id, created_at)
       VALUES (@id, @conversation_id, @parent_id, @role, @text, @content, @thinking, @model, @provider_id, @usage, @status, @error, @active_child_id, @created_at)`
    ).run(row)
    if (row.parent_id && activate) setActiveChild(row.parent_id, row.id)
  })()
  return row
}

export function updateNode(id: string, fields: Partial<Omit<NodeRow, 'id' | 'conversation_id'>>): void {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`)
  if (sets.length) db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = @id`).run({ ...fields, id })
}

export function setActiveChild(parentId: string, childId: string): void {
  db.prepare('UPDATE nodes SET active_child_id = ? WHERE id = ?').run(childId, parentId)
}

export function touchConversation(id: string): void {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

/** The visible thread: root, then each active child in turn. */
export function activePath(conversation: ConversationRow, nodes: Map<string, NodeRow>): NodeRow[] {
  const path: NodeRow[] = []
  let current = nodes.get(conversation.root_id)
  while (current) {
    path.push(current)
    current = current.active_child_id ? nodes.get(current.active_child_id) : undefined
  }
  return path
}

/** Root to `leafId`, inclusive. */
export function ancestors(nodes: Map<string, NodeRow>, leafId: string): NodeRow[] {
  const path: NodeRow[] = []
  for (let n = nodes.get(leafId); n; n = n.parent_id ? nodes.get(n.parent_id) : undefined) path.unshift(n)
  return path
}

/** Follows active children down from `nodeId` to the most recently used leaf. */
export function descend(nodes: Map<string, NodeRow>, nodeId: string): string {
  let current = nodes.get(nodeId)
  while (current?.active_child_id && nodes.has(current.active_child_id)) current = nodes.get(current.active_child_id)
  return current?.id ?? nodeId
}

export function childrenOf(nodes: Map<string, NodeRow>, parentId: string): NodeRow[] {
  const out: NodeRow[] = []
  for (const n of nodes.values()) if (n.parent_id === parentId) out.push(n)
  return out.sort((a, b) => a.created_at - b.created_at)
}

export function toView(node: NodeRow, nodes: Map<string, NodeRow>): NodeView {
  const siblings = node.parent_id ? childrenOf(nodes, node.parent_id) : [node]
  return {
    id: node.id,
    parentId: node.parent_id,
    role: node.role as 'user' | 'assistant',
    text: node.text,
    thinking: node.thinking ?? undefined,
    modelId: node.model ?? undefined,
    providerId: node.provider_id ?? undefined,
    usage: node.usage ? (JSON.parse(node.usage) as Usage) : undefined,
    status: node.status,
    error: node.error ?? undefined,
    createdAt: node.created_at,
    siblingIndex: siblings.findIndex((s) => s.id === node.id),
    siblingCount: siblings.length
  }
}
