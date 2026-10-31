import { useMemo, useState } from 'react'
import type { DocContext } from '@shared/types'
import { formatTokens } from '@shared/pricing'
import { gameFormat } from '@shared/gameFormat'
import { editorText } from '../gameCopy'
import { readGameFormat } from '../gameFormatSettings'
import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { Editor } from './Editor'
import { BookIcon, CloseIcon, PlusIcon, SidebarIcon, SlidersIcon, UndoIcon } from './Icons'
import { ContinuityPanel } from './ContinuityPanel'
import { ModelPicker } from './ModelPicker'

const STATUS = { saved: 'Saved', unsaved: 'Edited', saving: 'Saving…', error: "Couldn't save" } as const

/** Rough token count (~4 characters a token) for the cost hints. */
const tokensOf = (chars: number): number => Math.round(chars / 4)

/** What the writing tools see for this document: instructions, reference documents, and how much manuscript. */
function ContextPanel({ onClose }: { onClose: () => void }) {
  const open = useWriting((s) => s.open)!
  const context = useWriting((s) => s.context) ?? { instructions: '', references: [], wholeManuscript: false }
  const docs = useWriting((s) => s.docs)
  const [filter, setFilter] = useState('')
  const save = (patch: Partial<DocContext>): void => void useWriting.getState().saveContext({ ...context, ...patch })
  const candidates = useMemo(
    () =>
      docs
        .filter((d) => d.path !== open.path && d.path.toLowerCase().includes(filter.trim().toLowerCase()))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [docs, open.path, filter]
  )
  const refChars = docs.filter((d) => context.references.includes(d.path)).reduce((n, d) => n + d.size, 0)
  const docChars = open.text.length

  return (
    <section className="panel context-panel" aria-label="Document context">
      <div className="panel-head">
        <h2 className="t-heading">Context for writing tools</h2>
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p className="field-note">
        Ask, Rewrite and the other tools send this along with your selection, like a chat would. Only the selected passage ever
        changes.
      </p>

      <label className="field">
        <span className="field-label">Instructions for this document</span>
        <textarea
          rows={4}
          defaultValue={context.instructions}
          placeholder="Voice, tense, rules: “Close third person on Wren, past tense, no adverbs in dialogue tags.”"
          onBlur={(e) => e.currentTarget.value !== context.instructions && save({ instructions: e.currentTarget.value })}
        />
      </label>

      <div className="field">
        <span className="field-label">
          Reference documents {context.references.length > 0 && `· ${context.references.length} · ~${formatTokens(tokensOf(refChars))} tokens`}
        </span>
        <input placeholder="Filter documents" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="ref-list">
          {candidates.map((d) => (
            <label key={d.path} className="check ref-item">
              <input
                type="checkbox"
                checked={context.references.includes(d.path)}
                onChange={(e) =>
                  save({ references: e.target.checked ? [...context.references, d.path] : context.references.filter((p) => p !== d.path) })
                }
              />
              <span className="ref-name">{d.path.replace(/\.md$/i, '')}</span>
              <span className="ref-size">~{formatTokens(tokensOf(d.size))}</span>
            </label>
          ))}
          {candidates.length === 0 && <p className="field-note">No other documents{filter ? ' match' : ''}.</p>}
        </div>
        <span className="field-note">Sent in full and cached, so after the first run they cost little.</span>
      </div>

      <label className="check">
        <input type="checkbox" checked={context.wholeManuscript} onChange={(e) => save({ wholeManuscript: e.target.checked })} />
        Send the whole manuscript (~{formatTokens(tokensOf(docChars))} tokens) instead of about 1,000 words around the selection
      </label>
      {context.wholeManuscript && (
        <p className="field-note">
          Best continuity. The manuscript is cached between runs, but every edit you make changes it, so the next run pays to cache it
          again.
        </p>
      )}
    </section>
  )
}

export function WritingView() {
  const open = useWriting((s) => s.open)
  const status = useWriting((s) => s.status)
  const words = useWriting((s) => s.words)
  const editCount = useWriting((s) => s.editCount)
  const historyOpen = useWriting((s) => s.historyOpen)
  const hasContext = useWriting((s) => !!s.context && (s.context.instructions.trim() !== '' || s.context.references.length > 0 || s.context.wholeManuscript))
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const [contextOpen, setContextOpen] = useState(false)
  const [continuityOpen, setContinuityOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <main className="chat writing">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{open ? open.path.replace(/\.md$/i, '') : 'Writing'}</h1>
        {open && (
          <>
            <span className={`doc-status doc-status-${status}`}>
              {words.toLocaleString()} words · {STATUS[status]}
            </span>
            <button
              className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
              aria-pressed={historyOpen}
              title="AI edits you accepted, with Revert"
              onClick={() => useWriting.getState().toggleHistory()}
            >
              <UndoIcon />
              Edits{editCount > 0 && ` · ${editCount}`}
            </button>
            <button
              className="tw-btn tw-btn-ghost tw-btn-sm no-drag game-format-btn"
              title="Copy for a game: the selection, or the whole document when nothing is selected, with paragraphs joined by single line breaks (options in Settings)"
              onClick={() => {
                void window.twilight.copyText(gameFormat(editorText.get?.() ?? open.text, readGameFormat()))
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              {copied ? 'Copied' : 'Game Format'}
            </button>
            <button
              className={`tw-btn tw-btn-ghost tw-btn-sm no-drag ${hasContext ? 'has-context' : ''}`}
              aria-expanded={contextOpen}
              title="What the writing tools know: instructions, references, manuscript"
              onClick={() => setContextOpen((o) => !o)}
            >
              <SlidersIcon />
              Context
            </button>
            <button
              className="tw-btn tw-btn-ghost tw-btn-sm no-drag continuity-open"
              aria-expanded={continuityOpen}
              title="Check the selection, or the document, against documents you pick"
              onClick={() => setContinuityOpen((o) => !o)}
            >
              <BookIcon />
              Continuity
            </button>
          </>
        )}
        <div className="no-drag" title="Model used by the writing tools">
          <ModelPicker placement="down" scope="defaults" />
        </div>
      </header>
      {contextOpen && open && <ContextPanel key={open.path} onClose={() => setContextOpen(false)} />}
      {continuityOpen && open && <ContinuityPanel key={`continuity:${open.path}`} onClose={() => setContinuityOpen(false)} />}
      {open ? (
        <Editor key={open.path} docPath={open.path} />
      ) : (
        <div className="empty">
          <h2 className="t-display">Write something</h2>
          <p className="empty-sub">Open a document from the sidebar, or start a new one.</p>
          <button className="tw-btn tw-btn-primary" onClick={() => void useWriting.getState().newDoc()}>
            <PlusIcon />
            New document
          </button>
        </div>
      )}
    </main>
  )
}
