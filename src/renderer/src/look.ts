import { useSyncExternalStore } from 'react'

// Background and motion: how the window looks around your work. Both are per install (like the
// theme), kept in local storage; the background picture itself lives in Twilight's data folder.

export interface Backdrop {
  kind: 'none' | 'gradient' | 'image'
  gradient: string
  /** Your picture's version stamp, so a new one reloads (see main/background.ts). */
  image: string | null
  /** How much the night darkens it, 0–90 (%), so text stays easy to read. */
  dim: number
  /** Blur in pixels, 0–24. */
  blur: number
  /** Your picture's framing: the point kept in view (0–100 % across and down) and the zoom (100–300 %). */
  posX: number
  posY: number
  zoom: number
}

export type Motion = 'full' | 'reduced' | 'off'

/** A repeatable scatter (the same stars every time), from a small seeded generator. */
function scatter(seed: number, count: number, make: (r: () => number) => string): string {
  let s = seed
  const r = (): number => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
  return Array.from({ length: count }, () => make(r)).join('')
}

const svg = (body: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 1000' preserveAspectRatio='xMidYMid slice'>${body}</svg>`)}")`

/** Nearly three hundred stars of every size and warmth, a few with a halo, and a faint band of sky light. */
const STARS = svg(
  `<defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='70'/></filter><filter id='h'><feGaussianBlur stdDeviation='2.2'/></filter></defs>` +
    `<ellipse cx='800' cy='470' rx='900' ry='120' fill='#9aa2ee' opacity='.3' transform='rotate(-18 800 470)' filter='url(#b)'/>` +
    scatter(7, 280, (r) => {
      const big = r() > 0.93
      const tint = ['#ffffff', '#dfe6ff', '#fff1d6', '#e6dcff'][Math.floor(r() * 4)]
      return `<circle cx='${(r() * 1600).toFixed(1)}' cy='${(r() * 1000).toFixed(1)}' r='${(big ? 2.4 + r() * 1.6 : 0.9 + r() * 1.5).toFixed(2)}' fill='${tint}' opacity='${(0.5 + r() * 0.5).toFixed(2)}'${big ? " filter='url(#h)'" : ''}/>`
    })
)

/** Sparks drifting up from a fire below the window. */
const SPARKS = svg(
  `<defs><filter id='g'><feGaussianBlur stdDeviation='1.6'/></filter></defs>` +
    scatter(13, 120, (r) => {
      const y = 380 + r() * 620
      const c = ['#ffb347', '#ff7a2f', '#ffd27a', '#ff5a1f'][Math.floor(r() * 4)]
      return `<circle cx='${(r() * 1600).toFixed(1)}' cy='${y.toFixed(1)}' r='${(1.4 + r() * 3).toFixed(2)}' fill='${c}' opacity='${(0.35 + (y / 1000) * 0.65 * r()).toFixed(2)}' filter='url(#g)'/>`
    })
)

// Each is a background-image list, so a flat colour has to be written as a gradient too (a bare
// colour makes the browser drop the whole list).
export const GRADIENTS: { id: string; name: string; css: string }[] = [
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(180deg, #0b0d1c 0%, #1c1f4a 45%, #4a2550 78%, #8a3f5a 100%)' },
  { id: 'aurora', name: 'Aurora', css: 'radial-gradient(90% 60% at 20% 10%, #1f6f5c 0%, transparent 60%), radial-gradient(70% 50% at 80% 30%, #3a2a7a 0%, transparent 60%), linear-gradient(180deg, #050a12, #0b1424)' },
  {
    id: 'nebula',
    name: 'Nebula',
    css: `${STARS}, radial-gradient(42% 38% at 68% 32%, #d24bb8 0%, #8a2a9acc 30%, transparent 70%), radial-gradient(38% 34% at 28% 66%, #5a5af0 0%, #2e2e9acc 35%, transparent 72%), radial-gradient(26% 22% at 50% 48%, #ff8ad8aa 0%, transparent 70%), linear-gradient(#07050f, #07050f)`
  },
  {
    id: 'embers',
    name: 'Embers',
    css: `${SPARKS}, radial-gradient(95% 60% at 50% 112%, #ff6a24 0%, #c8401a 22%, #6a1a0c 45%, transparent 70%), radial-gradient(45% 32% at 85% 12%, #5a1a12 0%, transparent 70%), linear-gradient(#0a0505, #0a0505)`
  },
  { id: 'deep-sea', name: 'Deep sea', css: 'radial-gradient(90% 70% at 50% 0%, #10405a 0%, transparent 65%), linear-gradient(180deg, #04121c, #020609)' },
  { id: 'starfield', name: 'Starfield', css: `${STARS}, radial-gradient(120% 70% at 50% 115%, #2a3070 0%, #10143a 40%, #05060f 75%)` }
]

const DEFAULT: Backdrop = { kind: 'none', gradient: 'dusk', image: null, dim: 55, blur: 0, posX: 50, posY: 50, zoom: 100 }

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

let backdrop: Backdrop = read('twilight.backdrop', DEFAULT)
let motion: Motion = (() => {
  try {
    const m = localStorage.getItem('twilight.motion')
    return m === 'reduced' || m === 'off' ? m : 'full'
  } catch {
    return 'full'
  }
})()
const listeners = new Set<() => void>()
const changed = (): void => listeners.forEach((l) => l())
const subscribe = (cb: () => void): (() => void) => (listeners.add(cb), () => listeners.delete(cb))

export function setBackdrop(patch: Partial<Backdrop>): void {
  backdrop = { ...backdrop, ...patch }
  try {
    localStorage.setItem('twilight.backdrop', JSON.stringify(backdrop))
  } catch {
    // Storage unavailable: the background holds for this session.
  }
  changed()
}

export const useBackdrop = (): Backdrop => useSyncExternalStore(subscribe, () => backdrop)

/** The CSS background for the current choice, or null for none. */
export function backdropImage(b: Backdrop): string | null {
  if (b.kind === 'gradient') return GRADIENTS.find((g) => g.id === b.gradient)?.css ?? GRADIENTS[0].css
  if (b.kind === 'image' && b.image) return `url("twilight-bg://image/?v=${encodeURIComponent(b.image)}")`
  return null
}

/** Where and how big your picture sits: CSS for the background layer (nothing for gradients). */
export function framing(b: Backdrop): { backgroundPosition?: string; transform?: string; transformOrigin?: string } {
  if (b.kind !== 'image') return {}
  const at = `${b.posX}% ${b.posY}%`
  return { backgroundPosition: at, transform: b.zoom > 100 ? `scale(${b.zoom / 100})` : undefined, transformOrigin: at }
}

/** Applies the motion setting to the page (read before the first paint, like the theme). */
export function applyMotion(m: Motion = motion): void {
  if (m === 'full') delete document.documentElement.dataset.motion
  else document.documentElement.dataset.motion = m
}

export function setMotion(m: Motion): void {
  motion = m
  try {
    localStorage.setItem('twilight.motion', m)
  } catch {
    // Storage unavailable: the setting holds for this session.
  }
  applyMotion(m)
  changed()
}

export const useMotion = (): Motion => useSyncExternalStore(subscribe, () => motion)
