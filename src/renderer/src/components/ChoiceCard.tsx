import { useState } from 'react'
import type { ChoiceGroup, ChoiceSet } from '@shared/choices'
import { renderMarkdownLive } from '../markdown'
import { usePane } from '../pane'
import { useStore } from '../store'
import { CheckIcon, PenIcon, SendIcon } from './Icons'

const groupName = (group: ChoiceGroup, k: number): string => group.title ?? `Choice ${k + 1}`

/** With several groups, the message sent is one "Title: pick" line per group. */
function compose(groups: ChoiceGroup[], picks: (string | null)[]): string {
  return groups.length === 1 ? (picks[0] ?? '') : groups.map((g, k) => `${groupName(g, k)}: ${picks[k] ?? ''}`).join('\n')
}

/** What was picked in each group, read back from the message that answered the card. */
function readAnswer(groups: ChoiceGroup[], answer: string | null): (string | null)[] {
  if (answer === null) return groups.map(() => null)
  if (groups.length === 1) return [answer.trim()]
  const lines = answer.split('\n')
  return groups.map((g, k) => {
    const prefix = `${groupName(g, k)}:`
    return lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? null
  })
}

/**
 * The options a model offered, as a card. With one decision, clicking an option sends it. With
 * several (an outfit and then what to do, or one per character), clicks only select, and Send
 * goes once every decision has a pick. The pencil changes an option before it's used; "Something
 * else" takes your own words. Once answered, the card shows what was picked.
 */
export function ChoiceCard({ choices, answer, active }: { choices: ChoiceSet; answer: string | null; active: boolean }) {
  const pane = usePane()
  const { groups } = choices
  const multi = groups.length > 1
  const [picks, setPicks] = useState<(string | null)[]>(() => groups.map(() => null))
  const [editing, setEditing] = useState<string | null>(null)
  const [own, setOwn] = useState<string[]>(() => groups.map(() => ''))
  const streaming = useStore((s) => {
    const c = s.current
    const path = pane === 'b' && c?.split ? c.split.path : c?.path
    return path?.at(-1)?.status === 'streaming'
  })
  const answered = answer !== null
  const chosen = answered ? readAnswer(groups, answer) : picks

  const send = (text: string): void => {
    const value = text.trim()
    if (!value || streaming) return
    setEditing(null)
    void useStore.getState().send(value, [], pane)
  }
  const choose = (k: number, value: string): void => {
    const v = value.trim()
    if (!v) return
    if (!multi) return send(v)
    setEditing(null)
    setPicks((p) => p.map((x, j) => (j === k ? v : x)))
  }
  const ready = picks.every((p) => p !== null)

  return (
    <div className={`choice-card ${answered ? 'choice-answered' : ''} ${multi ? 'choice-multi' : ''}`} role="group" aria-label="Choices">
      {groups.map((group, k) => {
        const pick = chosen[k]
        const pickedIndex = pick !== null ? group.options.findIndex((o) => o.label.trim() === pick) : -1
        return (
          <section key={k} className="choice-group" aria-label={groupName(group, k)}>
            {group.title && <div className="choice-question">{group.title}</div>}
            {group.intro && <div className="choice-intro md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(group.intro) }} />}
            <ol className="choice-list">
              {group.options.map((option, i) => {
                const id = `${k}:${i}`
                return (
                  <li key={i} className={`choice ${pickedIndex === i ? 'choice-picked' : ''}`}>
                    {editing === id ? (
                      <form
                        className="choice-edit"
                        onSubmit={(e) => {
                          e.preventDefault()
                          choose(k, new FormData(e.currentTarget).get('choice')?.toString() ?? '')
                        }}
                      >
                        <span className="choice-num">{i + 1}</span>
                        <input name="choice" autoFocus defaultValue={option.label} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                        <button className="tw-btn tw-btn-ghost tw-btn-icon" type="submit" aria-label={multi ? 'Use edited choice' : 'Send edited choice'}>
                          {multi ? <CheckIcon size={14} /> : <SendIcon size={14} />}
                        </button>
                      </form>
                    ) : (
                      <>
                        <button className="choice-pick" disabled={!active || answered || streaming} onClick={() => choose(k, option.label)}>
                          <span className="choice-num">{pickedIndex === i ? <CheckIcon size={12} /> : i + 1}</span>
                          <span className="choice-body">
                            <span className="choice-text">{option.label}</span>
                            {option.details && <span className="choice-details md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(option.details) }} />}
                          </span>
                        </button>
                        {active && !answered && (
                          <button
                            className="tw-btn tw-btn-ghost tw-btn-icon choice-edit-btn"
                            aria-label={`Edit choice ${i + 1} before ${multi ? 'using' : 'sending'}`}
                            title={multi ? 'Edit before using' : 'Edit before sending'}
                            onClick={() => setEditing(id)}
                          >
                            <PenIcon size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </li>
                )
              })}
            </ol>
            {active && !answered && (
              <form
                className="choice-own"
                onSubmit={(e) => {
                  e.preventDefault()
                  choose(k, own[k])
                }}
              >
                <input
                  value={own[k]}
                  placeholder="Something else…"
                  aria-label={`Something else for ${groupName(group, k)}`}
                  onChange={(e) => setOwn((o) => o.map((x, j) => (j === k ? e.target.value : x)))}
                />
                <button className="tw-btn tw-btn-sm" type="submit" disabled={!own[k].trim() || streaming}>
                  {multi ? 'Use' : 'Send'}
                </button>
              </form>
            )}
            {pick !== null && pickedIndex === -1 && <div className="choice-yours">{answered ? 'You chose' : 'Your pick'}: {pick}</div>}
          </section>
        )
      })}
      {multi && active && !answered && (
        <div className="choice-send">
          <span className="field-note">
            {picks.filter((p) => p !== null).length} of {groups.length} chosen
          </span>
          <button className="tw-btn tw-btn-primary tw-btn-sm" disabled={!ready || streaming} onClick={() => send(compose(groups, picks))}>
            <SendIcon size={14} />
            Send choices
          </button>
        </div>
      )}
    </div>
  )
}
