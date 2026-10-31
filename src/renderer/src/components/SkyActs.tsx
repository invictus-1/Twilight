import platypusRun from '../assets/sky/platypus-run.webp'
import platypusTrot from '../assets/sky/platypus-trot.webp'
import { useLayoutEffect, useRef } from 'react'
import type { Horizon } from '../extras'
import { cityRoofs } from './Horizons'
import { Pumpkin, Platypus, PlatypusNoir, Robot, Saucer, Whale } from './SkyCast'

// The visitors' acts: on the city, cyberpunk, dunes and ocean the UFO, the whale and the platypus
// each do something of their own there, and the pumpkin does something ridiculous on every scene.
// An act is a little stage play run by CSS keyframes over its length (--d); the cast is SkyCast.

type Act = { ms: number; Scene: () => React.JSX.Element }

const play = (ms: number): React.CSSProperties => ({ '--d': `${ms / 1000}s` }) as React.CSSProperties

/** A tractor beam from a saucer, its width and colour from the act. */
const Beam = ({ className = '' }: { className?: string }) => <span className={`act-beam ${className}`} />

/** Splash or dust: a burst of drops thrown up and falling back. */
function Burst({ className, count = 9 }: { className: string; count?: number }) {
  return (
    <span className={`act-burst ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ '--a': `${-80 + (i - (count - 1) / 2) * 16}deg`, '--h': `${26 + ((i * 7) % 5) * 9}px` } as React.CSSProperties} />
      ))}
    </span>
  )
}

// ——— City ———

// The city's acts play on the skyline itself: the tops of its front row of towers, measured where
// they are drawn (the drawing is scaled to the window, so they sit somewhere new on every size).

/** A roof on screen, in px within the act: its left and right edges and its height above the act's bottom. */
type Roof = { l: number; r: number; y: number }

function measureRoofs(act: HTMLElement): Roof[] {
  const svg = act.closest('.empty-sky')?.querySelector<SVGSVGElement>('svg.hz-city')
  if (!svg) return []
  const box = svg.getBoundingClientRect()
  const stage = act.getBoundingClientRect()
  const { width, top, roofs } = cityRoofs()
  // The drawing is fitted with xMidYMax slice: scaled to cover, centred across, sat on the bottom.
  const scale = Math.max(box.width / width, box.height / (160 - top))
  const left = box.left - stage.left + (box.width - width * scale) / 2
  const bottom = stage.bottom - box.bottom
  return roofs
    .map((roof) => ({ l: left + roof.x * scale, r: left + (roof.x + roof.w) * scale, y: bottom + (160 - roof.y) * scale }))
    .filter((roof) => roof.r > 0 && roof.l < stage.width)
}

/** Places a city act once the skyline is drawn (it waits for an idle moment), or on the horizon if it never is. */
function useCity(place: (act: HTMLDivElement, roofs: Roof[]) => void) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    let frame = 0
    let tries = 0
    const go = (): void => {
      const act = ref.current
      if (!act) return
      const roofs = measureRoofs(act)
      if (!roofs.length && tries++ < 40) {
        frame = requestAnimationFrame(go)
        return
      }
      place(act, roofs.length ? roofs : [{ l: -200, r: act.clientWidth + 200, y: act.clientHeight * 0.36 }])
      act.classList.add('is-placed')
    }
    go()
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

/** The roof nearest a point across the act, preferring ones at least `minWidth` wide. */
function roofNear(roofs: Roof[], x: number, minWidth = 0): Roof {
  const wide = roofs.filter((roof) => roof.r - roof.l >= minWidth)
  const pool = wide.length ? wide : roofs
  return pool.reduce((best, roof) => (Math.abs((roof.l + roof.r) / 2 - x) < Math.abs((best.l + best.r) / 2 - x) ? roof : best))
}

/** Pins an act's props to a roof through CSS variables: its centre, left edge and height. */
function pin(act: HTMLElement, roof: Roof): void {
  act.style.setProperty('--roof-x', `${(roof.l + roof.r) / 2}px`)
  act.style.setProperty('--roof-l', `${roof.l}px`)
  act.style.setProperty('--roof-y', `${roof.y}px`)
}

const RUNNER = 72

/** The platypus's route over the roofs, as keyframes: running along each, hopping the small steps,
 *  clinging to and scrambling up the tall ones, teetering then nose-diving down the long drops. */
function parkour(roofs: Roof[], width: number, ms: number): { frames: Keyframe[]; duration: number } {
  const speed = 230
  const limit = (ms / 1000) * 0.93
  const points: { t: number; x: number; y: number; rot: number; ease: string }[] = []
  let t = 0
  let x = 0
  const to = (dt: number, nx: number, y: number, rot = 0, ease = 'linear'): void => {
    t += dt
    x = nx
    points.push({ t, x: nx, y, rot, ease })
  }
  let i = Math.max(0, roofs.findIndex((roof) => roof.l > width * 0.03))
  points.push({ t: 0, x: roofs[i].l + 14, y: roofs[i].y, rot: 0, ease: 'linear' })
  x = roofs[i].l + 14
  let teetered = false
  for (; i < roofs.length && t < limit; i++) {
    const roof = roofs[i]
    const next = roofs[i + 1]
    const edge = roof.r - 10
    if (!next) {
      to((width + RUNNER - x) / speed, width + RUNNER, roof.y)
      break
    }
    const rise = next.y - roof.y
    const land = next.l + 16
    // Level enough to run straight on.
    if (Math.abs(rise) < 5 && next.l - roof.r < 8) continue
    if (edge > x) to((edge - x) / speed, edge, roof.y)
    if (rise > 30) {
      // Too tall to hop: he hits the wall, slips, scrabbles, and hauls himself over.
      to(0.3, next.l - 8, next.y - 20, -30, 'ease-out')
      to(0.18, next.l - 9, next.y - 30, -38, 'ease-in')
      to(0.22, next.l - 7, next.y - 18, -26, 'ease-out')
      to(0.2, next.l - 9, next.y - 26, -36)
      to(0.3, land, next.y, 0, 'ease-out')
    } else if (rise < -36) {
      // A long drop: a teeter on the brink the first time, then a nose-dive and a bounce.
      if (!teetered) {
        teetered = true
        to(0.16, edge + 3, roof.y, 16)
        to(0.16, edge - 2, roof.y, -12)
        to(0.16, edge + 4, roof.y, 20)
        to(0.2, edge, roof.y, 0)
      }
      to(0.22, (edge + land) / 2, roof.y + 22, -14, 'ease-out')
      to(Math.sqrt((2 * (roof.y + 22 - next.y)) / 1800), land, next.y, 34, 'ease-in')
      to(0.14, land + 10, next.y + 8, -6, 'ease-out')
      to(0.12, land + 16, next.y, 0, 'ease-in')
    } else {
      to(0.2, (edge + land) / 2, Math.max(roof.y, next.y) + 26, -12, 'ease-out')
      to(0.2, land, next.y, 10, 'ease-in')
      to(0.06, land + 4, next.y, 0)
    }
  }
  const total = Math.max(t, 0.1)
  // An easing in Web Animations shapes the stretch after its keyframe, so each one is moved back a step.
  const frames = points.map((p, k) => ({
    offset: Math.min(1, p.t / total),
    transform: `translate(${(p.x - RUNNER / 2).toFixed(1)}px, ${(-p.y).toFixed(1)}px) rotate(${p.rot}deg)`,
    easing: points[k + 1]?.ease ?? 'linear'
  }))
  return { frames, duration: total * 1000 }
}

// The city's platypus is the rendered one from the sky, running and leaping roof to roof.
function CityParkour() {
  const ref = useCity((act, roofs) => {
    const runner = act.querySelector<HTMLElement>('.act-run-x')
    const { frames, duration } = parkour(roofs, act.clientWidth, 16_000)
    runner?.animate(frames, { duration, delay: 400, fill: 'both' })
  })
  return (
    <div ref={ref} className="act act-city act-parkour" style={play(16_000)}>
      <div className="act-run-x">
        <img className="act-art" src={platypusRun} alt="" />
      </div>
    </div>
  )
}

function CityAbduction() {
  const ref = useCity((act, roofs) => pin(act, roofNear(roofs, act.clientWidth * 0.24, 50)))
  return (
    <div ref={ref} className="act act-city act-abduct" style={play(15_000)}>
      <div className="act-abduct-ufo">
        <Saucer />
        <Beam className="act-abduct-beam" />
      </div>
      {/* He strolls under the saucer, and his legs keep scrambling once the beam has him. */}
      <div className="act-abduct-victim">
        <div className="act-abduct-spin">
          <img className="act-art act-abduct-trot" src={platypusTrot} alt="" />
          <img className="act-art act-abduct-run" src={platypusRun} alt="" />
        </div>
      </div>
    </div>
  )
}

function CityBlimp() {
  return (
    <div className="act act-blimp" style={play(20_000)}>
      <div className="act-blimp-ride">
        <span className="act-banner">
          <span className="act-banner-rope" />
          <span className="act-banner-cloth">FREE HUGS</span>
        </span>
        <Whale />
      </div>
    </div>
  )
}

// A little noodle bar on a rooftop. The pumpkin floats in side on, sits at the counter with his
// back to us while he eats, then turns round, grinning, and floats off.
function CityDinner() {
  const ref = useCity((act, roofs) => pin(act, roofNear(roofs, act.clientWidth * 0.62, 70)))
  return (
    <div ref={ref} className="act act-city act-dinner" style={play(17_000)}>
      <div className="act-shop">
        <svg viewBox="0 0 130 110" aria-hidden="true">
          <defs>
            <linearGradient id="shop-glow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffd98a" />
              <stop offset="1" stopColor="#f29a4a" />
            </linearGradient>
          </defs>
          <rect x="12" y="30" width="106" height="78" fill="#2c2433" />
          <rect x="18" y="38" width="94" height="36" rx="2" fill="url(#shop-glow)" />
          {[26, 38, 50].map((x) => (
            <rect key={x} x={x} y="44" width="8" height="6" rx="1" fill="#7a4a34" />
          ))}
          <g className="act-cook">
            <circle cx="92" cy="66" r="7" fill="#3a2a2e" />
            <path d="M85 60 Q83 50 88 51 Q92 45 96 51 Q101 50 99 60 Z" fill="#fff" />
          </g>
          {Array.from({ length: 9 }, (_, i) => {
            const x = 6 + i * 13.1
            return <path key={i} d={`M${x} 22 L${x + 13.1} 22 L${x + 13.1} 31 A6.55 5 0 0 1 ${x} 31 Z`} fill={i % 2 ? '#f6efe0' : '#d2423a'} />
          })}
          <rect x="36" y="2" width="58" height="17" rx="3" fill="#1e1822" stroke="#ff8a3d" strokeWidth="1.2" />
          <text x="65" y="14.5" textAnchor="middle" className="act-shop-sign">EATS</text>
          <rect x="8" y="74" width="114" height="6" rx="1.5" fill="#d9b48a" />
          <rect x="12" y="80" width="106" height="28" fill="#8e3529" />
          {[30, 48, 66, 84, 102].map((x) => (
            <path key={x} d={`M${x} 82 L${x} 106`} stroke="#6e271e" strokeWidth="1.5" />
          ))}
          <path d="M55 68 Q64 80 73 68 Z" fill="#f4f1ea" />
          <ellipse className="act-bowl-noodles" cx="64" cy="68" rx="9" ry="2" fill="#f2c94c" />
          <path d="M66 70 L78 58 M68 71 L80 60" stroke="#c9925a" strokeWidth="1.2" />
          {[34, 64, 96].map((x) => (
            <g key={x}>
              <rect x={x - 1.5} y="80" width="3" height="26" fill="#6a6a78" />
              <ellipse cx={x} cy="106" rx="7" ry="1.8" fill="#4a4a58" />
              <ellipse cx={x} cy="80" rx="9" ry="2.6" fill="#e0b040" />
            </g>
          ))}
        </svg>
        {[0, 1, 2].map((i) => (
          <span key={i} className="act-steam act-shop-steam" style={{ animationDelay: `${i * 0.8}s` }} />
        ))}
      </div>
      <div className="act-patron">
        <div className="act-patron-turn">
          <Pumpkin view="side" className="act-pk-side" />
          <Pumpkin view="back" className="act-pk-back is-eating" />
          <Pumpkin view="front" className="act-pk-front" />
        </div>
      </div>
      <span className="act-say act-nom">nom</span>
      <span className="act-say act-burp">*burp*</span>
    </div>
  )
}

// ——— Cyberpunk ———

function CyberBrawl() {
  return (
    <div className="act act-brawl" style={play(15_000)}>
      <div className="act-brawl-hero">
        <PlatypusNoir className="is-running" band />
      </div>
      <div className="act-bot act-bot-1">
        <Robot className="is-marching" />
        <span className="act-sparks">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 45}deg` } as React.CSSProperties} />
          ))}
        </span>
      </div>
      <div className="act-bot act-bot-2">
        <Robot className="is-marching" />
      </div>
      <div className="act-bot act-bot-3">
        <Robot className="is-marching" />
      </div>
    </div>
  )
}

