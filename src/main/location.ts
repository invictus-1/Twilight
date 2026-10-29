import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Where Twilight keeps its data. The standard place is %APPDATA%\Twilight; you can choose another
// (a bigger drive, a synced folder). A small pointer file in the standard place says where the
// data is. A move is done on the next start, before anything opens the data: everything is
// copied to the new folder, checked, and only then used. The old copy stays where it was until
// you remove it, so a move never loses anything.

const POINTER = 'location.json'

interface Pointer {
  /** The folder in use, when it isn't the standard one. */
  path?: string
  /** A move to do on the next start. */
  pendingMove?: string
  /** What the last start did, for Settings to show. */
  last?: { kind: 'moved' | 'move-failed'; detail: string; at: number }
}

/** Chromium's caches are rebuilt on their own; copying them would only slow a move. */
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'blob_storage', POINTER])

export const standardFolder = (): string => join(app.getPath('appData'), 'Twilight')

function read(standard: string): Pointer {
  try {
    return JSON.parse(readFileSync(join(standard, POINTER), 'utf8')) as Pointer
  } catch {
    return {}
  }
}

function write(standard: string, pointer: Pointer): void {
  mkdirSync(standard, { recursive: true })
  writeFileSync(join(standard, POINTER), JSON.stringify(pointer, null, 2))
}

/** A folder you can move to: new, or empty (the standard place may still hold the old copy). */
export function checkTarget(target: string, current: string, standard = standardFolder()): string | null {
  if (!target.trim()) return 'Choose a folder.'
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  if (norm(target) === norm(current)) return 'Twilight already keeps its data there.'
  if (norm(target).startsWith(`${norm(current)}\\`) || norm(target).startsWith(`${norm(current)}/`)) return "That folder is inside the current data folder; choose one outside it."
  if (norm(target) !== norm(standard) && existsSync(target) && readdirSync(target).length) return 'Choose an empty folder (or a new one), so nothing in it is mixed with Twilight\'s data.'
  return null
}

/** Sets up a move for the next start. */
export function stageMove(target: string, standard = standardFolder()): void {
  write(standard, { ...read(standard), pendingMove: target })
}

/**
 * Runs before the app is ready: does a staged move, then returns the folder to use. Copying is
 * checked file by file (same names, same sizes) before the new folder is used.
 */
export function resolveDataFolder(standard = standardFolder()): string {
  const pointer = read(standard)
  const current = pointer.path && existsSync(pointer.path) ? pointer.path : standard
  const target = pointer.pendingMove
  if (!target) return current
  delete pointer.pendingMove
  try {
    mkdirSync(target, { recursive: true })
    const copied = copyData(current, target)
    // Back to the standard place: the pointer simply goes.
    const usingStandard = target.replace(/[\\/]+$/, '').toLowerCase() === standard.replace(/[\\/]+$/, '').toLowerCase()
    write(standard, { ...pointer, path: usingStandard ? undefined : target, last: { kind: 'moved', detail: `${copied} files from ${current}`, at: Date.now() } })
    return target
  } catch (err) {
    write(standard, { ...pointer, last: { kind: 'move-failed', detail: (err as Error).message, at: Date.now() } })
    return current
  }
}

function copyData(from: string, to: string): number {
  let count = 0
  for (const name of readdirSync(from)) {
    if (SKIP.has(name)) continue
    cpSync(join(from, name), join(to, name), { recursive: true, errorOnExist: false, force: true })
  }
  // Check the copy before trusting it.
  const walk = (a: string, b: string): void => {
    for (const e of readdirSync(a, { withFileTypes: true })) {
      if (SKIP.has(e.name) && a === from) continue
      const pa = join(a, e.name)
      const pb = join(b, e.name)
      if (!existsSync(pb)) throw new Error(`${e.name} didn't copy.`)
      if (e.isDirectory()) walk(pa, pb)
      else if (statSync(pa).size !== statSync(pb).size) throw new Error(`${e.name} didn't copy whole.`)
      else count++
    }
  }
  walk(from, to)
  return count
}

export function lastLocationChange(standard = standardFolder()): Pointer['last'] | null {
  return read(standard).last ?? null
}

export function isMoved(standard = standardFolder()): boolean {
  return !!read(standard).path
}
