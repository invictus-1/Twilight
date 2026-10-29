import { app, BrowserWindow, dialog } from 'electron'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { BackupInfo, BackupSettings } from '@shared/backups'
import { backupDatabase, kvGet, kvSet } from './db'
import { toRecycleBin } from './code/workspace'

// Backups of everything Twilight keeps: the database (chats, workspaces, settings, encrypted
// keys), your background picture, the pictures chats made, and the window's own settings (theme,
// motion, shortcuts). Each is a plain folder, so it can be copied anywhere and looked into. A
// restore happens on the next start, before anything is open, and the state it replaces is
// backed up first; old scheduled backups go to the Recycle Bin, never straight to deletion.

const FOLDERS = ['background', 'generated']
const DB = 'twilight.db'
const MANIFEST = 'backup.json'
const SETTINGS = 'window-settings.json'

const DEFAULTS: BackupSettings = { schedule: 'daily', keep: 10, folder: '' }

export function backupSettings(): BackupSettings {
  return { ...DEFAULTS, ...kvGet<Partial<BackupSettings>>('backups.settings') }
}

export function setBackupSettings(patch: Partial<BackupSettings>): BackupSettings {
  kvSet('backups.settings', { ...backupSettings(), ...patch })
  return backupSettings()
}

/** Where backups go: your choice, or a folder in Documents (in the throwaway profile for tests). */
export function backupFolder(): string {
  const chosen = backupSettings().folder
  if (chosen) return chosen
  return process.env.TWILIGHT_E2E ? join(app.getPath('userData'), 'backups') : join(app.getPath('documents'), 'Twilight backups')
}

export async function chooseBackupFolder(win: BrowserWindow | null): Promise<BackupSettings> {
  const options: Electron.OpenDialogOptions = { title: 'Choose where backups go', properties: ['openDirectory', 'createDirectory'] }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return backupSettings()
  return setBackupSettings({ folder: result.filePaths[0] })
}

const stamp = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** The window's own settings (local storage under twilight.*), read from an open window. */
async function windowSettings(): Promise<Record<string, string>> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.isDestroyed())
  if (!win) return {}
  try {
    return (await win.webContents.executeJavaScript(
      `Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('twilight.')).map((k) => [k, localStorage.getItem(k)]))`
    )) as Record<string, string>
  } catch {
    return {}
  }
}

async function folderSize(dir: string): Promise<number> {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    total += e.isDirectory() ? await folderSize(full) : (await stat(full)).size
  }
  return total
}

/** Makes a backup now; returns it. */
export async function createBackup(reason: BackupInfo['reason']): Promise<BackupInfo> {
  const root = backupFolder()
  const now = new Date()
  let dir = join(root, `Twilight ${stamp(now)}`)
  for (let n = 2; existsSync(dir); n++) dir = join(root, `Twilight ${stamp(now)} (${n})`)
  await mkdir(dir, { recursive: true })
  await backupDatabase(join(dir, DB))
  for (const f of FOLDERS) {
    const from = join(app.getPath('userData'), f)
    if (existsSync(from)) await cp(from, join(dir, f), { recursive: true })
  }
  await writeFile(join(dir, SETTINGS), JSON.stringify(await windowSettings(), null, 2))
  const counts = new Database(join(dir, DB), { readonly: true })
  const chats = (counts.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n
  counts.close()
  const info: Omit<BackupInfo, 'path' | 'bytes'> = { name: dir.split(/[\\/]/).pop()!, createdAt: now.getTime(), reason, version: app.getVersion(), chats }
  await writeFile(join(dir, MANIFEST), JSON.stringify(info, null, 2))
  if (reason === 'scheduled') kvSet('backups.last', now.getTime())
  return { ...info, path: dir, bytes: await folderSize(dir) }
}

/** Every backup in the folder, newest first. */
export async function listBackups(): Promise<BackupInfo[]> {
  const root = backupFolder()
  if (!existsSync(root)) return []
  const out: BackupInfo[] = []
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = join(root, e.name)
    try {
      const info = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as Omit<BackupInfo, 'path' | 'bytes'>
      if (!existsSync(join(dir, DB))) continue
      out.push({ ...info, path: dir, bytes: await folderSize(dir) })
    } catch {
      // Not a backup (or an unfinished one); left alone.
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** Scheduled backups beyond the number kept go to the Recycle Bin; ones you made are never removed. */
export async function pruneBackups(): Promise<string[]> {
  const keep = Math.max(1, backupSettings().keep)
  const scheduled = (await listBackups()).filter((b) => b.reason === 'scheduled')
  const extra = scheduled.slice(keep)
  for (const b of extra) await toRecycleBin(b.path)
  return extra.map((b) => b.name)
}

const DAY = 24 * 60 * 60 * 1000

/** Whether a scheduled backup is due. */
export function backupDue(settings: BackupSettings, last: number | undefined, now: number): boolean {
  if (settings.schedule === 'off') return false
  const every = settings.schedule === 'daily' ? DAY : 7 * DAY
  return !last || now - last >= every
}

/** Checks now and then; a due backup runs a minute after start, so it never slows opening. */
export function startBackupSchedule(): void {
  const check = (): void => {
    if (!backupDue(backupSettings(), kvGet<number>('backups.last'), Date.now())) return
    void createBackup('scheduled')
      .then(() => pruneBackups())
      .catch((err) => kvSet('backups.error', { at: Date.now(), message: (err as Error).message }))
  }
  setTimeout(check, 60_000).unref()
  setInterval(check, 60 * 60 * 1000).unref()
}

// ——— Restoring ———
// The database is open while Twilight runs, so a restore is set up now and done on the next
// start, before the database opens. What's there is backed up first.

const PENDING = 'restore.json'
const LOCAL = 'restore-window-settings.json'

export async function stageRestore(backupPath: string): Promise<void> {
  if (!existsSync(join(backupPath, DB)) || !existsSync(join(backupPath, MANIFEST))) throw new Error("That folder isn't a Twilight backup.")
  await createBackup('before-restore')
  await writeFile(join(app.getPath('userData'), PENDING), JSON.stringify({ from: backupPath }))
}

/**
 * Runs at start, before the database opens: puts a staged backup's files in place. Returns the
 * backup's name when it restored one. A failed restore leaves your data as it was.
 */
export function applyPendingRestore(dataDir: string): string | null {
  const pending = join(dataDir, PENDING)
  if (!existsSync(pending)) return null
  const { from } = JSON.parse(readFileSync(pending, 'utf8')) as { from: string }
  rmSync(pending, { force: true })
  if (!existsSync(join(from, DB))) return null
  // The database's write-ahead files belong to the copy being replaced.
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(join(dataDir, f), { force: true })
  cpSync(join(from, DB), join(dataDir, DB))
  for (const f of FOLDERS) {
    rmSync(join(dataDir, f), { recursive: true, force: true })
    if (existsSync(join(from, f))) cpSync(join(from, f), join(dataDir, f), { recursive: true })
  }
  if (existsSync(join(from, SETTINGS))) writeFileSync(join(dataDir, LOCAL), readFileSync(join(from, SETTINGS)))
  return from.split(/[\\/]/).pop() ?? null
}

/** The window settings a restore brought back, taken once (the window writes them and reloads). */
export function takeRestoredWindowSettings(dataDir: string): Record<string, string> | null {
  const file = join(dataDir, LOCAL)
  if (!existsSync(file)) return null
  const settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  rmSync(file, { force: true })
  return settings
}