function CyberChase() {
  return (
    <div className="act act-chase" style={play(13_000)}>
      <div className="act-chase-ufo">
        <Saucer />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className={`act-drone act-drone-${i}`}>
          <span className="act-drone-body" />
          <span className="act-drone-siren" />
          <span className="act-drone-light" />
        </div>
      ))}
    </div>
  )
}

function CyberHolo() {
  return (
    <div className="act act-holo" style={play(18_000)}>
      <div className="act-holo-ride">
        <Whale holo />
        <span className="act-holo-trail" />
      </div>
    </div>
  )
}

function CyberNoodles() {
  return (
    <div className="act act-noodles" style={play(19_000)}>
      <div className="act-cart-train">
        <div className="act-puller">
          <Pumpkin className="is-pulling" />
        </div>
        <span className="act-handle" />
        <div className="act-cart">
          <svg viewBox="0 0 120 90" aria-hidden="true">
            <path d="M8 34 L112 34 L104 20 L16 20 Z" fill="#ff3fa4" />
            {[16, 36, 56, 76, 96].map((x) => (
              <path key={x} d={`M${x} 20 L${x + 10} 20 L${x + 9} 34 L${x - 1} 34 Z`} fill="#fff" opacity=".85" />
            ))}
            <rect x="14" y="34" width="4" height="22" fill="#4a4f6a" />
            <rect x="102" y="34" width="4" height="22" fill="#4a4f6a" />
            <rect x="8" y="56" width="104" height="22" rx="3" fill="#2c3049" />
            <rect x="16" y="60" width="88" height="10" rx="2" className="act-neon-sign" />
            <text x="60" y="68.5" textAnchor="middle" className="act-neon-text">NOODLES</text>
            <circle cx="28" cy="82" r="7" fill="#15172a" />
            <circle cx="92" cy="82" r="7" fill="#15172a" />
            <circle cx="28" cy="82" r="2.5" fill="#6a7090" />
            <circle cx="92" cy="82" r="2.5" fill="#6a7090" />
            <rect x="40" y="44" width="40" height="12" rx="3" fill="#d9dbe8" />
            <path d="M44 44 Q60 36 76 44" fill="#d9dbe8" />
          </svg>
          {[0, 1, 2].map((i) => (
            <span key={i} className="act-steam" style={{ animationDelay: `${i * 0.9}s` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ——— Dunes ———

function DuneBuggy() {
  return (
    <div className="act act-buggy" style={play(14_000)}>
      <div className="act-buggy-x">
        <div className="act-buggy-y">
          <svg className="act-buggy-car" viewBox="0 0 150 80" aria-hidden="true">
            <path d="M20 44 L44 26 L96 26 L120 40 L132 44 L132 54 L18 54 Z" fill="#e2552c" />
            <path d="M44 26 L58 10 L94 10 L104 26" fill="none" stroke="#2b2b33" strokeWidth="3.5" />
            <path d="M74 10 L74 26" stroke="#2b2b33" strokeWidth="3" />
            <rect x="120" y="44" width="16" height="6" fill="#ffd36b" />
            <g className="act-wheel"><circle cx="38" cy="58" r="15" fill="#1e1c22" /><circle cx="38" cy="58" r="5" fill="#8a8f9e" /><rect x="36" y="44" width="4" height="28" fill="#2f2c35" /></g>
            <g className="act-wheel"><circle cx="114" cy="58" r="15" fill="#1e1c22" /><circle cx="114" cy="58" r="5" fill="#8a8f9e" /><rect x="112" y="44" width="4" height="28" fill="#2f2c35" /></g>
          </svg>
          <div className="act-driver">
            <Platypus goggles />
          </div>
          <span className="act-scarf" />
        </div>
        <span className="act-dust" />
      </div>
    </div>
  )
}

function DuneCactus() {
  return (
    <div className="act act-cactus" style={play(14_000)}>
      <div className="act-cactus-ufo">
        <Saucer />
        <Beam className="act-cactus-beam" />
      </div>
      <div className="act-cactus-plant">
        <svg viewBox="0 0 60 90" aria-hidden="true">
          <path d="M24 88 L24 18 Q30 6 36 18 L36 88 Z" fill="#3f8f4f" />
          <path d="M24 52 L14 52 Q8 52 8 44 L8 30 Q12 24 16 30 L16 44 L24 44 Z" fill="#3f8f4f" />
          <path d="M36 40 L46 40 Q52 40 52 32 L52 22 Q48 16 44 22 L44 32 L36 32 Z" fill="#3f8f4f" />
          <path d="M30 20 L30 86" stroke="#2c6b3a" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  )
}

function DuneWorm() {
  return (
    <div className="act act-sandwhale" style={play(12_000)}>
      <div className="act-surface act-surface-dunes">
        <div className="act-breach">
          <Whale />
        </div>
      </div>
      <Burst className="act-sand act-sand-out" />
      <Burst className="act-sand act-sand-in" />
    </div>
  )
}

function DuneBeach() {
  return (
    <div className="act act-beach" style={play(17_000)}>
      <div className="act-beach-set">
        <svg className="act-umbrella" viewBox="0 0 120 120" aria-hidden="true">
          <path d="M60 18 L60 116" stroke="#eee6d2" strokeWidth="3" />
          <path d="M8 46 Q60 -6 112 46 Z" fill="#ff5d73" />
          {[24, 52, 80].map((x) => (
            <path key={x} d={`M60 16 L${x} 46 L${x + 14} 46 Z`} fill="#fff7e8" />
          ))}
        </svg>
        <span className="act-towel" />
        <div className="act-sunbather">
          <Pumpkin className="is-lounging" />
          <span className="act-shades" />
        </div>
        <span className="act-juice">
          <span className="act-straw" />
        </span>
      </div>
      <span className="act-say act-ahh">ahh</span>
    </div>
  )
}

// ——— Ocean ———

function OceanSurf() {
  return (
    <div className="act act-surf" style={play(14_000)}>
      <div className="act-wave-ride">
        <svg className="act-wave" viewBox="0 0 220 90" aria-hidden="true">
          <path d="M0 90 L0 70 Q60 64 110 40 Q150 18 172 30 Q190 40 178 52 Q170 44 160 50 Q140 64 220 74 L220 90 Z" className="act-wave-body" />
          <path d="M110 40 Q150 18 172 30 Q190 40 178 52" className="act-wave-foam" />
        </svg>
        <div className="act-surfer">
          <span className="act-board" />
          <Platypus className="is-surfing" />
        </div>
        <Burst className="act-spray" count={7} />
      </div>
    </div>
  )
}

function OceanFishing() {
  return (
    <div className="act act-ufish" style={play(14_000)}>
      <div className="act-ufish-ufo">
        <Saucer />
        <Beam className="act-ufish-beam" />
      </div>
      <div className="act-fish">
        <svg viewBox="0 0 60 30" aria-hidden="true">
          <path d="M6 15 Q22 0 44 10 L56 2 L52 15 L56 28 L44 20 Q22 30 6 15 Z" fill="#ff9a3c" />
          <circle cx="16" cy="13" r="2" fill="#1a1a22" />
        </svg>
      </div>
      <Burst className="act-splash act-ufish-splash" />
    </div>
  )
}

function OceanBreach() {
  return (
    <div className="act act-breach-sea" style={play(12_000)}>
      <span className="act-spout">
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} style={{ '--a': `${-90 + (i - 3) * 9}deg` } as React.CSSProperties} />
        ))}
      </span>
      <div className="act-surface act-surface-sea">
        <div className="act-breach">
          <Whale />
        </div>
      </div>
      <Burst className="act-splash act-splash-out" />
      <Burst className="act-splash act-splash-in" count={11} />
    </div>
  )
}

function OceanRowboat() {
  return (
    <div className="act act-rowboat" style={play(17_000)}>
      <div className="act-boat-bob">
        <div className="act-angler">
          <Pumpkin className="is-fishing" />
          <span className="act-rod" />
          <span className="act-line" />
          <span className="act-catch">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M8 2 L22 2 L22 24 L36 28 Q38 36 30 38 L8 38 Z" fill="#4a3426" />
              <path d="M8 30 L36 30" stroke="#2a1d15" strokeWidth="2" />
              <circle cx="15" cy="8" r="1.2" fill="#d8c4a0" />
              <circle cx="15" cy="14" r="1.2" fill="#d8c4a0" />
            </svg>
          </span>
        </div>
        <svg className="act-boat" viewBox="0 0 140 40" aria-hidden="true">
          <path d="M4 8 L136 8 Q124 36 70 38 Q16 36 4 8 Z" fill="#8a5a36" />
          <path d="M8 14 L132 14" stroke="#5e3b22" strokeWidth="2" />
        </svg>
      </div>
      <Burst className="act-splash act-boot-splash" count={7} />
      <span className="act-say act-shrug">…</span>
    </div>
  )
}

// ——— The grid and the mountains: the pumpkin's turns ———

function GridDisco() {
  return (
    <div className="act act-disco" style={play(15_000)}>
      <span className="act-ball-cord" />
      <span className="act-ball" />
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`act-spot act-spot-${i}`} />
      ))}
      <div className="act-skater">
        <Pumpkin className="is-skating" />
        <span className="act-skate act-skate-l" />
        <span className="act-skate act-skate-r" />
      </div>
    </div>
  )
}

