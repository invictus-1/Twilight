import { useEffect, useRef, useState } from 'react'
import { clockTime, seasonFor } from '@shared/sky'
import { useExtras, type SkyTime } from '../extras'
import balloon from '../assets/sky/balloon.webp'
import lighthouse from '../assets/sky/lighthouse.webp'
import platypus from '../assets/sky/platypus.webp'
import platypusRun from '../assets/sky/platypus-run.webp'
import platypusTrot from '../assets/sky/platypus-trot.webp'
import ufo from '../assets/sky/ufo.webp'
import whale from '../assets/sky/whale.webp'

// When this session began, for the sky that drifts toward night over a long one.
const sessionStart = Date.now()

/** The sky's time of day, kept current while it's on screen (checked once a minute). */
function useSkyTime(): Exclude<SkyTime, 'clock'> {
  const { sky } = useExtras()
  const [now, setNow] = useState(() => clockTime())
  useEffect(() => {
    if (sky !== 'clock') return
    const timer = setInterval(() => setNow(clockTime()), 60_000)
    return () => clearInterval(timer)
  }, [sky])
  return sky === 'clock' ? now : sky
}

// The rare things that cross the sky if you sit and watch, and how long each stays. The models are
// low-poly renders from Blender, loops of a few dozen frames that load only when one appears.
const EGGS = ['ufo', 'whale', 'comet', 'balloon', 'lighthouse', 'satellite', 'lantern'] as const
type Egg = (typeof EGGS)[number] | 'platypus' | 'platypus-trot'
const ART: Partial<Record<Egg, string>> = { ufo, whale, balloon, lighthouse, platypus, 'platypus-trot': platypusTrot }
const STAYS: Record<Egg, number> = { ufo: 14_000, whale: 20_000, comet: 6_000, balloon: 16_000, lighthouse: 15_000, satellite: 14_000, lantern: 14_000, platypus: 4_200, 'platypus-trot': 18_000 }
// Phosphor's visitor takes turns: a peek over the horizon, then a stroll along it.
const PLATYPUS: Egg[] = ['platypus', 'platypus-trot']
// Test runs (opened at #e2e) don't sit for 45 seconds.
const QUIET = location.hash === '#e2e' ? 1_200 : 45_000

/**
 * After a while with no keys or pointer, one of them crosses once; then it waits for the next quiet
 * spell. Moving clears the sky, except for Phosphor's own visitor: a small platypus that peeks over
 * the horizon now and then, and ducks out of sight the moment you move.
 */
function useEasterEgg(watching: boolean): { name: Egg; ducking: boolean } | null {
  const [egg, setEgg] = useState<{ name: Egg; ducking: boolean } | null>(null)
  // `ducking` is the platypus spotted: the peeking one drops out of sight, the strolling one bolts.
  useEffect(() => {
    if (!watching) return
    let quiet: ReturnType<typeof setTimeout>
    let shown = 0
    let current: Egg | null = null
    const show = (name: Egg | null, ducking = false): void => {
      current = name
      setEgg(name ? { name, ducking } : null)
    }
    const wait = (): void => {
      clearTimeout(quiet)
      quiet = setTimeout(() => {
        // In Phosphor, every other visitor is the platypus.
        const phosphor = document.documentElement.dataset.theme === 'phosphor'
        const name: Egg = phosphor && shown % 2 === 0 ? PLATYPUS[(shown / 2) % 2] : EGGS[Math.floor(shown / (phosphor ? 2 : 1)) % EGGS.length]
        shown++
        show(name)
        quiet = setTimeout(() => (show(null), wait()), STAYS[name])
      }, QUIET)
    }
    const stir = (): void => {
      if (current === 'platypus' || current === 'platypus-trot') {
        // Spotted: down it goes, quick, or off at a sprint; then it's gone.
        clearTimeout(quiet)
        show(current, true)
        quiet = setTimeout(() => (show(null), wait()), current === 'platypus' ? 260 : 2_200)
        return
      }
      if (current) show(null)
      wait()
    }
    wait()
    window.addEventListener('pointermove', stir, { passive: true })
    window.addEventListener('keydown', stir)
    return () => {
      clearTimeout(quiet)
      window.removeEventListener('pointermove', stir)
      window.removeEventListener('keydown', stir)
    }
  }, [watching])
  return egg
}

