import { useEffect, useMemo, useRef, useState } from 'react'
import type { Horizon } from '../extras'
import { carColours, carSprite, paintCity, PX, readPalette, type CityLayout } from '../pixelCity'

// What stands under the sky (Extras → Under the sky): the neon grid, an ocean with a lighthouse,
// low-poly mountains, a city skyline, desert dunes, or a pixel-art cyberpunk city. Each sits on the
// horizon in front of the sun and takes the theme's colours. The scenes are drawn once (SVG, or a
// canvas for the pixel city); what moves is transforms and opacity, and it all stands still under
// Gentle and Off motion.

function seeded(seed: number): () => number {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// ——— Mountains: three ridges, each face lit or in shade by its slope ———

/** A ridge's peaks and saddles across 0–1000, between heights `lo` and `hi` (200 is the horizon). */
function ridge(seed: number, steps: number, lo: number, hi: number): [number, number][] {
  const rand = seeded(seed)
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 1000 + (i > 0 && i < steps ? (rand() - 0.5) * (1000 / steps) * 0.7 : 0)
    // Peaks and saddles in turn, so the line reads as mountains rather than noise; now and then a
    // peak stands well above its neighbours, and some saddles dip deep.
    const peak = rand() < 0.25 ? hi : hi + rand() * (lo - hi) * 0.55
    const saddle = lo - rand() * (lo - hi) * (rand() < 0.3 ? 0.15 : 0.45)
    points.push([Math.round(x), Math.round(i % 2 === 0 ? peak : saddle)])
  }
  return points
}
const RIDGES = [
  { cls: 'far', points: ridge(11, 14, 150, 30) },
  { cls: 'mid', points: ridge(23, 18, 175, 85) },
  { cls: 'near', points: ridge(37, 22, 198, 140) }
]

function Ridges({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 1000 200" preserveAspectRatio="none">
      {RIDGES.map((r) => (
        <g key={r.cls} className={`hz-ridge hz-ridge-${r.cls}`}>
          {r.points.slice(1).map(([x2, y2], i) => {
            const [x1, y1] = r.points[i]
            return <polygon key={i} className={y2 < y1 ? 'lit' : 'shade'} points={`${x1},${y1} ${x2},${y2} ${x2},200 ${x1},200`} />
          })}
        </g>
      ))}
    </svg>
  )
}

function Mountains() {
  return (
    <>
      <Ridges className="hz-up hz-mountains" />
      <span className="hz-mist" />
      {/* A still lake below, the ridges mirrored in it and fading into the dark. */}
      <div className="hz-floor hz-floor-mountains">
        <Ridges className="hz-lake" />
        <span className="hz-lake-sheen" />
      </div>
    </>
  )
}

// ——— City skyline: two rows of buildings, a few windows flickering ———

const CITY = (() => {
  const rand = seeded(1959)
  const rows = [
    { cls: 'back', lo: 40, hi: 150, min: 26, max: 60 },
    { cls: 'front', lo: 20, hi: 95, min: 30, max: 70 }
  ]
  return rows.map((row) => {
    const buildings: { x: number; w: number; h: number; windows: { x: number; y: number; on: boolean; blink: boolean }[]; aerial: boolean }[] = []
    for (let x = -10; x < 1010; ) {
      const w = Math.round(row.min + rand() * (row.max - row.min))
      const h = Math.round(row.lo + rand() * (row.hi - row.lo))
      const windows: { x: number; y: number; on: boolean; blink: boolean }[] = []
      for (let wy = 160 - h + 8; wy < 154; wy += 9) for (let wx = x + 5; wx < x + w - 6; wx += 8) windows.push({ x: wx, y: wy, on: rand() < 0.22, blink: rand() < 0.03 })
      buildings.push({ x, w, h, windows, aerial: h > row.hi - 20 && rand() < 0.5 })
      x += w + Math.round(rand() * 6)
    }
    return { cls: row.cls, buildings }
  })
})()

function City() {
  return (
    <>
      <span className="hz-city-glow" />
      <svg className="hz-up hz-city" viewBox="0 0 1000 160" preserveAspectRatio="xMidYMax slice">
        {CITY.map((row) => (
          <g key={row.cls} className={`hz-row hz-row-${row.cls}`}>
            {row.buildings.map((b, i) => (
              <g key={i}>
                <rect className="hz-building" x={b.x} y={160 - b.h} width={b.w} height={b.h} />
                {b.aerial && (
                  <>
                    <rect className="hz-building" x={b.x + b.w / 2 - 1} y={160 - b.h - 14} width={2} height={14} />
                    <circle className="hz-aerial-light" cx={b.x + b.w / 2} cy={160 - b.h - 15} r={2} style={{ animationDelay: `${(i % 5) * 0.7}s` }} />
                  </>
                )}
                {b.windows.map((w, j) =>
                  w.on || w.blink ? <rect key={j} className={`hz-window ${w.blink ? 'is-blink' : ''}`} x={w.x} y={w.y} width={3} height={4} style={w.blink ? { animationDelay: `${(j % 7) * 1.3}s` } : undefined} /> : null
                )}
              </g>
            ))}
          </g>
        ))}
      </svg>
      <div className="hz-floor hz-floor-city" />
    </>
  )
}

