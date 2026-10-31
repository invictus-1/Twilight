import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { keysFor, openChats, openMode, useBindings } from '../commands'
import { useStore, type Mode } from '../store'
import { CodeIcon, FeatherIcon, ScaleIcon, SearchIcon, SettingsIcon, SparkIcon, SpeechIcon } from './Icons'

const SECTIONS: { mode: Mode; label: string; icon: ReactNode; command: string }[] = [
  { mode: 'chat', label: 'Chats', icon: <SpeechIcon size={19} />, command: 'go-chat' },
  { mode: 'write', label: 'Writing', icon: <FeatherIcon size={19} />, command: 'go-write' },
  { mode: 'judge', label: 'Judge', icon: <ScaleIcon size={19} />, command: 'go-judge' },
  { mode: 'insights', label: 'Insights', icon: <SparkIcon size={19} />, command: 'go-insights' },
  { mode: 'code', label: 'Code', icon: <CodeIcon size={19} />, command: 'go-code' }
]

/** Twilight's mark: a sun on the horizon under two bands of sky. */
function Mark() {
  return (
    <svg className="rail-mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="rail-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--iris)" />
          <stop offset="1" stopColor="var(--dusk)" />
        </linearGradient>
      </defs>
      <rect x="3" y="5" width="26" height="6" rx="3" fill="url(#rail-sky)" opacity=".55" />
      <path d="M7 24a9 9 0 0 1 18 0z" fill="var(--horizon)" />
      <rect x="3" y="24" width="26" height="3" rx="1.5" fill="var(--horizon)" opacity=".7" />
    </svg>
  )
}

// Your order for the sections, kept per install like the theme. Sections added in a later
// version join at the end.
const ORDER_KEY = 'twilight.railOrder'
function savedOrder(): Mode[] {
  const all = SECTIONS.map((s) => s.mode)
  try {
    const saved = (JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as Mode[]).filter((m) => all.includes(m))
    return [...saved, ...all.filter((m) => !saved.includes(m))]
  } catch {
    return all
  }
}
function saveOrder(order: Mode[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    // Storage unavailable: the order holds for this session.
  }
}
const moved = <T,>(list: T[], from: number, to: number): T[] => {
  const out = [...list]
  out.splice(to, 0, ...out.splice(from, 1))
  return out
}

interface Drag {
  mode: Mode
  from: number
  over: number
  dy: number
  /** One slot's height: an item and the gap after it. */
  slot: number
  /** The first slot's top and an item's height, for drawing where it will land. */
  top: number
  height: number
}

/**
 * The column of sections down the left edge, each an icon with its name under it. It stays when
 * the sidebar is hidden; clicking the section you're in shows or hides the sidebar. Sections can
 * be dragged into your own order: the one you hold lifts and follows the pointer while the others
 * slide aside to open its new place (Alt+Up and Alt+Down move the focused one too).
 */