/** One visitor in the sky. The strolling platypus, when spotted, bolts: its walk sped up ninefold from wherever it is. */
function SkyEgg({ name, spotted }: { name: Egg; spotted: boolean }) {
  const el = useRef<HTMLSpanElement>(null)
  const bolting = spotted && name === 'platypus-trot'
  useEffect(() => {
    if (bolting) el.current?.getAnimations().forEach((a) => (a.playbackRate = 9))
  }, [bolting])
  const art = bolting ? platypusRun : ART[name]
  return (
    <span ref={el} className={`sky-egg sky-egg-${name} ${spotted ? 'is-ducking' : ''}`}>
      {name === 'lighthouse' && <span className="sky-sweep" />}
      {art && <img src={art} alt="" draggable={false} />}
    </span>
  )
}

/**
 * The sky behind an empty chat and above every chat, drawn retro: a deep field of stars and a band
 * of the galaxy, a striped sun on the horizon and a glowing grid running toward you. It follows
 * the clock (dawn, day, dusk, night) unless held at one time in Extras. The field is one static
 * SVG, so it costs a single paint; the few things that move are transforms and stop under Gentle
 * and Off motion. `watch` is the empty chat, where surprises may cross if you sit and look;
 * `session` is the top of a chat, which darkens toward night over a long session.
 */
export function EmptySky({ watch = false, session = false }: { watch?: boolean; session?: boolean }) {
  const extras = useExtras()
  const time = useSkyTime()
  const egg = useEasterEgg(watch && extras.easterEggs)
  const season = extras.seasons ? seasonFor() : null
  // Up to most of the way to night over three hours.
  const late = session && extras.sessionSky ? Math.min(0.75, (Date.now() - sessionStart) / (3 * 60 * 60 * 1000)) : 0
  return (
    <div className="empty-sky is-retro" data-sky={time} aria-hidden="true" style={late ? ({ '--session-night': late.toFixed(2) } as React.CSSProperties) : undefined}>
      <span className="empty-galaxy" />
      <svg className="empty-field" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        {FIELD.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} className={`empty-dot empty-dot-${s.tone}`} opacity={s.o} />
        ))}
      </svg>
      {STARS.map((s, i) => (
        <span key={i} className={`empty-star ${s.big ? 'is-big' : ''}`} style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
      ))}
      <span className="empty-shooting" />
      {season && (
        <div className={`sky-season sky-${season}`}>
          {SEASON.map((p, i) => (
            <span key={i} style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, animationDuration: `${p.t}s` }} />
          ))}
        </div>
      )}
      {egg && <SkyEgg name={egg.name} spotted={egg.ducking} />}
      <span className="empty-sun" />
      <span className="empty-horizon" />
      <div className="empty-floor">
        <div className="empty-plane">
          <span className="empty-grid" />
        </div>
      </div>
      {late > 0 && <span className="sky-late" />}
    </div>
  )
}

// Fixed, scattered places, the same every time: a small seeded generator, so the sky never shifts
// between visits and nothing random runs at render.
function seeded(seed: number): () => number {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
const rand = seeded(1987)
// Thinner toward the horizon (y 0–600 is the sky above it), as a real sky looks through more air.
const FIELD = Array.from({ length: 220 }, () => {
  const y = Math.pow(rand(), 1.4) * 560
  const size = rand()
  return {
    x: Math.round(rand() * 1000 * 10) / 10,
    y: Math.round(y * 10) / 10,
    r: size > 0.97 ? 1.6 : size > 0.85 ? 1.1 : 0.6,
    o: Math.round((0.25 + rand() * 0.6) * (1 - y / 900) * 100) / 100,
    tone: rand() > 0.88 ? (rand() > 0.5 ? 'iris' : 'horizon') : 'ink'
  }
})
const STARS = Array.from({ length: 16 }, (_, i) => ({ x: (i * 37.7 + 6) % 100, y: (i * 23.3 + 4) % 50, d: (i % 8) * 0.55, big: i % 5 === 0 }))
// A dozen pieces of the season: where each starts across the sky, its delay and how long it takes.
const SEASON = Array.from({ length: 12 }, () => ({ x: Math.round(rand() * 96 + 2), d: Math.round(rand() * 120) / 10, t: Math.round(90 + rand() * 80) / 10 }))

