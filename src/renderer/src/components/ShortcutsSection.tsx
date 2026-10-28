import { useEffect, useState } from 'react'
import { bind, COMMANDS, comboOf, FIXED_KEYS, isCustom, keysFor, resetBindings, useBindings } from '../commands'
import { Keys } from './CommandMenu'

let recording = false
/** True while a new shortcut is being recorded, so the app doesn't act on the keys pressed. */
export const recordingKeys = (): boolean => recording

/** Every command's shortcut, rebindable: click Change, press the new keys. */
export function ShortcutsSection() {
  const bindings = useBindings()
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    recording = editing !== null
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setEditing(null)
      if (e.key === 'Backspace' || e.key === 'Delete') {
        bind(editing, '')
        return setEditing(null)
      }
      const combo = comboOf(e)
      if (!combo) return
      if (!/^(Ctrl|Alt)\+/.test(combo) && !/^F\d/.test(combo)) {
        setNote('Use Ctrl or Alt with a key (or an F key), so typing never triggers it.')
        return
      }
      const taken = COMMANDS.find((c) => c.id !== editing && keysFor(c.id) === combo)
      bind(editing, combo)
      setNote(taken ? `${combo} moved here from “${taken.title}”, which now has no shortcut.` : '')
      setEditing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      recording = false
      window.removeEventListener('keydown', onKey, true)
    }
  }, [editing])

  return (
    <>
      <div className="settings-card">
        <div className="panel-head">
          <h3 className="t-heading">Commands</h3>
          <button className="tw-btn tw-btn-ghost tw-btn-sm" disabled={!Object.keys(bindings).length} onClick={() => (resetBindings(), setNote(''))}>
            Reset all
          </button>
        </div>
        <p className="field-note">Everything here is also in the command menu ({keysFor('menu') || 'no shortcut'}). Click Change and press the new keys; Backspace removes a shortcut, Esc cancels.</p>
        {note && <p className="field-note keys-note">{note}</p>}
        <table className="shortcut-table keys-table">
          <tbody>
            {COMMANDS.map((c) => {
              const keys = keysFor(c.id)
              return (
                <tr key={c.id} data-command={c.id}>
                  <td>{c.group === 'Theme' ? `Theme: ${c.title}` : c.group === 'Go to' ? `Go to ${c.title}` : c.title}</td>
                  <td className="keys-cell">{editing === c.id ? <span className="keys-recording">Press keys…</span> : keys ? <Keys keys={keys} /> : <span className="field-note">None</span>}</td>
                  <td className="keys-actions">
                    {isCustom(c.id) && editing !== c.id && (
                      <button className="tw-btn tw-btn-ghost tw-btn-sm" title={`Back to ${c.keys ?? 'none'}`} onClick={() => bind(c.id, c.keys ?? '')}>
                        Reset
                      </button>
                    )}
                    <button className="tw-btn tw-btn-sm" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                      {editing === c.id ? 'Cancel' : 'Change'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Fixed keys</h3>
        <table className="shortcut-table">
          <tbody>
            {FIXED_KEYS.map(([keys, what, where]) => (
              <tr key={what}>
                <td>
                  <Keys keys={keys} />
                </td>
                <td>
                  {what} <span className="field-note">· {where}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
