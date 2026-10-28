import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchResults, Snippet } from '@shared/types'
import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { Keys } from './CommandMenu'
import { CloseIcon, DocIcon, SearchIcon, SpeechIcon } from './Icons'

function Snip({ s }: { s: Snippet }) {
  return (
    <span className="search-snippet">
      {s.before}
      {s.match && <mark>{s.match}</mark>}
      {s.after}
    </span>
  )
}

const when = (at: number): string => {
  const d = new Date(at)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

/**
 * Ctrl+Shift+F: every chat message and document at once. Results come as you type; arrows move
 * between them and Enter opens one at the match.
 */
export function SearchPanel() {
  const initial = useStore((s) => s.searchQuery)
  const [query, setQuery] = useState(initial)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [active, setActive] = useState(0)
  const [scope, setScope] = useState<'all' | 'chats' | 'docs'>('all')
  const list = useRef<HTMLDivElement>(null)
  const close = (): void => useStore.getState().setOverlay(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setResults(null)
    let live = true
    const t = setTimeout(() => {
      void window.twilight.searchAll(q).then((r) => live && setResults(r))
    }, 140)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const hits: SearchHit[] = results ? [...(scope !== 'docs' ? results.chats : []), ...(scope !== 'chats' ? results.docs : [])] : []
  useEffect(() => setActive(0), [results, scope])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (hit: SearchHit | undefined): void => {
    if (!hit) return
    close()
    if (hit.kind === 'chat') void useStore.getState().revealMessage(hit.conversationId, hit.nodeId)
    else {
      useStore.getState().setMode('write')
      void useWriting.getState().revealIn(hit.path, hit.snippet.match || '')
    }
  }

  let lastTitle = ''
  return (
    <div className="dialog-backdrop overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette search-panel" role="dialog" aria-modal="true" aria-label="Search everything">
        <div className="palette-input">
          <SearchIcon size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search every chat and document…"
            aria-label="Search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(hits.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                open(hits[active])
              }
            }}
          />
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <div className="search-scopes" role="tablist" aria-label="Where to search">
          {(['all', 'chats', 'docs'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} className="search-scope" onClick={() => setScope(s)}>
              {s === 'all' ? 'Everything' : s === 'chats' ? `Chats${results ? ` · ${results.chatTotal}` : ''}` : `Documents${results ? ` · ${results.docTotal}` : ''}`}
            </button>
          ))}
          <span className="tw-spacer" />
          {results && <span className="field-note search-time">{results.ms} ms</span>}
        </div>
        <div className="palette-list search-list" role="listbox" ref={list}>
          {!results && <div className="palette-empty">{query.trim().length < 2 ? 'Type at least two letters.' : 'Searching…'}</div>}
          {results && hits.length === 0 && <div className="palette-empty">Nothing found for “{results.query}”.</div>}
          {hits.map((hit, i) => {
            const title = hit.kind === 'chat' ? hit.title : hit.path.replace(/\.md$/i, '')
            const head = hit.kind === 'chat' && title !== lastTitle
            lastTitle = hit.kind === 'chat' ? title : ''
            return (
              <div
                key={hit.kind === 'chat' ? hit.nodeId : hit.path}
                role="option"
                aria-selected={i === active}
                className={`search-hit ${head || hit.kind === 'doc' ? 'search-hit-first' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => open(hit)}
              >
                <span className="palette-icon" aria-hidden="true">
                  {hit.kind === 'chat' ? head && <SpeechIcon size={14} /> : <DocIcon size={14} />}
                </span>
                <span className="search-body">
                  {(head || hit.kind === 'doc') && (
                    <span className="search-title">
                      {title}
                      {hit.kind === 'doc' && hit.count > 0 && <span className="field-note"> · {hit.count === 1 ? '1 match' : `${hit.count} matches`}</span>}
                    </span>
                  )}
                  <span className="search-line">
                    {hit.kind === 'chat' && <span className="search-role">{hit.role === 'user' ? 'You' : 'Reply'}</span>}
                    <Snip s={hit.snippet} />
                  </span>
                </span>
                {hit.kind === 'chat' && <span className="search-when">{when(hit.at)}</span>}
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <Keys keys="↑ / ↓" /> move <Keys keys="Enter" /> open <Keys keys="Esc" /> close
        </div>
      </div>
    </div>
  )
}
