import { useState } from 'react'
import type { ContinuityIssue } from '@shared/bible'
import type { NodeView } from '@shared/types'
import { useChecking } from '../continuity'
import { useStore } from '../store'
import { AlertIcon, BookIcon } from './Icons'

// Under a reply: what the continuity watcher found against the story bible. Each clash can update
// the bible (the reply is right), fix the reply (the bible is right: the passage is rewritten and
// shown before it's saved as a new version), or be ignored as intended.

const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Issue({ node, issue }: { node: NodeView; issue: ContinuityIssue }) {
  const [fix, setFix] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const chat = useStore((s) => s.current)
  const resolve = async (action: 'update' | 'ignore' | 'fixed'): Promise<void> => {
    if (!chat) return
    const left = await window.twilight.resolveContinuity(issue, action, `Chat: ${chat.title}`, node.id)
    useStore.getState().setContinuity(node.id, left)
  }
  const askFix = async (): Promise<void> => {
    if (!chat) return
    setBusy(true)
    try {
      setFix(await window.twilight.editPassage(chat.id, node.id, issue.quote, `Change this so it agrees with the established fact: ${issue.factText} Keep everything else as it is.`, true, 'a'))
    } catch (err) {
      useStore.getState().setError(clean(err))
    } finally {
      setBusy(false)
    }
  }
  const accept = async (): Promise<void> => {
    if (fix === null) return
    await resolve('fixed')
    await useStore.getState().editMessage(node.id, node.text.replace(issue.quote, fix), 'a', false)
  }
  return (
    <li className="continuity-issue" data-issue={issue.id}>
      <p className="continuity-quote">“{issue.quote}”</p>
      <p className="continuity-fact">
        <BookIcon size={12} /> Your bible, under {issue.entryName}: {issue.factText}
      </p>
      {issue.why && <p className="field-note">{issue.why}</p>}
      {fix !== null ? (
        <div className="continuity-fix">
          <div className="passage-compare">
            <div className="passage-old">{issue.quote}</div>
            <div className="passage-new">{fix}</div>
          </div>
          <div className="continuity-actions">
            <button className="tw-btn tw-btn-sm tw-btn-primary continuity-accept" onClick={() => void accept()} title="Saved as a new version of the reply; the original stays one ‹ › away">
              Accept
            </button>
            <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setFix(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <div className="continuity-actions">
          <button className="tw-btn tw-btn-sm continuity-update" title={`The reply is right: “${issue.says}” replaces the bible's fact`} onClick={() => void resolve('update')}>
            Update the bible
          </button>
          <button className="tw-btn tw-btn-sm continuity-fix-btn" disabled={busy} title="The bible is right: rewrite this passage to agree with it" onClick={() => void askFix()}>
            {busy ? 'Fixing…' : 'Fix the text'}
          </button>
          <button className="tw-btn tw-btn-ghost tw-btn-sm continuity-ignore" title="It's intended: don't flag this again" onClick={() => void resolve('ignore')}>
            Ignore
          </button>
        </div>
      )}
    </li>
  )
}

export function ContinuityNote({ node }: { node: NodeView }) {
  const checking = useChecking(node.id)
  if (checking) {
    return (
      <div className="continuity-note is-checking" role="status">
        <span className="tw-spin" /> Checking against your story bible…
      </div>
    )
  }
  const issues = node.continuity ?? []
  if (!issues.length) return null
  return (
    <div className="continuity-note" role="status">
      <div className="continuity-head">
        <AlertIcon size={14} />
        {issues.length === 1 ? 'A possible clash with your story bible' : `${issues.length} possible clashes with your story bible`}
      </div>
      <ul className="continuity-list">
        {issues.map((i) => (
          <Issue key={i.id} node={node} issue={i} />
        ))}
      </ul>
    </div>
  )
}
