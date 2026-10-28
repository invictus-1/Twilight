import { useEffect, useRef, useState } from 'react'
import type { ChatSettings } from '@shared/types'
import { useStore } from '../store'
import { ToolIcon } from './Icons'

/**
 * A small description that appears after the pointer rests on a control for a moment (or when it
 * has keyboard focus), so the composer stays uncluttered but every switch explains itself.
 */
export function Hint({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const show = (): void => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 450)
  }
  const hide = (): void => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <span className="hint-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onMouseDown={hide}>
      {children}
      {open && (
        <span className="hint" role="tooltip">
          <b>{title}</b>
          {text}
        </span>
      )}
    </span>
  )
}

function Row(props: { label: string; note: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; sub?: boolean }) {
  return (
    <label className={`tools-row ${props.sub ? 'sub' : ''} ${props.disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        <span className="tools-label">{props.label}</span>
        <span className="tools-note">{props.note}</span>
      </span>
    </label>
  )
}

/** The composer's Tools menu: what the model may use in this chat, switched on and off in one place. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const settings = useStore((s) => s.current?.settings)
  const split = useStore((s) => !!s.current?.split)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!settings) return null
  const update = (patch: Partial<ChatSettings>): void => {
    const s = useStore.getState()
    void s.updateSettings(patch, 'a')
    if (split) void s.updateSettings(patch, 'b')
  }
  const active = settings.choiceCards ? 1 + (settings.choiceTool ? 1 : 0) : 0
  return (
    <div className="tools-menu" ref={box}>
      <Hint title="Tools" text="Switch on what the model can use in this chat: the choice menu tool, and how choices are read. Web tools come later.">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
          <ToolIcon size={15} />
          Tools
          {active > 0 && <span className="tools-count">{active}</span>}
        </button>
      </Hint>
      {open && (
        <div className="tools-pop" role="dialog" aria-label="Tools">
          <div className="tools-head">Choices{split ? ' · both panes' : ''}</div>
          <Row
            label="Choice cards"
            note="When the story reaches a decision, the options become a card you can click, edit or answer in your own words."
            checked={settings.choiceCards}
            onChange={(on) => update({ choiceCards: on })}
          />
          <Row
            sub
            label="Choice menu tool (present_choices)"
            note="The model sends the options as data through a tool call. The most reliable way; needs a model with tool calling."
            checked={settings.choiceTool}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choiceTool: on })}
          />
          <Row
            sub
            label="Choices blocks"
            note="Read a choices code block the model writes at the end of its reply."
            checked={settings.choiceFenced}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choiceFenced: on })}
          />
          <Row
            sub
            label="Plain numbered options"
            note={'Read options your own prompt writes as a numbered list, under a title that asks or with "Something else".'}
            checked={settings.choicePlain}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choicePlain: on })}
          />
          <Row
            sub
            label="Tell the model how"
            note="Adds a short instruction to the system prompt. Turn off if your own prompt already covers choices."
            checked={settings.choiceInstructions}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choiceInstructions: on })}
          />
          <div className="tools-head">More tools</div>
          <p className="tools-later">Web search, web fetch, and the date and time are on the roadmap.</p>
        </div>
      )}
    </div>
  )
}
