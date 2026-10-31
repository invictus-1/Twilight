import { useEffect, useState } from 'react'
import { BIBLE_KINDS, type BibleKind } from '@shared/bible'
import { useBible } from '../bibleStore'
import { BookIcon, PlusIcon } from './Icons'

const api = window.twilight

/** The sidebar in the Bible section: the overview, then every entry by kind, with a search. */
export function BibleList() {
  const state = useBible((s) => s.state)
  const page = useBible((s) => s.page)
  const query = useBible((s) => s.query)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    void useBible.getState().init()
  }, [])
  const q = query.trim().toLowerCase()
  const visible = (state?.entries ?? []).filter((e) => e.status !== 'removed' && (!q || [e.name, ...e.aliases].some((n) => n.toLowerCase().includes(q))))
  const waiting = (state?.entries ?? []).reduce((n, e) => n + (e.status === 'proposed' ? 1 : e.status === 'accepted' ? e.facts.filter((f) => f.status === 'proposed').length : 0), 0)
  return (
    <div className="sidebar-list bible-list">
      <button className="judge-board-item bible-overview-item" aria-current={page === null ? 'true' : undefined} onClick={() => useBible.getState().open(null)}>
        <BookIcon />
        <span>Overview</span>
        {waiting > 0 && <span className="tw-badge bible-waiting-count">{waiting}</span>}
      </button>
      <input className="bible-search" placeholder="Find an entry…" value={query} onChange={(e) => useBible.getState().setQuery(e.target.value)} />
      {BIBLE_KINDS.map((k) => {
        const list = visible.filter((e) => e.kind === k.kind)
        if (!list.length) return null
        return (
          <div key={k.kind} className="bible-group">
            <div className="side-section">
              <span>{k.plural}</span>
            </div>
            {list.map((e) => (
              <button key={e.id} className={`judge-board-item bible-item ${e.status === 'proposed' ? 'is-proposed' : ''}`} aria-current={page === e.id ? 'true' : undefined} data-entry={e.id} onClick={() => useBible.getState().open(e.id)}>
                <span>{e.name}</span>
                {e.status === 'proposed' && <span className="bible-dot" title="Proposed, not yet accepted" />}
              </button>
            ))}
          </div>
        )
      })}
      {creating ? (
        <form
          className="bible-new"
          onSubmit={(e) => {
            e.preventDefault()
            const form = e.currentTarget
            const name = (form.elements.namedItem('name') as HTMLInputElement).value
            const kind = (form.elements.namedItem('kind') as HTMLSelectElement).value as BibleKind
            if (name.trim()) void api.addBibleEntry(name, kind).then(useBible.getState().set)
            setCreating(false)
          }}
        >
          <input name="name" autoFocus placeholder="Name" />
          <select name="kind" defaultValue="character">
            {BIBLE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <button className="tw-btn tw-btn-sm">Add</button>
        </form>
      ) : (
        state?.settings.on && (
          <button className="tw-btn tw-btn-ghost tw-btn-sm bible-add" onClick={() => setCreating(true)}>
            <PlusIcon size={13} /> New entry
          </button>
        )
      )}
    </div>
  )
}
