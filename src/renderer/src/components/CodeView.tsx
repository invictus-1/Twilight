import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CodeEntry, CodeMode, CodePending, DiffLine } from '@shared/code'
import { useCode } from '../codeStore'
import { renderMarkdownLive } from '../markdown'
import { modelName, useStore } from '../store'
import { AlertIcon, CheckIcon, CloseIcon, FolderIcon, SendIcon, SidebarIcon, StopIcon, UndoIcon } from './Icons'

// The Code tab: one session's transcript, the agent's approvals and questions, and your messages.

const MODES: { id: CodeMode; label: string; note: string }[] = [
  { id: 'ask', label: 'Ask first', note: 'Every edit and command waits for you.' },
  { id: 'edits', label: 'Accept edits', note: 'Edits go through (each can be undone); commands and deletions still ask.' },
  { id: 'read', label: 'Read only', note: 'The agent can look but not change anything or run commands.' }
]

const tokens = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`)

function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="code-diff">
      {lines.map((l, i) => (
        <span key={i} className={`diff-${l.kind}`}>
          {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : l.kind === 'gap' ? '⋯ ' : '  '}
          {l.text}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

function ToolEntry({ e }: { e: Extract<CodeEntry, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const has = !!e.output || !!e.diff
  const mark = { running: '…', done: '✓', declined: '✕', error: '!', undone: '↶' }[e.status]
  return (
    <div className={`code-tool code-tool-${e.status}`} data-tool={e.tool}>
      <button className="code-tool-head" disabled={!has} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="code-tool-mark" aria-hidden="true">
          {mark}
        </span>
        <span className="code-tool-title">{e.title}</span>
        {e.status === 'declined' && <span className="code-tool-note">declined</span>}
        {e.status === 'undone' && <span className="code-tool-note">undone</span>}
        {e.status === 'error' && <span className="code-tool-note">failed</span>}
      </button>
      {open && e.diff && <Diff lines={e.diff} />}
      {open && e.output && <pre className="code-output">{e.output}</pre>}
    </div>
  )
}

/** The agent is waiting on you: approve or decline a change or command, or answer a question. */
function PendingCard({ p }: { p: CodePending }) {
  const respond = useCode((s) => s.respond)
  const [text, setText] = useState('')
  if (p.kind === 'question') {
    return (
      <div className="code-pending code-question" role="dialog" aria-label="The agent asks">
        <div className="code-pending-head">The agent asks</div>
        <p className="code-question-text">{p.question}</p>
        {p.options && p.options.length > 0 && (
          <div className="code-options">
            {p.options.map((o) => (
              <button key={o} className="tw-btn tw-btn-sm" onClick={() => void respond({ approve: true, text: o })}>
                {o}
              </button>
            ))}
          </div>
        )}
        <form
          className="code-answer"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) void respond({ approve: true, text: text.trim() })
          }}
        >
          <input autoFocus value={text} placeholder="Your answer" onChange={(e) => setText(e.target.value)} />
          <button className="tw-btn tw-btn-primary tw-btn-sm" type="submit" disabled={!text.trim()}>
            Answer
          </button>
        </form>
      </div>
    )
  }
  const what = p.kind === 'command' ? 'Run this command?' : p.kind === 'delete' ? 'Move this file to the Recycle Bin?' : p.kind === 'write' ? 'Create this file?' : 'Make this change?'
  return (
    <div className={`code-pending ${p.risk ? 'code-risky' : ''}`} role="dialog" aria-label={what}>
      <div className="code-pending-head">
        {what} {p.path && <code>{p.path}</code>}
      </div>
      {p.diff && <Diff lines={p.diff} />}
      {p.command && <pre className="code-command">{p.command}</pre>}
      {p.risk && (
        <p className="code-risk" role="alert">
          <AlertIcon size={14} /> Careful: {p.risk}. Read it before you approve; Twilight can't undo what a command does.
        </p>
      )}
      {p.kind === 'command' && !p.risk && <p className="field-note">Commands run in the project folder but can reach outside it, and only file edits can be undone.</p>}
      <div className="code-pending-actions">
        <button className="tw-btn tw-btn-primary tw-btn-sm" autoFocus onClick={() => void respond({ approve: true })}>
          <CheckIcon size={14} />
          {p.kind === 'command' ? 'Run it' : 'Approve'}
        </button>
        {(p.kind === 'edit' || p.kind === 'write') && (
          <button className="tw-btn tw-btn-sm" title="Approve, and let later edits in this session through without asking" onClick={() => void respond({ approve: true, always: true })}>
            Approve all edits
          </button>
        )}
        {p.kind === 'command' && !p.risk && (
          <button className="tw-btn tw-btn-sm" title="Run it, and don't ask again for this exact command in this session" onClick={() => void respond({ approve: true, always: true })}>
            Always allow this command
          </button>
        )}
        <input className="code-decline-note" value={text} placeholder="Why not? (optional, the agent reads it)" onChange={(e) => setText(e.target.value)} />
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void respond({ approve: false, text: text.trim() || undefined })}>
          <CloseIcon size={14} />
          Decline
        </button>
      </div>
    </div>
  )
}

export function CodeView() {
  const current = useCode((s) => s.current)
  const models = useStore((s) => s.models)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => void useCode.getState().init(), [])
  const count = current?.entries.length ?? 0
  const lastText = current?.entries.at(-1)?.kind === 'assistant' ? (current.entries.at(-1) as { text: string }).text.length : 0
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, lastText, current?.pending?.id])

  if (!current) {
    return (
      <main className="chat code-view">
        <header className="chat-head drag">
          <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
            <SidebarIcon />
          </button>
          <h1 className="chat-title">Code</h1>
        </header>
        <div className="empty">
          <h2 className="t-display">Code with an agent</h2>
          <p className="empty-sub">Choose a project folder. The agent reads, edits and runs things there, and asks before it changes anything.</p>
          <button className="tw-btn tw-btn-primary" onClick={() => void useCode.getState().create()}>
            <FolderIcon />
            Open a folder
          </button>
        </div>
      </main>
    )
  }
  const shownModels = models.filter((m) => !m.hidden)
  const send = (): void => {
    if (!text.trim() || current.running) return
    void useCode.getState().send(text.trim())
    setText('')
  }
  return (
    <main className="chat code-view">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{current.title}</h1>
        <span className="code-folder no-drag" title={current.folder}>
          <FolderIcon size={14} />
          {current.folder.split(/[\\/]/).pop()}
        </span>
        <div className="tw-seg code-modes no-drag" role="radiogroup" aria-label="What the agent may do">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={current.mode === m.id} aria-pressed={current.mode === m.id} title={m.note} onClick={() => void useCode.getState().setOptions({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <select
          className="code-model no-drag"
          aria-label="Model"
          value={`${current.providerId}::${current.modelId}`}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split('::')
            void useCode.getState().setOptions({ providerId, modelId })
          }}
        >
          {!shownModels.some((m) => m.providerId === current.providerId && m.id === current.modelId) && (
            <option value={`${current.providerId}::${current.modelId}`}>{modelName(models, current.modelId)}</option>
          )}
          {shownModels.map((m) => (
            <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          disabled={current.running || current.undoable.length === 0}
          title={current.undoable.length ? `Undo: ${current.undoable.at(-1)!.label}` : 'Nothing to undo'}
          onClick={() => void useCode.getState().undo(false)}
        >
          <UndoIcon size={14} />
          Undo
        </button>
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          disabled={current.running || current.undoable.length < 2}
          title="Put back every file this session changed"
          onClick={() => void useCode.getState().undo(true)}
        >
          Undo all
        </button>
      </header>
      <div className="code-scroll" ref={scroller}>
        <div className="code-thread">
          {current.entries.length === 0 && (
            <div className="code-intro">
              <p>
                Ask for something in <b>{current.folder.split(/[\\/]/).pop()}</b>: fix a bug, explain a file, add a feature, run the tests.
              </p>
              <p className="field-note">{MODES.find((m) => m.id === current.mode)!.note} Every change is snapshotted first, so Undo puts it back.</p>
            </div>
          )}
          {current.entries.map((e, i) =>
            e.kind === 'user' ? (
              <div key={i} className="code-user">
                {e.text}
              </div>
            ) : e.kind === 'assistant' ? (
              e.text && <div key={i} className="code-assistant md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(e.text) }} />
            ) : e.kind === 'tool' ? (
              <ToolEntry key={e.id} e={e} />
            ) : e.kind === 'question' ? (
              <div key={i} className="code-asked">
                <span>Asked: {e.question}</span>
                {e.answer && <span className="code-asked-answer">You: {e.answer}</span>}
              </div>
            ) : (
              <div key={i} className="code-note">
                {e.text}
              </div>
            )
          )}
          {current.pending && <PendingCard key={current.pending.id} p={current.pending} />}
          {current.running && !current.pending && (
            <div className="code-working">
              <span className="tw-spin" /> Working
            </div>
          )}
          {current.error && (
            <div className="tw-msg-error" role="alert">
              <AlertIcon className="err-icon" />
              <div>{current.error}</div>
            </div>
          )}
        </div>
      </div>
      <div className="composer-wrap">
        <div className="tw-composer">
          <textarea
            rows={2}
            value={text}
            placeholder={current.running ? 'The agent is working…' : 'Ask the agent'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="tw-composer-bar">
            <span className="field-note code-usage">
              {current.tokens.input + current.tokens.cacheRead > 0 &&
                `${tokens(current.tokens.input + current.tokens.cacheRead)} in · ${tokens(current.tokens.output)} out · ${Math.round((current.tokens.cacheRead / Math.max(1, current.tokens.input + current.tokens.cacheRead)) * 100)}% cached`}
            </span>
            <span className="tw-spacer" />
            {current.running ? (
              <button className="tw-send" aria-label="Stop" title="Stop" onClick={() => void useCode.getState().stop()}>
                <StopIcon />
              </button>
            ) : (
              <button className="tw-send" aria-label="Send (Enter)" disabled={!text.trim()} onClick={send}>
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
