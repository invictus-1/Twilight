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

const toRel = (full: string): string => relative(resolve(writingFolder()), full).split(sep).join('/')

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

export async function createDoc(name: string): Promise<DocEntry> {
  const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled'
  const root = resolve(writingFolder())
  await fs.mkdir(root, { recursive: true })
  for (let n = 1; ; n++) {
    const fileName = `${n === 1 ? clean : `${clean} ${n}`}.md`
    const full = resolveInside(fileName)
    try {
      await fs.writeFile(full, '', { encoding: 'utf8', flag: 'wx' }) // wx: never overwrite an existing file
      const st = await fs.stat(full)
      return { path: toRel(full), name: fileName.slice(0, -3), mtime: st.mtimeMs, size: 0 }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}
