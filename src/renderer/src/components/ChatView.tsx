import { useState } from 'react'
import { useStore } from '../store'
import { CacheBar } from './CacheBar'
import { ChatSettingsPanel } from './ChatSettingsPanel'
import { Composer } from './Composer'
import { SidebarIcon, SlidersIcon, SplitIcon } from './Icons'
import { SplitView } from './SplitView'
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
  const split = !!current?.split
  const empty = !current || (current.path.length === 0 && !split)

  return (
    <main className="chat">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{current?.title ?? 'New chat'}</h1>
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          aria-pressed={split}
          disabled={!current || current.path.length === 0}
          title={split ? 'Close split (keeps A)' : 'Clone into split (Ctrl+Shift+S)'}
          onClick={() => void (split ? useStore.getState().closeSplit('a') : useStore.getState().cloneIntoSplit())}
        >
          <SplitIcon />
          {split ? 'Close split' : 'Split'}
        </button>
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
          disabled={!current}
        >
          <SlidersIcon />
          Model settings
        </button>
      </header>
      {panelOpen && current && <ChatSettingsPanel key={current.id} onClose={() => setPanelOpen(false)} />}
      {split ? (
        <SplitView key={current.id} />
      ) : empty ? (
        <div className="empty">
          <h2 className="t-display">{greeting()}</h2>
          <p className="empty-sub">Pick a model below and start typing.</p>
        </div>
      ) : (
        <Thread key={current.id} />
      )}
      {!split && current && <CacheBar />}
      <Composer />
    </main>
  )
}
