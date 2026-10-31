import { useEffect, useState, useSyncExternalStore } from 'react'
import type { NodeView } from '@shared/types'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { readStream, subscribeStream } from '../stream'
import { modelName, useStore } from '../store'
import { CloseIcon, GridIcon, StopIcon } from './Icons'

// Multiverse drafts: every reply to one message of yours side by side, with the chat's whole
// context behind each. Before any are written you choose how many, and whether they share your
// message or each get one of their own (to compare ways of asking); a draft with its own message
// goes under a new version of yours. Each draft is an ordinary version, so the ones you don't use
// stay in the chat to come back to; Use this makes one the thread shown.

const COUNT_KEY = 'twilight.draftCount'
const COUNTS = [2, 3, 4]
/** How many drafts to write, as last chosen (3 to start). */
export function savedCount(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY))
    return COUNTS.includes(n) ? n : 3
  } catch {
    return 3
  }
}
// More columns than this would be too narrow to read; past it, the row scrolls.
const MAX_FIT = 5

const words = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0)

function LiveDraft({ nodeId }: { nodeId: string }) {
  const text = useSyncExternalStore(
    (cb) => subscribeStream(nodeId, cb),
    () => readStream(nodeId).text
  )
  if (!text) return <div className="msg-pending"><span className="tw-spin" /> Waiting for the first token</div>
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(text) }} />
}

