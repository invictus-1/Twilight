import { useState } from 'react'
import { contrast, customTokens, DEFAULT_CUSTOM, loadCustom, saveCustom, type CustomTheme } from '../customTheme'
import { setTheme } from '../theme'
import { GRADIENTS, backdropImage, framing, setBackdrop, setChatText, setEmphasis, setMotion, setScrollFx, useBackdrop, useChatText, useEmphasis, useMotion, useScrollFx, type Backdrop, type ChatText, type Emphasis, type Motion, type ScrollFxStyle } from '../look'
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
          {b.kind === 'image' && <Framing b={b} />}
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

/**
 * Which part of your picture shows: drag the preview to move it, and zoom in to crop tighter.
 * The preview has the window's own shape, so what it shows is what the window shows.
 */
function Framing({ b }: { b: Backdrop }) {
  const [drag, setDrag] = useState<{ x: number; y: number; posX: number; posY: number } | null>(null)
  const clamp = (v: number): number => Math.round(Math.min(100, Math.max(0, v)))
  return (
    <div className="bg-framing">
      <div
        className={`bg-frame ${drag ? 'dragging' : ''}`}
        style={{ aspectRatio: `${window.innerWidth} / ${window.innerHeight}` }}
        title="Drag to choose which part shows"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // A pointer that's already gone can't be captured; the drag still works while it's over the frame.
          }
          setDrag({ x: e.clientX, y: e.clientY, posX: b.posX, posY: b.posY })
        }}
        onPointerMove={(e) => {
          if (!drag) return
          const box = e.currentTarget.getBoundingClientRect()
          // Dragging the picture right shows more of its left side, so the point moves the other way.
          const speed = 100 / (b.zoom / 100)
          setBackdrop({ posX: clamp(drag.posX - ((e.clientX - drag.x) / box.width) * speed), posY: clamp(drag.posY - ((e.clientY - drag.y) / box.height) * speed) })
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="bg-frame-image" style={{ backgroundImage: backdropImage(b) ?? undefined, ...framing(b) }} />
      </div>
      <div className="bg-frame-controls">
        <label className="bg-slider">
          <span>Zoom</span>
          <input type="range" min={100} max={300} step={5} value={b.zoom} onChange={(e) => setBackdrop({ zoom: Number(e.target.value) })} />
          <span className="bg-value">{b.zoom}%</span>
        </label>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" disabled={b.posX === 50 && b.posY === 50 && b.zoom === 100} onClick={() => setBackdrop({ posX: 50, posY: 50, zoom: 100 })}>
          Centre it again
        </button>
        <span className="field-note">Drag the picture to choose which part shows.</span>
      </div>
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

const CHAT_TEXTS: { id: ChatText; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' }
]

// The theme's own colour for each, as the page draws it.
const THEME_TINT: Record<Emphasis, string> = {
  bold: 'color-mix(in srgb, var(--horizon) 72%, var(--ink))',
  italic: 'color-mix(in srgb, var(--dusk) 70%, var(--ink))'
}

/** The theme's colour for bold or italic words as #rrggbb, so the colour picker starts from what you see. */
function themeTint(kind: Emphasis): string {
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;color:${THEME_TINT[kind]}`
  document.body.appendChild(probe)
  // A mixed colour reads back as color(srgb 0.8 0.6 0.4); a plain one as rgb(204, 153, 102).
  const color = getComputedStyle(probe).color
  const scale = color.startsWith('color(') ? 255 : 1
  const rgb = color.match(/\d*\.?\d+/g)?.slice(0, 3).map((n) => Math.min(255, Math.round(Number(n) * scale))) ?? [200, 160, 120]
  probe.remove()
  return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** A switch for coloured bold or italic words, with a swatch to pick any colour and the way back to the theme's. */
function EmphasisRow({ kind, label }: { kind: Emphasis; label: string }) {
  const { on, tint } = useEmphasis(kind)
  return (
    <div className={`emphasis-row ${kind}-color-row`}>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setEmphasis(kind, { on: e.target.checked })} />
        Colour {label} text in chats
      </label>
      {on && (
        <>
          <input
            type="color"
            className={`emphasis-tint ${kind}-tint`}
            aria-label={`Colour for ${label} text`}
            title={`Pick any colour for ${label} text`}
            value={tint ?? themeTint(kind)}
            onChange={(e) => setEmphasis(kind, { tint: e.target.value })}
          />
          {tint ? (
            <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setEmphasis(kind, { tint: null })}>
              Use the theme's
            </button>
          ) : (
            <span className="field-note">The theme's own</span>
          )}
        </>
      )}
    </div>
  )
}

/** How big the words in a chat are: replies, your messages and the message box; and the colour of bold and italic words. */
export function ChatTextPicker() {
  const size = useChatText()
  return (
    <div className="look-block">
      <span className="field-label">Chat text size</span>
      <div className="tw-seg motion-seg" role="radiogroup" aria-label="Chat text size">
        {CHAT_TEXTS.map((t) => (
          <button key={t.id} role="radio" aria-checked={size === t.id} aria-pressed={size === t.id} onClick={() => setChatText(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="field-note">The words in chats, your messages and the message box. Menus and labels stay as they are.</p>
      <EmphasisRow kind="bold" label="bold" />
      <EmphasisRow kind="italic" label="italic" />
    </div>
  )
}

const FX_STYLES: { id: ScrollFxStyle; label: string; note: string }[] = [
  { id: 'stardust', label: 'Stardust', note: 'Fine twinkling light that drifts against the scroll.' },
  { id: 'sparks', label: 'Sparks', note: 'Bright streaks thrown in from the edge the text comes from.' },
  { id: 'fireflies', label: 'Fireflies', note: 'A few soft, warm glows that wander and pulse.' },
  { id: 'snow', label: 'Snow', note: 'Flakes swept along by the scroll that settle into falling.' },
  { id: 'constellations', label: 'Constellations', note: 'Blue stars that join up into constellations as they drift.' },
  { id: 'bats', label: 'Bats', note: 'Dark bats outlined in green that flap up and swoop around.' }
]

/** Particles while you scroll a chat: a few when you go slowly, a shower when you fling. */
export function ScrollFxPicker() {
  const fx = useScrollFx()
  const motion = useMotion()
  return (
    <div className="look-block">
      <label className="check">
        <input type="checkbox" checked={fx.on} onChange={(e) => setScrollFx({ on: e.target.checked })} />
        Particles when scrolling chats
      </label>
      {fx.on && (
        <>
          <div className="tw-seg fx-seg" role="radiogroup" aria-label="Particle style">
            {FX_STYLES.map((s) => (
              <button key={s.id} role="radio" aria-checked={fx.style === s.id} aria-pressed={fx.style === s.id} onClick={() => setScrollFx({ style: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="field-note">
            {FX_STYLES.find((s) => s.id === fx.style)?.note} The faster you scroll, the more there are.
            {motion !== 'full' && ' They show only with Motion set to Full.'}
          </p>
        </>
      )}
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
