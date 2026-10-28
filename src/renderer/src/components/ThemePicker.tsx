import { THEMES, type Theme } from '@shared/themes'

/** Every theme as a swatch card; used in Settings and in the welcome. */
export function ThemePicker({ value, onPick, className = '' }: { value: Theme; onPick: (theme: Theme) => void; className?: string }) {
  return (
    <div className={`theme-picker ${className}`} role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} className="theme-option" data-theme-id={t.id} aria-pressed={value === t.id} onClick={() => onPick(t.id)}>
          <span className="theme-swatch" style={{ background: t.swatch }}>
            {t.dots.map((d) => (
              <span key={d} style={{ background: d }} />
            ))}
          </span>
          <b>{t.name}</b>
          <small>{t.note}</small>
        </button>
      ))}
    </div>
  )
}
