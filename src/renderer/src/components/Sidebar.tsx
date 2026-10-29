import { memo, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { ChatFolder, ConversationSummary, DocEntry } from '@shared/types'
import { modelName, useStore } from '../store'
import { useInsights, type InsightsPage } from '../insightsStore'
import { useJudge } from '../judgeStore'
import { useWriting } from '../writingStore'
import { useCode } from '../codeStore'
import {
  BookIcon,
  BulbIcon,
  CalendarIcon,
  ChevronDown,
  ChevronRight,
  ExportIcon,
  FolderIcon,
  FolderPlusIcon,
  GridIcon,
  PenIcon,
  PeopleIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  SlidersIcon,
  SparkIcon,
  TargetIcon,
  TrashIcon,
  TrophyIcon
} from './Icons'
import { WorkspaceDialog } from './WorkspaceDialog'

const CHAT_MIME = 'application/x-twilight-chat'
const DOC_MIME = 'application/x-twilight-doc'

const INSIGHT_PAGES: { id: InsightsPage; label: string; icon: React.ReactElement; ai?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <GridIcon /> },
  { id: 'heatmap', label: 'Heatmap', icon: <CalendarIcon /> },
  { id: 'words', label: 'Word analysis', icon: <BookIcon /> },
  { id: 'characters', label: 'Characters', icon: <PeopleIcon /> },
  { id: 'story', label: 'Story analysis', icon: <SparkIcon />, ai: true },
  { id: 'focus', label: 'Focus', icon: <TargetIcon />, ai: true },
  { id: 'insights', label: 'Insights', icon: <BulbIcon />, ai: true },
  { id: 'achievements', label: 'Achievements', icon: <TrophyIcon /> },
  { id: 'reports', label: 'Reports', icon: <ExportIcon /> }
]

