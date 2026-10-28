import type { ChatFolder, WorkspacePatch } from '@shared/types'
import * as db from './db'

type Config = Omit<ChatFolder, 'id' | 'name' | 'collapsed'>

const EMPTY: Config = { description: '', color: '', systemPrompt: '', providerId: null, modelId: null, includeContext: false, choiceCards: false }

export function toWorkspace(row: db.FolderRow): ChatFolder {
  return { id: row.id, name: row.name, collapsed: !!row.collapsed, ...EMPTY, ...(row.config ? (JSON.parse(row.config) as Partial<Config>) : {}) }
}

export function listWorkspaces(): ChatFolder[] {
  return db.listFolders().map(toWorkspace)
}

export function updateWorkspace(id: string, patch: WorkspacePatch): void {
  const row = db.getFolder(id)
  if (!row) return
  const { name, collapsed, ...config } = patch
  const current = toWorkspace(row)
  const { id: _id, name: _n, collapsed: _c, ...currentConfig } = current
  db.updateFolder(id, {
    ...(name !== undefined && name.trim() ? { name: name.trim() } : {}),
    ...(collapsed !== undefined ? { collapsed: collapsed ? 1 : 0 } : {}),
    config: JSON.stringify({ ...currentConfig, ...config })
  })
}

/** The system prompt a new chat in this workspace starts with. */
export function workspaceSystemPrompt(ws: ChatFolder): string {
  const head = ws.includeContext ? `Workspace: ${ws.name}${ws.description.trim() ? `\n${ws.description.trim()}` : ''}` : ''
  return [head, ws.systemPrompt.trim()].filter(Boolean).join('\n\n')
}
