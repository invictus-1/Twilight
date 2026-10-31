import { useSyncExternalStore } from 'react'
import type { Weather } from '@shared/sky'

// Temporary, for trying things out before a release: a dev panel (Ctrl+Alt+D) that plays any
// visitor's act at once and sets the weather. Remove this file, DevSkyPanel and their two uses in
// Sky.tsx and App.tsx once the acts and weather have been tried.

interface DevSky {
  /** A visitor to show now; `at` tells two plays of the same one apart. */
  egg: { name: string; at: number } | null
  weather: 'auto' | Weather
  open: boolean
}

let state: DevSky = { egg: null, weather: 'auto', open: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<DevSky>): void => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const devSky = {
  play: (name: string): void => set({ egg: { name, at: Date.now() } }),
  stop: (): void => set({ egg: null }),
  weather: (weather: DevSky['weather']): void => set({ weather }),
  toggle: (): void => set({ open: !state.open })
}

export const useDevSky = (): DevSky =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => state
  )
