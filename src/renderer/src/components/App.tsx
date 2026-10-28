import { lazy, Suspense, useEffect } from 'react'
import { useStore } from '../store'
import { handleStreamEvent } from '../stream'
import { useWriting } from '../writingStore'

// The editor (CodeMirror) loads the first time Writing opens, so startup only parses the chat.
const WritingView = lazy(() => import('./WritingView').then((m) => ({ default: m.WritingView })))
import { ChatView } from './ChatView'
import { CloseIcon } from './Icons'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const mode = useStore((s) => s.mode)
  const error = useStore((s) => s.error)

  useEffect(() => {
    const store = useStore.getState()
    void store.init()
    void useWriting.getState().init()
    return window.twilight.onStream((event) => {
      handleStreamEvent(event)
      // Writing-tool runs finish inside the editor (Editor.tsx), not in a chat.
      if (event.kind === 'done' && event.conversationId !== 'writing') useStore.getState().applyDone(event.conversationId, event.node)
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
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <Sidebar />
      {mode === 'chat' ? (
        <ChatView />
      ) : (
        <Suspense fallback={<main className="chat" />}>
          <WritingView />
        </Suspense>
      )}
      {settingsOpen && <SettingsDialog />}
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
