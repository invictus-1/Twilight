import { useLayoutEffect, useRef, useState } from 'react'
import { formatTokens } from '@shared/pricing'
import type { Attachment, SendTarget } from '@shared/types'
import { useStore } from '../store'
import { CloseIcon, PaperclipIcon, SendIcon, StopIcon } from './Icons'
import { ModelPicker } from './ModelPicker'

const MAX_LINES = 12
const LINE = 22

const TARGETS: { value: SendTarget; label: string; hint: string }[] = [
  { value: 'a', label: 'A', hint: 'Alt+1' },
  { value: 'b', label: 'B', hint: 'Alt+2' },
  { value: 'both', label: 'Both', hint: 'Alt+3' }
]

const PLACEHOLDER: Record<SendTarget, string> = { a: 'Message A', b: 'Message B', both: 'Message both panes' }

export function Composer() {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const area = useRef<HTMLTextAreaElement>(null)
  const split = useStore((s) => !!s.current?.split)
  const target = useStore((s) => (s.current?.split ? s.target : 'a'))
  const streaming = useStore((s) => {
    const c = s.current
    if (!c) return false
    const a = c.path.at(-1)?.status === 'streaming'
    const b = c.split?.path.at(-1)?.status === 'streaming'
    return target === 'a' ? a : target === 'b' ? b : a || b
  })
  const send = useStore((s) => s.send)
  const stop = useStore((s) => s.stop)
  const currentId = useStore((s) => s.current?.id)
  const choiceCards = useStore((s) => s.current?.settings.choiceCards ?? false)

  // Grow with the text up to MAX_LINES, then scroll.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES * LINE + 8)}px`
  }, [text])

  useLayoutEffect(() => area.current?.focus(), [currentId])

  const submit = (): void => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || streaming) return
    setText('')
    setAttachments([])
    void send(value, attachments)
  }

  const attach = async (): Promise<void> => {
    try {
      const picked = await window.twilight.pickAttachments()
      if (picked.length) setAttachments((list) => [...list, ...picked])
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
    area.current?.focus()
  }

  return (
    <div className={`composer-wrap ${split ? 'composer-split' : ''}`}>
      <div className="tw-composer">
        {attachments.length > 0 && (
          <div className="tw-attach">
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="tw-badge attach-chip" title={`${a.text.length.toLocaleString()} characters, sent in full`}>
                <PaperclipIcon size={13} />
                {a.name}
                <span className="attach-size">~{formatTokens(Math.round(a.text.length / 4))}</span>
                <button
                  className="attach-remove"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={split ? 1 : 2}
          value={text}
          placeholder={split ? PLACEHOLDER[target] : 'Ask anything'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="tw-composer-bar">
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Attach files" title="Attach files (their full text goes into the message)" onClick={() => void attach()}>
            <PaperclipIcon />
          </button>
          {currentId && (
            <button
              className="tw-btn tw-btn-ghost tw-btn-sm tw-toggle"
              aria-pressed={choiceCards}
              title="Choice cards: the model offers clickable options when you should decide (adds a short instruction to the system prompt)"
              onClick={() => {
                const s = useStore.getState()
                void s.updateSettings({ choiceCards: !choiceCards }, 'a')
                if (split) void s.updateSettings({ choiceCards: !choiceCards }, 'b')
              }}
            >
              Choices
            </button>
          )}
          {split && (
            <div className="tw-seg" role="group" aria-label="Send to">
              {TARGETS.map((t) => (
                <button
                  key={t.value}
                  className={t.value === 'a' ? 'tw-seg-a' : t.value === 'b' ? 'tw-seg-b' : undefined}
                  aria-pressed={target === t.value}
                  title={`Send to ${t.label} (${t.hint})`}
                  onClick={() => useStore.getState().setTarget(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <span className="tw-spacer" />
          {!split && <ModelPicker />}
          {streaming ? (
            <button className="tw-send" aria-label="Stop (Esc)" title="Stop (Esc)" onClick={() => void stop(target)}>
              <StopIcon />
            </button>
          ) : (
            <button
              className="tw-send"
              aria-label="Send (Enter)"
              title="Send (Enter)"
              disabled={!text.trim() && attachments.length === 0}
              onClick={submit}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
