import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { kvGet } from './db'

// Request logs: every chat turn and writing-tool run is appended to a daily JSON Lines file
// (logs/2026-10-28.jsonl) as a safety net — the prompt, the reply and what produced it. Files
// are only ever appended to; API keys are never written.

export function logsFolder(): string {
  return join(app.getPath('userData'), 'logs')
}

export function loggingEnabled(): boolean {
  return kvGet<boolean>('requestLogs') ?? true
}

let queue: Promise<void> = Promise.resolve()

export function appendLog(entry: Record<string, unknown>): void {
  if (!loggingEnabled()) return
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const line = JSON.stringify({ time: now.toISOString(), ...entry }) + '\n'
  // Serialized so concurrent replies (split compare) never interleave lines.
  queue = queue
    .then(async () => {
      await fs.mkdir(logsFolder(), { recursive: true })
      await fs.appendFile(join(logsFolder(), `${day}.jsonl`), line, 'utf8')
    })
    .catch((err) => console.error('Request log write failed:', err))
}
