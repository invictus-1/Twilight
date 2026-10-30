import { useEffect, useRef, useState } from 'react'
import { useExtras } from '../extras'
import { useInsights } from '../insightsStore'

/** Words in a day worth a moment's glow. */
const MILESTONES = [250, 500, 1000, 2000, 3000, 5000, 10000]

/**
 * A warm glow rising from the bottom of the window when the day's writing (Writer insights' count)
 * passes a milestone. Never on opening: only when the count climbs past one while you write.
 */
export function WritingGlow() {
  const on = useExtras().writingGlow
  const today = useInsights((s) => s.summary?.today ?? null)
  const seen = useRef<number | null>(null)
  const [glow, setGlow] = useState(0)
  useEffect(() => {
    if (today === null) return
    const before = seen.current
    seen.current = today
    if (!on || before === null) return
    if (MILESTONES.some((m) => before < m && today >= m)) setGlow((n) => n + 1)
  }, [today, on])
  useEffect(() => {
    if (!glow) return
    const done = setTimeout(() => setGlow(0), 2700)
    return () => clearTimeout(done)
  }, [glow])
  return glow ? <div key={glow} className="writing-glow" aria-hidden="true" /> : null
}

/** A small constellation of its own for each achievement: stars placed from its name, drawn line by line. */
export function Constellation({ name }: { name: string }) {
  let seed = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) | 0
    return ((seed >>> 8) & 0xffff) / 0xffff
  }
  const stars = Array.from({ length: 5 }, (_, i) => ({ x: 6 + i * 11 + next() * 6, y: 5 + next() * 22 }))
  return (
    <svg className="ach-constellation" viewBox="0 0 56 32" aria-hidden="true">
      {stars.slice(1).map((s, i) => (
        <line key={i} x1={stars[i].x} y1={stars[i].y} x2={s.x} y2={s.y} style={{ animationDelay: `${i * 220}ms` }} />
      ))}
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={i === 0 ? 1.8 : 1.3} style={{ animationDelay: `${i * 220}ms` }} />
      ))}
    </svg>
  )
}
