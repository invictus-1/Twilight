import { BrowserWindow, Notification, type WebContents } from 'electron'
import * as db from './db'

/** A reply that took at least this long is worth telling you about when it finishes unseen. */
export const LONG_REPLY_MS = 10_000

// Test runs work in a window that's always in the background; they'd flash the taskbar all day.
const testRun = !!(process.env.TWILIGHT_E2E || process.env.TWILIGHT_SHOWCASE || process.env.TWILIGHT_SELFTEST || process.env.TWILIGHT_BENCH)

/** The Windows notification is yours to turn on (Settings → General); the taskbar glow is always there. */
export const doneNotificationOn = (): boolean => db.kvGet<boolean>('doneNotification') ?? false
export function setDoneNotification(on: boolean): boolean {
  db.kvSet('doneNotification', on)
  return on
}

/** Whether a finished reply gets the signal: a long one, while Twilight wasn't the window in front. */
export const shouldSignal = (focused: boolean, tookMs: number): boolean => !focused && tookMs >= LONG_REPLY_MS

/**
 * A long reply finished while you were elsewhere: the taskbar button glows until you come back,
 * and, if you asked for it, a quiet Windows notification names the chat.
 */
export function signalDone(contents: WebContents, chatTitle: string, tookMs: number): void {
  const win = BrowserWindow.fromWebContents(contents)
  if (testRun || !win || win.isDestroyed() || !shouldSignal(win.isFocused(), tookMs)) return
  win.flashFrame(true)
  win.once('focus', () => win.flashFrame(false))
  if (!doneNotificationOn() || !Notification.isSupported()) return
  const note = new Notification({ title: 'Reply ready', body: chatTitle, silent: true })
  note.on('click', () => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  note.show()
}
