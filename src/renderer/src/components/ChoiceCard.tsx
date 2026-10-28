import { useState } from 'react'
import type { ChoiceSet } from '@shared/choices'
import { usePane } from '../pane'
import { useStore } from '../store'
import { CheckIcon, PenIcon, SendIcon } from './Icons'

/**
 * The options a model offered, as a card: click to send one, the pencil to change it first,
 * or "Something else" for your own. Once answered, it shows what was picked.
 */
export function ChoiceCard({ choices, answer, active }: { choices: ChoiceSet; answer: string | null; active: boolean }) {
  const pane = usePane()
  const [editing, setEditing] = useState<number | null>(null)
  const [own, setOwn] = useState('')
  const streaming = useStore((s) => {
    const c = s.current
    const path = pane === 'b' && c?.split ? c.split.path : c?.path
    return path?.at(-1)?.status === 'streaming'
  })
  const send = (text: string): void => {
    const value = text.trim()
    if (!value || streaming) return
    setEditing(null)
    setOwn('')
    void useStore.getState().send(value, [], pane)
  }
  const picked = answer !== null ? choices.options.findIndex((o) => o.trim() === answer.trim()) : -1
  const answered = answer !== null

  return (
    <div className={`choice-card ${answered ? 'choice-answered' : ''}`} role="group" aria-label={choices.question ?? 'Choices'}>
      {choices.question && <div className="choice-question">{choices.question}</div>}
      <ol className="choice-list">
        {choices.options.map((option, i) => (
          <li key={i} className={`choice ${picked === i ? 'choice-picked' : ''}`}>
            {editing === i ? (
              <form
                className="choice-edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  send(new FormData(e.currentTarget).get('choice')?.toString() ?? '')
                }}
              >
                <span className="choice-num">{i + 1}</span>
                <input name="choice" autoFocus defaultValue={option} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                <button className="tw-btn tw-btn-ghost tw-btn-icon" type="submit" aria-label="Send edited choice">
                  <SendIcon size={14} />
                </button>
              </form>
            ) : (
              <>
                <button className="choice-pick" disabled={!active || streaming} onClick={() => send(option)}>
                  <span className="choice-num">{picked === i ? <CheckIcon size={12} /> : i + 1}</span>
                  <span className="choice-text">{option}</span>
                </button>
                {active && (
                  <button
                    className="tw-btn tw-btn-ghost tw-btn-icon choice-edit-btn"
                    aria-label={`Edit choice ${i + 1} before sending`}
                    title="Edit before sending"
                    onClick={() => setEditing(i)}
                  >
                    <PenIcon size={14} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {active ? (
        <form
          className="choice-own"
          onSubmit={(e) => {
            e.preventDefault()
            send(own)
          }}
        >
          <input value={own} placeholder="Something else…" onChange={(e) => setOwn(e.target.value)} />
          <button className="tw-btn tw-btn-sm" type="submit" disabled={!own.trim() || streaming}>
            Send
          </button>
        </form>
      ) : (
        answered && picked === -1 && <div className="choice-yours">You chose: {answer}</div>
      )}
    </div>
  )
}
