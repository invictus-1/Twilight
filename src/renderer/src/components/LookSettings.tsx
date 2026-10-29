import { useState } from 'react'
import { contrast, customTokens, DEFAULT_CUSTOM, loadCustom, saveCustom, type CustomTheme } from '../customTheme'
import { setTheme } from '../theme'
import { GRADIENTS, backdropImage, setBackdrop, setMotion, useBackdrop, useMotion, type Motion } from '../look'
import { useStore } from '../store'

/** None, a built-in gradient, or your own picture; then how dark and soft it sits behind the text. */
export function BackgroundPicker() {
  const b = useBackdrop()
  const [busy, setBusy] = useState(false)
  const choose = async (): Promise<void> => {
    setBusy(true)
    try {
      const version = await window.twilight.chooseBackground()
      if (version) setBackdrop({ kind: 'image', image: version })
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="look-block">
      <span className="field-label">Background</span>
      <div className="bg-picker" role="group" aria-label="Background">
        <button className="bg-option bg-none" aria-pressed={b.kind === 'none'} onClick={() => setBackdrop({ kind: 'none' })}>
          <span className="bg-swatch" />
          <small>Theme</small>
        </button>
        {GRADIENTS.map((g) => (
          <button key={g.id} className="bg-option" data-gradient={g.id} aria-pressed={b.kind === 'gradient' && b.gradient === g.id} onClick={() => setBackdrop({ kind: 'gradient', gradient: g.id })}>
            <span className="bg-swatch" style={{ backgroundImage: g.css }} />
            <small>{g.name}</small>
          </button>
        ))}
        <button className="bg-option bg-image" aria-pressed={b.kind === 'image'} disabled={busy} onClick={() => (b.image && b.kind !== 'image' ? setBackdrop({ kind: 'image' }) : void choose())}>
          <span className="bg-swatch" style={b.image ? { backgroundImage: backdropImage({ ...b, kind: 'image' }) ?? undefined } : undefined}>
            {!b.image && '+'}
          </span>
          <small>{b.image ? 'Your picture' : 'Your own…'}</small>
        </button>
      </div>
      {b.kind !== 'none' && (
        <div className="bg-controls">
          <label className="bg-slider">
            <span>Darken</span>
            <input type="range" min={0} max={90} step={5} value={b.dim} onChange={(e) => setBackdrop({ dim: Number(e.target.value) })} />
            <span className="bg-value">{b.dim}%</span>
          </label>
          <label className="bg-slider">
            <span>Blur</span>
            <input type="range" min={0} max={24} step={2} value={b.blur} onChange={(e) => setBackdrop({ blur: Number(e.target.value) })} />
            <span className="bg-value">{b.blur}px</span>
          </label>
          {b.kind === 'image' && (
            <span className="bg-image-actions">
              <button className="tw-btn tw-btn-sm" disabled={busy} onClick={() => void choose()}>
                Choose another
              </button>
              <button
                className="tw-btn tw-btn-ghost tw-btn-sm"
                onClick={() => {
                  void window.twilight.clearBackground()
                  setBackdrop({ kind: 'none', image: null })
                }}
              >
                Remove the picture
              </button>
            </span>
          )}
        </div>
      )}
      <p className="field-note">Shown behind the whole window. Darken it until text reads comfortably; your picture stays on this PC, copied into Twilight's data folder.</p>
    </div>
  )
}

const MOTIONS: { id: Motion; label: string; note: string }[] = [
  { id: 'full', label: 'Full', note: 'Pages fade in, messages ease in, the evening glows at startup.' },
  { id: 'reduced', label: 'Gentle', note: 'Fades only; nothing slides or moves.' },
  { id: 'off', label: 'Off', note: 'Everything appears at once.' }
]

/** How much moves. Windows' own "reduce motion" setting also tones things down. */
export function MotionPicker() {
  const motion = useMotion()
  return (
    <div className="look-block">
      <span className="field-label">Motion</span>
      <div className="tw-seg motion-seg" role="radiogroup" aria-label="Motion">
        {MOTIONS.map((m) => (
          <button key={m.id} role="radio" aria-checked={motion === m.id} aria-pressed={motion === m.id} onClick={() => setMotion(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="field-note">{MOTIONS.find((m) => m.id === motion)?.note}</p>
    </div>
  )
}

const FIELDS: { key: keyof CustomTheme; label: string; note: string }[] = [
  { key: 'ground', label: 'Ground', note: 'The darkest colour, behind everything' },
  { key: 'actions', label: 'Actions', note: 'Buttons, selection, links' },
  { key: 'tools', label: 'Tools', note: 'AI pages, highlights, code keywords' },
  { key: 'writing', label: 'Writing', note: 'Warm accents, the sun, pane B' }
]

/** Your own theme: four colours in, a full readable palette out (see customTheme.ts). */
export function ThemeBuilder() {
  const [theme, setThemeState] = useState(loadCustom)
  const tokens = customTokens(theme)
  const shown: Record<keyof CustomTheme, string> = { ground: tokens['--night'], actions: tokens['--iris'], tools: tokens['--dusk'], writing: tokens['--horizon'] }
  const change = (patch: Partial<CustomTheme>): void => {
    const next = { ...theme, ...patch }
    saveCustom(next)
    setThemeState(next)
    setTheme('custom')
  }
  // Only a change you'd notice counts as adjusted, not rounding.
  const adjusted = FIELDS.filter((f) => contrast(shown[f.key], theme[f.key]) > 1.15)
  return (
    <div className="look-block theme-builder">
      <span className="field-label">Your own theme</span>
      <div className="builder-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className="builder-field" data-field={f.key}>
            <input type="color" value={theme[f.key]} onChange={(e) => change({ [f.key]: e.target.value })} aria-label={f.label} />
            <span>
              <b>{f.label}</b>
              <small>{f.note}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="builder-preview" aria-hidden="true" style={{ background: tokens['--surface'], color: tokens['--ink'], borderColor: tokens['--line'] }}>
        <span style={{ color: tokens['--ink-muted'] }}>Preview</span>
        <b>A quiet place to write.</b>
        <span className="builder-chips">
          <span style={{ background: tokens['--iris'], color: tokens['--on-iris'] }}>Send</span>
          <span style={{ background: tokens['--dusk-soft'], color: tokens['--dusk'] }}>Insights</span>
          <span style={{ background: tokens['--horizon-soft'], color: tokens['--horizon'] }}>Pane B</span>
        </span>
        <small style={{ color: tokens['--ink-faint'] }}>Text contrast {contrast(tokens['--ink'], tokens['--surface']).toFixed(1)}:1</small>
      </div>
      <p className="field-note">
        {adjusted.length
          ? `Adjusted to stay readable: ${adjusted.map((f) => f.label.toLowerCase()).join(', ')}. Every colour keeps text at 4.5:1 or better.`
          : 'Every colour keeps text at 4.5:1 or better; ones that would not are lightened (or, for the ground, darkened) automatically.'}
      </p>
      <button className="tw-btn tw-btn-ghost tw-btn-sm builder-reset" onClick={() => change(DEFAULT_CUSTOM)}>
        Start from Twilight's colours
      </button>
    </div>
  )
}
