import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment } from '@shared/types'
import { fuzzyScore } from '../commands'
import { useWriting } from '../writingStore'
import { DocIcon } from './Icons'
import { Hint } from './ToolsMenu'

/** Attaches documents from the writing folder: type to find one, click to attach its text in full. */
export function DocPicker({ onPick }: { onPick: (attachment: Attachment) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const docs = useWriting((s) => s.docs)

  useEffect(() => {
    if (!open) return
    void useWriting.getState().refresh()
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim()
    const named = docs.map((d) => ({ d, title: d.path.replace(/\.md$/i, '') }))
    if (!q) return named.slice(0, 30)
    return named
      .map((x) => ({ ...x, score: fuzzyScore(q, x.title) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
  }, [docs, query])

  useEffect(() => setActive(0), [query])

  const pick = async (path: string): Promise<void> => {
    setOpen(false)
    setQuery('')
    try {
      const doc = await window.twilight.readDoc(path)
      onPick({ name: path.split('/').pop() ?? path, text: doc.text })
    } catch (err) {
      useWriting.setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="tools-menu doc-picker" ref={box}>
      <Hint title="Attach a document" text="Pick from your writing folder. Its whole text goes into the message, like any attached file.">
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Attach a document from the writing folder" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <DocIcon />
        </button>
      </Hint>
      {open && (
        <div className="tools-pop doc-pop" role="dialog" aria-label="Attach a document">
          <input
            autoFocus
            className="doc-pop-input"
            value={query}
            placeholder="Find a document…"
            aria-label="Find a document"
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
                void pick(shown[active].d.path)
              }
            }}
          />
          <div className="doc-pop-list" role="listbox">
            {shown.length === 0 && <p className="tools-later">{docs.length ? 'Nothing matches.' : 'No documents in the writing folder yet.'}</p>}
            {shown.map(({ d, title }, i) => (
              <div key={d.path} role="option" aria-selected={i === active} className="palette-item doc-pop-item" onMouseMove={() => i !== active && setActive(i)} onClick={() => void pick(d.path)}>
                <span className="palette-title">{title}</span>
                <span className="palette-group">{d.size < 1024 ? `${d.size} B` : `${Math.round(d.size / 1024)} KB`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
