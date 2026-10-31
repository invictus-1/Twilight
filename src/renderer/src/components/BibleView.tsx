import { useEffect, useState } from 'react'
import { BIBLE_KINDS, type BibleEntry, type BibleFact, type BibleKind } from '@shared/bible'
import { useBible } from '../bibleStore'
import { useStore } from '../store'
import { BookIcon, CheckIcon, CloseIcon, SidebarIcon, TrashIcon } from './Icons'

// The Bible section: the overview (the switch, the documents it reads, and what's waiting for
// you) and each entry's own page, where facts can be edited, added, accepted or turned down.

const api = window.twilight
const kindLabel = (k: BibleKind): string => BIBLE_KINDS.find((x) => x.kind === k)?.label ?? k
const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const where = (f: BibleFact): string => [f.source === 'you' ? 'Added by you' : f.source, f.section].filter(Boolean).join(' › ')

function Progress({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, (done / Math.max(1, total)) * 100)
  return (
    <div className="library-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/** A fact: its text (editable when it counts), where it came from, and what can be done with it. */
function Fact({ fact, owner }: { fact: BibleFact; owner?: BibleEntry }) {
  const [editing, setEditing] = useState(false)
  const set = useBible((s) => s.set)
  return (
    <li className={`bible-fact is-${fact.status}`} data-fact={fact.id}>
      {owner && (
        <button className="link-btn bible-fact-owner" onClick={() => useBible.getState().open(owner.id)}>
          {owner.name}
        </button>
      )}
      {editing ? (
        <input
          className="bible-fact-edit"
          autoFocus
          defaultValue={fact.text}
          onBlur={(e) => {
            setEditing(false)
            if (e.currentTarget.value.trim() && e.currentTarget.value.trim() !== fact.text) void api.editBibleFact(fact.id, e.currentTarget.value).then(set)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="bible-fact-text" onDoubleClick={() => fact.status === 'accepted' && setEditing(true)} title={fact.status === 'accepted' ? 'Double-click to edit' : undefined}>
          {fact.text}
        </span>
      )}
      {where(fact) && <span className="bible-fact-where field-note">{where(fact)}</span>}
      <span className="bible-fact-actions">
        {fact.status === 'proposed' && (
          <button className="tw-btn tw-btn-ghost tw-btn-icon bible-accept" aria-label="Accept" title="Accept" onClick={() => void api.reviewBible('accept', { facts: [fact.id] }).then(set)}>
            <CheckIcon size={14} />
          </button>
        )}
        {fact.status === 'removed' ? (
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void api.reviewBible('restore', { facts: [fact.id] }).then(set)}>
            Restore
          </button>
        ) : (
          <button className="tw-btn tw-btn-ghost tw-btn-icon bible-remove" aria-label="Remove" title={fact.status === 'proposed' ? "Turn down: it won't be proposed again" : 'Remove'} onClick={() => void api.reviewBible('remove', { facts: [fact.id] }).then(set)}>
            <CloseIcon size={13} />
          </button>
        )}
      </span>
    </li>
  )
}

function EntryPage({ entry }: { entry: BibleEntry }) {
  const set = useBible((s) => s.set)
  const [adding, setAdding] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)
  const facts = entry.facts.filter((f) => f.status !== 'removed')
  const removed = entry.facts.filter((f) => f.status === 'removed')
  const others = useBible((s) => s.state?.entries ?? [])
  // Relationships: the facts that name another entry.
  const related = others.filter((o) => o.id !== entry.id && o.status === 'accepted' && facts.some((f) => f.text.toLowerCase().includes(o.name.toLowerCase())))
  return (
    <div className="bible-entry" data-entry={entry.id}>
      <div className="bible-entry-head">
        <input
          className="bible-name"
          key={`name:${entry.id}:${entry.name}`}
          defaultValue={entry.name}
          aria-label="Name"
          onBlur={(e) => e.currentTarget.value.trim() !== entry.name && void api.editBibleEntry(entry.id, { name: e.currentTarget.value }).then(set)}
        />
        <select value={entry.kind} aria-label="Kind" onChange={(e) => void api.editBibleEntry(entry.id, { kind: e.target.value as BibleKind }).then(set)}>
          {BIBLE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        {entry.status === 'proposed' && (
          <button className="tw-btn tw-btn-sm tw-btn-primary bible-accept-entry" onClick={() => void api.reviewBible('accept', { entries: [entry.id] }).then(set)}>
            Accept with its facts
          </button>
        )}
        <span className="tw-spacer" />
        {entry.status === 'removed' ? (
          <button className="tw-btn tw-btn-sm" onClick={() => void api.reviewBible('restore', { entries: [entry.id] }).then(set)}>
            Restore
          </button>
        ) : (
          <button className="tw-btn tw-btn-ghost tw-btn-sm bible-remove-entry" title="Remove it; it won't be proposed again (Restore brings it back)" onClick={() => void api.reviewBible('remove', { entries: [entry.id] }).then(set)}>
            <TrashIcon size={13} />
            Remove
          </button>
        )}
      </div>
      {entry.status === 'proposed' && <p className="field-note bible-waiting">Proposed from your documents. Nothing here counts until you accept it.</p>}
      <label className="field">
        <span className="field-label">Also called</span>
        <input
          key={`aliases:${entry.id}:${entry.aliases.join('|')}`}
          defaultValue={entry.aliases.join(', ')}
          placeholder="Other names, separated by commas"
          onBlur={(e) => e.currentTarget.value !== entry.aliases.join(', ') && void api.editBibleEntry(entry.id, { aliases: e.currentTarget.value.split(',') }).then(set)}
        />
      </label>
      <h3 className="settings-section">Facts</h3>
      {facts.length ? (
        <ul className="bible-facts">
          {facts.map((f) => (
            <Fact key={f.id} fact={f} />
          ))}
        </ul>
      ) : (
        <p className="field-note">No facts yet.</p>
      )}
      <form
        className="bible-add-fact"
        onSubmit={(e) => {
          e.preventDefault()
          if (!adding.trim()) return
          void api.addBibleFact(entry.id, adding).then(set)
          setAdding('')
        }}
      >
        <input value={adding} placeholder="Add a fact of your own…" onChange={(e) => setAdding(e.target.value)} />
        <button className="tw-btn tw-btn-sm" disabled={!adding.trim()}>
          Add
        </button>
      </form>
      {related.length > 0 && (
        <p className="field-note bible-related">
          Connected to{' '}
          {related.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ', '}
              <button className="link-btn" onClick={() => useBible.getState().open(o.id)}>
                {o.name}
              </button>
            </span>
          ))}
        </p>
      )}
      <label className="field">
        <span className="field-label">Your notes</span>
        <textarea key={`notes:${entry.id}`} rows={3} defaultValue={entry.notes} placeholder="Anything you want kept with it; chats get these too." onBlur={(e) => e.currentTarget.value !== entry.notes && void api.editBibleEntry(entry.id, { notes: e.currentTarget.value }).then(set)} />
      </label>
      {removed.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? 'Hide' : 'Show'} {removed.length} removed {removed.length === 1 ? 'fact' : 'facts'}
          </button>
          {showRemoved && (
            <ul className="bible-facts">
              {removed.map((f) => (
                <Fact key={f.id} fact={f} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Overview() {
  const state = useBible((s) => s.state)!
  const set = useBible((s) => s.set)
  const [showFiles, setShowFiles] = useState(false)
  const { settings, sources, reading } = state
  const chosen = sources.filter((s) => s.chosen)
  const stale = chosen.filter((s) => !s.current).length
  const newEntries = state.entries.filter((e) => e.status === 'proposed')
  const newFacts = state.entries.filter((e) => e.status === 'accepted').flatMap((e) => e.facts.filter((f) => f.status === 'proposed').map((f) => ({ e, f })))
  const toggle = (path: string, on: boolean): void => void api.setBibleSettings({ sources: on ? [...settings.sources, path] : settings.sources.filter((p) => p !== path) }).then(set)
  const acceptAll = (): void =>
    void api.reviewBible('accept', { entries: newEntries.map((e) => e.id), facts: newFacts.map((x) => x.f.id) }).then(set)
  const counts = BIBLE_KINDS.map((k) => ({ ...k, n: state.entries.filter((e) => e.kind === k.kind && e.status === 'accepted').length })).filter((k) => k.n)

  return (
    <div className="bible-overview">
      <div className="settings-card bible-sources">
        <h3 className="t-heading">What it reads</h3>
        <p className="field-note">
          Choose documents from your library: character profiles, world notes, chapters. A model (the scout's) reads them and proposes entries and facts; you accept what's right.
          Documents read again only when they change.
        </p>
        {!state.model && (
          <p className="form-error">
            Choose a scout model in{' '}
            <button className="link-btn" onClick={() => useStore.getState().setSettingsOpen(true, 'writing')}>
              Settings → Documents
            </button>{' '}
            first; the bible reads and checks with it.
          </p>
        )}
        {sources.length === 0 ? (
          <p className="field-note">
            Your library is empty. Add folders in{' '}
            <button className="link-btn" onClick={() => useStore.getState().setSettingsOpen(true, 'writing')}>
              Settings → Documents
            </button>
            .
          </p>
        ) : (
          <>
            <button className="link-btn bible-files-toggle" onClick={() => setShowFiles((v) => !v)}>
              {chosen.length ? `${chosen.length} of ${sources.length} documents chosen` : `Choose from ${sources.length} documents`}
            </button>
            {(showFiles || !chosen.length) && (
              <div className="bible-files">
                {sources.map((s) => (
                  <label key={s.path} className="check bible-file">
                    <input type="checkbox" checked={s.chosen} onChange={(e) => toggle(s.path, e.target.checked)} />
                    {s.source}
                    {s.chosen && !s.current && <span className="field-note"> · not read yet</span>}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {reading ? (
          <>
            <p className="field-note" aria-live="polite">
              Reading {reading.file}: {reading.done.toLocaleString()} of {reading.total.toLocaleString()} passages…
            </p>
            <Progress done={reading.done} total={reading.total} />
            <div className="data-actions">
              <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void api.stopBibleReading()}>
                Stop
              </button>
            </div>
          </>
        ) : (
          <div className="data-actions">
            <button className="tw-btn tw-btn-sm tw-btn-primary bible-read" disabled={!state.model || !chosen.length || !stale} onClick={() => void api.readBible()}>
              {stale ? `Read ${stale === chosen.length ? 'them' : `the ${stale} changed`}` : 'Up to date'}
            </button>
            {state.lastRead && <span className="field-note">Last read {new Date(state.lastRead).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          </div>
        )}
        {state.error && <p className="form-error">{state.error}</p>}
      </div>

      <div className="settings-card bible-review">
        <div className="panel-head">
          <h3 className="t-heading">Waiting for you</h3>
          {newEntries.length + newFacts.length > 0 && (
            <button className="tw-btn tw-btn-sm bible-accept-all" onClick={acceptAll}>
              Accept all
            </button>
          )}
        </div>
        {newEntries.length + newFacts.length === 0 ? (
          <p className="field-note">Nothing to review.{counts.length > 0 && ` The bible holds ${counts.map((k) => `${k.n} ${k.n === 1 ? k.label.toLowerCase() : k.plural.toLowerCase()}`).join(', ')}.`}</p>
        ) : (
          <>
            {newEntries.map((e) => (
              <div key={e.id} className="bible-proposal" data-entry={e.id}>
                <div className="bible-proposal-head">
                  <button className="link-btn bible-proposal-name" onClick={() => useBible.getState().open(e.id)}>
                    {e.name}
                  </button>
                  <span className="tw-badge">{kindLabel(e.kind)}</span>
                  {e.aliases.length > 0 && <span className="field-note">also {e.aliases.join(', ')}</span>}
                  <span className="tw-spacer" />
                  <button className="tw-btn tw-btn-sm bible-accept-entry" onClick={() => void api.reviewBible('accept', { entries: [e.id] }).then(set)}>
                    Accept
                  </button>
                  <button className="tw-btn tw-btn-ghost tw-btn-sm bible-remove-entry" onClick={() => void api.reviewBible('remove', { entries: [e.id] }).then(set)}>
                    Turn down
                  </button>
                </div>
                <ul className="bible-facts">
                  {e.facts.filter((f) => f.status !== 'removed').map((f) => (
                    <Fact key={f.id} fact={f} />
                  ))}
                </ul>
              </div>
            ))}
            {newFacts.length > 0 && (
              <div className="bible-proposal">
                <div className="bible-proposal-head">
                  <strong>New facts about entries you have</strong>
                </div>
                <ul className="bible-facts">
                  {newFacts.map(({ e, f }) => (
                    <Fact key={f.id} fact={f} owner={e} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function BibleView() {
  const state = useBible((s) => s.state)
  const page = useBible((s) => s.page)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  useEffect(() => {
    void useBible.getState().init()
  }, [])
  const entry = page ? state?.entries.find((e) => e.id === page) : undefined

  return (
    <main className="chat bible">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{entry ? entry.name : 'Story bible'}</h1>
        {state && (
          <label className="check no-drag bible-switch" title="Off: nothing is read, nothing goes into chats, nothing is checked">
            <input type="checkbox" checked={state.settings.on} onChange={(e) => void api.setBibleSettings({ on: e.target.checked }).then(useBible.getState().set)} />
            On
          </label>
        )}
      </header>
      <div className="judge-scroll bible-scroll">
        {!state ? null : !state.settings.on ? (
          <div className="empty">
            <h2 className="t-display">Story bible</h2>
            <p className="empty-sub">
              The characters, places and facts of your story, read from the documents you choose and kept once you accept them. Chats bring the entries a message names, and
              the continuity watcher flags anything that contradicts them.
            </p>
            <button className="tw-btn tw-btn-primary bible-turn-on" onClick={() => void api.setBibleSettings({ on: true }).then(useBible.getState().set).catch((err) => useStore.getState().setError(clean(err)))}>
              <BookIcon />
              Switch it on
            </button>
          </div>
        ) : entry ? (
          <EntryPage entry={entry} />
        ) : (
          <Overview />
        )}
      </div>
    </main>
  )
}
