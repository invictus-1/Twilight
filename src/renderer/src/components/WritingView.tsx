import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { Editor } from './Editor'
import { PlusIcon, SidebarIcon } from './Icons'
import { ModelPicker } from './ModelPicker'

const STATUS = { saved: 'Saved', unsaved: 'Edited', saving: 'Saving…', error: "Couldn't save" } as const

export function WritingView() {
  const open = useWriting((s) => s.open)
  const status = useWriting((s) => s.status)
  const words = useWriting((s) => s.words)
  const toggleSidebar = useStore((s) => s.toggleSidebar)

  return (
    <main className="chat writing">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{open ? open.path.replace(/\.md$/i, '') : 'Writing'}</h1>
        {open && (
          <span className={`doc-status doc-status-${status}`}>
            {words.toLocaleString()} words · {STATUS[status]}
          </span>
        )}
        <div className="no-drag" title="Model used by the writing tools">
          <ModelPicker placement="down" scope="defaults" />
        </div>
      </header>
      {open ? (
        <Editor key={open.path} docPath={open.path} />
      ) : (
        <div className="empty">
          <h2 className="t-display">Write something</h2>
          <p className="empty-sub">Open a document from the sidebar, or start a new one.</p>
          <button className="tw-btn tw-btn-primary" onClick={() => void useWriting.getState().newDoc()}>
            <PlusIcon />
            New document
          </button>
        </div>
      )}
    </main>
  )
}
