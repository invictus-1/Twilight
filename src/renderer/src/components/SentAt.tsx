import { useSyncExternalStore } from 'react'
import { sentLabel } from '@shared/time'

// When a message of yours was sent, as "5 min ago", with the exact date and time on hover. One
// timer for the whole chat ticks once a minute, and only these labels redraw when it does.

const listeners = new Set<() => void>()
let minute = Math.floor(Date.now() / 60_000)
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  timer ??= setInterval(() => {
    const now = Math.floor(Date.now() / 60_000)
    if (now === minute) return
    minute = now
    listeners.forEach((l) => l())
  }, 15_000)
  return () => {
    listeners.delete(cb)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function SentAt({ at }: { at: number }) {
  useSyncExternalStore(subscribe, () => minute)
  const exact = new Date(at).toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return (
    <time className="sent-at" dateTime={new Date(at).toISOString()} title={exact}>
      {sentLabel(at)}
    </time>
  )
}
