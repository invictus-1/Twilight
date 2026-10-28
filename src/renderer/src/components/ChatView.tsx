import { useState } from 'react'
import { useStore } from '../store'
import { ChatSettingsPanel } from './ChatSettingsPanel'
import { Composer } from './Composer'
import { SidebarIcon, SlidersIcon } from './Icons'
import { Thread } from './Thread'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function ChatView() {
  const current = useStore((s) => s.current)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const [panelOpen, setPanelOpen] = useState(false)
  const empty = !current || current.path.length === 0

  return (
    <main className="chat">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{current?.title ?? 'New chat'}</h1>
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
          disabled={!current}
        >
          <SlidersIcon />
          Chat settings
        </button>
      </header>
      {panelOpen && current && <ChatSettingsPanel key={current.id} onClose={() => setPanelOpen(false)} />}
      {empty ? (
        <div className="empty">
          <h2 className="t-display">{greeting()}</h2>
          <p className="empty-sub">Pick a model below and start typing.</p>
        </div>
      ) : (
        <Thread key={current.id} />
      )}
      <Composer />
    </main>
  )
}
