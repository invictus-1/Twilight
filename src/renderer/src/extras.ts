import { useSyncExternalStore } from 'react'

// Settings → Extras: small things that don't change how anything works. Each is a switch, kept in
// this browser's storage like the theme, and shown to CSS as data-fx-* on <html> so the styles can
// leave a switched-off one out entirely. Motion set to Gentle or Off stills all of them.

/** Where the sky's sun is: following the clock, or held at one time of day. */
export type SkyTime = 'clock' | 'dawn' | 'day' | 'dusk' | 'night'

export interface Extras {
  sky: SkyTime
  /** The top of a chat drifts toward night over a long session. */
  sessionSky: boolean
  /** Rare surprises in the sky if you sit and watch. */
  easterEggs: boolean
  /** Snow in winter, leaves in autumn, and a few special nights. */
  seasons: boolean
  /** A small sun on the horizon under a reply rises while it streams. */
  sunProgress: boolean
  /** The rail's highlight glides to the section you pick. */
  glidingRail: boolean
  /** Your message lifts into place; versions slide; choices fan in. */
  touches: boolean
  /** Buttons give a little under a click; menus rise into place. */
  presses: boolean
  /** The spinner is a small moon on its orbit. */
  moon: boolean
  /** A sweep along the horizon when the theme changes. */
  themeWipe: boolean
  /** An achievement draws its own constellation. */
  constellations: boolean
  /** A warm glow along the horizon when a day's writing passes a milestone. */
  writingGlow: boolean
  /** After midnight, the screen warms slightly, like a reading lamp. */
  warmNight: boolean
}

export const DEFAULT_EXTRAS: Extras = {
  sky: 'clock',
  sessionSky: true,
  easterEggs: false,
  seasons: false,
  sunProgress: false,
  glidingRail: true,
  touches: true,
  presses: true,
  moon: true,
  themeWipe: false,
  constellations: true,
  writingGlow: true,
  warmNight: false
}

const KEY = 'twilight.extras'
let extras: Extras = (() => {
  try {
    return { ...DEFAULT_EXTRAS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Extras>) }
  } catch {
    return DEFAULT_EXTRAS
  }
})()
const listeners = new Set<() => void>()
const subscribe = (cb: () => void): (() => void) => (listeners.add(cb), () => listeners.delete(cb))

/** Shows the switches to CSS: data-fx-<name> for each one that's on (read before the first paint). */
export function applyExtras(e: Extras = extras): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(e)) {
    const attr = `fx${key[0].toUpperCase()}${key.slice(1)}`
    if (typeof value === 'boolean') {
      if (value) root.dataset[attr] = ''
      else delete root.dataset[attr]
    }
  }
}

/** After midnight and before five, the warm light (when it's on) has its hours; checked each minute. */
function lateHours(): void {
  const h = new Date().getHours()
  if (h < 5) document.documentElement.dataset.lateHours = ''
  else delete document.documentElement.dataset.lateHours
}
lateHours()
setInterval(lateHours, 60_000)

export function setExtras(patch: Partial<Extras>): void {
  extras = { ...extras, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(extras))
  } catch {
    // Storage unavailable: the setting holds for this session.
  }
  applyExtras()
  listeners.forEach((l) => l())
}

export const useExtras = (): Extras => useSyncExternalStore(subscribe, () => extras)
export const readExtras = (): Extras => extras
