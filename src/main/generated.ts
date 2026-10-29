import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

// Pictures made during chats (by the Pictures tool, or by an image model answering itself),
// kept in Twilight's data folder and served to the window as twilight-bg://generated/<file>.

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }

export const generatedFolder = (): string => join(app.getPath('userData'), 'generated')

/** A generated picture's bytes, by file name only (nothing outside the folder can be asked for). */
export async function readGenerated(file: string): Promise<{ data: Buffer; type: string } | null> {
  const name = basename(file)
  const type = TYPES[extname(name).toLowerCase()]
  if (!type) return null
  try {
    return { data: await readFile(join(generatedFolder(), name)), type }
  } catch {
    return null
  }
}

export async function savePicture(data: Buffer, type: string): Promise<string> {
  await mkdir(generatedFolder(), { recursive: true })
  const file = `${randomUUID()}${EXT[type] ?? '.png'}`
  await writeFile(join(generatedFolder(), file), data)
  return file
}

/** A data: URL or an address a server gave, saved; returns the file name. */
export async function savePictureFrom(url: string, signal?: AbortSignal): Promise<string> {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (m) return savePicture(Buffer.from(m[2], 'base64'), m[1])
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Couldn't download the picture (${res.status}).`)
  return savePicture(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type')?.split(';')[0] ?? 'image/png')
}