function MountainSki() {
  return (
    <div className="act act-ski" style={play(13_000)}>
      <div className="act-ski-x">
        <div className="act-ski-y">
          <div className="act-skier">
            <Pumpkin className="is-skiing" />
            <span className="act-skis" />
            <span className="act-scarf act-scarf-ski" />
          </div>
        </div>
        <span className="act-snow" />
      </div>
    </div>
  )
}

const ACTS: Partial<Record<string, Act>> = {
  'platypus-trot:city': { ms: 16_000, Scene: CityParkour },
  'ufo:city': { ms: 15_000, Scene: CityAbduction },
  'whale:city': { ms: 20_000, Scene: CityBlimp },
  'pumpkin:city': { ms: 17_000, Scene: CityDinner },
  'platypus-trot:cyberpunk': { ms: 15_000, Scene: CyberBrawl },
  'ufo:cyberpunk': { ms: 13_000, Scene: CyberChase },
  'whale:cyberpunk': { ms: 18_000, Scene: CyberHolo },
  'pumpkin:cyberpunk': { ms: 19_000, Scene: CyberNoodles },
  'platypus-trot:dunes': { ms: 14_000, Scene: DuneBuggy },
  'ufo:dunes': { ms: 14_000, Scene: DuneCactus },
  'whale:dunes': { ms: 12_000, Scene: DuneWorm },
  'pumpkin:dunes': { ms: 17_000, Scene: DuneBeach },
  'platypus-trot:ocean': { ms: 14_000, Scene: OceanSurf },
  'ufo:ocean': { ms: 14_000, Scene: OceanFishing },
  'whale:ocean': { ms: 12_000, Scene: OceanBreach },
  'pumpkin:ocean': { ms: 17_000, Scene: OceanRowboat },
  'pumpkin:grid': { ms: 15_000, Scene: GridDisco },
  'pumpkin:mountains': { ms: 13_000, Scene: MountainSki }
}

/** The act a visitor plays on a scene, if it has one there (otherwise it simply crosses the sky). */
export const actFor = (name: string, horizon: Horizon): Act | undefined => ACTS[`${name}:${horizon}`]

/** Every act, for the test run that looks at each one. */
export const ACT_KEYS = Object.keys(ACTS)
