import { useEffect, useState } from 'react'
import type { NodeView } from '@shared/types'
import { formatTokens } from '@shared/pricing'
import { useStore } from '../store'
import { contextUse } from './CacheBar'

type Settings = { threshold: number | null; instructions: string; keepDocs: boolean }
let cached: Settings | null = null
const listeners = new Set<(s: Settings) => void>()
/** The compaction settings, loaded once and shared, updated when Settings changes them. */
export function useCompactionSettings(): Settings | null {
  const [s, setS] = useState(cached)
  useEffect(() => {
    listeners.add(setS)
    if (!cached) void window.twilight.getCompaction().then((v) => ((cached = v), listeners.forEach((l) => l(v))))
    return () => void listeners.delete(setS)
  }, [])
  return s
}
export async function saveCompactionSettings(patch: Partial<Settings>): Promise<void> {
  cached = await window.twilight.setCompaction(patch)
  listeners.forEach((l) => l(cached!))
}

// Chats where "Not now" was chosen, and at what size, so it asks again only after real growth.
const declined = new Map<string, number>()

// The compaction under way, if any: which chat and since when, shared by the bar and the command.
let running: { id: string; since: number } | null = null
const runListeners = new Set<() => void>()
const runChanged = (): void => runListeners.forEach((l) => l())
const useRunning = (): { id: string; since: number } | null => {
  const [, set] = useState(0)
  useEffect(() => {
    const l = (): void => set((n) => n + 1)
    runListeners.add(l)
    return () => void runListeners.delete(l)
  }, [])
  return running
}

const plainError = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

/**
 * Compacts the open chat; the summary arrives as a marker above the exchange it kept. Failures
 * show as the app's error notice, with the reason; Cancel's own stop is quiet.
 */
export async function compactOpenChat(): Promise<void> {
  const id = useStore.getState().current?.id
  if (!id || running) return
  running = { id, since: Date.now() }
  runChanged()
  try {
    const done = await window.twilight.compactChat(id)
    if (useStore.getState().current?.id === id) useStore.setState({ current: done })
  } catch (err) {
    const why = plainError(err)
    if (why !== 'Compacting stopped.') useStore.getState().setError(why)
  } finally {
    running = null
    runChanged()
  }
}

/** "Compacting… 1m 40s", counting up while it works. There's no progress to report beyond time: the summary arrives whole. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const s = Math.max(0, Math.round((now - since) / 1000))
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</>
}

/**
 * Above the message box: while a compaction runs, how long it's been and a way to stop it; and
 * otherwise, once a chat passes your size (Settings → General), the quiet offer to compact it now
 * or not yet. Not now waits until the chat has grown another tenth.
 */
export function CompactBar() {
  const current = useStore((s) => s.current)
  const models = useStore((s) => s.models)
  const settings = useCompactionSettings()
  const run = useRunning()
  const [, rerender] = useState(0)
  if (!current || current.split) return null
  if (run?.id === current.id) {
    return (
      <div className="compact-bar" role="status">
        <span>
          <span className="tw-spin" /> Compacting… <Elapsed since={run.since} />. A big chat can take a few minutes; the summary arrives all at once.
        </span>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void window.twilight.cancelCompaction(current.id)}>
          Cancel
        </button>
      </div>
    )
  }
  if (!settings?.threshold) return null
  const last = current.path.at(-1)
  if (!last || last.role !== 'assistant' || last.status !== 'done' || last.compaction) return null
  const use = contextUse(current.path, models, current.settings)
  if (!use || use.used < settings.threshold) return null
  const no = declined.get(current.id)
  if (no && use.used < no * 1.1) return null
  return (
    <div className="compact-bar" role="status">
      <span>
        This chat is at {formatTokens(use.used)} tokens. Compacting sums up everything before your latest message, which goes on word for word with its reply, so the chat stays quick and cheaper
        {settings.keepDocs ? '; your attached documents come along' : ''}. Everything stays here to read.
      </span>
      <button className="tw-btn tw-btn-sm tw-btn-primary" disabled={!!run} onClick={() => void compactOpenChat()}>
        Compact chat
      </button>
      <button
        className="tw-btn tw-btn-ghost tw-btn-sm"
        onClick={() => {
          declined.set(current.id, use.used)
          rerender((n) => n + 1)
        }}
      >
        Not now
      </button>
    </div>
  )
}

/** The summary in the conversation: a marker that everything above is now sent as this summary. */
export function CompactionMarker({ node }: { node: NodeView }) {
  const words = node.text.split(/\s+/).filter(Boolean).length
  const carried = node.compaction?.carried ?? 0
  return (
    <div className="msg compaction-marker" data-node={node.id}>
      <div className="compaction-line">
        <span>Compacted here</span>
      </div>
      <details className="compaction-summary">
        <summary>
          Everything above is sent as a {words.toLocaleString()}-word summary{carried ? `, with ${carried} attachment${carried === 1 ? '' : 's'} carried over` : ''}
          {node.compaction?.local ? ' (written by the model)' : ''}
          {node.compaction?.kept ? '; from here on, word for word' : ''}
        </summary>
        <div className="compaction-text">{node.text}</div>
      </details>
    </div>
  )
}
