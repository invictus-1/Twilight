import { memo, useState } from 'react'
import type { ConversationSummary } from '@shared/types'
import { modelName, useStore } from '../store'
import { useWriting } from '../writingStore'
import { PlusIcon, SettingsIcon, TrashIcon } from './Icons'

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

const Row = memo(function Row({ c, active, model }: { c: ConversationSummary; active: boolean; model: string }) {
  const [editing, setEditing] = useState(false)
  const store = useStore.getState()
  return (
    <div
      className="tw-conv"
      aria-current={active ? 'true' : undefined}
      onClick={() => !editing && void store.open(c.id)}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <input
          className="tw-conv-edit"
          autoFocus
          defaultValue={c.title}
          onBlur={(e) => {
            setEditing(false)
            const title = e.currentTarget.value.trim()
            if (title && title !== c.title) void store.renameChat(c.id, title)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="tw-conv-title">{c.title}</span>
      )}
      <span className="tw-conv-meta">
        {model} · {relativeTime(c.updatedAt)}
      </span>
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon tw-conv-delete"
        aria-label={`Delete ${c.title}`}
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          void store.deleteChat(c.id)
        }}
      >
        <TrashIcon size={14} />
      </button>
    </div>
  )
})

function ChatList() {
  const conversations = useStore((s) => s.conversations)
  const currentId = useStore((s) => s.current?.id)
  const models = useStore((s) => s.models)
  return (
    <div className="sidebar-list">
      {conversations.map((c) => (
        <Row key={c.id} c={c} active={c.id === currentId} model={modelName(models, c.modelId)} />
      ))}
      {conversations.length === 0 && <p className="sidebar-empty">No chats yet.</p>}
    </div>
  )
}

function DocList() {
  const docs = useWriting((s) => s.docs)
  const openPath = useWriting((s) => s.open?.path)
  const folder = useWriting((s) => s.folder)
  const error = useWriting((s) => s.error)
  return (
    <>
      <div className="sidebar-list">
        {docs.map((d) => {
          const dir = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : ''
          return (
            <div
              key={d.path}
              className="tw-conv doc-item"
              data-path={d.path}
              aria-current={d.path === openPath ? 'true' : undefined}
              onClick={() => void useWriting.getState().openDoc(d.path)}
            >
              <span className="tw-conv-title">{d.name}</span>
              <span className="tw-conv-meta">
                {dir ? `${dir} · ` : ''}
                {relativeTime(d.mtime)}
              </span>
            </div>
          )
        })}
        {docs.length === 0 && <p className="sidebar-empty">{error ?? 'No documents yet.'}</p>}
      </div>
      <button className="folder-btn" title={`${folder}\nClick to choose another folder (an Obsidian vault works)`} onClick={() => void useWriting.getState().chooseFolder()}>
        <span className="folder-label">Folder</span>
        <span className="folder-path">{folder}</span>
      </button>
    </>
  )
}

export function Sidebar() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const newChat = useStore((s) => s.newChat)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  return (
    <nav className="sidebar" aria-label={mode === 'chat' ? 'Conversations' : 'Documents'}>
      <div className="sidebar-head drag">
        <span className="brand">Twilight</span>
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon no-drag"
          aria-label={mode === 'chat' ? 'New chat (Ctrl+N)' : 'New document (Ctrl+Shift+N)'}
          title={mode === 'chat' ? 'New chat (Ctrl+N)' : 'New document (Ctrl+Shift+N)'}
          onClick={() => void (mode === 'chat' ? newChat() : useWriting.getState().newDoc())}
        >
          <PlusIcon />
        </button>
      </div>
      <div className="mode-tabs" role="tablist">
        <button role="tab" data-mode="chat" aria-selected={mode === 'chat'} onClick={() => setMode('chat')}>
          Chats
        </button>
        <button
          role="tab"
          data-mode="write"
          aria-selected={mode === 'write'}
          onClick={() => {
            setMode('write')
            void useWriting.getState().refresh()
          }}
        >
          Writing
        </button>
      </div>
      {mode === 'chat' ? <ChatList /> : <DocList />}
      <div className="sidebar-foot">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
          Settings
        </button>
      </div>
    </nav>
  )
}
