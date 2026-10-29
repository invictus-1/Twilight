import { costOf, formatCost, formatTokens } from '@shared/pricing'
import type { Pane } from '@shared/types'
import { PaneContext } from '../pane'
import { useRef } from 'react'
import { useDragResize, usePersistentNumber } from '../resize'
import { optionsFor, paneOf, useStore } from '../store'
import { cacheStatus, ContextMeter } from './CacheBar'
import { CloseIcon } from './Icons'
import { ModelPicker } from './ModelPicker'
import { Thread } from './Thread'

/** The same stats, in the same order, under both panes so they compare at a glance. */
function PaneFooter({ pane }: { pane: Pane }) {
  const path = useStore((s) => paneOf(s.current!, pane).path)
  const last = path.findLast((n) => n.role === 'assistant')
  const settings = useStore((s) => paneOf(s.current!, pane).settings)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  useStore((s) => s.prices) // re-price when your price list changes
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
      <span className="tw-spacer" />
      <ContextMeter path={path} settings={settings} />
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

/** Two panes with a draggable divider between them (double-click it to go back to half and half). */
export function SplitView() {
  const box = useRef<HTMLDivElement>(null)
  const [share, setShare] = usePersistentNumber('twilight.splitShare', 0.5)
  const drag = useDragResize({
    onMove: (x) => {
      const rect = box.current?.getBoundingClientRect()
      if (rect) setShare(Math.min(0.8, Math.max(0.2, (x - rect.left) / rect.width)))
    },
    onReset: () => setShare(0.5)
  })
  return (
    <div className="tw-split" ref={box} style={{ gridTemplateColumns: `minmax(0, ${share}fr) 6px minmax(0, ${1 - share}fr)` }}>
      <PaneColumn pane="a" />
      <div
        className="resize-handle split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the panes (double-click for half and half)"
        title="Drag to resize · double-click for half and half"
        {...drag}
      />
      <PaneColumn pane="b" />
    </div>
  )
}
