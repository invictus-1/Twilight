import { lazy, Suspense, useEffect, useState } from 'react'
import { useStore } from '../store'
import { useJudge } from '../judgeStore'
import { clearStream, handleStreamEvent } from '../stream'
import { useWriting } from '../writingStore'
import { useInsights } from '../insightsStore'
import { InsightsView } from './InsightsView'
import { JudgeView } from './JudgeView'

// The editor (CodeMirror) loads the first time Writing opens, so startup only parses the chat.
const WritingView = lazy(() => import('./WritingView').then((m) => ({ default: m.WritingView })))
import { ChatView } from './ChatView'
import { CloseIcon, TrophyIcon } from './Icons'
import { SettingsView } from './SettingsView'
import { useDragResize, usePersistentNumber } from '../resize'
import { Sidebar } from './Sidebar'

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const settingsSection = useStore((s) => s.settingsSection)
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
  const [sidebarWidth, setSidebarWidth] = usePersistentNumber('twilight.sidebarWidth', 264)
  const sidebarDrag = useDragResize({
    onMove: (x) => setSidebarWidth(Math.round(Math.min(560, Math.max(200, x)))),
    onReset: () => setSidebarWidth(264)
  })

  useEffect(() => {
    const store = useStore.getState()
    void store.init()
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
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        s.setMode('chat')
        void s.newChat()
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        s.setMode('write')
        void useWriting.getState().newDoc()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        s.toggleSidebar()
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        s.setSettingsOpen(true)
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's' && s.mode === 'chat') {
        e.preventDefault()
        if (s.current?.path.length) void (s.current.split ? s.closeSplit('a') : s.cloneIntoSplit())
      } else if (e.altKey && ['1', '2', '3'].includes(e.key) && s.current?.split) {
        e.preventDefault()
        s.setTarget(e.key === '1' ? 'a' : e.key === '2' ? 'b' : 'both')
      } else if (e.key === 'Escape') {
        if (s.settingsOpen) s.setSettingsOpen(false)
        else if (s.mode === 'chat') void s.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`} style={sidebarOpen ? { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` } : undefined}>
      <Sidebar />
      {sidebarOpen && (
        <div
          className="resize-handle sidebar-handle"
          style={{ left: sidebarWidth - 3 }}
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
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void useStore.getState().restoreDeletion(undo.deletionId, undo.pane)}>
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
