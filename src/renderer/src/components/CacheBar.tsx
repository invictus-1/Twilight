import { useEffect, useState } from 'react'
import { formatTokens } from '@shared/pricing'
import type { ChatSettings, ModelInfo, ModelOptions, NodeView, Usage } from '@shared/types'
import { optionsFor, paneOf, useStore } from '../store'
import { readHidden, writeHidden } from './ChatSettingsPanel'
import { CloseIcon } from './Icons'

export type CacheTone = 'hit' | 'write' | 'miss' | 'off' | 'idle'

/** Whether the last reply's prompt came from the cache, in a sentence. */
export function cacheStatus(usage: Usage | undefined, settings: ChatSettings, options: ModelOptions): { tone: CacheTone; text: string } {
  if (!options.caching) {
    if (usage?.cacheRead) return { tone: 'hit', text: `Server reused ${formatTokens(usage.cacheRead)} cached tokens` }
    return { tone: 'idle', text: 'This server keeps its own cache and doesn’t report it' }
  }
  if (!settings.caching) return { tone: 'off', text: 'Prompt caching is off: every message pays full price for the whole conversation' }
  if (!usage) return { tone: 'idle', text: `Prompt caching on (${settings.cacheTtl === '1h' ? '1 hour' : '5 minutes'}); status shows after the first reply` }
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite
  if (usage.cacheRead > 0) {
    const pct = Math.round((usage.cacheRead / prompt) * 100)
    return {
      tone: 'hit',
      text: `Cache hit · ${formatTokens(usage.cacheRead)} of ${formatTokens(prompt)} tokens read from cache (${pct}%)${usage.cacheWrite ? ` · ${formatTokens(usage.cacheWrite)} new written` : ''}`
    }
  }
  if (usage.cacheWrite > 0)
    return { tone: 'write', text: `Cache written · ${formatTokens(usage.cacheWrite)} tokens (first message, expired, or something earlier changed)` }
  return { tone: 'miss', text: 'Not cached · the prompt is under this model’s minimum for caching' }
}

/**
 * How much of the model's context window the conversation fills: the last reply's whole prompt
 * plus what it wrote, which is what the next message builds on.
 */
export function contextUse(path: NodeView[], models: ModelInfo[], settings: ChatSettings): { used: number; window?: number } | null {
  // After a summary, only replies since it count: the summary is what's sent now.
  const u = path.slice(path.findLastIndex((n) => n.compaction) + 1).findLast((n) => n.role === 'assistant' && n.usage)?.usage
  if (!u) return null
  const window = models.find((m) => m.id === settings.modelId && m.providerId === settings.providerId)?.contextWindow
  return { used: u.input + u.cacheRead + u.cacheWrite + u.output, window }
}

/** Tokens used against the window, with a thin bar that warms as it fills. */
export function ContextMeter({ path, settings }: { path: NodeView[]; settings: ChatSettings }) {
  const models = useStore((s) => s.models)
  const use = contextUse(path, models, settings)
  if (!use) return null
  const pct = use.window ? Math.min(100, (use.used / use.window) * 100) : null
  const level = pct === null ? '' : pct >= 90 ? 'ctx-full' : pct >= 70 ? 'ctx-high' : ''
  const title = use.window
    ? `${use.used.toLocaleString()} of ${use.window.toLocaleString()} tokens in this model's context window (${pct!.toFixed(0)}%)`
    : `${use.used.toLocaleString()} tokens in the conversation (this model doesn't report its window)`
  return (
    <span className={`ctx-meter ${level}`} title={title}>
      {pct !== null && (
        <span className="ctx-track" aria-hidden="true">
          <span className="ctx-fill" style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
      )}
      <span className="ctx-text">
        {formatTokens(use.used)}
        {use.window ? ` / ${formatTokens(use.window)}` : ' tokens'}
      </span>
    </span>
  )
}

/** Under a single-pane chat. (Split panes show the same status in their footers.) */
export function CacheBar() {
  const [hidden, setHidden] = useState(readHidden)
  const current = useStore((s) => s.current)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)

  useEffect(() => {
    const onChange = (): void => setHidden(readHidden())
    window.addEventListener('twilight-cachebar', onChange)
    return () => window.removeEventListener('twilight-cachebar', onChange)
  }, [])

  if (hidden || !current) return null
  const { settings, path } = paneOf(current, 'a')
  const last = path.findLast((n) => n.role === 'assistant' && n.status !== 'streaming')
  const status = cacheStatus(last?.usage, settings, optionsFor(models, providers, settings.providerId, settings.modelId))
  return (
    <div className={`cache-bar cache-${status.tone}`} role="status">
      <span className="cache-dot" aria-hidden="true" />
      <span className="cache-text">{status.text}</span>
      <ContextMeter path={path} settings={settings} />
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon"
        aria-label="Hide the cache status bar"
        title="Hide (turn it back on in Model settings)"
        onClick={() => writeHidden(true)}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}
