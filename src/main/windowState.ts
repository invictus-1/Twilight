import type { BrowserWindow, Rectangle } from 'electron'

/** Where the window was when it last closed: its normal (unmaximized) bounds, and whether it was maximized. */
export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/**
 * Where to open the window from the saved state. A position that no longer lands on a screen (a
 * monitor unplugged since) is dropped so Windows centres the window, and the size is kept within
 * the largest screen.
 */
export function placement(saved: WindowState | null, workAreas: Rectangle[], min = { width: 720, height: 480 }): Partial<Rectangle> & { maximized: boolean } {
  if (!saved || !(saved.width > 0) || !(saved.height > 0)) return { maximized: false }
  const widest = Math.max(...workAreas.map((a) => a.width), min.width)
  const tallest = Math.max(...workAreas.map((a) => a.height), min.height)
  const width = Math.round(Math.min(Math.max(saved.width, min.width), widest))
  const height = Math.round(Math.min(Math.max(saved.height, min.height), tallest))
  // Enough of the title bar on some screen to grab it: 100 px across and its top edge inside.
  const onScreen = workAreas.some(
    (a) => saved.x + width - 100 >= a.x && saved.x + 100 <= a.x + a.width && saved.y >= a.y && saved.y + 40 <= a.y + a.height
  )
  return onScreen ? { x: Math.round(saved.x), y: Math.round(saved.y), width, height, maximized: saved.maximized } : { width, height, maximized: saved.maximized }
}

/** Saves the window's state as it's moved, resized, maximized or closed (moves are settled for half a second first). */
export function trackWindow(win: BrowserWindow, save: (state: WindowState) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const now = (): void => {
    clearTimeout(timer)
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    save({ ...win.getNormalBounds(), maximized: win.isMaximized() })
  }
  const soon = (): void => {
    clearTimeout(timer)
    timer = setTimeout(now, 500)
  }
  win.on('resize', soon)
  win.on('move', soon)
  win.on('maximize', now)
  win.on('unmaximize', now)
  win.on('close', now)
}
