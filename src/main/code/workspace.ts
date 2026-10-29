import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs, realpathSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

// Everything the agent does to files goes through here, and nothing here reaches outside the
// session's folder: every path is resolved and checked against the folder's real location
// (symlinks included). Before anything is changed, the original is copied into a snapshot, so
// each step can be undone; deleting sends to the Recycle Bin rather than erasing.

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'release', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', 'target'])
const MAX_READ = 2 * 1024 * 1024
const MAX_OUTPUT = 30_000

export class OutsideFolder extends Error {}

/** A path inside the folder, or an error that says it isn't. */
export function inside(root: string, rel: string): string {
  const realRoot = realpathSync(root)
  const full = resolve(realRoot, rel || '.')
  // The deepest part that exists decides, so a symlink inside can't lead out.
  let probe = full
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const real = realpathSync(probe)
  const settled = resolve(real, relative(probe, full))
  if (settled !== realRoot && !settled.startsWith(realRoot + sep)) throw new OutsideFolder(`${rel} is outside the folder this session works in.`)
  return settled
}

/** The same path, written relative to the folder with forward slashes. */
export const shown = (root: string, full: string): string => relative(realpathSync(root), full).split(sep).join('/') || '.'

/** Writes inside .git would let the agent rewrite history behind your back. */
function refuseGitInternals(root: string, full: string): void {
  if (shown(root, full).split('/').includes('.git')) throw new Error("Twilight's agent doesn't change files inside .git. Use a git command instead, which asks first.")
}

export async function listFiles(root: string, rel = '.', depth = 2): Promise<string> {
  const start = inside(root, rel)
  const lines: string[] = []
  const walk = async (dir: string, level: number, indent: string): Promise<void> => {
    if (lines.length >= 400) return
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name))
    for (const e of entries) {
      if (lines.length >= 400) {
        lines.push(`${indent}… (more not shown)`)
        return
      }
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) {
          lines.push(`${indent}${e.name}/ (skipped)`)
          continue
        }
        lines.push(`${indent}${e.name}/`)
        if (level < depth) await walk(join(dir, e.name), level + 1, `${indent}  `)
      } else lines.push(`${indent}${e.name}`)
    }
  }
  await walk(start, 1, '')
  return lines.join('\n') || '(empty folder)'
}

export async function readFile(root: string, rel: string, offset = 1, limit = 2000): Promise<string> {
  const full = inside(root, rel)
  const info = await fs.stat(full)
  if (info.isDirectory()) throw new Error(`${rel} is a folder; list it instead.`)
  if (info.size > MAX_READ) throw new Error(`${rel} is ${(info.size / 1024 / 1024).toFixed(1)} MB, too big to read whole. Search it instead.`)
  const text = await fs.readFile(full, 'utf8')
  if (text.includes('\u0000')) throw new Error(`${rel} isn't a text file.`)
  const lines = text.split('\n')
  const from = Math.max(1, offset)
  const slice = lines.slice(from - 1, from - 1 + limit)
  const body = slice.map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n')
  const more = from - 1 + limit < lines.length ? `\n… ${lines.length - (from - 1 + limit)} more lines (read on with offset ${from + limit})` : ''
  return `${body}${more}`
}

/** Raw text of a file, or null if it doesn't exist (for diffs and snapshots). */
export async function currentText(root: string, rel: string): Promise<string | null> {
  const full = inside(root, rel)
  try {
    return await fs.readFile(full, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function searchFiles(root: string, pattern: string, rel = '.', glob?: string): Promise<string> {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  const ext = glob ? new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null
  const hits: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (hits.length >= 200) return
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) await walk(full)
        continue
      }
      if (ext && !ext.test(e.name)) continue
      const info = await fs.stat(full)
      if (info.size > MAX_READ) continue
      const text = await fs.readFile(full, 'utf8').catch(() => '')
      if (text.includes('\u0000')) continue
      text.split('\n').forEach((line, i) => {
        if (hits.length < 200 && re.test(line)) hits.push(`${shown(root, full)}:${i + 1}: ${line.trim().slice(0, 200)}`)
      })
    }
  }
  await walk(inside(root, rel))
  return hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n… stopped at 200 matches; narrow the search' : '') : 'No matches.'
}

// ——— Snapshots ———

interface SnapshotFile {
  path: string
  /** Null when the file didn't exist before (undo removes it again). */
  backup: string | null
}

const snapshotDir = (sessionId: string, n: number): string => join(app.getPath('userData'), 'code-snapshots', sessionId, String(n))