/** The Insights pages, and the rescan button with its progress. */
function InsightsNav() {
  const page = useInsights((s) => s.page)
  const setPage = useInsights((s) => s.setPage)
  const scanning = useInsights((s) => s.summary?.scanning ?? false)
  const progress = useInsights((s) => s.progress)
  const scannedAt = useInsights((s) => s.summary?.scannedAt ?? null)
  return (
    <>
      <div className="sidebar-list insights-nav" role="tablist" aria-label="Insights pages">
        {INSIGHT_PAGES.map((p) => (
          <button key={p.id} role="tab" aria-selected={page === p.id} className="insights-nav-item" onClick={() => setPage(p.id)}>
            {p.icon}
            <span>{p.label}</span>
            {p.ai && (
              <span className="ai-badge" title="Uses a model you choose; runs only when you ask">
                AI
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="insights-rescan">
        <button className="tw-btn tw-btn-primary rescan-btn" disabled={scanning} onClick={() => void useInsights.getState().rescan()}>
          <RefreshIcon className={scanning ? 'spinning' : ''} />
          {scanning ? (progress ? `Reading ${progress.done} of ${progress.total}` : 'Reading…') : 'Rescan now'}
        </button>
        {scannedAt && !scanning && <span className="field-note">Last read {relativeTime(scannedAt)}</span>}
      </div>
    </>
  )
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

/** Makes an element accept one kind of dragged item, highlighting while something hovers over it. */
function useDrop(mime: string, onDrop: (value: string) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(mime)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      },
      onDrop: (e: DragEvent) => {
        setOver(false)
        const value = e.dataTransfer.getData(mime)
        if (value) {
          e.preventDefault()
          onDrop(value)
        }
      }
    }
  }
}

/** Inline name field: Enter or leaving it commits, Esc cancels. */
function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (name: string | null) => void }) {
  return (
    <input
      className="tw-conv-edit name-input"
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.currentTarget.value = ''
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function SectionHeader({ title, children, drop }: { title: string; children?: ReactNode; drop?: ReturnType<typeof useDrop> }) {
  return (
    <div className={`side-section ${drop?.over ? 'drop-over' : ''}`} {...drop?.props}>
      <span>{title}</span>
      {children}
    </div>
  )
}

// ——— Chats ———

const ChatRow = memo(function ChatRow({ c, active, model, depth }: { c: ConversationSummary; active: boolean; model: string; depth: number }) {
  const [editing, setEditing] = useState(false)
  const store = useStore.getState()
  return (
    <div
      className="tw-conv"
      style={{ paddingLeft: 12 + depth * 16 }}
      aria-current={active ? 'true' : undefined}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(CHAT_MIME, c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => !editing && void store.open(c.id)}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <NameInput
          initial={c.title}
          placeholder="Chat title"
          onDone={(title) => {
            setEditing(false)
            if (title && title !== c.title) void store.renameChat(c.id, title)
          }}
        />
      ) : (
        <span className="tw-conv-title">
          {c.pinned && <PinIcon size={12} className="pinned-mark" />}
          {c.title}
        </span>
      )}
      <span className="tw-conv-meta">
        {model} · {relativeTime(c.updatedAt)}
      </span>
      <span className="row-actions">
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label={c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`}
          title={c.pinned ? 'Unpin' : 'Pin'}
          aria-pressed={c.pinned}
          onClick={(e) => {
            e.stopPropagation()
            void store.pinChat(c.id, !c.pinned)
          }}
        >
          <PinIcon size={14} />
        </button>
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label={`Move ${c.title} to the trash`}
          title="Move to trash"
          onClick={(e) => {
            e.stopPropagation()
            void store.deleteChat(c.id)
          }}
        >
          <TrashIcon size={14} />
        </button>
      </span>
    </div>
  )
})

function ChatFolderGroup({ folder, chats }: { folder: ChatFolder; chats: ConversationSummary[] }) {
  const [renaming, setRenaming] = useState(false)
  const [editing, setEditing] = useState(false)
  const currentId = useStore((s) => s.current?.id)
  const models = useStore((s) => s.models)
  const store = useStore.getState()
  const drop = useDrop(CHAT_MIME, (id) => void store.moveChat(id, folder.id))
  return (
    <div className={`folder ${drop.over ? 'drop-over' : ''}`} {...drop.props}>
      <div className="folder-head" onClick={() => !renaming && void store.toggleFolder(folder.id)} onDoubleClick={() => setRenaming(true)}>
        {folder.collapsed ? <ChevronRight size={14} className="folder-chevron" /> : <ChevronDown size={14} className="folder-chevron" />}
        <FolderIcon size={15} className="folder-icon" style={folder.color ? { color: `var(--${folder.color})` } : undefined} />
        {renaming ? (
          <NameInput
            initial={folder.name}
            placeholder="Workspace name"
            onDone={(name) => {
              setRenaming(false)
              if (name && name !== folder.name) void store.renameFolder(folder.id, name)
            }}
          />
        ) : (
          <span className="folder-name">{folder.name}</span>
        )}
        <span className="folder-count">{chats.length || ''}</span>
        <span className="row-actions">
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label={`New chat in ${folder.name}`}
            title="New chat in this workspace"
            onClick={(e) => {
              e.stopPropagation()
              store.setMode('chat')
              void store.newChat(folder.id)
            }}
          >
            <PlusIcon size={14} />
          </button>
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label={`Edit workspace ${folder.name}`}
            title="Workspace settings: default system prompt and model"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            <SlidersIcon size={14} />
          </button>
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label={`Delete workspace ${folder.name}`}
            title="Delete workspace (its chats move to Recent)"
            onClick={(e) => {
              e.stopPropagation()
              void store.deleteFolder(folder.id)
            }}
          >
            <TrashIcon size={14} />
          </button>
        </span>
      </div>
      {!folder.collapsed &&
        chats.map((c) => <ChatRow key={c.id} c={c} active={c.id === currentId} model={modelName(models, c.modelId)} depth={1} />)}
      {!folder.collapsed && chats.length === 0 && <p className="folder-empty">Drag chats here</p>}
      {editing && <WorkspaceDialog workspace={folder} onClose={() => setEditing(false)} />}
    </div>
  )
}

function ChatList({ creating, onCreated }: { creating: boolean; onCreated: () => void }) {
  const conversations = useStore((s) => s.conversations)
  const folders = useStore((s) => s.folders)
  const currentId = useStore((s) => s.current?.id)
  const models = useStore((s) => s.models)
  const store = useStore.getState()
  const recentDrop = useDrop(CHAT_MIME, (id) => void store.moveChat(id, null))
  const pinned = conversations.filter((c) => c.pinned)
  const recent = conversations.filter((c) => !c.pinned && !c.folderId)
  const row = (c: ConversationSummary): ReactNode => (
    <ChatRow key={c.id} c={c} active={c.id === currentId} model={modelName(models, c.modelId)} depth={0} />
  )

  return (
    <div className="sidebar-list">
      {pinned.length > 0 && (
        <>
          <SectionHeader title="Pinned" />
          {pinned.map(row)}
        </>
      )}
      {(folders.length > 0 || creating) && <SectionHeader title="Workspaces" />}
      {creating && (
        <div className="folder-head">
          <FolderIcon size={15} className="folder-icon" />
          <NameInput
            initial=""
            placeholder="Workspace name"
            onDone={(name) => {
              onCreated()
              if (name) void store.createFolder(name)
            }}
          />
        </div>
      )}
      {folders.map((f) => (
        <ChatFolderGroup key={f.id} folder={f} chats={conversations.filter((c) => c.folderId === f.id)} />
      ))}
      <SectionHeader title="Recent" drop={recentDrop} />
      <div className={`recent ${recentDrop.over ? 'drop-over' : ''}`} {...recentDrop.props}>
        {recent.map(row)}
        {recent.length === 0 && <p className="sidebar-empty">{conversations.length ? 'Everything is filed.' : 'No chats yet.'}</p>}
      </div>
      <Trash />
    </div>
  )
}

/** Deleted chats wait here until restored or deleted for good. */
function Trash() {
  const trash = useStore((s) => s.trash)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const store = useStore.getState()
  if (trash.length === 0) return null
  return (
    <div className="trash">
      <div className="folder-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} className="folder-chevron" /> : <ChevronRight size={14} className="folder-chevron" />}
        <TrashIcon size={15} className="folder-icon" />
        <span className="folder-name">Trash</span>
        <span className="folder-count">{trash.length}</span>
      </div>
      {open && (
        <>
          {trash.map((c) => (
            <div key={c.id} className="tw-conv trash-row" style={{ paddingLeft: 28 }}>
              <span className="tw-conv-title">{c.title}</span>
              <span className="tw-conv-meta">Deleted {relativeTime(c.deletedAt ?? 0)}</span>
              <span className="trash-actions">
                <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void store.restoreChat(c.id)}>
                  Restore
                </button>
                <button className="tw-btn tw-btn-ghost tw-btn-sm danger-text" onClick={() => void store.deleteForever(c.id)}>
                  Delete forever
                </button>
              </span>
            </div>
          ))}
          <button
            className={`tw-btn tw-btn-sm empty-trash ${confirming ? 'tw-btn-danger' : 'tw-btn-ghost'}`}
            onBlur={() => setConfirming(false)}
            onClick={() => {
              if (!confirming) return setConfirming(true)
              setConfirming(false)
              void store.emptyTrash()
            }}
          >
            {confirming ? `Delete ${trash.length} chat${trash.length === 1 ? '' : 's'} forever` : 'Empty trash'}
          </button>
        </>
      )}
    </div>
  )
}

// ——— Documents (real folders on disk) ———

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Rename and remove for a document or folder row. Removing asks once more, then goes to the Recycle Bin. */
function DocActions({ path, kind, onRename, children }: { path: string; kind: 'doc' | 'folder'; onRename: () => void; children?: ReactNode }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <span className="row-actions" onClick={(e) => e.stopPropagation()}>
      {children}
      <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Rename ${path}`} title="Rename" onClick={onRename}>
        <PenIcon size={13} />
      </button>
      {confirming ? (
        <button
          className="tw-btn tw-btn-sm tw-btn-danger remove-confirm"
          autoFocus
          onBlur={() => setConfirming(false)}
          onClick={() => {
            setConfirming(false)
            void useWriting.getState().remove(path, kind)
          }}
        >
          Move to Recycle Bin
        </button>
      ) : (
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label={`Remove ${path}`}
          title={kind === 'folder' ? 'Move this folder and everything in it to the Recycle Bin' : 'Move to the Recycle Bin'}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon size={13} />
        </button>
      )}
    </span>
  )
}

function DocRow({ d, depth }: { d: DocEntry; depth: number }) {
  const active = useWriting((s) => s.open?.path === d.path)
  const [renaming, setRenaming] = useState(false)
  return (
    <div
      className="tw-conv doc-item"
      style={{ paddingLeft: 12 + depth * 16 }}
      data-path={d.path}
      aria-current={active ? 'true' : undefined}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(DOC_MIME, d.path)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => !renaming && void useWriting.getState().openDoc(d.path)}
    >
      {renaming ? (
        <NameInput
          initial={d.name}
          placeholder="Document name"
          onDone={(name) => {
            setRenaming(false)
            if (name && name !== d.name) void useWriting.getState().rename(d.path, name, 'doc')
          }}
        />
      ) : (
        <>
          <span className="tw-conv-title">{d.name}</span>
          <span className="tw-conv-meta">{relativeTime(d.mtime)}</span>
          <DocActions path={d.path} kind="doc" onRename={() => setRenaming(true)} />
        </>
      )}
    </div>
  )
}

function DocFolder({ path, depth }: { path: string; depth: number }) {
  const folders = useWriting((s) => s.folders)
  const docs = useWriting((s) => s.docs)
  const collapsed = useWriting((s) => s.collapsed.has(path))
  const w = useWriting.getState()
  const drop = useDrop(DOC_MIME, (doc) => void w.moveDoc(doc, path))
  const subfolders = folders.filter((f) => parentOf(f) === path)
  const inHere = docs.filter((d) => parentOf(d.path) === path).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const count = docs.filter((d) => d.path.startsWith(`${path}/`)).length
  const [renaming, setRenaming] = useState(false)
  const name = path.split('/').pop() ?? path
  return (
    <div className={`folder ${drop.over ? 'drop-over' : ''}`} {...drop.props}>
      <div className="folder-head" style={{ paddingLeft: 8 + depth * 16 }} data-folder={path} onClick={() => w.toggleFolder(path)}>
        {collapsed ? <ChevronRight size={14} className="folder-chevron" /> : <ChevronDown size={14} className="folder-chevron" />}
        <FolderIcon size={15} className="folder-icon" />
        {renaming ? (
          <NameInput
            initial={name}
            placeholder="Folder name"
            onDone={(next) => {
              setRenaming(false)
              if (next && next !== name) void w.rename(path, next, 'folder')
            }}
          />
        ) : (
          <>
            <span className="folder-name">{name}</span>
            <span className="folder-count">{count || ''}</span>
            <DocActions path={path} kind="folder" onRename={() => setRenaming(true)}>
              <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`New document in ${path}`} title="New document in this folder" onClick={() => void w.newDoc(path)}>
                <PlusIcon size={14} />
              </button>
            </DocActions>
          </>
        )}
      </div>
      {!collapsed && (
        <>
          {subfolders.map((f) => (
            <DocFolder key={f} path={f} depth={depth + 1} />
          ))}
          {inHere.map((d) => (
            <DocRow key={d.path} d={d} depth={depth + 1} />
          ))}
          {subfolders.length === 0 && inHere.length === 0 && (
            <p className="folder-empty" style={{ paddingLeft: 28 + depth * 16 }}>
              Drag documents here
            </p>
          )}
        </>
      )}
    </div>
  )
}

