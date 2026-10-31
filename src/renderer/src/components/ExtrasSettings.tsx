import { setExtras, useExtras, type Extras, type Horizon, type SkyTime } from '../extras'
import { ScrollFxPicker } from './LookSettings'

const SKY_TIMES: { id: SkyTime; label: string }[] = [
  { id: 'clock', label: 'Follow the clock' },
  { id: 'dawn', label: 'Dawn' },
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' }
]

const HORIZONS: { id: Horizon; label: string; note: string }[] = [
  { id: 'grid', label: 'Grid', note: 'A neon grid running toward you, the way it started.' },
  { id: 'ocean', label: 'Ocean', note: "A dark sea with the sun's reflection on slow swells, and a lighthouse sweeping its beam." },
  { id: 'mountains', label: 'Mountains', note: 'Low-poly ridges fading into mist toward the horizon.' },
  { id: 'city', label: 'City', note: 'A skyline at dusk, with windows lighting up here and there.' },
  { id: 'dunes', label: 'Dunes', note: 'Desert dunes catching the last light on their crests.' },
  { id: 'cyberpunk', label: 'Cyberpunk', note: 'A pixel-art city of neon and billboards, flying cars weaving through it, all mirrored in the wet street.' }
]

/** One switch with a line on exactly what it does. */
function Switch({ name, label, note }: { name: keyof Extras; label: string; note: string }) {
  const extras = useExtras()
  return (
    <div className="extras-switch">
      <label className="check">
        <input type="checkbox" checked={extras[name] as boolean} onChange={(e) => setExtras({ [name]: e.target.checked })} />
        {label}
      </label>
      <p className="field-note">{note}</p>
    </div>
  )
}

/** Settings → Extras: the sky, small motions, celebrations and comforts, each its own switch. */
export function ExtrasSettings() {
  const { sky, horizon } = useExtras()
  return (
    <>
      <div className="settings-card">
        <h3 className="t-heading">The sky</h3>
        <p className="field-note">The sky behind an empty chat and above every chat.</p>
        <div className="tw-seg" role="radiogroup" aria-label="Time of day in the sky">
          {SKY_TIMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={sky === t.id} aria-pressed={sky === t.id} onClick={() => setExtras({ sky: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="field-note">
          {sky === 'clock' ? 'Dawn, day, dusk and night as the hours pass, with a moon after dark.' : 'Held at this time of day, whatever the clock says.'}
        </p>
        <span className="field-label extras-horizon-label">Under the sky</span>
        <div className="tw-seg extras-horizon" role="radiogroup" aria-label="What stands under the sky">
          {HORIZONS.map((h) => (
            <button key={h.id} role="radio" data-horizon={h.id} aria-checked={horizon === h.id} aria-pressed={horizon === h.id} onClick={() => setExtras({ horizon: h.id })}>
              {h.label}
            </button>
          ))}
        </div>
        <p className="field-note">{HORIZONS.find((h) => h.id === horizon)?.note}</p>
        <Switch name="sessionSky" label="Night falls on a long session" note="The sky at the top of a chat slowly darkens over a few hours of writing. You'd only notice if you scroll up." />
        <Switch name="seasons" label="Seasons" note="Snow in winter, petals in spring, fireflies in summer, leaves in autumn, and a few special nights of the year." />
        <Switch name="easterEggs" label="Surprises" note="Sit and watch an empty chat for a while, and every so often something crosses the sky." />
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Motion</h3>
        <Switch name="glidingRail" label="The rail's highlight glides" note="The mark beside the section you're in slides to the one you pick." />
        <Switch name="touches" label="Small touches" note="Your message lifts into place when you send it, versions slide in from the side you went, and a choice card's options fan in." />
        <Switch name="presses" label="Buttons and menus" note="Buttons give a little under a click, and menus and panels rise into place." />
        <Switch name="moon" label="A moon for the spinner" note="While something works, a small moon goes round instead of the plain spinner." />
        <Switch name="sunProgress" label="A sun rises while a reply streams" note="A small sun rises over a horizon line under a reply as it comes in." />
        <Switch name="themeWipe" label="Sweep in a new theme" note="Changing the theme sweeps the new colours down the window." />
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Celebrations</h3>
        <Switch name="constellations" label="Constellations for achievements" note="An achievement's notice draws its own small constellation." />
        <Switch name="writingGlow" label="A glow for a good day's writing" note="A warm light rises from the bottom of the window when the day's words pass 250, 500, 1,000 and on." />
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Comfort</h3>
        <Switch
          name="warmNight"
          label="Warmer light late at night"
          note="Between midnight and 5 am, Twilight's colours warm slightly, like a reading lamp, to be easier on your eyes. It changes nothing else."
        />
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Scroll particles</h3>
        <ScrollFxPicker />
      </div>
      <p className="field-note">Motion set to Gentle or Off in Appearance stills all of these.</p>
    </>
  )
}
