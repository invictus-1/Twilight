import { useState } from 'react'
import type { ContinuityIssue } from '@shared/bible'
import { editorText } from '../gameCopy'
import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { BookIcon, CloseIcon } from './Icons'

// Writing → Continuity: the selection (or the whole document) checked against the story bible
// when you ask. Each clash can be shown in the text, fixed there (the editor proposes a rewrite to
// accept or reject), written into the bible as the new truth, or ignored as intended.

const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Asks the open editor to rewrite a passage so it agrees with a fact (Editor listens). */
export const FIX_EVENT = 'twilight-continuity-fix'

export function ContinuityPanel({ onClose }: { onClose: () => void }) {
  const open = useWriting((s) => s.open)!
  const [issues, setIssues] = useState<ContinuityIssue[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState('')

  const check = async (): Promise<void> => {
    const text = editorText.get?.() ?? open.text
    setScope(text.length === open.text.length ? 'the whole document' : 'the selection')
    setBusy(true)
    setError(null)
    try {
      setIssues(await window.twilight.checkContinuity(text))
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }
  const settle = async (issue: ContinuityIssue, action: 'update' | 'ignore' | 'fixed'): Promise<void> => {
    await window.twilight.resolveContinuity(issue, action, `Writing: ${open.path.replace(/\.md$/i, '')}`)
    setIssues((list) => list?.filter((i) => i.id !== issue.id) ?? null)
  }
  const fix = (issue: ContinuityIssue): void => {
    window.dispatchEvent(new CustomEvent(FIX_EVENT, { detail: { quote: issue.quote, instruction: `Change this so it agrees with the established fact: ${issue.factText} Keep everything else as it is.` } }))
    void settle(issue, 'fixed')
  }

  return (
    <section className="panel context-panel continuity-panel" aria-label="Continuity">
      <div className="panel-head">
        <h2 className="t-heading">Continuity</h2>
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p className="field-note">Checks the selection, or the whole document when nothing is selected, against your story bible. Only passages that name an entry are sent.</p>
      <div className="data-actions">
        <button className="tw-btn tw-btn-sm tw-btn-primary continuity-check" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check continuity'}
        </button>
        {busy && <span className="tw-spin" />}
      </div>
      {error && <p className="form-error">{error}</p>}
      {issues && !busy && (
        <p className="field-note continuity-result">{issues.length === 0 ? `Nothing in ${scope} contradicts the bible.` : `${issues.length} possible ${issues.length === 1 ? 'clash' : 'clashes'} in ${scope}:`}</p>
      )}
      {issues && issues.length > 0 && (
        <ul className="continuity-list">
          {issues.map((issue) => (
            <li key={issue.id} className="continuity-issue" data-issue={issue.id}>
              <button className="continuity-quote link-btn" title="Show it in the text" onClick={() => void useWriting.getState().revealIn(open.path, issue.quote)}>
                “{issue.quote}”
              </button>
              <p className="continuity-fact">
                <BookIcon size={12} /> Your bible, under {issue.entryName}: {issue.factText}
              </p>
              {issue.why && <p className="field-note">{issue.why}</p>}
              <div className="continuity-actions">
                <button className="tw-btn tw-btn-sm continuity-update" title={`The draft is right: “${issue.says}” replaces the bible's fact`} onClick={() => void settle(issue, 'update')}>
                  Update the bible
                </button>
                <button className="tw-btn tw-btn-sm continuity-fix-btn" title="The bible is right: the editor proposes a rewrite to accept or reject" onClick={() => fix(issue)}>
                  Fix the text
                </button>
                <button className="tw-btn tw-btn-ghost tw-btn-sm continuity-ignore" title="It's intended: don't flag this again" onClick={() => void settle(issue, 'ignore').catch((err) => useStore.getState().setError(clean(err)))}>
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