export function Rail() {
  useBindings()
  const mode = useStore((s) => s.mode)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const latestUpdate = useStore((s) => s.updates?.latest)
  const tip = (label: string, command: string): string => (keysFor(command) ? `${label} (${keysFor(command)})` : label)
  const [order, setOrder] = useState(savedOrder)
  const [drag, setDrag] = useState<Drag | null>(null)
  // After a drop, the item eases from where it was let go into its slot.
  const [settle, setSettle] = useState<{ mode: Mode; offset: number } | null>(null)
  const dragged = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  // The highlight that glides to the section you pick (Extras): placed beside the selected one.
  const glide = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const bar = glide.current
    const item = list.current?.querySelector<HTMLElement>('.rail-item[aria-selected="true"]')
    if (!bar) return
    bar.style.opacity = item ? '1' : '0'
    if (item) bar.style.transform = `translate(${item.offsetLeft - 6}px, ${item.offsetTop + 10}px)`
  })
  useLayoutEffect(() => {
    if (!settle) return
    const frame = requestAnimationFrame(() => setSettle(null))
    return () => cancelAnimationFrame(frame)
  }, [settle])

  const commit = (next: Mode[]): void => {
    setOrder(next)
    saveOrder(next)
  }

  const start = (e: React.PointerEvent<HTMLButtonElement>, m: Mode, index: number): void => {
    if (e.button !== 0) return
    const y0 = e.clientY
    const item = e.currentTarget
    const slot = item.offsetHeight + parseFloat(getComputedStyle(list.current!).rowGap || '4')
    const top = (list.current!.firstElementChild as HTMLElement).offsetTop
    let live: Drag | null = null
    dragged.current = false
    const move = (ev: PointerEvent): void => {
      const dy = ev.clientY - y0
      if (!live && Math.abs(dy) < 5) return
      const over = Math.max(0, Math.min(order.length - 1, index + Math.round(dy / slot)))
      live = { mode: m, from: index, over, dy, slot, top, height: item.offsetHeight }
      dragged.current = true
      setDrag(live)
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDrag(null)
      if (!live) return
      if (live.over !== live.from) commit(moved(order, live.from, live.over))
      setSettle({ mode: m, offset: live.dy - (live.over - live.from) * live.slot })
      // The click that ends a drag doesn't also open the section.
      setTimeout(() => (dragged.current = false), 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const nudge = (e: React.KeyboardEvent, index: number): void => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const to = index + (e.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= order.length) return
    const m = order[index]
    commit(moved(order, index, to))
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-mode="${m}"]`)?.focus())
  }

  /** Where an item sits while something is dragged: the held one under the pointer, the rest out of its way. */
  const offsetOf = (m: Mode, i: number): number => {
    if (settle?.mode === m) return settle.offset
    if (!drag) return 0
    if (m === drag.mode) return drag.dy
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.slot
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return drag.slot
    return 0
  }

  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-head drag">
        <Mark />
      </div>
      <div className={`rail-items ${drag ? 'rail-dragging' : ''}`} role="tablist" aria-orientation="vertical" ref={list}>
        <span className="rail-glide" ref={glide} aria-hidden="true" />
        {drag && <span className="rail-drop" aria-hidden="true" style={{ top: drag.top + drag.over * drag.slot, height: drag.height }} />}
        {order.map((m, i) => {
          const s = SECTIONS.find((x) => x.mode === m)!
          const current = mode === s.mode && !settingsOpen
          const held = drag?.mode === m
          const offset = offsetOf(m, i)
          return (
            <button
              key={s.mode}
              role="tab"
              data-mode={s.mode}
              className={`rail-item ${held ? 'rail-held' : ''} ${settle?.mode === m ? 'rail-settling' : ''}`}
              style={offset ? { transform: `translateY(${offset}px)${held ? ' scale(1.06)' : ''}` } : undefined}
              aria-selected={current}
              title={`${tip(s.label, s.command)} · drag to reorder`}
              onPointerDown={(e) => start(e, m, i)}
              onKeyDown={(e) => nudge(e, i)}
              onClick={() => {
                if (dragged.current) return
                if (current) useStore.getState().toggleSidebar()
                else if (s.mode === 'chat') openChats()
                else openMode(s.mode)
              }}
            >
              <span className="rail-icon">{s.icon}</span>
              <span className="rail-label">{s.label}</span>
            </button>
          )
        })}
      </div>
      <span className="tw-spacer" />
      <div className="rail-items rail-foot">
        <button className="rail-item" data-rail="search" title={tip('Search everything', 'search')} onClick={() => useStore.getState().setOverlay('search')}>
          <span className="rail-icon">
            <SearchIcon size={19} />
          </span>
          <span className="rail-label">Search</span>
        </button>
        <button
          className="rail-item"
          data-rail="settings"
          aria-selected={settingsOpen}
          title={latestUpdate ? `Settings · Twilight ${latestUpdate} is available` : tip('Settings', 'settings')}
          onClick={() => useStore.getState().setSettingsOpen(!settingsOpen)}
        >
          <span className="rail-icon">
            <SettingsIcon size={19} />
            {latestUpdate && <span className="rail-badge" aria-label="Update available" />}
          </span>
          <span className="rail-label">Settings</span>
        </button>
      </div>
    </nav>
  )
}
