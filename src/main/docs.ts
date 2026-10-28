import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { DocContent, DocEntry } from '@shared/types'
import { kvGet, kvSet } from './db'

// Manuscripts are plain markdown files in a folder the user picks — an Obsidian vault works as
// is, and both apps can edit the same files. Nothing is imported or copied.

const MAX_FILES = 10_000
const SKIP = new Set(['node_modules'])

export function writingFolder(): string {
  return kvGet<string>('writingFolder') ?? join(app.getPath('documents'), 'Twilight')
}

export async function chooseWritingFolder(win: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose your writing folder',
    defaultPath: writingFolder(),
    properties: ['openDirectory', 'createDirectory']
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  kvSet('writingFolder', result.filePaths[0])
  return result.filePaths[0]
}

/** Resolves a folder-relative path, refusing anything that would land outside the folder. */
function resolveInside(rel: string): string {
  const root = resolve(writingFolder())
  const full = resolve(root, rel)
  if (!full.startsWith(root + sep) || !full.toLowerCase().endsWith('.md')) throw new Error(`Not a document in the writing folder: ${rel}`)
  return full
}

/** Resolves a folder-relative directory ('' is the writing folder itself), refusing anything outside it. */
function resolveFolder(rel: string): string {
  const root = resolve(writingFolder())
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`Not a folder in the writing folder: ${rel}`)
  if (relative(root, full).split(sep).some((part) => part.startsWith('.'))) throw new Error(`Hidden folders are off limits: ${rel}`)
  return full
}

const toRel = (full: string): string => relative(resolve(writingFolder()), full).split(sep).join('/')

export async function listDocFolders(): Promise<string[]> {
  const root = resolve(writingFolder())
  await fs.mkdir(root, { recursive: true })
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue
      const full = join(dir, e.name)
      out.push(toRel(full))
      if (out.length < MAX_FILES) await walk(full)
    }
  }
  await walk(root)
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export async function createDocFolder(rel: string): Promise<string> {
  const clean = rel
    .split('/')
    .map((part) => part.replace(/[\\:*?"<>|]+/g, ' ').trim())
    .filter(Boolean)
    .join('/')
  if (!clean) throw new Error('Give the folder a name.')
  const full = resolveFolder(clean)
  await fs.mkdir(full, { recursive: true })
  return toRel(full)
}

/** Moves a document into another folder of the writing folder, keeping its name; never overwrites. */
export async function moveDoc(rel: string, folder: string): Promise<string> {
  const from = resolveInside(rel)
  const to = join(resolveFolder(folder), basename(from))
  if (to === from) return toRel(from)
  try {
    await fs.access(to)
    throw new Error(`"${basename(from)}" already exists in that folder.`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await fs.rename(from, to)
  return toRel(to)
}

export async function listDocs(): Promise<DocEntry[]> {
  const root = resolve(writingFolder())
  await fs.mkdir(root, { recursive: true })
  const out: DocEntry[] = []
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= MAX_FILES) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue // .obsidian, .trash, .git …
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const st = await fs.stat(full)
        out.push({ path: toRel(full), name: e.name.slice(0, -3), mtime: st.mtimeMs, size: st.size })
        if (out.length >= MAX_FILES) return
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => b.mtime - a.mtime)
}

export async function readDoc(rel: string): Promise<DocContent> {
  const full = resolveInside(rel)
  const [text, st] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
  return { path: toRel(full), text, mtime: st.mtimeMs }
}

/** Writes to a temporary file beside the target, then renames it over: a crash never leaves half a manuscript. */
export async function writeDoc(rel: string, text: string): Promise<number> {
  const full = resolveInside(rel)
  await fs.mkdir(dirname(full), { recursive: true })
  const tmp = join(dirname(full), `.${basename(full)}.twilight-tmp`)
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, full)
  return (await fs.stat(full)).mtimeMs
}

export async function createDoc(name: string, folder = ''): Promise<DocEntry> {
  const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled'
  const dir = resolveFolder(folder)
  await fs.mkdir(dir, { recursive: true })
  for (let n = 1; ; n++) {
    const fileName = `${n === 1 ? clean : `${clean} ${n}`}.md`
    const full = resolveInside(toRel(join(dir, fileName)))
    try {
      await fs.writeFile(full, '', { encoding: 'utf8', flag: 'wx' }) // wx: never overwrite an existing file
      const st = await fs.stat(full)
      return { path: toRel(full), name: fileName.slice(0, -3), mtime: st.mtimeMs, size: 0 }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}
