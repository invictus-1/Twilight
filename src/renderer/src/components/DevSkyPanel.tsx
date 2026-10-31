import { useEffect } from 'react'
import { devSky, useDevSky } from '../devSky'
import { setExtras, useExtras, type Horizon } from '../extras'

// Temporary (see devSky.ts): Ctrl+Alt+D opens a small panel to play the sky's acts and weather
// on demand, without waiting for a quiet spell.

const SCENES: Horizon[] = ['grid', 'ocean', 'mountains', 'city', 'dunes', 'cyberpunk']
const VISITORS: [string, string][] = [
  ['ufo', 'UFO'],
  ['whale', 'Whale'],
  ['platypus-trot', 'Platypus'],
  ['pumpkin', 'Pumpkin'],
  ['platypus', 'Peeking platypus'],
  ['comet', 'Comet'],
  ['balloon', 'Balloon'],
  ['lighthouse', 'Lighthouse'],
  ['satellite', 'Satellite'],
  ['lantern', 'Lantern']
]
const WEATHER = ['auto', 'clear', 'rain', 'snow'] as const

export function DevSkyPanel() {
  const dev = useDevSky()
  const { horizon } = useExtras()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        devSky.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!dev.open) return null
  return (
    <div className="dev-sky" role="dialog" aria-label="Sky dev tools">
      <div className="dev-sky-head">
        <span>Sky dev tools</span>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={devSky.toggle}>
          Close
        </button>
      </div>
      <p className="field-note">Plays on a new chat's sky. Temporary, removed after release.</p>
      <span className="field-label">Scene</span>
      <div className="dev-sky-row">
        {SCENES.map((s) => (
          <button key={s} className={`tw-btn tw-btn-sm ${horizon === s ? '' : 'tw-btn-ghost'}`} data-scene={s} onClick={() => setExtras({ horizon: s })}>
            {s}
          </button>
        ))}
      </div>
      <span className="field-label">Visitor</span>
      <div className="dev-sky-row">
        {VISITORS.map(([id, label]) => (
          <button key={id} className="tw-btn tw-btn-ghost tw-btn-sm" data-visitor={id} onClick={() => devSky.play(id)}>
            {label}
          </button>
        ))}
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={devSky.stop}>
          Stop
        </button>
      </div>
      <span className="field-label">Weather</span>
      <div className="dev-sky-row">
        {WEATHER.map((w) => (
          <button key={w} className={`tw-btn tw-btn-sm ${dev.weather === w ? '' : 'tw-btn-ghost'}`} data-weather={w} onClick={() => devSky.weather(w)}>
            {w}
          </button>
        ))}
      </div>
    </div>
  )
}
