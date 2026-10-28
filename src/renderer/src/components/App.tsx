import { useEffect } from 'react'
import { useStore } from '../store'
import { handleStreamEvent } from '../stream'
import { ChatView } from './ChatView'
import { CloseIcon } from './Icons'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const error = useStore((s) => s.error)

  useEffect(() => {
    const store = useStore.getState()
    void store.init()
    return window.twilight.onStream((event) => {
      handleStreamEvent(event)
      if (event.kind === 'done') useStore.getState().applyDone(event.conversationId, event.node)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void s.newChat()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        s.toggleSidebar()
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        s.setSettingsOpen(true)
      } else if (e.key === 'Escape') {
        if (s.settingsOpen) s.setSettingsOpen(false)
        else void s.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <Sidebar />
      <ChatView />
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
