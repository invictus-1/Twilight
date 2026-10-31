import { useEffect, useMemo, useState } from 'react'
import type { ContinuityIssue, ContinuityPreset } from '@shared/types'
import { formatTokens } from '@shared/pricing'
import { editorText } from '../gameCopy'
import { useWriting } from '../writingStore'
import { CloseIcon } from './Icons'

// Writing → Continuity: check the selection (or the whole document) against documents you pick,
// with the writing tools' model. Presets keep sets you check against often ("Characters",
// "Lore"); Everything takes every document. Nothing runs until you press Check.

const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const LAST_KEY = 'twilight.continuityDocs'
const title = (path: string): string => path.replace(/\.md$/i, '')

/** Asks the open editor to rewrite a passage (Editor listens). */
export const FIX_EVENT = 'twilight-continuity-fix'

function lastChosen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function ContinuityPanel({ onClose }: { onClose: () => void }) {
  const open = useWriting((s) => s.open)!
  const docs = useWriting((s) => s.docs)
  const others = useMemo(() => docs.filter((d) => d.path !== open.path).sort((a, b) => a.path.localeCompare(b.path)), [docs, open.path])
  const [chosen, setChosen] = useState<string[]>(() => lastChosen().filter((p) => p !== open.path))
  const [presets, setPresets] = useState<ContinuityPreset[]>([])
  const [naming, setNaming] = useState(false)
  const [filter, setFilter] = useState('')
  const [issues, setIssues] = useState<ContinuityIssue[] | null>(null)
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.twilight.continuityPresets().then(setPresets)
  }, [])

  const known = new Set(others.map((d) => d.path))
  const picked = chosen.filter((p) => known.has(p))
  const tokens = others.filter((d) => picked.includes(d.path)).reduce((n, d) => n + d.size / 4, 0)
  const choose = (paths: string[]): void => {
    setChosen(paths)
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(paths))
    } catch {
      // Storage unavailable: the choice holds while the panel is open.
    }
  }
  const savePresets = (list: ContinuityPreset[]): void => void window.twilight.saveContinuityPresets(list).then(setPresets)
  const isPreset = (p: ContinuityPreset): boolean => p.paths.length === picked.length && p.paths.every((x) => picked.includes(x))
  const shown = others.filter((d) => d.path.toLowerCase().includes(filter.trim().toLowerCase()))

  const check = async (): Promise<void> => {
    const text = editorText.get?.() ?? open.text
    setScope(text.length === open.text.length ? 'the whole document' : 'the selection')
    setBusy(true)
    setError(null)
    setIssues(null)
    try {
      setIssues(await window.twilight.checkContinuity(open.path, text, picked))
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }
  const dismiss = (issue: ContinuityIssue): void => setIssues((list) => list?.filter((i) => i.id !== issue.id) ?? null)
  const fix = (issue: ContinuityIssue): void => {
    window.dispatchEvent(
      new CustomEvent(FIX_EVENT, {
        detail: { quote: issue.quote, instruction: `Change this so it agrees with ${title(issue.reference)}, which says: "${issue.evidence}". Keep everything else as it is.` }
      })
    )
    dismiss(issue)
  }

  return (
    <section className="panel context-panel continuity-panel" aria-label="Continuity">
      <div className="panel-head">
        <h2 className="t-heading">Continuity</h2>
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p className="field-note">
        Checks the selection, or the whole document when nothing is selected, against the documents you pick, with the writing tools' model. Pick only what bears on it:
        less to read is quicker, cheaper and sharper.
      </p>

      <div className="continuity-presets" role="group" aria-label="Presets">
        <button className="tw-btn tw-btn-sm continuity-preset" aria-pressed={picked.length === others.length && others.length > 0} onClick={() => choose(others.map((d) => d.path))}>
          Everything
        </button>
        {presets.map((p) => (
          <span key={p.name} className="continuity-preset-wrap">
            <button className="tw-btn tw-btn-sm continuity-preset" aria-pressed={isPreset(p)} data-preset={p.name} onClick={() => choose(p.paths.filter((x) => known.has(x)))}>
              {p.name}
            </button>
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon continuity-preset-remove"
              aria-label={`Remove the preset ${p.name}`}
              title="Remove this preset (the documents stay)"
              onClick={() => savePresets(presets.filter((x) => x.name !== p.name))}
            >
              <CloseIcon size={11} />
            </button>
          </span>
        ))}
        {naming ? (
          <input
            className="continuity-preset-name"
            autoFocus
            placeholder="Name, like Characters"
            onBlur={(e) => {
              const name = e.currentTarget.value.trim()
              if (name && picked.length) savePresets([...presets.filter((p) => p.name !== name), { name, paths: picked }])
              setNaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.currentTarget.value = ''
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <button className="link-btn continuity-save-preset" disabled={!picked.length} onClick={() => setNaming(true)}>
            Save as a preset
          </button>
        )}
      </div>

      <input placeholder="Filter documents" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="ref-list continuity-docs">
        {shown.map((d) => (
          <label key={d.path} className="check ref-item">
            <input type="checkbox" checked={picked.includes(d.path)} onChange={(e) => choose(e.target.checked ? [...picked, d.path] : picked.filter((p) => p !== d.path))} />
            <span className="ref-name">{title(d.path)}</span>
            <span className="ref-size">~{formatTokens(Math.round(d.size / 4))}</span>
          </label>
        ))}
        {!others.length && <p className="field-note">No other documents yet.</p>}
      </div>

      <div className="data-actions">
        <button className="tw-btn tw-btn-sm tw-btn-primary continuity-check" disabled={busy || !picked.length} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check'}
        </button>
        <span className="field-note">
          {picked.length ? `${picked.length} ${picked.length === 1 ? 'document' : 'documents'}, about ${formatTokens(Math.round(tokens))} tokens` : 'Pick documents to check against'}
        </span>
        {busy && <span className="tw-spin" />}
      </div>
      {error && <p className="form-error">{error}</p>}
      {issues && (
        <p className="field-note continuity-result">{issues.length === 0 ? `Nothing in ${scope} contradicts them.` : `${issues.length} possible ${issues.length === 1 ? 'clash' : 'clashes'} in ${scope}:`}</p>
      )}
      {issues && issues.length > 0 && (
        <ul className="continuity-list">
          {issues.map((issue) => (
            <li key={issue.id} className="continuity-issue" data-issue={issue.id}>
              <button className="continuity-quote link-btn" title="Show it in the text" onClick={() => void useWriting.getState().revealIn(open.path, issue.quote)}>
                “{issue.quote}”
              </button>
              <p className="continuity-fact">
                <button className="link-btn" title="Open it there" onClick={() => void useWriting.getState().revealIn(issue.reference, issue.evidence)}>
                  {title(issue.reference)}
                </button>{' '}
                says “{issue.evidence}”
              </p>
              {issue.why && <p className="field-note">{issue.why}</p>}
              <div className="continuity-actions">
                <button className="tw-btn tw-btn-sm continuity-fix-btn" title="The editor proposes a rewrite that agrees, to accept or reject" onClick={() => fix(issue)}>
                  Fix the text
                </button>
                <button className="tw-btn tw-btn-ghost tw-btn-sm continuity-ignore" title="It's intended" onClick={() => dismiss(issue)}>
                  Ignore
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

