import { useEffect, useState } from 'react'
import type { LibraryHit, LibrarySettings, LibraryStatus, ScoutCaseResult } from '@shared/docLibrary'
import { useStore } from '../store'
import { FolderPlusIcon, RefreshIcon, SearchIcon, TrashIcon } from './Icons'

// Settings → Writing → Document library: the folders searched, how the index is doing, the
// embedding model for search by meaning, the scout that picks passages for each message, and a
// search box to see what a message would bring.

const api = window.twilight
const when = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function LibraryCard() {
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<LibraryHit[] | null>(null)
  // What the last try did: plain search, or the scout (with its searches and time).
  const [scouted, setScouted] = useState<{ searches: string[]; ms: number; read: number } | null>(null)
  const [busy, setBusy] = useState<'search' | 'scout' | 'test' | null>(null)
  const [tried, setTried] = useState<{ file: string; results: ScoutCaseResult[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  const scoutChosen = settings.scoutProviderId && settings.scoutModelId ? `${settings.scoutProviderId}::${settings.scoutModelId}` : ''
  const run = async <T,>(kind: 'search' | 'scout' | 'test', work: () => Promise<T>): Promise<T | null> => {
    setBusy(kind)
    setError(null)
    try {
      return await work()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      return null
    } finally {
      setBusy(null)
    }
  }
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
      <div className="field-row">
        <label className="field">
          <span className="field-label">Scout</span>
          <select
            className="library-scout"
            value={scoutChosen}
            onChange={(e) => {
              const [providerId, modelId] = e.target.value ? e.target.value.split('::') : [null, null]
              change({ scoutProviderId: providerId, scoutModelId: modelId })
            }}
          >
            <option value="">Off: plain search</option>
            {scoutChosen && !models.some((m) => `${m.providerId}::${m.id}` === scoutChosen) && <option value={scoutChosen}>{settings.scoutModelId}</option>}
            {models.map((m) => (
              <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                {m.name} · {providers.find((x) => x.id === m.providerId)?.name}
              </option>
            ))}
          </select>
          <span className="field-note">
            A small fast model, like Claude Haiku or a local one, reads the best candidates for each message first and picks what the reply needs. They come as whole scenes in story order. It adds a moment before each reply.
          </span>
        </label>
        <label className="field library-count">
          <span className="field-label">Scout's words</span>
          <input type="number" min={300} max={20000} step={100} value={settings.scoutWords} disabled={!scoutChosen} onChange={(e) => change({ scoutWords: Number(e.target.value) || 300 })} />
        </label>
      </div>
      <form
        className="library-try"
        onSubmit={(e) => {
          e.preventDefault()
          const q = query.trim()
          if (!q) return
          const scoutIt = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'scout'
          if (scoutIt)
            void run('scout', () => api.scoutDocLibrary(q)).then((r) => {
              if (!r) return
              setHits(r.hits)
              setScouted({ searches: r.searches, ms: r.ms, read: r.read })
            })
          else
            void run('search', () => api.searchDocLibrary(q)).then((r) => {
              if (!r) return
              setHits(r)
              setScouted(null)
            })
        }}
      >
        <input value={query} placeholder="Try a search: what would a message about this bring?" onChange={(e) => setQuery(e.target.value)} />
        <button className="tw-btn tw-btn-sm" type="submit" value="search" disabled={!query.trim() || !status.passages || !!busy}>
          <SearchIcon size={14} />
          Search
        </button>
        {scoutChosen && (
          <button className="tw-btn tw-btn-sm library-scout-try" type="submit" value="scout" disabled={!query.trim() || !status.passages || !!busy}>
            {busy === 'scout' ? 'Scouting…' : 'Scout'}
          </button>
        )}
      </form>
      {scoutChosen && (
        <div className="data-actions">
          <button className="tw-btn tw-btn-ghost tw-btn-sm library-scout-test" disabled={!status.passages || !!busy} onClick={() => void run('test', () => api.testScout()).then((r) => r && setTried(r))}>
            {busy === 'test' ? 'Testing the scout…' : 'Test the scout…'}
          </button>
          <span className="field-note">A JSON file of questions, each {'{"ask": "…", "expect": ["words the right passages contain"]}'}. Each runs through plain search and through the scout.</span>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {tried && <ScoutReport file={tried.file} results={tried.results} />}
      {scouted && hits && (
        <p className="field-note library-scouted">
          Read {scouted.read} candidates{scouted.searches.length ? `, searched for ${scouted.searches.map((s) => `“${s}”`).join(', ')}` : ''}, in {(scouted.ms / 1000).toFixed(1)}s.
        </p>
      )}
      {hits && (
        <ol className="library-hits">
          {hits.map((h, i) => (
            <li key={i}>
              <span className="library-hit-source">
                {h.source}
                {h.section ? ` › ${h.section}` : ''}, line {h.line}
              </span>
              <span className="library-hit-text">{h.text.length > 240 ? `${h.text.slice(0, 240)}…` : h.text}</span>
            </li>
          ))}
          {hits.length === 0 && <li className="field-note">{scouted ? 'The scout found nothing this needs.' : 'Nothing matched.'}</li>}
        </ol>
      )}
    </div>
  )
}

/** The scout test's results: how much of what each question needed plain search and the scout found, and at what size. */
function ScoutReport({ file, results }: { file: string; results: ScoutCaseResult[] }) {
  const total = results.reduce((n, r) => n + r.expect, 0)
  const plain = results.reduce((n, r) => n + r.plain.found, 0)
  const ok = results.filter((r) => !('error' in r.scout))
  const scout = ok.reduce((n, r) => n + ('found' in r.scout ? r.scout.found : 0), 0)
  const words = (chars: number): string => `${Math.round(chars / 6).toLocaleString()} words`
  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const pct = (n: number): string => `${total ? Math.round((n / total) * 100) : 0}%`
  return (
    <div className="scout-report">
      <p className="field-note">
        {file}: {results.length} questions. Plain search found {pct(plain)} of what they needed (about {words(avg(results.map((r) => r.plain.chars)))} each); the scout found {pct(scout)} (about{' '}
        {words(avg(ok.map((r) => ('chars' in r.scout ? r.scout.chars : 0))))} each, {(avg(ok.map((r) => ('ms' in r.scout ? r.scout.ms : 0))) / 1000).toFixed(1)}s).
      </p>
      <table className="scout-table">
        <thead>
          <tr>
            <th>Question</th>
            <th>Plain</th>
            <th>Scout</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td>{r.ask.length > 90 ? `${r.ask.slice(0, 90)}…` : r.ask}</td>
              <td>
                {r.plain.found}/{r.expect}
              </td>
              <td title={'error' in r.scout ? r.scout.error : r.scout.searches.join(', ')}>{'error' in r.scout ? 'Failed' : `${r.scout.found}/${r.expect}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
