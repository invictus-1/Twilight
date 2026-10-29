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
}

export type Motion = 'full' | 'reduced' | 'off'

export const GRADIENTS: { id: string; name: string; css: string }[] = [
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(180deg, #0b0d1c 0%, #1c1f4a 45%, #4a2550 78%, #8a3f5a 100%)' },
  { id: 'aurora', name: 'Aurora', css: 'radial-gradient(90% 60% at 20% 10%, #1f6f5c 0%, transparent 60%), radial-gradient(70% 50% at 80% 30%, #3a2a7a 0%, transparent 60%), linear-gradient(180deg, #050a12, #0b1424)' },
  { id: 'nebula', name: 'Nebula', css: 'radial-gradient(60% 50% at 70% 30%, #6a1f6f 0%, transparent 65%), radial-gradient(50% 40% at 25% 70%, #2a2a8a 0%, transparent 65%), #07050f' },
  { id: 'embers', name: 'Embers', css: 'radial-gradient(80% 55% at 50% 110%, #8a2a10 0%, transparent 65%), radial-gradient(40% 30% at 80% 20%, #3a0d0d 0%, transparent 70%), #0a0505' },
  { id: 'deep-sea', name: 'Deep sea', css: 'radial-gradient(90% 70% at 50% 0%, #10405a 0%, transparent 65%), linear-gradient(180deg, #04121c, #020609)' },
  { id: 'starfield', name: 'Starfield', css: 'radial-gradient(1px 1px at 12% 18%, #fff9 50%, transparent), radial-gradient(1px 1px at 72% 34%, #fff8 50%, transparent), radial-gradient(1.5px 1.5px at 38% 62%, #fffa 50%, transparent), radial-gradient(1px 1px at 86% 76%, #fff7 50%, transparent), radial-gradient(1px 1px at 22% 88%, #fff8 50%, transparent), radial-gradient(1.5px 1.5px at 58% 12%, #fff9 50%, transparent), radial-gradient(120% 80% at 50% 120%, #1a1f4a, #05060f 70%)' }
]

const DEFAULT: Backdrop = { kind: 'none', gradient: 'dusk', image: null, dim: 55, blur: 0 }

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
