import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS, FIXED_KEYS, fuzzyScore, keysFor, useBindings } from '../commands'
import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { CloseIcon, DocIcon, SearchIcon, SpeechIcon } from './Icons'

/** "Ctrl+Shift+S" as key caps. */
export function Keys({ keys }: { keys: string }) {
  if (!keys) return null
  return (
    <span className="keys">
      {keys.split(' / ').map((combo, i) => (
        <span key={combo}>
          {i > 0 && <span className="keys-or">/</span>}
          {combo.split(/\+(?!$)/).map((k) => (
            <kbd key={k} className="tw-kbd">
              {k}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  )
}

interface Item {
  key: string
  title: string
  group: string
  keys?: string
  icon?: 'chat' | 'doc'
  hint?: string
  run(): void
}

/**
 * Ctrl+K: every command, chat and document by name. Type to filter (letters in order are
 * enough), arrows to move, Enter to run. Typing with nothing matched offers a full search.
 */
export function CommandMenu() {
  useBindings()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const conversations = useStore((s) => s.conversations)
  const docs = useWriting((s) => s.docs)
  const close = (): void => useStore.getState().setOverlay(null)

  const items = useMemo((): Item[] => {
    const commands: Item[] = COMMANDS.filter((c) => c.id !== 'menu' && (!c.when || c.when())).map((c) => ({
      key: `cmd:${c.id}`,
      title: c.title,
      group: c.group,
      keys: keysFor(c.id),
      run: c.run,
      hint: c.hint
    }))
    const chats: Item[] = conversations.map((c) => ({
      key: `chat:${c.id}`,
      title: c.title,
      group: 'Chats',
      icon: 'chat',
      run: () => {
        useStore.getState().setMode('chat')
        void useStore.getState().open(c.id)
      }
    }))
    const documents: Item[] = docs.map((d) => ({
      key: `doc:${d.path}`,
      title: d.path.replace(/\.md$/i, ''),
      group: 'Documents',
      icon: 'doc',
      run: () => {
        useStore.getState().setMode('write')
        void useWriting.getState().openDoc(d.path)
      }
    }))
    const q = query.trim()
    if (!q) return [...commands, ...chats.slice(0, 6)]
    return [...commands, ...chats, ...documents]
      .map((item) => ({ item, score: Math.max(fuzzyScore(q, item.title), fuzzyScore(q, `${item.group} ${item.title} ${item.hint ?? ''}`) - 10) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.item)
  }, [query, conversations, docs])

  const searchItem: Item | null = query.trim()
    ? {
        key: 'search',
        title: `Search chats and documents for “${query.trim()}”`,
        group: 'Search',
        keys: keysFor('search'),
        run: () => useStore.getState().setOverlay('search', query.trim())
      }
    : null
  const shown = searchItem ? [...items, searchItem] : items

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (item: Item | undefined): void => {
    if (!item) return
    if (item.key !== 'search') close()
    item.run()
  }

  return (
    <div className="dialog-backdrop overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="palette-input">
          <SearchIcon size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Type a command, chat or document…"
            aria-label="Command"
            aria-controls="palette-list"
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
                run(shown[active])
              }
            }}
          />
          <Keys keys="Esc" />
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {shown.length === 0 && <div className="palette-empty">Nothing matches.</div>}
          {shown.map((item, i) => (
            <div
              key={item.key}
              role="option"
              aria-selected={i === active}
              className="palette-item"
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => run(item)}
            >
              <span className="palette-icon" aria-hidden="true">
                {item.icon === 'chat' ? <SpeechIcon size={14} /> : item.icon === 'doc' ? <DocIcon size={14} /> : item.key === 'search' ? <SearchIcon size={14} /> : null}
              </span>
              <span className="palette-title">{item.title}</span>
              <span className="palette-group">{item.group}</span>
              {item.keys && <Keys keys={item.keys} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Ctrl+/: every shortcut on one sheet. */
export function ShortcutSheet() {
  useBindings()
  const close = (): void => useStore.getState().setOverlay(null)
  const groups = new Map<string, [string, string][]>()
  const add = (group: string, keys: string, what: string): void => {
    if (!keys) return
    groups.set(group, [...(groups.get(group) ?? []), [keys, what]])
  }
  for (const c of COMMANDS) add(c.group === 'Go to' ? 'Go to' : c.group === 'Theme' ? 'App' : c.group, keysFor(c.id), c.title)
  for (const [keys, what, group] of FIXED_KEYS) add(group, keys, what)
  return (
    <div className="dialog-backdrop overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog shortcut-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="panel-head">
          <h2 className="t-title">Keyboard shortcuts</h2>
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => (close(), useStore.getState().setSettingsOpen(true, 'shortcuts'))}>
            Rebind keys
          </button>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-grid">
          {[...groups].map(([group, rows]) => (
            <section key={group} className="sheet-group">
              <h3 className="t-label">{group}</h3>
              {rows.map(([keys, what]) => (
                <div key={what} className="sheet-row">
                  <span>{what}</span>
                  <Keys keys={keys} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
