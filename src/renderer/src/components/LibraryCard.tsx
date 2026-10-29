import { useEffect, useState } from 'react'
import type { LibraryHit, LibrarySettings, LibraryStatus } from '@shared/docLibrary'
import { useStore } from '../store'
import { FolderPlusIcon, RefreshIcon, SearchIcon, TrashIcon } from './Icons'

// Settings → Writing → Document library: the folders searched, how the index is doing, the
// embedding model for search by meaning, and a search box to see what a message would bring.

const api = window.twilight
const when = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function LibraryCard() {
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<LibraryHit[] | null>(null)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  useEffect(() => {
    void api.getDocLibrary().then((l) => {
      setSettings(l.settings)
      setStatus(l.status)
    })
    return api.onDocLibrary(setStatus)
  }, [])
  if (!settings || !status) return null
  // Embeddings come from OpenAI-compatible servers; Claude has none.
  const embedders = models.filter((m) => providers.find((p) => p.id === m.providerId)?.kind !== 'anthropic')
  const chosen = settings.embedProviderId && settings.embedModelId ? `${settings.embedProviderId}::${settings.embedModelId}` : ''
  const change = (patch: Partial<LibrarySettings>): void => void api.setDocLibrarySettings(patch).then(setSettings)
  const p = status.progress
  return (
    <div className="settings-card library-card">
      <h3 className="t-heading">Document library</h3>
      <p className="field-note">
        Folders of your own writing and notes. With Document library on in a chat's Tools menu, each message brings the passages that bear on it, and models that call tools can search for more themselves. Word search runs on this PC; an embedding model adds search by meaning.
      </p>
      <div className="library-folders">
        {settings.folders.map((f) => (
          <div key={f} className="field-inline library-folder">
            <span className="folder-path log-path">{f}</span>
            <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Remove ${f} from the library`} title="Remove from the library (your files stay as they are)" onClick={() => void api.removeDocLibraryFolder(f).then(setSettings)}>
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
        {settings.folders.length === 0 && <p className="sidebar-empty">No folders yet.</p>}
      </div>
      <div className="data-actions">
        <button className="tw-btn tw-btn-sm" onClick={() => void api.addDocLibraryFolder().then((s) => s && setSettings(s))}>
          <FolderPlusIcon size={14} />
          Add folder…
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" disabled={status.indexing || !settings.folders.length} onClick={() => void api.reindexDocLibrary().then(setStatus)}>
          <RefreshIcon size={14} />
          Re-index
        </button>
      </div>
      <p className="field-note library-status" aria-live="polite">
        {status.indexing
          ? p
            ? `${p.phase === 'reading' ? 'Reading files' : 'Working out meanings'}: ${p.done.toLocaleString()} of ${p.total.toLocaleString()}…`
            : 'Indexing…'
          : `${status.files.toLocaleString()} files · ${status.passages.toLocaleString()} passages${chosen ? ` · ${status.embedded.toLocaleString()} searchable by meaning` : ''}${status.lastIndexed ? ` · checked ${when(status.lastIndexed)}` : ''}`}
      </p>
      {status.indexing && p && (
        <div className="library-progress" role="progressbar" aria-valuenow={Math.round((p.done / Math.max(1, p.total)) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} />
        </div>
      )}
      {status.error && <p className="form-error">{status.error}</p>}
      <div className="field-row">
        <label className="field">
          <span className="field-label">Search by meaning</span>
          <select
            value={chosen}
            onChange={(e) => {
              const [providerId, modelId] = e.target.value ? e.target.value.split('::') : [null, null]
              change({ embedProviderId: providerId, embedModelId: modelId })
            }}
          >
            <option value="">Off: word search only</option>
            {chosen && !embedders.some((m) => `${m.providerId}::${m.id}` === chosen) && <option value={chosen}>{settings.embedModelId}</option>}
            {embedders.map((m) => (
              <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                {m.name} · {providers.find((x) => x.id === m.providerId)?.name}
              </option>
            ))}
          </select>
          <span className="field-note">An embedding model, like nomic-embed-text on Ollama. On a local server it never leaves this PC.</span>
        </label>
        <label className="field library-count">
          <span className="field-label">Passages per message</span>
          <input type="number" min={1} max={24} value={settings.passages} onChange={(e) => change({ passages: Number(e.target.value) || 1 })} />
        </label>
      </div>
      <form
        className="library-try"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) void api.searchDocLibrary(query.trim()).then(setHits)
        }}
      >
        <input value={query} placeholder="Try a search: what would a message about this bring?" onChange={(e) => setQuery(e.target.value)} />
        <button className="tw-btn tw-btn-sm" type="submit" disabled={!query.trim() || !status.passages}>
          <SearchIcon size={14} />
          Search
        </button>
      </form>
      {hits && (
        <ol className="library-hits">
          {hits.map((h, i) => (
            <li key={i}>
              <span className="library-hit-source">
                {h.source}, line {h.line}
              </span>
              <span className="library-hit-text">{h.text.length > 240 ? `${h.text.slice(0, 240)}…` : h.text}</span>
            </li>
          ))}
          {hits.length === 0 && <li className="field-note">Nothing matched.</li>}
        </ol>
      )}
    </div>
  )
}
