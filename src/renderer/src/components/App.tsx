import { Constellation, WritingGlow } from './Delights'
import { useExtras } from '../extras'
import { FindBar } from './FindBar'
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { useStore } from '../store'
import { useJudge } from '../judgeStore'
import { clearStream, handleStreamEvent } from '../stream'
import { useWriting } from '../writingStore'
import { useInsights } from '../insightsStore'
/**
 * A screen whose code loads after start. Once loaded it renders at once, like any other; only
 * opening it before then shows the empty page for the moment it takes to load.
 */
function screen<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { preload: () => Promise<unknown> } {
  let ready: ComponentType<P> | null = null
  const fetch = (): Promise<ComponentType<P>> => load().then((c) => (ready = c))
  const Lazy = lazy(() => fetch().then((c) => ({ default: c })))
  const Screen = (props: P) => {
    const C = (ready ?? Lazy) as ComponentType<P>
    return <C {...props} />
  }
  return Object.assign(Screen, { preload: fetch })
}

// Only the chat is needed at start. The other screens load in the background as soon as the
// window is ready (Settings first), so they're there before anyone opens them but not in the way
// of starting. The editor (CodeMirror) is the biggest of them.
const SettingsView = screen(() => import('./SettingsView').then((m) => m.SettingsView))
const JudgeView = screen(() => import('./JudgeView').then((m) => m.JudgeView))
const CodeView = screen(() => import('./CodeView').then((m) => m.CodeView))
const InsightsView = screen(() => import('./InsightsView').then((m) => m.InsightsView))
const Welcome = screen(() => import('./Welcome').then((m) => m.Welcome))
const WritingView = screen(() => import('./WritingView').then((m) => m.WritingView))
const screens = [SettingsView, JudgeView, CodeView, InsightsView, Welcome, WritingView]
import { ChatView } from './ChatView'
import { CloseIcon, TrophyIcon } from './Icons'
import { useDragResize, usePersistentNumber } from '../resize'
import { Sidebar } from './Sidebar'
import { Rail } from './Rail'
import { backdropImage, framing, useBackdrop } from '../look'
import { commandFor } from '../commands'
import { recordingKeys } from './ShortcutsSection'
import { CommandMenu, ShortcutSheet } from './CommandMenu'
import { SearchPanel } from './SearchPanel'
import { PersonaChooser } from './PersonaChooser'

/** Your background, under everything, with the night laid over it so text stays readable. */
function Backdrop() {
  const b = useBackdrop()
  const image = backdropImage(b)
  if (!image) return null
  return (
    <>
      <div className="backdrop" aria-hidden="true" style={{ backgroundImage: image, filter: b.blur ? `blur(${b.blur}px)` : undefined, ...framing(b) }} />
      <div className="backdrop-dim" aria-hidden="true" style={{ opacity: b.dim / 100 }} />
    </>
  )
}

/** The window opens on a moment of evening: a horizon glow that fades as the app appears. */
function BootGlow() {
  const [on, setOn] = useState(true)
  if (!on) return null
  return <div className="boot-glow" aria-hidden="true" onAnimationEnd={() => setOn(false)} />
}

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const settingsSection = useStore((s) => s.settingsSection)
  const welcomeOpen = useStore((s) => s.welcomeOpen)
  const overlay = useStore((s) => s.overlay)
  const hasBackdrop = !!backdropImage(useBackdrop())
  const mode = useStore((s) => s.mode)
  const error = useStore((s) => s.error)
  const undo = useStore((s) => s.undo)
  const latestUpdate = useStore((s) => s.updates?.latest ?? null)
  const unlocked = useInsights((s) => s.unlocked)
  const constellations = useExtras().constellations
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
    void store.init().finally(() => {
      document.body.dataset.ready = '1'
      // Once the window is up, the other screens load in the background, one after another.
      for (const s of screens) void s.preload().catch(() => undefined)
    })
    void useWriting.getState().init()
    void useJudge.getState().init()
    return window.twilight.onStream((event) => {
      handleStreamEvent(event)
      if (event.kind !== 'done') return
      // Writing-tool runs finish inside the editor (Editor.tsx); judge runs in the judgment.
      if (event.conversationId === 'judge') {
        void useJudge.getState().reload(event.node.parentId ?? '').then(() => clearStream(event.nodeId))
      } else if (event.conversationId !== 'writing') useStore.getState().applyDone(event.conversationId, event.node, event.asked)
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
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'} ${hasBackdrop ? 'has-backdrop' : ''}`} style={{ gridTemplateColumns: `${RAIL}px ${sidebarOpen ? sidebarWidth : 0}px minmax(0, 1fr)` }}>
      <Backdrop />
      <BootGlow />
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
      <Suspense fallback={<main className="chat" />}>
        {settingsOpen ? (
          <SettingsView key={settingsSection ?? ''} />
        ) : mode === 'chat' ? (
          <ChatView />
        ) : mode === 'judge' ? (
          <JudgeView />
        ) : mode === 'insights' ? (
          <InsightsView />
        ) : mode === 'code' ? (
          <CodeView />
        ) : (
          <WritingView />
        )}
      </Suspense>
      {welcomeOpen && (
        <Suspense fallback={null}>
          <Welcome />
        </Suspense>
      )}
      <FindBar />
      <WritingGlow />
      {overlay === 'commands' && <CommandMenu />}
      {overlay === 'shortcuts' && <ShortcutSheet />}
      {overlay === 'search' && <SearchPanel />}
      {overlay === 'personas' && <PersonaChooser />}
      {unlocked.length > 0 && !undo && !error && (
        <div className="toast toast-info ach-toast" role="status">
          {constellations && unlocked.length === 1 ? <Constellation name={unlocked[0]} /> : <TrophyIcon size={16} />}
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