/** Choosing what to write: how many drafts, and the same message for all or one each. */
function Setup({ message, onRun, onCancel }: { message: string; onRun: (count: number, prompts?: string[]) => void; onCancel: (() => void) | null }) {
  const [count, setCount] = useState(savedCount)
  const [each, setEach] = useState(false)
  const [prompts, setPrompts] = useState<string[]>(() => Array.from({ length: 4 }, () => message))
  const run = (): void => {
    try {
      localStorage.setItem(COUNT_KEY, String(count))
    } catch {
      // Storage unavailable: the count holds for this session.
    }
    onRun(count, each ? prompts.slice(0, count) : undefined)
  }
  return (
    <div className="multiverse-setup">
      <div className="multiverse-setup-row">
        <span className="field-label">How many</span>
        <span className="tw-seg" role="group" aria-label="How many drafts">
          {COUNTS.map((n) => (
            <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </span>
      </div>
      <div className="multiverse-setup-row" role="radiogroup" aria-label="Messages">
        <label className="check">
          <input type="radio" name="mv-each" checked={!each} onChange={() => setEach(false)} />
          The same message for all
        </label>
        <label className="check">
          <input type="radio" name="mv-each" className="multiverse-each" checked={each} onChange={() => setEach(true)} />A different message for each
        </label>
      </div>
      {each ? (
        <div className="multiverse-prompts" style={{ '--cols': count } as React.CSSProperties}>
          {prompts.slice(0, count).map((p, i) => (
            <label key={i} className="field multiverse-prompt">
              <span className="field-label">Draft {i + 1}</span>
              <textarea rows={6} value={p} onChange={(e) => setPrompts((list) => list.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
          ))}
        </div>
      ) : (
        <p className="multiverse-message field-note" title={message}>
          {message}
        </p>
      )}
      <p className="field-note">Each draft gets the whole chat as context, as a regenerate would. A draft with its own message goes in as a new version of yours.</p>
      <div className="data-actions">
        <button className="tw-btn tw-btn-primary tw-btn-sm multiverse-run" disabled={each && prompts.slice(0, count).some((p) => !p.trim())} onClick={run}>
          Write {count} drafts
        </button>
        {onCancel && (
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={onCancel}>
            Back to the drafts
          </button>
        )}
      </div>
    </div>
  )
}

export function MultiversePanel() {
  const userId = useStore((s) => s.multiverseFor)
  const startInSetup = useStore((s) => s.multiverseSetup)
  const current = useStore((s) => s.current)
  const models = useStore((s) => s.models)
  const [columns, setColumns] = useState<{ user: NodeView; reply: NodeView }[] | null>(null)
  const [setup, setSetup] = useState(startInSetup)
  const close = (): void => useStore.getState().setOverlay(null)
  const chatId = current?.id
  // Which draft shows in the chat: the one on the thread shown now.
  const pathIds = new Set(current?.path.map((n) => n.id))
  const base = current?.path.find((n) => n.id === userId)

  useEffect(() => {
    if (!chatId || !userId) return
    let live = true
    const load = (): void => void window.twilight.multiverse(chatId, userId).then((c) => live && setColumns(c))
    load()
    const off = window.twilight.onStream((event) => {
      if (event.kind !== 'done' || event.conversationId !== chatId) return
      // The finished text first (the live buffer is cleared on done), then the whole set.
      setColumns((list) => list?.map((c) => (c.reply.id === event.node.id ? { ...c, reply: event.node } : c)) ?? list)
      load()
    })
    return () => {
      live = false
      off()
    }
    // Reloaded when the chat's thread changes too: new drafts arrive as new versions.
  }, [chatId, userId, current?.path.length, current?.path.at(-1)?.id])

  const writing = columns?.some((c) => c.reply.status === 'streaming') ?? false
  const run = async (count: number, prompts?: string[]): Promise<void> => {
    if (!chatId || !userId) return
    setSetup(false)
    await useStore.getState().writeDrafts(userId, count, prompts)
    setColumns(await window.twilight.multiverse(chatId, userId))
  }
  const use = (reply: NodeView): void => {
    if (!chatId) return
    close()
    void useStore.getState().revealMessage(chatId, reply.id)
  }
  // Each draft's message shows above it when they differ.
  const mixed = !!columns && new Set(columns.map((c) => c.user.text.trim())).size > 1
  const fit = Math.min(columns?.length ?? 1, MAX_FIT)

  return (
    <div className="dialog-backdrop overlay-backdrop multiverse-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette multiverse-panel" role="dialog" aria-modal="true" aria-label="Multiverse drafts">
        <div className="branch-head">
          <GridIcon size={16} />
          <span className="branch-title">Multiverse drafts</span>
          {columns && !setup && <span className="field-note">{columns.length} {columns.length === 1 ? 'version' : 'versions'}</span>}
          <span className="tw-spacer" />
          {writing ? (
            <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => chatId && void window.twilight.stop(chatId, 'a')}>
              <StopIcon size={13} /> Stop
            </button>
          ) : (
            !setup && (
              <button className="tw-btn tw-btn-sm tw-btn-primary multiverse-more" onClick={() => setSetup(true)}>
                Write more
              </button>
            )
          )}
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        {setup ? (
          <Setup message={base?.text ?? columns?.[0]?.user.text ?? ''} onRun={(n, p) => void run(n, p)} onCancel={columns && columns.length > 1 ? () => setSetup(false) : null} />
        ) : (
          <div className={`multiverse-grid ${(columns?.length ?? 0) > MAX_FIT ? 'is-many' : ''}`} style={{ '--cols': fit } as React.CSSProperties}>
            {!columns && <div className="palette-empty">Loading the versions…</div>}
            {columns?.map(({ user, reply }, i) => {
              const shown = pathIds.has(reply.id)
              const streaming = reply.status === 'streaming'
              return (
                <article key={reply.id} className={`multiverse-draft ${shown ? 'is-shown' : ''}`} data-node={reply.id} data-status={reply.status}>
                  <header className="multiverse-draft-head field-note">
                    <strong>Version {i + 1}</strong>
                    <span>{modelName(models, reply.modelId)}</span>
                    {streaming ? <span className="tw-spin" /> : <span>{words(reply.text).toLocaleString()} words</span>}
                  </header>
                  {mixed && (
                    <p className="multiverse-draft-message" title={user.text}>
                      {user.text}
                    </p>
                  )}
                  <div className="multiverse-draft-body">
                    {streaming ? (
                      <LiveDraft nodeId={reply.id} />
                    ) : reply.status === 'error' ? (
                      <p className="field-note">This one failed: {reply.error}</p>
                    ) : (
                      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.id, reply.text) }} />
                    )}
                  </div>
                  <footer className="multiverse-draft-foot">
                    {shown ? (
                      <span className="branch-here field-note">Shown now</span>
                    ) : (
                      <button className="tw-btn tw-btn-sm multiverse-use" disabled={streaming} onClick={() => use(reply)}>
                        Use this
                      </button>
                    )}
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