function DocList({ creating, onCreated }: { creating: boolean; onCreated: () => void }) {
  const docs = useWriting((s) => s.docs)
  const folders = useWriting((s) => s.folders)
  const folder = useWriting((s) => s.folder)
  const error = useWriting((s) => s.error)
  const w = useWriting.getState()
  const rootDrop = useDrop(DOC_MIME, (doc) => void w.moveDoc(doc, ''))
  const topFolders = folders.filter((f) => !f.includes('/'))
  const rootDocs = docs.filter((d) => !d.path.includes('/'))
  return (
    <>
      <div className="sidebar-list">
        {creating && (
          <div className="folder-head">
            <FolderIcon size={15} className="folder-icon" />
            <NameInput
              initial=""
              placeholder="Folder name (a/b for a subfolder)"
              onDone={(name) => {
                onCreated()
                if (name) void w.newFolder(name)
              }}
            />
          </div>
        )}
        {topFolders.map((f) => (
          <DocFolder key={f} path={f} depth={0} />
        ))}
        <SectionHeader title="Documents" drop={rootDrop} />
        <div className={`recent ${rootDrop.over ? 'drop-over' : ''}`} {...rootDrop.props}>
          {rootDocs.map((d) => (
            <DocRow key={d.path} d={d} depth={0} />
          ))}
          {docs.length === 0 && <p className="sidebar-empty">No documents yet.</p>}
        </div>
      </div>
      {error && (
        <p className="side-error" role="alert" onClick={() => useWriting.setState({ error: null })}>
          {error}
        </p>
      )}
      <button className="folder-btn" title={`${folder}\nClick to choose another folder (an Obsidian vault works)`} onClick={() => void w.chooseFolder()}>
        <span className="folder-label">Writing folder</span>
        <span className="folder-path">{folder}</span>
      </button>
    </>
  )
}

