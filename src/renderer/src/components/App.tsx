import { lazy, Suspense, useEffect, useState } from 'react'
import { useStore } from '../store'
import { useJudge } from '../judgeStore'
import { clearStream, handleStreamEvent } from '../stream'
import { useWriting } from '../writingStore'
import { useInsights } from '../insightsStore'
import { InsightsView } from './InsightsView'
import { Welcome } from './Welcome'
import { JudgeView } from './JudgeView'

// The editor (CodeMirror) loads the first time Writing opens, so startup only parses the chat.
const WritingView = lazy(() => import('./WritingView').then((m) => ({ default: m.WritingView })))
import { ChatView } from './ChatView'
import { CloseIcon, TrophyIcon } from './Icons'
import { SettingsView } from './SettingsView'
import { useDragResize, usePersistentNumber } from '../resize'
import { Sidebar } from './Sidebar'
import { Rail } from './Rail'
import { commandFor } from '../commands'
import { recordingKeys } from './ShortcutsSection'
import { CommandMenu, ShortcutSheet } from './CommandMenu'
import { SearchPanel } from './SearchPanel'
import { PersonaChooser } from './PersonaChooser'

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const settingsSection = useStore((s) => s.settingsSection)
  const welcomeOpen = useStore((s) => s.welcomeOpen)
  const overlay = useStore((s) => s.overlay)
  const mode = useStore((s) => s.mode)
  const error = useStore((s) => s.error)
  const undo = useStore((s) => s.undo)
  const latestUpdate = useStore((s) => s.updates?.latest ?? null)
  const unlocked = useInsights((s) => s.unlocked)
  useEffect(() => void useInsights.getState().init(), [])
  const [noticed, setNoticed] = useState(() => {
    try {
      return localStorage.getItem('twilight.updateNoticed')
    } catch {
      return null
    }
  })
  const dismissUpdate = (): void => {
    try {
      localStorage.setItem('twilight.updateNoticed', latestUpdate ?? '')
    } catch {
      // Private storage unavailable: the notice just comes back next launch.
    }
    setNoticed(latestUpdate)
  }
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => useStore.getState().dismissUndo(), 8000)
    return () => clearTimeout(t)
  }, [undo])
  const [savedSidebarWidth, setSidebarWidth] = usePersistentNumber('twilight.sidebarWidth', 264)
  // The rail holds the sections now, so the sidebar can go narrower than the old tabs allowed.
  const SIDEBAR_MIN = 200
  const RAIL = 68
  const sidebarWidth = Math.max(SIDEBAR_MIN, savedSidebarWidth)
  const sidebarDrag = useDragResize({
    onMove: (x) => setSidebarWidth(Math.round(Math.min(560, Math.max(SIDEBAR_MIN, x - RAIL)))),
    onReset: () => setSidebarWidth(264)
  })

  useEffect(() => {
    const store = useStore.getState()
    // Marks the page once the first load is done; the end-to-end tests wait for it.
    void store.init().finally(() => (document.body.dataset.ready = '1'))
    void useWriting.getState().init()
    void useJudge.getState().init()
    return window.twilight.onStream((event) => {
      handleStreamEvent(event)
      if (event.kind !== 'done') return
      // Writing-tool runs finish inside the editor (Editor.tsx); judge runs in the judgment.
      if (event.conversationId === 'judge') {
        void useJudge.getState().reload(event.node.parentId ?? '').then(() => clearStream(event.nodeId))
      } else if (event.conversationId !== 'writing') useStore.getState().applyDone(event.conversationId, event.node)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      // Keys an editor already used (Ctrl+B for bold, say) stay with it; the welcome and a
      // shortcut being recorded take every key.
      if (e.defaultPrevented || s.welcomeOpen || recordingKeys()) return
      const command = commandFor(e)
      if (command) {
        e.preventDefault()
        if (s.overlay && command.id !== s.overlay) s.setOverlay(null)
        command.run()
      } else if (e.key === 'Escape') {
        if (s.overlay) s.setOverlay(null)
        else if (s.settingsOpen) s.setSettingsOpen(false)
        else if (s.mode === 'chat') void s.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`} style={{ gridTemplateColumns: `${RAIL}px ${sidebarOpen ? sidebarWidth : 0}px minmax(0, 1fr)` }}>
      <Rail />
      <Sidebar />
      {sidebarOpen && (
        <div
          className="resize-handle sidebar-handle"
          style={{ left: RAIL + sidebarWidth - 3 }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar (double-click to reset)"
          title="Drag to resize · double-click to reset"
          {...sidebarDrag}
        />
      )}
      {settingsOpen ? (
        <SettingsView key={settingsSection ?? ''} />
      ) : mode === 'chat' ? (
        <ChatView />
      ) : mode === 'judge' ? (
        <JudgeView />
      ) : mode === 'insights' ? (
        <InsightsView />
      ) : (
        <Suspense fallback={<main className="chat" />}>
          <WritingView />
        </Suspense>
      )}
      {welcomeOpen && <Welcome />}
      {overlay === 'commands' && <CommandMenu />}
      {overlay === 'shortcuts' && <ShortcutSheet />}
      {overlay === 'search' && <SearchPanel />}
      {overlay === 'personas' && <PersonaChooser />}
      {unlocked.length > 0 && !undo && !error && (
        <div className="toast toast-info ach-toast" role="status">
          <TrophyIcon size={16} />
          <span>
            {unlocked.length === 1 ? `Achievement unlocked: ${unlocked[0]}` : `${unlocked.length} achievements unlocked: ${unlocked.slice(0, 3).join(', ')}${unlocked.length > 3 ? '…' : ''}`}
          </span>
          <button
            className="tw-btn tw-btn-ghost tw-btn-sm"
            onClick={() => {
              useInsights.getState().dismissUnlocked()
              useInsights.getState().setPage('achievements')
              useStore.getState().setSettingsOpen(false)
              useStore.getState().setMode('insights')
            }}
          >
            View
          </button>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Dismiss" onClick={() => useInsights.getState().dismissUnlocked()}>
            <CloseIcon />
          </button>
        </div>
      )}
      {latestUpdate && latestUpdate !== noticed && !settingsOpen && !undo && !error && !unlocked.length && (
        <div className="toast toast-info update-toast" role="status">
          <span className="update-dot" />
          <span>Twilight {latestUpdate} is available</span>
          <button
            className="tw-btn tw-btn-ghost tw-btn-sm"
            onClick={() => {
              dismissUpdate()
              useStore.getState().setSettingsOpen(true, 'updates')
            }}
          >
            View
          </button>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Dismiss" onClick={dismissUpdate}>
            <CloseIcon />
          </button>
        </div>
      )}
      {undo && !error && (
        <div className="toast toast-info" role="status">
          <span>{undo.label}</span>
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void useStore.getState().runUndo()}>
            Undo
          </button>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Dismiss" onClick={() => useStore.getState().dismissUndo()}>
            <CloseIcon />
          </button>
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Dismiss" onClick={() => useStore.getState().setError(null)}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
}
