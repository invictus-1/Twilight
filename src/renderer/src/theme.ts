import { readExtras } from './extras'
import { isTheme, type Theme as BuiltIn } from '@shared/themes'
import { injectCustom } from './customTheme'

/** A built-in theme, or "custom": your own, made in Settings → General. */
export type Theme = BuiltIn | 'custom'

const KEY = 'twilight.theme'

/** The theme chosen last; read before the first paint so the app never flashes the other one. */
export function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'custom' || isTheme(saved) ? saved : 'twilight'
  } catch {
    return 'twilight'
  }
}

/** Applies a theme to the page; returns the custom theme's tokens when that's the one. */
export function applyTheme(theme: Theme): Record<string, string> | null {
  const tokens = theme === 'custom' ? injectCustom() : null
  if (theme === 'twilight') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  return tokens
}

/** Switches theme now, remembers it, and has the window's title bar match. */
export function setTheme(theme: Theme): void {
  // With the theme wipe on (Extras) and motion at Full, the new colours sweep down the window.
  const wipe = readExtras().themeWipe && !document.documentElement.dataset.motion && 'startViewTransition' in document
  let tokens: ReturnType<typeof applyTheme> = null
  // The frame takes the theme's colours once they're in place (a wipe applies them a moment later).
  const frame = (): void => void window.twilight.setWindowTheme(theme, tokens ? { night: tokens['--night'], symbol: tokens['--ink-muted'] } : undefined)
  if (wipe) void document.startViewTransition(() => void (tokens = applyTheme(theme))).updateCallbackDone.then(frame)
  else {
    tokens = applyTheme(theme)
    frame()
  }
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Storage unavailable: the theme holds for this session.
  }
}
