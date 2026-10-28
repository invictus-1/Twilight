export type Theme = 'twilight' | 'ultraviolet'

const KEY = 'twilight.theme'

/** The theme chosen last; read before the first paint so the app never flashes the other one. */
export function savedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'ultraviolet' ? 'ultraviolet' : 'twilight'
  } catch {
    return 'twilight'
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'twilight') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

/** Switches theme now, remembers it, and has the window's title bar match. */
export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Storage unavailable: the theme holds for this session.
  }
  void window.twilight.setWindowTheme(theme)
}
