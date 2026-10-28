import { useEffect, useState } from 'react'
import type { NodeView } from '@shared/types'
import { renderMarkdown } from '../markdown'
import { useStore } from '../store'
import { ChevronLeft, CloseIcon, UndoIcon } from './Icons'

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * The current chat's recently deleted messages. Each can be read as it was or restored; a
 * restore puts the messages back where they were, as another version of that point in the chat,
 * so anything written since stays too and the arrows switch between them.
 */
export function DeletedPanel({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.current)!
  const deletions = useStore((s) => s.deletions)
  const [viewing, setViewing] = useState<{ id: string; nodes: NodeView[] } | null>(null)
  const [pane, setPane] = useState<'a' | 'b'>('a')

  useEffect(() => void useStore.getState().refreshDeletions(), [current.id])

  const view = async (id: string): Promise<void> => {
    try {
      setViewing({ id, nodes: await window.twilight.viewDeletion(current.id, id) })
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message : String(err))
    }
  }
  const restore = async (id: string): Promise<void> => {
    await useStore.getState().restoreDeletion(id, pane)
    setViewing(null)
  }

  return (
    <section className="panel deleted-panel" aria-label="Recently deleted">
      <div className="panel-head">
        {viewing ? (
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setViewing(null)}>
            <ChevronLeft />
            Back
          </button>
        ) : (
          <h2 className="t-heading">Recently deleted</h2>
        )}
        {current.split && (
          <div className="tw-seg" role="group" aria-label="Restore into pane" title="Which pane a restore shows in">
            <button className="tw-seg-a" aria-pressed={pane === 'a'} onClick={() => setPane('a')}>
              A
            </button>
            <button className="tw-seg-b" aria-pressed={pane === 'b'} onClick={() => setPane('b')}>
              B
            </button>
          </div>
        )}
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {viewing ? (
        <>
          <div className="deleted-view">
            {viewing.nodes.map((n) => (
              <div key={n.id} className={`deleted-msg deleted-${n.role}`}>
                <span className="deleted-role">{n.role === 'user' ? 'You' : 'Reply'}</span>
                <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(`deleted:${n.id}`, n.text) }} />
              </div>
            ))}
          </div>
          <button className="tw-btn tw-btn-primary tw-btn-sm" onClick={() => void restore(viewing.id)}>
            <UndoIcon />
            Restore
          </button>
        </>
      ) : deletions.length === 0 ? (
        <p className="field-note">Nothing deleted in this chat. Deleted messages wait here so you can read or restore them.</p>
      ) : (
        <>
          <p className="field-note">A restore comes back as another version of that point in the chat, so later messages stay too.</p>
          <ul className="deleted-list">
            {deletions.map((d) => (
              <li key={d.id} className="deleted-item">
                <div className="deleted-meta">
                  <span>{d.role === 'user' ? 'You' : 'Reply'}</span>
                  {d.count > 1 && <span className="tw-badge">+{d.count - 1} below</span>}
                  <span className="deleted-when">{ago(d.createdAt)}</span>
                </div>
                <p className="deleted-preview">{d.preview}</p>
                <div className="deleted-actions">
                  <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void view(d.id)}>
                    View
                  </button>
                  <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void restore(d.id)}>
                    <UndoIcon />
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
