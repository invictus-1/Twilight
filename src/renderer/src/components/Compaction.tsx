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

/** Compacts the open chat; the summary arrives as a marker at the end of the conversation. */
export async function compactOpenChat(): Promise<void> {
  const s = useStore.getState()
  const id = s.current?.id
  if (!id) return
  const done = await window.twilight.compactChat(id)
  if (useStore.getState().current?.id === id) useStore.setState({ current: done })
}

/**
 * The quiet offer above the message box once a chat passes your size (Settings → General): compact
 * it now, or not yet. Not now waits until the chat has grown another tenth.
 */
export function CompactBar() {
  const current = useStore((s) => s.current)
  const models = useStore((s) => s.models)
  const settings = useCompactionSettings()
  const [busy, setBusy] = useState(false)
  const [, rerender] = useState(0)
  if (!current || current.split || !settings?.threshold) return null
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
      <button
        className="tw-btn tw-btn-sm tw-btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await compactOpenChat()
          } catch (err) {
            useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? (
          <>
            <span className="tw-spin" /> Compacting…
          </>
        ) : (
          'Compact chat'
        )}
      </button>
      {!busy && (
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm"
          onClick={() => {
            declined.set(current.id, use.used)
            rerender((n) => n + 1)
          }}
        >
          Not now
        </button>
      )}
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
