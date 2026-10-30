import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePane } from '../pane'
import { ChatTop } from './ChatTop'
import { paneOf, useStore } from '../store'
import { subscribeStream } from '../stream'
import { Message } from './Message'
import { useMotion, useScrollFx } from '../look'
import { attachScrollFx } from '../scrollFx'

// Scrolling is left entirely to the browser's compositor: no scroll listeners, no JS-driven
// virtual list. Each message uses content-visibility: auto (see app.css), so off-screen
// messages skip layout and paint, and the thread is a plain block (not flex) so a message
// coming into view lays out alone. Measured with `TWILIGHT_SELFTEST` (src/main/selftest.ts).

// Where each chat was left: the message at the top of the view and how far into it, so it reopens
// there, or at the newest message when it was left at the bottom. Kept across restarts.
const SPOTS_KEY = 'twilight.chatSpots'
type Spot = { node: string; offset: number }
const readSpots = (): Record<string, Spot> => {
  try {
    return JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '{}') as Record<string, Spot>
  } catch {
    return {}
  }
}
function saveSpot(key: string, spot: Spot | null): void {
  try {
    const all = readSpots()
    delete all[key]
    if (spot) all[key] = spot
    // The 200 chats seen most recently are plenty.
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k]
    localStorage.setItem(SPOTS_KEY, JSON.stringify(all))
  } catch {
    // Storage unavailable: the chat opens at its newest message.
  }
}

export function Thread() {
  const pane = usePane()
  const path = useStore((s) => paneOf(s.current!, pane).path)
  const spotKey = useStore((s) => `${s.current!.id}:${pane}`)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Open where it was left, or at the newest message; and remember the place when leaving it.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const spot = readSpots()[spotKey]
    const target = spot ? el.querySelector<HTMLElement>(`[data-node="${spot.node}"]`) : null
    const place = (): void => {
      if (target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top + spot!.offset
      else el.scrollTop = el.scrollHeight
    }
    if (target) atBottom.current = false
    place()
    // Messages above lay out at their real height over the next moments (they start as estimates),
    // which moves things; place it again as they settle, unless you've started scrolling yourself.
    let yours = false
    const mine = (): void => void (yours = true)
    el.addEventListener('wheel', mine, { passive: true, once: true })
    el.addEventListener('pointerdown', mine, { once: true })
    el.addEventListener('keydown', mine, { once: true })
    const timers = [0, 120, 350, 800].map((ms) => setTimeout(() => !yours && place(), ms))
    const leave = (): void => {
      if (atBottom.current) return saveSpot(spotKey, null)
      const top = el.getBoundingClientRect().top
      const msg = [...(content.current?.querySelectorAll<HTMLElement>('.msg[data-node]') ?? [])].find((m) => m.getBoundingClientRect().bottom > top)
      saveSpot(spotKey, msg ? { node: msg.dataset.node!, offset: top - msg.getBoundingClientRect().top } : null)
    }
    window.addEventListener('beforeunload', leave)
    return () => {
      timers.forEach(clearTimeout)
      el.removeEventListener('wheel', mine)
      el.removeEventListener('pointerdown', mine)
      el.removeEventListener('keydown', mine)
      window.removeEventListener('beforeunload', leave)
      leave()
    }
  }, [spotKey])

  // Track whether the reader is at the bottom without a scroll listener.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => (atBottom.current = entry.isIntersecting), {
      root: scroller.current,
      rootMargin: '0px 0px 80px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Follow a streaming reply only while the reader is already at the bottom.
  const last = path[path.length - 1]
  const streamingId = last?.status === 'streaming' ? last.id : null
  // While you're selecting (the mouse held down, or text selected in the chat) it stays put, so a
  // selection isn't dragged along by the reply; it follows again once you let go and click away.
  const selecting = useRef(false)
  useEffect(() => {
    if (!streamingId) return
    return subscribeStream(streamingId, () => {
      requestAnimationFrame(() => {
        const el = scroller.current
        if (!el || !atBottom.current || selecting.current) return
        const sel = document.getSelection()
        if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return
        el.scrollTop = el.scrollHeight
      })
    })
  }, [streamingId])

  // Once the chat has painted, lay out every message for good ("warm") in one idle moment, so
  // later scrolling has no layout left to do. Warming them gradually measured far slower: each
  // change re-checks every placeholder, so one pass is cheapest.
  const count = path.length
  useEffect(() => {
    const root = content.current
    if (!root) return
    const handle = requestIdleCallback(
      () => root.querySelectorAll<HTMLElement>('.msg:not(.warm)').forEach((el) => el.classList.add('warm')),
      { timeout: 1000 }
    )
    return () => cancelIdleCallback(handle)
  }, [count])

  // Scroll to a newly sent message (not on opening: that's the place it was left, above).
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) return void (opened.current = true)
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])

  // A search result: bring its message to the middle and light it up for a moment. Twice, since
  // messages above it may lay out at their real height after the first jump.
  const flash = useStore((s) => s.flash)
  useEffect(() => {
    if (!flash) return
    const el = (): HTMLElement | null | undefined => scroller.current?.querySelector<HTMLElement>(`[data-node="${flash}"]`)
    const go = (): void => el()?.scrollIntoView({ block: 'center' })
    requestAnimationFrame(go)
    const again = setTimeout(() => {
      go()
      el()?.classList.add('msg-flash')
      useStore.setState({ flash: null })
    }, 180)
    return () => clearTimeout(again)
  }, [flash])

  const onClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    const link = target.closest('a')
    if (link) {
      e.preventDefault()
      const href = link.getAttribute('href')
      if (href && /^https?:\/\//.test(href)) void window.twilight.openExternal(href)
      return
    }
    const collapse = target.closest<HTMLElement>('[data-collapse]')
    if (collapse) {
      const block = collapse.closest('.tw-codeblock')
      const collapsed = block?.classList.toggle('collapsed')
      collapse.textContent = collapsed ? 'Expand' : 'Collapse'
      return
    }
    const copy = target.closest<HTMLElement>('[data-copy]')
    if (copy) {
      const code = copy.closest('.tw-codeblock')?.querySelector('code')?.textContent ?? ''
      void window.twilight.copyText(code)
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
    }
  }

  return (
    <div className="thread-wrap">
      <div
        className="thread-scroll"
        ref={scroller}
        onClick={onClick}
        onPointerDown={() => {
          // Let go anywhere (a drag can end outside the chat) and it follows again.
          selecting.current = true
          const up = (): void => {
            selecting.current = false
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', up)
          }
          window.addEventListener('pointerup', up)
          window.addEventListener('pointercancel', up)
        }}
      >
        <ChatTop />
        <div className="thread" ref={content}>
          {path.map((node, i) => (
            <Message key={node.id} node={node} next={path[i + 1]} isLast={i === path.length - 1} />
          ))}
          <div ref={sentinel} className="thread-end" />
        </div>
      </div>
      <ScrollParticles scroller={scroller} />
    </div>
  )
}

/** The scroll particles, when they're on and motion is Full (Windows' reduce motion turns them off too). */
function ScrollParticles({ scroller }: { scroller: React.RefObject<HTMLDivElement | null> }) {
  const fx = useScrollFx()
  const motion = useMotion()
  const canvas = useRef<HTMLCanvasElement>(null)
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const on = fx.on && motion === 'full' && !reduce
  useEffect(() => {
    if (!on || !scroller.current || !canvas.current) return
    return attachScrollFx(scroller.current, canvas.current, fx.style)
  }, [on, fx.style, scroller])
  return on ? <canvas ref={canvas} className="scroll-fx" data-style={fx.style} aria-hidden="true" /> : null
}
