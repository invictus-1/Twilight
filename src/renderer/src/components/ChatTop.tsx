import { useState } from 'react'
import { CHOICES_INSTRUCTION, CHOICES_TOOL_INSTRUCTION } from '@shared/choices'
import { paneOf, useStore } from '../store'
import { usePane } from '../pane'
import { CopyIcon, PenIcon } from './Icons'
import { EmptySky } from './Sky'

/** Copies text, saying so on the button for a moment. */
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="tw-btn tw-btn-ghost tw-btn-sm"
      onClick={() => {
        void window.twilight.copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      <CopyIcon size={13} />
      {copied ? 'Copied' : label}
    </button>
  )
}

/** The top of a chat: half a screen of the evening sky, then the chat's system prompt. */
export function ChatTop() {
  return (
    <div className="thread-top">
      <EmptySky session />
      <SystemPromptCard />
    </div>
  )
}

/**
 * The chat's system prompt, editable in place: on an empty chat before the first message, and at
 * the top of a started one. Once started, a change either replaces the system prompt (the cache
 * restarts) or goes in from the next message on (the cache holds), and every replaced prompt stays
 * here to read and copy. Compact shows two lines until it's opened.
 */
export function SystemPromptCard({ compact = false }: { compact?: boolean }) {
  const pane = usePane()
  const settings = useStore((s) => paneOf(s.current!, pane).settings)
  const started = useStore((s) => !!s.current?.started)
  const [open, setOpen] = useState(!compact)
  const [draft, setDraft] = useState<string | null>(null)
  const prompt = settings.systemPrompt
  const history = settings.promptHistory ?? []
  const update = (patch: Parameters<ReturnType<typeof useStore.getState>['updateSettings']>[0]): void => {
    void useStore.getState().updateSettings(patch, pane)
    setDraft(null)
  }
  const changed = draft !== null && draft !== prompt
  // What choice cards add after the system prompt (the same rule as the request), shown so nobody
  // wonders where it came from.
  const howTo = settings.choiceCards && settings.choiceInstructions ? (settings.choiceTool ? CHOICES_TOOL_INSTRUCTION : settings.choiceFenced ? CHOICES_INSTRUCTION : '') : ''

  return (
    <section className={`chat-prompt ${compact ? 'is-compact' : ''}`} aria-label="System prompt">
      <div className="chat-prompt-head">
        <span className="chat-prompt-label">System prompt</span>
        {draft === null && (
          <>
            {prompt && <CopyButton text={prompt} />}
            <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setDraft(prompt)}>
              <PenIcon size={13} />
              {prompt ? 'Edit' : 'Add one'}
            </button>
          </>
        )}
      </div>
      {draft === null ? (
        prompt ? (
          <div className={`chat-prompt-text ${open ? '' : 'is-clamped'}`} onClick={() => setOpen(true)} title={open ? undefined : 'Show all'}>
            {prompt}
          </div>
        ) : (
          <p className="chat-prompt-none">None. The model gets only your messages.</p>
        )
      ) : (
        <>
          <textarea className="chat-prompt-edit" rows={6} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} placeholder="Instructions the model follows for this chat" />
          <div className="chat-prompt-actions">
            <button className="tw-btn tw-btn-sm tw-btn-primary" disabled={!changed} onClick={() => update({ systemPrompt: draft })} title={started ? 'Every message is sent again under the new system prompt' : undefined}>
              {started ? 'Save, restarting the cache' : 'Save'}
            </button>
            {started && (
              <button
                className="tw-btn tw-btn-sm"
                disabled={!changed || !draft.trim()}
                onClick={() => update({ pendingInstruction: [settings.pendingInstruction, draft].filter((t) => t.trim()).join('\n\n') })}
                title="Goes into your next message instead, so everything before it stays cached"
              >
                From the next message on
              </button>
            )}
            <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
          {started && <p className="field-note">Saving sends the whole chat again under the new prompt, so the prompt cache restarts. From the next message on keeps it.</p>}
        </>
      )}
      {howTo && draft === null && (
        <details className="chat-prompt-added">
          <summary>Choice cards add their how-to after it</summary>
          <div className="chat-prompt-text">{howTo}</div>
          <button
            className="tw-btn tw-btn-ghost tw-btn-sm"
            onClick={() => update({ choiceInstructions: false })}
            title="Your own prompt then says how to offer choices. The system prompt changes, so the prompt cache restarts."
          >
            Stop adding it
          </button>
        </details>
      )}
      {settings.pendingInstruction.trim() && draft === null && (
        <p className="chat-prompt-pending">From your next message: {settings.pendingInstruction}</p>
      )}
      {history.length > 0 && (
        <details className="chat-prompt-history">
          <summary>Earlier system prompts ({history.length})</summary>
          {[...history].reverse().map((h) => (
            <div key={h.until} className="chat-prompt-old">
              <div className="chat-prompt-old-head">
                <span>Used until {new Date(h.until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <CopyButton text={h.text} />
              </div>
              <div className="chat-prompt-text">{h.text}</div>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

/** A quiet line on a reply written under an earlier system prompt, to read or copy that prompt. */
export function EarlierPrompt({ createdAt }: { createdAt: number }) {
  const pane = usePane()
  const history = useStore((s) => (s.current ? paneOf(s.current, pane).settings.promptHistory : undefined))
  const now = useStore((s) => (s.current ? paneOf(s.current, pane).settings.systemPrompt : ''))
  const used = history?.find((h) => createdAt < h.until)
  // Changed and changed back: the reply's prompt is the one in use, so there's nothing to flag.
  if (!used || used.text === now) return null
  return (
    <details className="earlier-prompt">
      <summary>Written under an earlier system prompt</summary>
      <div className="chat-prompt-text">{used.text}</div>
      <CopyButton text={used.text} label="Copy that prompt" />
    </details>
  )
}
