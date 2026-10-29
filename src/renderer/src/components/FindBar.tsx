import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, CloseIcon } from './Icons'

// Open or closed, outside React so the command (Ctrl+F) can open it from anywhere.
let open = false
let focusTick = 0
const listeners = new Set<() => void>()
const subscribe = (cb: () => void): (() => void) => (listeners.add(cb), () => listeners.delete(cb))
const changed = (): void => listeners.forEach((l) => l())

/** Opens the find bar, or brings the cursor back to it when it's already open. */
export function openFind(): void {
  open = true
  focusTick++
  changed()
}

/** Text that isn't read as part of the page: what's being typed, code for the page itself, icons. */
const SKIP = 'textarea, input, select, script, style, svg, .find-bar, [aria-hidden="true"]'

/** Every place the words appear in what's on screen (the open section), in reading order. */
function findAll(query: string): Range[] {
  const root = document.querySelector('.app > main')
  if (!root || !query) return []
  const needle = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = new Range()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

const paint = (ranges: Range[], current: number): void => {
  CSS.highlights.set('find', new Highlight(...ranges))
  if (ranges[current]) CSS.highlights.set('find-current', new Highlight(ranges[current]))
  else CSS.highlights.delete('find-current')
}

const clear = (): void => {
  CSS.highlights.delete('find')
  CSS.highlights.delete('find-current')
}

/** Brings a match to the middle of its scroller; twice, as messages above may lay out on the way. */
function reveal(range: Range | undefined): void {
  const el = range?.startContainer.parentElement
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
}

/**
 * Find on the page (Ctrl+F): matches light up as you type, Enter and Shift+Enter step through
 * them, Esc closes. It reads the open section only, so a chat's thread or the Judge, never the
 * sidebar. The writing editor keeps its own find.
 */
export function FindBar() {
  const isOpen = useSyncExternalStore(subscribe, () => open)
  const tick = useSyncExternalStore(subscribe, () => focusTick)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const ranges = useRef<Range[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    input.current?.focus()
    input.current?.select()
  }, [isOpen, tick])

  // Search as you type, settled for a moment so a long chat isn't read on every key.
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      ranges.current = findAll(query)
      setCount(ranges.current.length)
      setIndex(0)
      paint(ranges.current, 0)
      reveal(ranges.current[0])
    }, 120)
    return () => clearTimeout(timer)
  }, [query, isOpen])

  useEffect(() => (isOpen ? undefined : clear()), [isOpen])

  if (!isOpen) return null

  const step = (by: 1 | -1): void => {
    // Read again first: a reply may have streamed in or the chat changed since the last search.
    ranges.current = findAll(query)
    const n = ranges.current.length
    setCount(n)
    if (!n) return paint([], 0)
    const next = (((index + by) % n) + n) % n
    setIndex(next)
    paint(ranges.current, next)
    reveal(ranges.current[next])
  }
  const close = (): void => {
    open = false
    changed()
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        value={query}
        placeholder="Find"
        aria-label="Find on the page"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {query ? (count ? `${index + 1} of ${count}` : 'No matches') : ''}
      </span>
      <button className="tw-btn tw-btn-ghost tw-btn-icon find-prev" aria-label="Previous match (Shift+Enter)" title="Previous (Shift+Enter)" disabled={!count} onClick={() => step(-1)}>
        <ChevronDown size={14} />
      </button>
      <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Next match (Enter)" title="Next (Enter)" disabled={!count} onClick={() => step(1)}>
        <ChevronDown size={14} />
      </button>
      <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close find (Esc)" title="Close (Esc)" onClick={close}>
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
