import { memo, useState } from 'react'
import type { ConversationSummary } from '@shared/types'
import { modelName, useStore } from '../store'
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

export function Sidebar() {
  const conversations = useStore((s) => s.conversations)
  const currentId = useStore((s) => s.current?.id)
  const models = useStore((s) => s.models)
  const newChat = useStore((s) => s.newChat)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  return (
    <nav className="sidebar" aria-label="Conversations">
      <div className="sidebar-head drag">
        <span className="brand">Twilight</span>
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="New chat (Ctrl+N)" title="New chat (Ctrl+N)" onClick={() => void newChat()}>
          <PlusIcon />
        </button>
      </div>
      <div className="sidebar-list">
        {conversations.map((c) => (
          <Row key={c.id} c={c} active={c.id === currentId} model={modelName(models, c.modelId)} />
        ))}
        {conversations.length === 0 && <p className="sidebar-empty">No chats yet.</p>}
      </div>
      <div className="sidebar-foot">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
          Settings
        </button>
      </div>
    </nav>
  )
}