// ——— Judge ———

const WINNER_TEXT = { A: 'A won', B: 'B won', tie: 'Tie', close: 'Too close to call' } as const

function JudgeList() {
  const list = useJudge((s) => s.list)
  const currentId = useJudge((s) => s.current?.id)
  const boardOpen = useJudge((s) => s.board !== null)
  return (
    <div className="sidebar-list">
      <button className="judge-board-item" aria-current={boardOpen ? 'true' : undefined} onClick={() => void useJudge.getState().openBoard(null)}>
        <TrophyIcon />
        <span>Leaderboard</span>
      </button>
      {list.map((j) => (
        <div
          key={j.id}
          className="tw-conv judgment-item"
          aria-current={j.id === currentId ? 'true' : undefined}
          onClick={() => void useJudge.getState().open(j.id)}
        >
          <span className="tw-conv-title">{j.title}</span>
          <span className="tw-conv-meta">
            {j.status === 'running' ? 'Judging…' : j.status === 'error' ? 'Failed' : j.winner ? WINNER_TEXT[j.winner] : 'No verdict'} ·{' '}
            {relativeTime(j.createdAt)}
          </span>
        </div>
      ))}
      {list.length === 0 && <p className="sidebar-empty">No comparisons yet.</p>}
    </div>
  )
}

