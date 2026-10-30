import { useEffect, useState, useSyncExternalStore } from 'react'
import type { NodeView } from '@shared/types'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { readStream, subscribeStream } from '../stream'
import { modelName, useStore } from '../store'
import { CloseIcon, GridIcon, StopIcon } from './Icons'

// Multiverse drafts: every version of the reply to one message of yours, side by side, with more
// written at once on request. Each draft is an ordinary version (a branch of the chat), so the
// ones you don't use stay there to come back to; Use this makes one the thread shown.

const COUNT_KEY = 'twilight.draftCount'
const COUNTS = [2, 3, 4]
/** How many drafts Write more makes, as last chosen (3 to start). */
export function savedCount(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY))
    return COUNTS.includes(n) ? n : 3
  } catch {
    return 3
  }
}

const words = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0)

function LiveDraft({ nodeId }: { nodeId: string }) {
  const text = useSyncExternalStore(
    (cb) => subscribeStream(nodeId, cb),
    () => readStream(nodeId).text
  )
  if (!text) return <div className="msg-pending"><span className="tw-spin" /> Waiting for the first token</div>
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(text) }} />
}

export function MultiversePanel() {
  const userId = useStore((s) => s.multiverseFor)
  const current = useStore((s) => s.current)
  const models = useStore((s) => s.models)
  const [versions, setVersions] = useState<NodeView[] | null>(null)
  const [count, setCount] = useState(savedCount)
  const close = (): void => useStore.getState().setOverlay(null)
  const chatId = current?.id
  // A draft being written shows in the chat only if it leads; the path says which one shows now.
  const pathIds = new Set(current?.path.map((n) => n.id))

  useEffect(() => {
    if (!chatId || !userId) return
    let live = true
    const load = (): void => void window.twilight.versions(chatId, userId).then((v) => live && setVersions(v))
    load()
    const off = window.twilight.onStream((event) => {
      if (event.kind !== 'done' || event.conversationId !== chatId || event.node.parentId !== userId) return
      // The finished text first (the live buffer is cleared on done), then the full list.
      setVersions((list) => list?.map((v) => (v.id === event.node.id ? event.node : v)) ?? list)
      load()
    })
    return () => {
      live = false
      off()
    }
    // Reloaded when the chat's thread changes too: new drafts arrive as new versions.
  }, [chatId, userId, current?.path.length, current?.path.at(-1)?.id])

  const writing = versions?.some((v) => v.status === 'streaming') ?? false
  const write = async (): Promise<void> => {
    try {
      localStorage.setItem(COUNT_KEY, String(count))
    } catch {
      // Storage unavailable: the count holds for this session.
    }
    if (userId) await useStore.getState().openMultiverse(userId, count)
    if (chatId && userId) setVersions(await window.twilight.versions(chatId, userId))
  }
  const use = (node: NodeView): void => {
    if (!chatId) return
    close()
    void useStore.getState().revealMessage(chatId, node.id)
  }

  return (
    <div className="dialog-backdrop overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette multiverse-panel" role="dialog" aria-modal="true" aria-label="Multiverse drafts">
        <div className="branch-head">
          <GridIcon size={16} />
          <span className="branch-title">Multiverse drafts</span>
          {versions && <span className="field-note">{versions.length} {versions.length === 1 ? 'version' : 'versions'} of this reply</span>}
          <span className="tw-spacer" />
          {writing ? (
            <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => chatId && void window.twilight.stop(chatId, 'a')}>
              <StopIcon size={13} /> Stop
            </button>
          ) : (
            <span className="multiverse-write">
              <span className="tw-seg" role="group" aria-label="How many drafts">
                {COUNTS.map((n) => (
                  <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>
                    {n}
                  </button>
                ))}
              </span>
              <button className="tw-btn tw-btn-sm tw-btn-primary multiverse-more" onClick={() => void write()}>
                Write {count} more
              </button>
            </span>
          )}
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <div className="multiverse-grid">
          {!versions && <div className="palette-empty">Loading the versions…</div>}
          {versions?.map((v, i) => {
            const shown = pathIds.has(v.id)
            const streaming = v.status === 'streaming'
            return (
              <article key={v.id} className={`multiverse-draft ${shown ? 'is-shown' : ''}`} data-node={v.id} data-status={v.status}>
                <header className="multiverse-draft-head field-note">
                  <strong>Version {i + 1}</strong>
                  <span>{modelName(models, v.modelId)}</span>
                  {streaming ? <span className="tw-spin" /> : <span>{words(v.text).toLocaleString()} words</span>}
                </header>
                <div className="multiverse-draft-body">
                  {streaming ? (
                    <LiveDraft nodeId={v.id} />
                  ) : v.status === 'error' ? (
                    <p className="field-note">This one failed: {v.error}</p>
                  ) : (
                    <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(v.id, v.text) }} />
                  )}
                </div>
                <footer className="multiverse-draft-foot">
                  {shown ? (
                    <span className="branch-here field-note">Shown now</span>
                  ) : (
                    <button className="tw-btn tw-btn-sm multiverse-use" disabled={streaming} onClick={() => use(v)}>
                      Use this
                    </button>
                  )}
                </footer>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
