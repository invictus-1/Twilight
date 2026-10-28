import { costOf, formatCost, formatTokens } from '@shared/pricing'
import type { Pane } from '@shared/types'
import { PaneContext } from '../pane'
import { optionsFor, paneOf, useStore } from '../store'
import { cacheStatus } from './CacheBar'
import { CloseIcon } from './Icons'
import { ModelPicker } from './ModelPicker'
import { Thread } from './Thread'

/** The same stats, in the same order, under both panes so they compare at a glance. */
function PaneFooter({ pane }: { pane: Pane }) {
  const last = useStore((s) => paneOf(s.current!, pane).path.findLast((n) => n.role === 'assistant'))
  const settings = useStore((s) => paneOf(s.current!, pane).settings)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const u = last?.usage
  const cache = cacheStatus(u, settings, optionsFor(models, providers, settings.providerId, settings.modelId))
  const cacheLabel = { hit: 'cache hit', write: 'cache written', miss: 'not cached', off: 'caching off', idle: '' }[cache.tone]
  if (!u) return <footer className="tw-pane-foot">No reply yet{cache.tone === 'off' ? ' · caching off' : ''}</footer>
  const local = models.find((m) => m.id === last.modelId && m.providerId === last.providerId)?.local ?? false
  const cost = costOf(last.modelId, u, local)
  return (
    <footer className="tw-pane-foot">
      <span>{formatTokens(u.output)} out</span>
      <span>{formatTokens(u.input + u.cacheRead + u.cacheWrite)} in</span>
      <span>{(u.ms / 1000).toFixed(1)}s</span>
      {cost !== null && <span>{formatCost(cost)}</span>}
      {cacheLabel && (
        <span className={`cache-${cache.tone}`} title={cache.text}>
          <span className="cache-dot" aria-hidden="true" /> {cacheLabel}
        </span>
      )}
    </footer>
  )
}

function PaneColumn({ pane }: { pane: Pane }) {
  const empty = useStore((s) => paneOf(s.current!, pane).path.length === 0)
  const closeSplit = useStore((s) => s.closeSplit)
  const other: Pane = pane === 'a' ? 'b' : 'a'
  return (
    <PaneContext.Provider value={pane}>
      <section className={`tw-pane tw-pane-${pane}`} aria-label={`Pane ${pane.toUpperCase()}`}>
        <header className="tw-pane-head">
          <span className="tw-pane-tag">{pane.toUpperCase()}</span>
          <ModelPicker placement="down" />
          <span className="tw-spacer" />
          <button
            className="tw-btn tw-btn-ghost tw-btn-sm"
            title={`Close the split and continue on ${pane.toUpperCase()}`}
            onClick={() => void closeSplit(pane)}
          >
            Keep {pane.toUpperCase()}
          </button>
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label={`Close pane ${pane.toUpperCase()}`}
            title={`Close ${pane.toUpperCase()} (keeps ${other.toUpperCase()})`}
            onClick={() => void closeSplit(other)}
          >
            <CloseIcon />
          </button>
        </header>
        {empty ? <div className="pane-empty">Send a message to start this pane.</div> : <Thread />}
        <PaneFooter pane={pane} />
      </section>
    </PaneContext.Provider>
  )
}

export function SplitView() {
  return (
    <div className="tw-split">
      <PaneColumn pane="a" />
      <PaneColumn pane="b" />
    </div>
  )
}