// ——— Dunes: smooth crests catching the last light ———

/** A dune line across 0–1000 at about `y`, as a closed shape down to the bottom. */
function dune(seed: number, y: number, amp: number, waves: number): string {
  const rand = seeded(seed)
  let d = `M -20 ${y}`
  for (let i = 0; i < waves; i++) {
    const x0 = -20 + (i * 1040) / waves
    const x1 = x0 + 1040 / waves
    const crest = y - amp * (0.5 + rand() * 0.5)
    // A gentle windward rise and a steeper lee side, as real dunes have.
    d += ` C ${x0 + (x1 - x0) * 0.45} ${crest}, ${x0 + (x1 - x0) * 0.6} ${crest}, ${x1} ${y + amp * 0.15 * rand()}`
  }
  return `${d} L 1020 320 L -20 320 Z`
}
// The far line sits on the horizon (the drawing starts a little above it); nearer ones are taller.
const DUNES = [
  { cls: 'far', d: dune(5, 46, 16, 6) },
  { cls: 'mid', d: dune(9, 100, 34, 4) },
  { cls: 'near', d: dune(13, 172, 54, 3) },
  { cls: 'front', d: dune(17, 252, 66, 2) }
]

function Dunes() {
  return (
    <svg className="hz-dunes" viewBox="0 0 1000 300" preserveAspectRatio="none">
      <defs>
        {/* Each dune lit along its crest by the low sun, falling into shadow below. */}
        {DUNES.map((l) => (
          <linearGradient key={l.cls} id={`hz-dune-${l.cls}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="hz-dune-lit" />
            <stop offset="0.35" className={`hz-dune-body hz-dune-body-${l.cls}`} />
            <stop offset="1" className={`hz-dune-deep hz-dune-deep-${l.cls}`} />
          </linearGradient>
        ))}
      </defs>
      {DUNES.map((l) => (
        <path key={l.cls} className={`hz-dune hz-dune-${l.cls}`} d={l.d} fill={`url(#hz-dune-${l.cls})`} />
      ))}
    </svg>
  )
}

// ——— Ocean: the sun's reflection on slow swells, and a lighthouse ———

function Ocean() {
  return (
    <>
      <div className="hz-floor hz-floor-ocean">
        <div className="hz-sea-plane">
          <span className="hz-swells" />
        </div>
        <span className="hz-glint" />
      </div>
      <div className="hz-lighthouse">
        <span className="hz-beam" />
        <svg viewBox="0 0 120 90" aria-hidden="true">
          <path className="hz-rock" d="M0 90 L6 70 L22 62 L40 66 L52 56 L70 58 L88 66 L104 64 L120 74 L120 90 Z" />
          <path className="hz-tower" d="M62 58 L65 20 L73 20 L76 58 Z" />
          <rect className="hz-tower-band" x="63.2" y="34" width="11.6" height="5" />
          <rect className="hz-tower-band" x="62.5" y="46" width="13" height="5" />
          <path className="hz-tower" d="M63 20 L69 13 L75 20 Z" />
          <rect className="hz-lamp" x="65.5" y="15.5" width="7" height="4.5" />
        </svg>
      </div>
    </>
  )
}

// ——— Cyberpunk: the pixel city, with flying cars and flickering neon ———

const LANES = (() => {
  const rand = seeded(88)
  // Far lanes high and slow, near ones low and quick; each its own direction.
  return Array.from({ length: 8 }, (_, i) => {
    const depth = i % 3
    return {
      top: 0.25 + rand() * 0.6,
      scale: depth === 0 ? 1.5 : depth === 1 ? 2 : PX,
      dim: depth === 0 ? 0.55 : depth === 1 ? 0.8 : 1,
      duration: depth === 0 ? 30 + rand() * 10 : depth === 1 ? 18 + rand() * 6 : 10 + rand() * 4,
      delay: -rand() * 30,
      left: rand() < 0.5,
      colour: i % 3
    }
  })
})()

function Cyberpunk({ time }: { time: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<CityLayout | null>(null)
  const [sprites, setSprites] = useState<string[]>([])
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const box = wrap.current
    const c = canvas.current
    if (!box || !c) return
    let idle = 0
    // Drawn in an idle moment, so opening a chat isn't held up by it.
    const draw = (): void => {
      cancelIdleCallback(idle)
      idle = requestIdleCallback(
        () => {
          const rect = c.getBoundingClientRect()
          const line = box.closest('.empty-sky')?.querySelector('.empty-horizon')?.getBoundingClientRect()
          if (!rect.width || !rect.height || !line) return
          const palette = readPalette(box)
          const w = Math.ceil(rect.width / PX)
          const h = Math.ceil(rect.height / PX)
          const hy = Math.max(4, Math.min(h - 2, Math.round((line.top - rect.top) / PX)))
          setLayout(paintCity(c, w, h, hy, palette, time))
          setSprites(carColours(palette).map((k) => carSprite(k.body, k.glow)))
          setWidth(rect.width)
        },
        { timeout: 400 }
      )
    }
    draw()
    const resized = new ResizeObserver(draw)
    resized.observe(box)
    // A new theme repaints it in the theme's colours.
    const themed = new MutationObserver(draw)
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => {
      cancelIdleCallback(idle)
      resized.disconnect()
      themed.disconnect()
    }
  }, [time])

  const flicker = useMemo(() => (layout ? layout.signs.filter((_, i) => i % 3 === 0).slice(0, 8) : []), [layout])
  const pct = (v: number, of: number): string => `${(v / of) * 100}%`
  return (
    <div className="hz-cyber" ref={wrap} style={{ '--hz-w': `${width}px` } as React.CSSProperties}>
      <div className="hz-cyber-box">
        <canvas ref={canvas} className="hz-cyber-canvas" />
        {layout &&
          flicker.map((s, i) => (
            <span key={`s${i}`} className="hz-neon" style={{ left: pct(s.x, layout.w), top: pct(s.y, layout.h), width: pct(s.w, layout.w), height: pct(s.h, layout.h), background: s.color, animationDelay: `${(i * 1.7) % 9}s`, animationDuration: `${6 + (i % 4) * 2.5}s` }} />
          ))}
        {layout &&
          layout.lights.slice(0, 12).map((l, i) => (
            <span key={`l${i}`} className="hz-blink" style={{ left: pct(l.x, layout.w), top: pct(l.y, layout.h), width: pct(1, layout.w), height: pct(1, layout.h), animationDelay: `${(i * 0.9) % 4}s` }} />
          ))}
      </div>
      {sprites.length > 0 &&
        width > 0 &&
        LANES.map((lane, i) => (
          <span
            key={i}
            className={`hz-car ${lane.left ? 'is-left' : ''}`}
            style={{
              top: `calc(var(--horizon-at) - var(--city-up) * ${lane.top.toFixed(3)})`,
              width: 12 * lane.scale,
              height: 5 * lane.scale,
              opacity: lane.dim,
              backgroundImage: `url(${sprites[lane.colour]})`,
              animationDuration: `${lane.duration.toFixed(1)}s`,
              animationDelay: `${lane.delay.toFixed(1)}s`
            }}
          />
        ))}
    </div>
  )
}

// ——— The grid, as it was ———

function Grid() {
  return (
    <div className="empty-floor">
      <div className="empty-plane">
        <span className="empty-grid" />
      </div>
    </div>
  )
}

export function HorizonScene({ kind, time }: { kind: Horizon; time: string }) {
  if (kind === 'ocean') return <Ocean />
  if (kind === 'mountains') return <Mountains />
  if (kind === 'city') return <City />
  if (kind === 'dunes') return <Dunes />
  if (kind === 'cyberpunk') return <Cyberpunk time={time} />
  return <Grid />
}

// ——— Shooting stars ———

interface Meteor {
  id: number
  x: number
  y: number
  angle: number
  length: number
  travel: number
  duration: number
}

const stillMotion = (): boolean => ['reduced', 'off'].includes(document.documentElement.dataset.motion ?? '')

/**
 * Shooting stars: every so often one streaks across the sky on a path of its own (now and then a
 * second follows it), a bright head with a glow and a long tapering tail. Nothing is scheduled
 * while motion is Gentle or Off, or while the window is hidden.
 */
export function Meteors() {
  const [meteors, setMeteors] = useState<Meteor[]>([])
  useEffect(() => {
    let timer = 0
    let id = 0
    const launch = (): void => {
      if (!document.hidden && !stillMotion()) {
        const rand = Math.random
        const toLeft = rand() < 0.3
        const one = (): Meteor => ({
          id: ++id,
          x: toLeft ? 35 + rand() * 60 : 2 + rand() * 60,
          y: 2 + rand() * 30,
          angle: (toLeft ? 180 - (14 + rand() * 22) : 14 + rand() * 22),
          length: 140 + rand() * 160,
          travel: 30 + rand() * 30,
          duration: 1.1 + rand() * 0.9
        })
        const first = one()
        setMeteors((list) => [...list, first])
        if (rand() < 0.2) setTimeout(() => setMeteors((list) => [...list, { ...one(), x: first.x + 4, y: first.y + 3, angle: first.angle, length: first.length * 0.6 }]), 350)
      }
      timer = window.setTimeout(launch, 7000 + Math.random() * 14000)
    }
    timer = window.setTimeout(launch, 2500 + Math.random() * 3000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <>
      {meteors.map((m) => (
        <span
          key={m.id}
          className="meteor"
          style={{ left: `${m.x}%`, top: `${m.y}%`, rotate: `${m.angle}deg`, '--travel': `${m.travel}vw`, '--len': `${m.length}px`, animationDuration: `${m.duration}s` } as React.CSSProperties}
          onAnimationEnd={() => setMeteors((list) => list.filter((x) => x.id !== m.id))}
        >
          <span className="meteor-tail" />
          <span className="meteor-head" />
        </span>
      ))}
    </>
  )
}
