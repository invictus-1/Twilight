import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BranchMap, MapNode } from '@shared/branchMap'
import { useStore } from '../store'
import { BranchIcon, CloseIcon } from './Icons'

// The branch map (Ctrl+Shift+B): the open chat's whole tree, every version and regeneration, with
// the thread shown now drawn in the accent colour. Straight runs fold into their edge with a
// count; click any message to make its branch the one the chat shows.

const COL = 34
const ROW = 46
const PAD = 24

const at = (n: MapNode): { x: number; y: number } => ({ x: PAD + n.x * COL + COL / 2, y: PAD + n.y * ROW + 10 })

const when = (t: number): string =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function BranchMapPanel() {
  const current = useStore((s) => s.current)
  const models = useStore((s) => s.models)
  const [map, setMap] = useState<BranchMap | null>(null)
  const [hover, setHover] = useState<MapNode | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const close = (): void => useStore.getState().setOverlay(null)

  useEffect(() => {
    if (!current) return
    let live = true
    void window.twilight.branchMap(current.id).then((m) => live && setMap(m))
    return () => {
      live = false
    }
  }, [current?.id])

  // Open with the end of the thread shown now in view.
  useLayoutEffect(() => {
    const el = scroller.current
    const end = map?.nodes.find((n) => n.id === map.current)
    if (!el || !end) return
    const p = at(end)
    el.scrollLeft = p.x - el.clientWidth / 2
    el.scrollTop = p.y - el.clientHeight / 2
  }, [map])

  const open = (node: MapNode): void => {
    if (!current) return
    close()
    void useStore.getState().revealMessage(current.id, node.id)
  }

  const byId = new Map(map?.nodes.map((n) => [n.id, n]) ?? [])
  const width = Math.max(1, map?.columns ?? 1) * COL + PAD * 2
  const height = Math.max(1, map?.rows ?? 1) * ROW + PAD * 2 - ROW / 2
  const shown = hover ?? map?.nodes.find((n) => n.id === map.current) ?? null
  const modelName = (id?: string): string => (id ? models.find((m) => m.id === id)?.name ?? id : '')

  return (
    <div className="dialog-backdrop overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette branch-panel" role="dialog" aria-modal="true" aria-label="Branch map">
        <div className="branch-head">
          <BranchIcon size={16} />
          <span className="branch-title">Branch map</span>
          {map && (
            <span className="field-note branch-count">
              {map.total.toLocaleString()} {map.total === 1 ? 'message' : 'messages'} · {map.branches} {map.branches === 1 ? 'branch' : 'branches'}
            </span>
          )}
          <span className="tw-spacer" />
          <span className="branch-legend field-note">
            <span className="branch-key branch-key-user" /> You
            <span className="branch-key branch-key-ai" /> Reply
          </span>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <div className="branch-scroll" ref={scroller}>
          {!map ? (
            <div className="palette-empty">{current ? 'Drawing the map…' : 'Open a chat to see its branches.'}</div>
          ) : map.nodes.length === 0 ? (
            <div className="palette-empty">Nothing here yet. Send a message and its branches show up here.</div>
          ) : (
            <svg className="branch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
              {map.nodes.map((n) => {
                const parent = n.parentId ? byId.get(n.parentId) : null
                if (!parent) return null
                const a = at(parent)
                const b = at(n)
                const mid = (a.y + b.y) / 2
                return (
                  <g key={`e:${n.id}`} className={`branch-edge ${n.onPath ? 'on-path' : ''}`}>
                    <path d={`M${a.x} ${a.y} C${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`} />
                    {n.folded > 0 && (
                      <text x={b.x + 9} y={mid + 4} className="branch-folded">
                        +{n.folded}
                      </text>
                    )}
                  </g>
                )
              })}
              {map.nodes.map((n) => {
                const p = at(n)
                return (
                  <g
                    key={n.id}
                    data-node={n.id}
                    className={`branch-node branch-${n.role} ${n.onPath ? 'on-path' : ''} ${n.id === map.current ? 'is-current' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.role === 'user' ? 'You' : 'Reply'}: ${n.preview}`}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(n)}
                    onClick={() => open(n)}
                    onKeyDown={(e) => e.key === 'Enter' && open(n)}
                  >
                    <circle cx={p.x} cy={p.y} r={12} className="branch-hit" />
                    <circle cx={p.x} cy={p.y} r={n.id === map.current ? 7 : 5.5} className="branch-dot" />
                  </g>
                )
              })}
            </svg>
          )}
        </div>
        {shown && (
          <div className="branch-detail">
            <div className="branch-detail-meta field-note">
              <strong>{shown.role === 'user' ? 'You' : 'Reply'}</strong>
              {shown.modelId && shown.role === 'assistant' && <span>{modelName(shown.modelId)}</span>}
              <span>{when(shown.createdAt)}</span>
              {shown.id === map?.current ? <span className="branch-here">Shown now</span> : shown.leaf ? <span>End of a branch</span> : null}
            </div>
            <p className="branch-preview">{shown.preview || '(empty)'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
