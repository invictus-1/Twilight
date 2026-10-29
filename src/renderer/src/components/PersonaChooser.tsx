import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyScore, openMode } from '../commands'
import { useLibrary } from '../libraryStore'
import { modelName, useStore } from '../store'
import { Keys } from './CommandMenu'
import { PeopleIcon } from './Icons'

/** "New chat from a persona…": pick one and a new chat starts with its prompt, model and choice setting. */
export function PersonaChooser() {
  const personas = useLibrary((s) => s.personas)
  const models = useStore((s) => s.models)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = (): void => useStore.getState().setOverlay(null)

  useEffect(() => void useLibrary.getState().refresh(), [])
  const shown = useMemo(() => {
    const q = query.trim()
    if (!q) return personas
    return personas
      .map((p) => ({ p, score: Math.max(fuzzyScore(q, p.name), fuzzyScore(q, `${p.name} ${p.description}`) - 10) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p)
  }, [personas, query])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const start = (id: string | undefined): void => {
    if (!id) return
    close()
    openMode('chat')
    void useStore.getState().newChatFromPersona(id)
  }

  return (
    <div className="dialog-backdrop overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette persona-chooser" role="dialog" aria-modal="true" aria-label="New chat from a persona">
        <div className="palette-input">
          <PeopleIcon size={16} />
          <input
            autoFocus
            value={query}
            placeholder="New chat from a persona…"
            aria-label="Find a persona"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(shown.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                start(shown[active]?.id)
              }
            }}
          />
          <Keys keys="Esc" />
        </div>
        <div className="palette-list" role="listbox" ref={list}>
          {shown.length === 0 && (
            <div className="palette-empty">
              {personas.length ? (
                'Nothing matches.'
              ) : (
                <>
                  No personas yet.{' '}
                  <button className="link-btn" onClick={() => (close(), useStore.getState().setSettingsOpen(true, 'library'))}>
                    Make one in the Library
                  </button>
                </>
              )}
            </div>
          )}
          {shown.map((p, i) => (
            <div
              key={p.id}
              role="option"
              aria-selected={i === active}
              className="palette-item persona-item"
              data-persona={p.id}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => start(p.id)}
            >
              <span className="persona-item-text">
                <span className="palette-title">{p.name}</span>
                {p.description && <span className="persona-item-desc">{p.description}</span>}
              </span>
              {p.choiceCards && <span className="tw-badge">Choices</span>}
              <span className="palette-group">{p.modelId ? modelName(models, p.modelId) : 'Chat default'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