/** Copies the files a step is about to change, before it changes them. */
export async function snapshot(sessionId: string, n: number, root: string, rels: string[]): Promise<void> {
  const dir = snapshotDir(sessionId, n)
  await fs.mkdir(dir, { recursive: true })
  const files: SnapshotFile[] = []
  for (const [i, rel] of rels.entries()) {
    const full = inside(root, rel)
    if (existsSync(full)) {
      const backup = join(dir, `${i}-${basename(full)}`)
      await fs.copyFile(full, backup)
      files.push({ path: rel, backup })
    } else files.push({ path: rel, backup: null })
  }
  await fs.writeFile(join(dir, 'snapshot.json'), JSON.stringify(files))
}

/** Puts a step's files back as they were. A file the step created goes to the Recycle Bin. */
export async function restore(sessionId: string, n: number, root: string): Promise<string[]> {
  const dir = snapshotDir(sessionId, n)
  const files = JSON.parse(await fs.readFile(join(dir, 'snapshot.json'), 'utf8')) as SnapshotFile[]
  for (const f of files) {
    const full = inside(root, f.path)
    if (f.backup) {
      await fs.mkdir(dirname(full), { recursive: true })
      await fs.copyFile(f.backup, full)
    } else if (existsSync(full)) await toRecycleBin(full)
  }
  return files.map((f) => f.path)
}

// ——— Changes ———

/** Sends a file to the Recycle Bin (in test runs, to a folder in the throwaway profile). */
export async function toRecycleBin(full: string): Promise<void> {
  if (process.env.TWILIGHT_E2E) {
    const bin = join(app.getPath('userData'), 'e2e-recycled')
    await fs.mkdir(bin, { recursive: true })
    await fs.rename(full, join(bin, `${Date.now()}-${basename(full)}`))
  } else await shell.trashItem(full)
}

export async function writeText(root: string, rel: string, text: string): Promise<void> {
  const full = inside(root, rel)
  refuseGitInternals(root, full)
  await fs.mkdir(dirname(full), { recursive: true })
  await fs.writeFile(full, text, 'utf8')
}

export async function removeFile(root: string, rel: string): Promise<void> {
  const full = inside(root, rel)
  refuseGitInternals(root, full)
  const info = await fs.stat(full)
  if (info.isDirectory()) throw new Error(`${rel} is a folder. The agent removes files one at a time, so each is snapshotted.`)
  await toRecycleBin(full)
}

/** The edited text: old_text must appear exactly (once, unless replacing every one). */
export function applyEdit(text: string, oldText: string, newText: string, all: boolean): string {
  if (!oldText) throw new Error('old_text is empty. To write a whole file, use write_file.')
  const count = text.split(oldText).length - 1
  if (count === 0) throw new Error("old_text wasn't found in the file. Read the file again and copy the text exactly, spaces and line breaks included.")
  if (count > 1 && !all) throw new Error(`old_text appears ${count} times. Include more surrounding lines so it's unique, or set replace_all.`)
  return all ? text.split(oldText).join(newText) : text.replace(oldText, () => newText)
}

// ——— Commands ———

const running = new Map<string, () => void>()

/** Stops a session's running command (and everything it started). */
export function stopCommand(sessionId: string): void {
  running.get(sessionId)?.()
}

/** Runs one PowerShell command in the folder, with a time limit; returns its exit code and output. */
export function runCommand(sessionId: string, root: string, command: string, timeoutSeconds = 120): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((done) => {
    // The command gets your environment, minus Twilight's own switches.
    const env = { ...process.env }
    for (const k of ['TWILIGHT_E2E', 'TWILIGHT_SELFTEST', 'TWILIGHT_SHOWCASE', 'ELECTRON_RUN_AS_NODE']) delete env[k]
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: realpathSync(root), windowsHide: true, env })
    let output = ''
    let timedOut = false
    const add = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      // Keep the start and the end of very long output; the middle is rarely what matters.
      if (output.length > MAX_OUTPUT * 2) output = `${output.slice(0, MAX_OUTPUT / 2)}\n… (output trimmed) …\n${output.slice(-MAX_OUTPUT / 2)}`
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const kill = (): void => {
      if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    }
    running.set(sessionId, kill)
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, Math.min(600, Math.max(5, timeoutSeconds)) * 1000)
    child.on('close', (code) => {
      clearTimeout(timer)
      running.delete(sessionId)
      const trimmed = output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT / 2)}\n… (output trimmed) …\n${output.slice(-MAX_OUTPUT / 2)}` : output
      done({ code, output: trimmed.trimEnd(), timedOut })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      running.delete(sessionId)
      done({ code: null, output: String(err), timedOut: false })
    })
  })
}

export const extOf = (rel: string): string => extname(rel).slice(1).toLowerCase()
