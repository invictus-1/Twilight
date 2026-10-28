import type { Command } from '@codemirror/view'

// Markdown formatting for the selection toolbar and shortcuts. The manuscript stays plain
// markdown, so Obsidian reads exactly what Twilight writes.

/** Wraps the selection in `mark` (e.g. ** for bold), or unwraps it if it's already wrapped. */
export const toggleWrap =
  (mark: string): Command =>
  (view) => {
    const { from, to } = view.state.selection.main
    const doc = view.state.doc
    const n = mark.length
    const inside = doc.sliceString(from, to)
    if (doc.sliceString(from - n, from) === mark && doc.sliceString(to, to + n) === mark) {
      view.dispatch({
        changes: [
          { from: from - n, to: from, insert: '' },
          { from: to, to: to + n, insert: '' }
        ],
        selection: { anchor: from - n, head: to - n }
      })
    } else if (inside.length >= 2 * n && inside.startsWith(mark) && inside.endsWith(mark)) {
      view.dispatch({
        changes: { from, to, insert: inside.slice(n, inside.length - n) },
        selection: { anchor: from, head: to - 2 * n }
      })
    } else {
      view.dispatch({
        changes: [
          { from, insert: mark },
          { from: to, insert: mark }
        ],
        selection: { anchor: from + n, head: to + n }
      })
    }
    view.focus()
    return true
  }

/** Cycles the current line through paragraph → # → ## → ### → paragraph. */
export const cycleHeading: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const match = /^(#{1,6}) /.exec(line.text)
  const level = match ? match[1].length : 0
  const next = level >= 3 ? '' : `${'#'.repeat(level + 1)} `
  view.dispatch({ changes: { from: line.from, to: line.from + (match ? match[0].length : 0), insert: next } })
  view.focus()
  return true
}

/** Toggles a "> " quote on every line the selection touches. */
export const toggleQuote: Command = (view) => {
  const { from, to } = view.state.selection.main
  const doc = view.state.doc
  const lines = []
  for (let pos = from; pos <= to; ) {
    const line = doc.lineAt(pos)
    lines.push(line)
    pos = line.to + 1
  }
  const quoted = lines.every((l) => l.text.startsWith('> '))
  view.dispatch({
    changes: lines.map((l) => (quoted ? { from: l.from, to: l.from + 2, insert: '' } : { from: l.from, insert: '> ' }))
  })
  view.focus()
  return true
}
