import { useLayoutEffect, useRef, useState } from 'react'
import type { SendTarget } from '@shared/types'
import { useStore } from '../store'
import { SendIcon, StopIcon } from './Icons'
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
    if (!value || streaming) return
    setText('')
    void send(value)
  }

  return (
    <div className={`composer-wrap ${split ? 'composer-split' : ''}`}>
      <div className="tw-composer">
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
            <button className="tw-send" aria-label="Send (Enter)" title="Send (Enter)" disabled={!text.trim()} onClick={submit}>
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
