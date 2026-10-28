import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePane } from '../pane'
import { paneOf, useStore } from '../store'
import { subscribeStream } from '../stream'
import { Message } from './Message'

// Scrolling is left entirely to the browser's compositor: no scroll listeners, no JS-driven
// virtual list. Each message uses content-visibility: auto (see app.css), so off-screen
// messages skip layout and paint, and the thread is a plain block (not flex) so a message
// coming into view lays out alone. Measured with `TWILIGHT_SELFTEST` (src/main/selftest.ts).

export function Thread() {
  const pane = usePane()
  const path = useStore((s) => paneOf(s.current!, pane).path)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Open at the newest message.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

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
  useEffect(() => {
    if (!streamingId) return
    return subscribeStream(streamingId, () => {
      requestAnimationFrame(() => {
        const el = scroller.current
        if (el && atBottom.current) el.scrollTop = el.scrollHeight
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

  // Scroll to a newly sent message.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])

  const onClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    const link = target.closest('a')
    if (link) {
      e.preventDefault()
      const href = link.getAttribute('href')
      if (href && /^https?:\/\//.test(href)) void window.twilight.openExternal(href)
      return
    }
    const copy = target.closest<HTMLElement>('[data-copy]')
    if (copy) {
      const code = copy.closest('.tw-codeblock')?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard.writeText(code)
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
    }
  }

  return (
    <div className="thread-scroll" ref={scroller} onClick={onClick}>
      <div className="thread" ref={content}>
        {path.map((node) => (
          <Message key={node.id} node={node} />
        ))}
        <div ref={sentinel} className="thread-end" />
      </div>
    </div>
  )
}