/** Deleting a session asks once more; it drops the history and snapshots, never the folder's files. */
function CodeSessionActions({ id, title }: { id: string; title: string }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <span className="row-actions" onClick={(e) => e.stopPropagation()}>
      {confirming ? (
        <button
          className="tw-btn tw-btn-sm tw-btn-danger remove-confirm"
          autoFocus
          title="Files in the folder stay as they are; this session's undo history goes"
          onBlur={() => setConfirming(false)}
          onClick={() => {
            setConfirming(false)
            void useCode.getState().remove(id)
          }}
        >
          Delete session
        </button>
      ) : (
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Delete ${title}`} title="Delete this session (files stay as they are)" onClick={() => setConfirming(true)}>
          <TrashIcon size={13} />
        </button>
      )}
    </span>
  )
}

function CodeList() {
  const sessions = useCode((s) => s.sessions)
  const currentId = useCode((s) => s.current?.id)
  useEffect(() => void useCode.getState().init(), [])
  return (
    <div className="sidebar-list">
      {sessions.map((c) => (
        <div
          key={c.id}
          className="tw-conv code-session-item"
          aria-current={c.id === currentId ? 'true' : undefined}
          onClick={() => void useCode.getState().open(c.id)}
        >
          <span className="tw-conv-title">{c.title}</span>
          <span className="tw-conv-meta">
            {c.waiting ? 'Waiting for you' : c.running ? 'Working…' : c.folder.split(/[\/]/).pop()} · {relativeTime(c.updatedAt)}
          </span>
          <CodeSessionActions id={c.id} title={c.title} />
        </div>
      ))}
      {sessions.length === 0 && <p className="sidebar-empty">No sessions yet.</p>}
    </div>
  )
}

const SECTION_NAMES = { chat: 'Chats', write: 'Writing', judge: 'Judge', insights: 'Insights', code: 'Code' } as const

export function Sidebar() {
  const mode = useStore((s) => s.mode)
  const newChat = useStore((s) => s.newChat)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const latestUpdate = useStore((s) => s.updates?.latest)
  const [creating, setCreating] = useState(false)
  // Switching sections drops a half-typed new folder name.
  useEffect(() => setCreating(false), [mode])

  return (
    <nav className="sidebar" aria-label={mode === 'chat' ? 'Conversations' : 'Documents'}>
      <div className="sidebar-head drag">
        <span className="brand">{SECTION_NAMES[mode]}</span>
        <span className="head-actions" hidden={mode === 'insights'}>
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon no-drag"
            hidden={mode === 'code'}
            aria-label={mode === 'chat' ? 'New workspace' : 'New folder'}
            title={mode === 'chat' ? 'New workspace' : 'New folder'}
            onClick={() => setCreating(true)}
          >
            <FolderPlusIcon />
          </button>
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon no-drag"
            aria-label={mode === 'chat' ? 'New chat (Ctrl+N)' : mode === 'code' ? 'New session' : 'New document (Ctrl+Shift+N)'}
            title={mode === 'chat' ? 'New chat (Ctrl+N)' : mode === 'code' ? 'New session in a folder' : 'New document (Ctrl+Shift+N)'}
            onClick={() =>
              void (mode === 'chat'
                ? newChat()
                : mode === 'write'
                  ? useWriting.getState().newDoc()
                  : mode === 'code'
                    ? useCode.getState().create()
                    : useJudge.getState().newDraft())
            }
          >
            <PlusIcon />
          </button>
        </span>
      </div>
      {mode === 'chat' ? (
        <ChatList creating={creating} onCreated={() => setCreating(false)} />
      ) : mode === 'write' ? (
        <DocList creating={creating} onCreated={() => setCreating(false)} />
      ) : mode === 'insights' ? (
        <InsightsNav />
      ) : mode === 'code' ? (
        <CodeList />
      ) : (
        <JudgeList />
      )}
      {latestUpdate && (
        <div className="sidebar-foot">
          <button className="tw-btn tw-btn-ghost tw-btn-sm update-chip" title="Open Settings > Updates" onClick={() => setSettingsOpen(true, 'updates')}>
            <span className="update-dot" />
            Update {latestUpdate}
          </button>
        </div>
      )}
    </nav>
  )
}
