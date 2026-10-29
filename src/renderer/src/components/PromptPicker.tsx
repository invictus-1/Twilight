import { useEffect, useMemo, useRef, useState } from 'react'
import { fillInput, hasInput, INPUT_PLACEHOLDER, type SavedPrompt } from '@shared/library'
import { fuzzyScore } from '../commands'
import { useLibrary } from '../libraryStore'
import { useStore } from '../store'
import { BookIcon } from './Icons'
import { Hint } from './ToolsMenu'

const preview = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 90 ? `${line.slice(0, 89)}…` : line
}

/**
 * The composer's Prompts popover: find a saved prompt and put it in the message box (never sent
 * on its own). A prompt with {{input}} asks for the value first.
 */
export function PromptPicker({ onInsert }: { onInsert: (text: string) => void }) {
  const open = useLibrary((s) => s.promptsOpen)
  const prompts = useLibrary((s) => s.prompts)
  const setOpen = (o: boolean): void => useLibrary.getState().setPromptsOpen(o)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [filling, setFilling] = useState<SavedPrompt | null>(null)
  const [value, setValue] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) {
      setFilling(null)
      setQuery('')
      return
    }
    void useLibrary.getState().refresh()
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  // After the composer's own focus on mount (opened from the command menu in another section).
  useEffect(() => field.current?.focus(), [open, filling])

  const shown = useMemo(() => {
    const q = query.trim()
    if (!q) return prompts.slice(0, 40)
    return prompts
      .map((p) => ({ p, score: Math.max(fuzzyScore(q, p.name), fuzzyScore(q, `${p.name} ${p.text}`) - 10) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.p)
  }, [prompts, query])

  useEffect(() => setActive(0), [query])

  const pick = (prompt: SavedPrompt): void => {
    if (hasInput(prompt.text)) {
      setFilling(prompt)
      setValue('')
      return
    }
    setOpen(false)
    onInsert(prompt.text)
  }
  const fill = (): void => {
    if (!filling) return
    setOpen(false)
    onInsert(fillInput(filling.text, value))
  }

  return (
    <div className="tools-menu prompt-picker" ref={box}>
      <Hint title="Prompts" text="Put one of your saved prompts in the message box, to send as it is or change first. Keep them in Settings → Library.">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" aria-label="Prompts" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
          <BookIcon size={15} />
          Prompts
        </button>
      </Hint>
      {open && (
        <div className="tools-pop doc-pop prompt-pop" role="dialog" aria-label={filling ? `Fill in ${filling.name}` : 'Insert a prompt'}>
          {filling ? (
            <div className="prompt-fill">
              <span className="field-label">
                {filling.name}: what goes in place of <code>{INPUT_PLACEHOLDER}</code>
              </span>
              <textarea
                ref={field}
                autoFocus
                rows={3}
                className="doc-pop-input prompt-fill-input"
                value={value}
                aria-label="Fill in the prompt"
                placeholder="Type it here"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setFilling(null)
                  } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    fill()
                  }
                }}
              />
              <p className="tools-later prompt-fill-preview">{preview(fillInput(filling.text, value || '…'))}</p>
              <div className="prompt-fill-actions">
                <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setFilling(null)}>
                  Back
                </button>
                <button className="tw-btn tw-btn-primary tw-btn-sm" onClick={fill}>
                  Insert
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                ref={field}
                autoFocus
                className="doc-pop-input"
                value={query}
                placeholder="Find a prompt…"
                aria-label="Find a prompt"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setOpen(false)
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(shown.length - 1, a + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(0, a - 1))
                  } else if (e.key === 'Enter' && shown[active]) {
                    e.preventDefault()
                    pick(shown[active])
                  }
                }}
              />
              <div className="doc-pop-list" role="listbox">
                {shown.length === 0 && <p className="tools-later">{prompts.length ? 'Nothing matches.' : 'No prompts yet. Save the messages you send often in Settings → Library.'}</p>}
                {shown.map((p, i) => (
                  <div
                    key={p.id}
                    role="option"
                    aria-selected={i === active}
                    className="palette-item doc-pop-item prompt-item"
                    data-prompt={p.id}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => pick(p)}
                  >
                    <span className="prompt-item-text">
                      <span className="palette-title">{p.name}</span>
                      <span className="prompt-item-preview">{preview(p.text)}</span>
                    </span>
                    {hasInput(p.text) && <span className="palette-group">fill in</span>}
                  </div>
                ))}
              </div>
              <div className="prompt-pop-foot">
                <button
                  className="link-btn"
                  onClick={() => {
                    setOpen(false)
                    useStore.getState().setSettingsOpen(true, 'library')
                  }}
                >
                  Manage prompts
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
