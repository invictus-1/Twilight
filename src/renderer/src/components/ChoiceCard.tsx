import { useEffect, useState } from 'react'
import type { ChoiceGroup, ChoiceSet } from '@shared/choices'
import { renderMarkdownLive } from '../markdown'
import { usePane } from '../pane'
import { useStore } from '../store'
import { CheckIcon, PenIcon, RefreshIcon, SendIcon } from './Icons'

const groupName = (group: ChoiceGroup, k: number): string => group.title ?? `Choice ${k + 1}`

/** Sent by "More options": a plain request, so it works with every way of offering choices. */
export const MORE_OPTIONS = 'Give me a few different options.'

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')

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

  // Number keys pick (Alt+number while typing). With several decisions, each number fills the
  // next one without a pick, and Enter sends once all are chosen.
  useEffect(() => {
    if (!active || answered) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.repeat || streaming) return
      if (isTyping(e.target) && !e.altKey) return
      const s = useStore.getState()
      if (s.mode !== 'chat' || s.settingsOpen || s.welcomeOpen || s.overlay) return
      // In split compare only the pane the composer sends to answers keys, so one key never sends twice.
      if (s.current?.split ? s.target !== pane : pane !== 'a') return
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1]
      if (digit) {
        const k = multi ? Math.max(0, picks.findIndex((p) => p === null)) : 0
        const option = groups[k]?.options[Number(digit) - 1]
        if (!option) return
        e.preventDefault()
        choose(k, option.label)
      } else if (e.key === 'Enter' && multi && ready && !isTyping(e.target)) {
        e.preventDefault()
        send(compose(groups, picks))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
      {active && !answered && (
        <div className="choice-send">
          <button className="tw-btn tw-btn-ghost tw-btn-sm choice-more" disabled={streaming} title="Ask the model for different options" onClick={() => send(MORE_OPTIONS)}>
            <RefreshIcon size={14} />
            More options
          </button>
          <span className="choice-keys">{multi ? 'Keys 1–9 pick, Enter sends' : 'Press 1–9 to pick'}</span>
          {multi && <span className="field-note">{`${picks.filter((p) => p !== null).length} of ${groups.length} chosen`}</span>}
          {multi && (
            <button className="tw-btn tw-btn-primary tw-btn-sm" disabled={!ready || streaming} onClick={() => send(compose(groups, picks))}>
              <SendIcon size={14} />
              Send choices
            </button>
          )}
        </div>
      )}
    </div>
  )
}
