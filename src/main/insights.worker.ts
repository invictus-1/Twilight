// Reads manuscripts off the main thread: an 8-million-word folder takes a few seconds, and the
// app stays responsive meanwhile.
import { parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { analyzeText, type TrackedCharacter } from '@shared/insights'

parentPort!.on('message', async (m: { id: number; file: string; characters: TrackedCharacter[] }) => {
  try {
    const text = await readFile(m.file, 'utf8')
    parentPort!.postMessage({ id: m.id, analysis: analyzeText(text, m.characters) })
  } catch (err) {
    parentPort!.postMessage({ id: m.id, error: String(err) })
  }
})
