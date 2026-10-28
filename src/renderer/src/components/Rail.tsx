import type { ReactNode } from 'react'
import { keysFor, openMode, useBindings } from '../commands'
import { useStore, type Mode } from '../store'
import { FeatherIcon, ScaleIcon, SearchIcon, SettingsIcon, SparkIcon, SpeechIcon } from './Icons'

const SECTIONS: { mode: Mode; label: string; icon: ReactNode; command: string }[] = [
  { mode: 'chat', label: 'Chats', icon: <SpeechIcon size={19} />, command: 'go-chat' },
  { mode: 'write', label: 'Writing', icon: <FeatherIcon size={19} />, command: 'go-write' },
  { mode: 'judge', label: 'Judge', icon: <ScaleIcon size={19} />, command: 'go-judge' },
  { mode: 'insights', label: 'Insights', icon: <SparkIcon size={19} />, command: 'go-insights' }
]

/** Twilight's mark: a sun on the horizon under two bands of sky. */
function Mark() {
  return (
    <svg className="rail-mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="rail-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--iris)" />
          <stop offset="1" stopColor="var(--dusk)" />
        </linearGradient>
      </defs>
      <rect x="3" y="5" width="26" height="6" rx="3" fill="url(#rail-sky)" opacity=".55" />
      <path d="M7 24a9 9 0 0 1 18 0z" fill="var(--horizon)" />
      <rect x="3" y="24" width="26" height="3" rx="1.5" fill="var(--horizon)" opacity=".7" />
    </svg>
  )
}

/**
 * The column of sections down the left edge, each an icon with its name under it. It stays when
 * the sidebar is hidden; clicking the section you're in shows or hides the sidebar.
 */
export function Rail() {
  useBindings()
  const mode = useStore((s) => s.mode)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const latestUpdate = useStore((s) => s.updates?.latest)
  const tip = (label: string, command: string): string => (keysFor(command) ? `${label} (${keysFor(command)})` : label)
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-head drag">
        <Mark />
      </div>
      <div className="rail-items" role="tablist" aria-orientation="vertical">
        {SECTIONS.map((s) => {
          const current = mode === s.mode && !settingsOpen
          return (
            <button
              key={s.mode}
              role="tab"
              data-mode={s.mode}
              className="rail-item"
              aria-selected={current}
              title={tip(s.label, s.command)}
              onClick={() => (current ? useStore.getState().toggleSidebar() : openMode(s.mode))}
            >
              <span className="rail-icon">{s.icon}</span>
              <span className="rail-label">{s.label}</span>
            </button>
          )
        })}
      </div>
      <span className="tw-spacer" />
      <div className="rail-items rail-foot">
        <button className="rail-item" data-rail="search" title={tip('Search everything', 'search')} onClick={() => useStore.getState().setOverlay('search')}>
          <span className="rail-icon">
            <SearchIcon size={19} />
          </span>
          <span className="rail-label">Search</span>
        </button>
        <button
          className="rail-item"
          data-rail="settings"
          aria-selected={settingsOpen}
          title={latestUpdate ? `Settings · Twilight ${latestUpdate} is available` : tip('Settings', 'settings')}
          onClick={() => useStore.getState().setSettingsOpen(!settingsOpen)}
        >
          <span className="rail-icon">
            <SettingsIcon size={19} />
            {latestUpdate && <span className="rail-badge" aria-label="Update available" />}
          </span>
          <span className="rail-label">Settings</span>
        </button>
      </div>
    </nav>
  )
}
