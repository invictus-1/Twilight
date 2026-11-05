import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { locatePassage } from '@shared/passage'
import { usePane } from '../pane'
import { paneOf, useStore } from '../store'
import { CloseIcon, PenIcon, SpeechIcon } from './Icons'

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
type Spot = { top: number; left: number }

/** A spot that keeps a box of this size inside the window, 16px from every edge. */
const inWindow = (top: number, left: number, width: number, height: number): Spot => ({
  top: Math.max(16, Math.min(top, window.innerHeight - height - 16)),
  left: Math.max(16, Math.min(left, window.innerWidth - width - 16))
})

/**
 * Select text in a finished reply and a small toolbar offers to change it: Rewrite (plain, or with
 * a note on what you want from it), Tighten, Expand, or anything you ask. The model sees the
 * passage (and, unless you switch it off, the whole chat, read from its cache); a request can be
 * stopped; the change shows before and after, in a panel that stays inside the window and can be
 * dragged by its top, and Accept saves the reply with it as a new version, the original one ‹ › away.
 */
export function PassageTools({ scroller }: { scroller: React.RefObject<HTMLDivElement | null> }) {
  const pane = usePane()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [ask, setAsk] = useState('')
  // The box for asking opens only when you click Ask (or the pen beside Rewrite), as in the editor.
  const [asking, setAsking] = useState<'ask' | 'note' | null>(null)
  const [withChat, setWithChat] = useState(readWithChat)
  // What the change on show was made from, for its heading.
  const [usedChat, setUsedChat] = useState(withChat)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Where it sits once kept inside the window or dragged; until then, under the selection.
  const [spot, setSpot] = useState<Spot | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  // Each run's number: a stopped or replaced run's answer is let go when it arrives.
  const runs = useRef(0)

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
        if (busy || result !== null) return
        const reply = (sel.anchorNode as Node).parentElement?.closest<HTMLElement>('.tw-msg-ai[data-node]')
        const end = (sel.focusNode as Node).parentElement?.closest<HTMLElement>('.tw-msg-ai[data-node]')
        if (!reply || reply !== end || !reply.querySelector('.tw-msg-body')?.contains(sel.anchorNode)) return
        const current = useStore.getState().current
        const node = current ? paneOf(current, pane).path.find((n) => n.id === reply.dataset.node) : undefined
        if (!node || node.status !== 'done' || node.compaction) return
        const span = locatePassage(node.text, sel.toString())
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        setError(span ? null : "That passage couldn't be matched in the reply's text. Try selecting within one paragraph.")
        setSpot(null)
        setPicked({ nodeId: node.id, source: node.text, start: span?.start ?? 0, end: span?.end ?? 0, top: rect.bottom + 8, left: rect.left })
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

  // Kept inside the window as it changes (Working, the box for asking, before and after: measured
  // as each is drawn, before it shows) and as the window does.
  useLayoutEffect(() => {
    const el = bar.current
    if (!picked || !el) return
    const fit = (): void => {
      const r = el.getBoundingClientRect()
      const next = inWindow(r.top, r.left, r.width, r.height)
      if (Math.abs(next.top - r.top) > 0.5 || Math.abs(next.left - r.left) > 0.5) setSpot(next)
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [picked, busy, asking, result, error])

  const close = (): void => {
    // Closing while it works stops the request too.
    if (busy) stop()
    setPicked(null)
    setResult(null)
    setError(null)
    setAsk('')
    setAsking(null)
  }

  // Esc closes it, from anywhere (the box for asking takes the first Esc to clear itself).
  useEffect(() => {
    if (!picked) return
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      close()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  if (!picked) return null
  const passage = picked.source.slice(picked.start, picked.end)
  const run = async (instruction: string): Promise<void> => {
    const id = useStore.getState().current?.id
    if (!id || !instruction.trim() || !passage) return
    const mine = ++runs.current
    setUsedChat(withChat)
    setBusy(true)
    setError(null)
    try {
      const text = await window.twilight.editPassage(id, picked.nodeId, passage, instruction, withChat, pane)
      if (mine === runs.current) setResult(text)
    } catch (err) {
      if (mine === runs.current) setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      if (mine === runs.current) setBusy(false)
    }
  }
  function stop(): void {
    const id = useStore.getState().current?.id
    runs.current++
    setBusy(false)
    if (id) void window.twilight.stopPassage(id, pane)
  }
  const accept = (): void => {
    if (result === null) return
    void useStore.getState().editMessage(picked.nodeId, picked.source.slice(0, picked.start) + result + picked.source.slice(picked.end), pane, false)
    close()
  }
  // Dragged by its top row: it follows the pointer, inside the window.
  const drag = (e: React.PointerEvent): void => {
    const el = bar.current
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // A pointer that isn't down any more: it follows while it stays over the panel.
    }
    const move = (ev: PointerEvent): void => setSpot(inWindow(ev.clientY - dy, ev.clientX - dx, r.width, el.offsetHeight))
    const done = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', done)
      el.removeEventListener('pointercancel', done)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', done)
    el.addEventListener('pointercancel', done)
  }
  const rewrite = QUICK[0]
  const at = spot ?? { top: picked.top, left: picked.left }

  // Drawn on the page itself: the chat's area keeps its opening animation's end, which makes
  // "fixed" count from that area rather than the window, so it would sit off by the rail's width.
  return createPortal(
    <div className={`passage-tools ${result === null ? 'is-bar' : ''}`} ref={bar} style={{ top: at.top, left: at.left }} role="dialog" aria-label="Change this passage">
      {result === null ? (
        busy ? (
          <>
            <span className="passage-working field-note">
              <span className="tw-spin" /> Working…
            </span>
            <button className="tw-btn tw-btn-ghost tw-btn-sm passage-stop" onClick={stop}>
              Stop
            </button>
          </>
        ) : asking ? (
          <form
            className="seltool-ask"
            onSubmit={(e) => {
              e.preventDefault()
              if (asking === 'ask') void run(ask)
              // An empty note is a plain rewrite.
              else void run(ask.trim() ? `${rewrite.ask}\nWhat I want from the rewrite: ${ask.trim()}` : rewrite.ask)
            }}
          >
            <input
              className="passage-ask"
              autoFocus
              placeholder={asking === 'ask' ? 'What should change? Enter to run' : 'Why rewrite it? Enter to run, or leave it empty'}
              value={ask}
              disabled={!passage}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                e.preventDefault()
                e.stopPropagation()
                if (ask) setAsk('')
                else setAsking(null)
              }}
            />
          </form>
        ) : (
          <>
            <button className="tw-btn tw-btn-ghost tw-btn-sm tw-ask" disabled={!passage} onClick={() => setAsking('ask')}>
              Ask
            </button>
            <span className="tw-sep" />
            {QUICK.map((q) => (
              <span key={q.label} className="passage-quick">
                <button className="tw-btn tw-btn-ghost tw-btn-sm" disabled={!passage} onClick={() => void run(q.ask)}>
                  {q.label}
                </button>
                {q === rewrite && (
                  <button
                    className="tw-btn tw-btn-ghost tw-btn-icon passage-note"
                    disabled={!passage}
                    aria-label="Rewrite with a note"
                    title="Rewrite with a note on what you want from it"
                    onClick={() => {
                      setAsk('')
                      setAsking('note')
                    }}
                  >
                    <PenIcon size={13} />
                  </button>
                )}
              </span>
            ))}
            <span className="tw-sep" />
            {/* Says what the model will see, in words, and switches it. */}
            <button
              className="tw-btn tw-btn-ghost tw-btn-sm passage-context"
              aria-pressed={withChat}
              title={withChat ? "The model sees the whole chat, read from its cache (the request isn't added to the chat). Click to send the passage alone." : 'The model sees the passage alone. Click to send the whole chat with it.'}
              onClick={() => {
                setWithChat(!withChat)
                try {
                  localStorage.setItem(CONTEXT_KEY, withChat ? 'off' : 'on')
                } catch {
                  // Storage unavailable: the choice holds while the app is open.
                }
              }}
            >
              <SpeechIcon size={13} />
              {withChat ? 'Whole chat' : 'Passage only'}
            </button>
          </>
        )
      ) : (
        <>
          <div className="passage-head" onPointerDown={drag} title="Drag to move">
            <span className="field-note">Before and after · {usedChat ? 'with the whole chat' : 'from the passage alone'}</span>
            <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}>
              <CloseIcon size={14} />
            </button>
          </div>
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
    </div>,
    document.body
  )
}
