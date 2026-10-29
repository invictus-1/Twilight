import { app, dialog, protocol, type BrowserWindow } from 'electron'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { IMAGE_EXTENSIONS } from '@shared/attachments'
import { kvGet, kvSet } from './db'
import { readGenerated } from './generated'

// Your own background picture. The chosen file is copied into Twilight's data folder (so moving
// or deleting the original changes nothing) and served to the window as twilight-bg://image,
// which keeps file paths out of the page and the network lockdown untouched.

export const BACKGROUND_SCHEME = 'twilight-bg'
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

const folder = (): string => join(app.getPath('userData'), 'background')

/** Must run before the app is ready. */
export function registerBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: BACKGROUND_SCHEME, privileges: { standard: true, secure: true } }])
}

async function current(): Promise<string | null> {
  if (!existsSync(folder())) return null
  const file = (await readdir(folder())).find((f) => f.startsWith('image.'))
  return file ? join(folder(), file) : null
}

export function serveBackground(): void {
  protocol.handle(BACKGROUND_SCHEME, async (request) => {
    // Pictures a chat made come from their own folder: twilight-bg://generated/<file>.
    const url = new URL(request.url)
    if (url.hostname === 'generated') {
      const pic = await readGenerated(decodeURIComponent(url.pathname.slice(1)))
      return pic ? new Response(pic.data, { headers: { 'content-type': pic.type, 'cache-control': 'max-age=31536000, immutable' } }) : new Response(null, { status: 404 })
    }
    const file = await current()
    if (!file) return new Response(null, { status: 404 })
    return new Response(await readFile(file), { headers: { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' } })
  })
}

/** A stamp that changes with each new picture, so the window reloads it; null when there is none. */
export function backgroundVersion(): string | null {
  return kvGet<string>('background.version') ?? null
}

export async function chooseBackground(win: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a background picture',
    properties: ['openFile'],
    filters: [{ name: 'Pictures', extensions: IMAGE_EXTENSIONS }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return setBackgroundFile(result.filePaths[0])
}

/** Copies a picture in as the background; returns its new version stamp. */
export async function setBackgroundFile(source: string): Promise<string> {
  const ext = extname(source).toLowerCase()
  if (!TYPES[ext]) throw new Error('Pick a PNG, JPEG, WebP or GIF picture.')
  await clearBackgroundFile()
  await mkdir(folder(), { recursive: true })
  await copyFile(source, join(folder(), `image${ext}`))
  const version = String(Date.now())
  kvSet('background.version', version)
  return version
}

export async function clearBackgroundFile(): Promise<void> {
  if (existsSync(folder())) for (const f of await readdir(folder())) await rm(join(folder(), f), { force: true })
  kvSet('background.version', null)
}
