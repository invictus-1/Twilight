import { useEffect, useRef, useState } from 'react'
import { locatePassage } from '@shared/passage'
import { usePane } from '../pane'
import { paneOf, useStore } from '../store'
import { SpeechIcon } from './Icons'

// Quick asks, in the editor's spirit; anything else goes in the box.
const QUICK: { label: string; ask: string }[] = [
  { label: 'Rewrite', ask: 'Rewrite this passage: the same events and meaning, in fresher, stronger prose.' },
  { label: 'Tighten', ask: 'Tighten this passage: cut filler and repetition, keep every beat.' },
  { label: 'Expand', ask: 'Expand this passage: more sensory detail, interiority and dialogue, the same events and voice.' }
]

const CONTEXT_KEY = 'twilight.passageWithChat'
const readWithChat = (): boolean => {
  try {
    return localStorage.getItem(CONTEXT_KEY) !== 'off'
  } catch {
    return true
  }
}

type Picked = { nodeId: string; source: string; start: number; end: number; top: number; left: number }

/**
 * Select text in a finished reply and a small toolbar offers to change it: Rewrite, Tighten,
 * Expand, or anything you ask. The model sees the passage (and, unless you switch it off, the
 * whole chat, read from its cache); the change shows before and after, and Accept saves the reply
 * with it as a new version, the original one ‹ › away.
 */
export function PassageTools({ scroller }: { scroller: React.RefObject<HTMLDivElement | null> }) {
  const pane = usePane()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [ask, setAsk] = useState('')
  // The box for asking opens only when you click Ask, as in the editor.
  const [asking, setAsking] = useState(false)
  const [withChat, setWithChat] = useState(readWithChat)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement>(null)

  // A selection inside one finished reply of this thread opens it; one elsewhere closes it.
  useEffect(() => {
    const up = (e: MouseEvent): void => {
      if (bar.current?.contains(e.target as Node)) return
      requestAnimationFrame(() => {
        const sel = document.getSelection()
        const el = scroller.current
        if (!sel || sel.isCollapsed || !el || !el.contains(sel.anchorNode)) {
          if (!busy && !result) setPicked(null)
          return
        }
        const reply = (sel.anchorNode as Node).parentElement?.closest<HTMLElement>('.tw-msg-ai[data-node]')
        const end = (sel.focusNode as Node).parentElement?.closest<HTMLElement>('.tw-msg-ai[data-node]')
        if (!reply || reply !== end || !reply.querySelector('.tw-msg-body')?.contains(sel.anchorNode)) return
        const current = useStore.getState().current
        const node = current ? paneOf(current, pane).path.find((n) => n.id === reply.dataset.node) : undefined
        if (!node || node.status !== 'done' || node.compaction) return
        const span = locatePassage(node.text, sel.toString())
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        setResult(null)
        setError(span ? null : "That passage couldn't be matched in the reply's text. Try selecting within one paragraph.")
        setPicked({ nodeId: node.id, source: node.text, start: span?.start ?? 0, end: span?.end ?? 0, top: Math.min(rect.bottom + 8, window.innerHeight - 80), left: Math.max(16, Math.min(rect.left, window.innerWidth - 460)) })
      })
    }
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [scroller, pane, busy, result])

  // Scrolling moves the passage away from the toolbar; while nothing is running, it closes.
  useEffect(() => {
    const el = scroller.current
    if (!picked || !el) return
    const away = (): void => void (!busy && !result && setPicked(null))
    el.addEventListener('scroll', away, { passive: true, once: true })
    return () => el.removeEventListener('scroll', away)
  }, [picked, busy, result, scroller])

  if (!picked) return null
  const passage = picked.source.slice(picked.start, picked.end)
  const run = async (instruction: string): Promise<void> => {
    const id = useStore.getState().current?.id
    if (!id || !instruction.trim() || !passage) return
    setBusy(true)
    setError(null)
    try {
      setResult(await window.twilight.editPassage(id, picked.nodeId, passage, instruction, withChat, pane))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }
  const close = (): void => {
    setPicked(null)
    setResult(null)
    setError(null)
    setAsk('')
    setAsking(false)
  }
  const accept = (): void => {
    if (result === null) return
    void useStore.getState().editMessage(picked.nodeId, picked.source.slice(0, picked.start) + result + picked.source.slice(picked.end), pane, false)
    close()
  }

  return (
    <div className={`passage-tools ${result === null ? 'is-bar' : ''}`} ref={bar} style={{ top: picked.top, left: picked.left }} role="dialog" aria-label="Change this passage">
      {result === null ? (
        busy ? (
          <span className="passage-working field-note">
            <span className="tw-spin" /> Working…
          </span>
        ) : asking ? (
          <form
            className="seltool-ask"
            onSubmit={(e) => {
              e.preventDefault()
              void run(ask)
            }}
          >
            <input
              className="passage-ask"
              autoFocus
              placeholder="What should change? Enter to run"
              value={ask}
              disabled={!passage}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (ask ? setAsk('') : setAsking(false))}
            />
          </form>
        ) : (
          <>
            <button className="tw-btn tw-btn-ghost tw-btn-sm tw-ask" disabled={!passage} onClick={() => setAsking(true)}>
              Ask
            </button>
            <span className="tw-sep" />
            {QUICK.map((q) => (
              <button key={q.label} className="tw-btn tw-btn-ghost tw-btn-sm" disabled={!passage} onClick={() => void run(q.ask)}>
                {q.label}
              </button>
            ))}
            <span className="tw-sep" />
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon passage-context"
              aria-pressed={withChat}
              aria-label="Use the whole chat as context"
              title={withChat ? "Uses the whole chat as context, read from its cache (the request isn't added to the chat). Click to use the passage alone." : 'Uses the passage alone. Click to use the whole chat as context.'}
              onClick={() => {
                setWithChat(!withChat)
                try {
                  localStorage.setItem(CONTEXT_KEY, withChat ? 'off' : 'on')
                } catch {
                  // Storage unavailable: the choice holds while the app is open.
                }
              }}
            >
              <SpeechIcon size={14} />
            </button>
          </>
        )
      ) : (
        <>
          <div className="passage-compare">
            <div className="passage-old">{passage}</div>
            <div className="passage-new">{result}</div>
          </div>
          <div className="passage-row">
            <button className="tw-btn tw-btn-sm tw-btn-primary" onClick={accept} title="Saved as a new version of the reply; the original stays one ‹ › away">
              Accept
            </button>
            <button className="tw-btn tw-btn-sm" onClick={() => setResult(null)}>
              Try another
            </button>
            <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={close}>
              Discard
            </button>
          </div>
        </>
      )}
      {error && <p className="passage-error">{error}</p>}
    </div>
  )
}
