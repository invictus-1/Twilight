import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { SendIcon, StopIcon } from './Icons'
import { ModelPicker } from './ModelPicker'

const MAX_LINES = 12
const LINE = 22

export function Composer() {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const streaming = useStore((s) => s.current?.path.at(-1)?.status === 'streaming')
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
    <div className="composer-wrap">
      <div className="tw-composer">
        <textarea
          ref={area}
          rows={2}
          value={text}
          placeholder="Ask anything"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="tw-composer-bar">
          <span className="tw-spacer" />
          <ModelPicker />
          {streaming ? (
            <button className="tw-send" aria-label="Stop (Esc)" title="Stop (Esc)" onClick={() => void stop()}>
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
