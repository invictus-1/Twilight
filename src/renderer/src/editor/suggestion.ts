import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view'
import { wordDiff } from './diff'

// A suggestion is a proposed rewrite of one range of the manuscript. While the model streams,
// the original is dimmed and the new text grows after it; once done it becomes a word diff
// (struck-through removals, marked insertions) until the writer accepts or rejects it.
// The manuscript itself never changes until Accept.

export interface Suggestion {
  from: number
  to: number
  original: string
  proposed: string
  label: string
  status: 'streaming' | 'ready' | 'error'
  error?: string
}

export const setSuggestion = StateEffect.define<Suggestion | null>()
export const updateProposed = StateEffect.define<{ proposed: string; status?: Suggestion['status']; error?: string }>()

class InsertWidget extends WidgetType {
  constructor(readonly text: string, readonly streaming: boolean) {
    super()
  }
  eq(other: InsertWidget): boolean {
    return other.text === this.text && other.streaming === this.streaming
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.streaming ? 'tw-ins tw-ins-streaming' : 'tw-ins'
    span.textContent = this.text
    return span
  }
}

export const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) value = e.value
      else if (e.is(updateProposed) && value) value = { ...value, ...e.value, status: e.value.status ?? value.status }
    }
    if (value && tr.docChanged) {
      // An edit inside the suggested range makes it stale; edits elsewhere just shift it.
      if (tr.changes.touchesRange(value.from, value.to)) return null
      value = { ...value, from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) }
    }
    return value
  },
  provide: (field) =>
    EditorView.decorations.from(field, (s): DecorationSet => {
      if (!s) return Decoration.none
      if (s.status !== 'ready') {
        const marks = [Decoration.mark({ class: 'tw-pending' }).range(s.from, s.to)]
        if (s.proposed) marks.push(Decoration.widget({ widget: new InsertWidget(` ${s.proposed}`, true), side: 1 }).range(s.to))
        return Decoration.set(marks, true)
      }
      const ranges = []
      for (const op of wordDiff(s.original, s.proposed)) {
        if (op.type === 'del') ranges.push(Decoration.mark({ class: 'tw-del' }).range(s.from + op.from, s.from + op.from + op.text.length))
        else if (op.type === 'ins') ranges.push(Decoration.widget({ widget: new InsertWidget(op.text, false), side: 1 }).range(s.from + op.at))
      }
      return Decoration.set(ranges, true)
    })
})

export function currentSuggestion(state: EditorState): Suggestion | null {
  return state.field(suggestionField, false) ?? null
}

// ——— Accepted edits: a history that can be reverted ———
// Each accepted suggestion is remembered with the text it replaced. Its range follows later
// typing; Revert puts the original back as long as the edited text is still exactly what the
// model wrote (otherwise Ctrl+Z is the way back).

export interface AppliedEdit {
  id: string
  label: string
  from: number
  to: number
  original: string
  proposed: string
  at: number
  state: 'applied' | 'changed' | 'reverted'
}

export const recordEdit = StateEffect.define<AppliedEdit>()
export const markReverted = StateEffect.define<string>()
export const restoreEdits = StateEffect.define<AppliedEdit[]>()

export const editsField = StateField.define<AppliedEdit[]>({
  create: () => [],
  update(edits, tr) {
    if (tr.docChanged) {
      edits = edits.map((e) =>
        e.state !== 'applied'
          ? e
          : tr.changes.touchesRange(e.from, e.to) && !tr.effects.some((x) => x.is(markReverted) && x.value === e.id)
            ? { ...e, state: 'changed' as const }
            : { ...e, from: tr.changes.mapPos(e.from, 1), to: tr.changes.mapPos(e.to, -1) }
      )
    }
    for (const effect of tr.effects) {
      if (effect.is(recordEdit)) edits = [effect.value, ...edits].slice(0, 100)
      else if (effect.is(markReverted)) edits = edits.map((e) => (e.id === effect.value ? { ...e, state: 'reverted' as const } : e))
      else if (effect.is(restoreEdits)) edits = effect.value
    }
    return edits
  },
  provide: (field) =>
    EditorView.decorations.from(field, (edits): DecorationSet =>
      Decoration.set(
        edits.filter((e) => e.state === 'applied' && e.to > e.from).map((e) => Decoration.mark({ class: 'tw-edited' }).range(e.from, e.to)),
        true
      )
    )
})

export function revertEdit(view: EditorView, id: string): boolean {
  const edit = view.state.field(editsField).find((e) => e.id === id)
  if (!edit || edit.state !== 'applied' || view.state.doc.sliceString(edit.from, edit.to) !== edit.proposed) return false
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.original },
    effects: markReverted.of(id),
    selection: { anchor: edit.from, head: edit.from + edit.original.length },
    userEvent: 'input.revert'
  })
  return true
}

export function acceptSuggestion(view: EditorView): boolean {
  const s = currentSuggestion(view.state)
  if (!s || s.status !== 'ready') return false
  view.dispatch({
    changes: { from: s.from, to: s.to, insert: s.proposed },
    effects: [
      setSuggestion.of(null),
      recordEdit.of({
        id: crypto.randomUUID(),
        label: s.label,
        from: s.from,
        to: s.from + s.proposed.length,
        original: s.original,
        proposed: s.proposed,
        at: Date.now(),
        state: 'applied'
      })
    ],
    selection: { anchor: s.from + s.proposed.length },
    userEvent: 'input.suggestion'
  })
  return true
}

export function rejectSuggestion(view: EditorView): boolean {
  if (!currentSuggestion(view.state)) return false
  view.dispatch({ effects: setSuggestion.of(null) })
  return true
}

export function suggestionExtension(handlers: { onReject: () => void }): Extension {
  return [
    suggestionField,
    editsField,
    Prec.highest(
      keymap.of([
        { key: 'Alt-Enter', run: acceptSuggestion },
        {
          key: 'Alt-Backspace',
          run: (v) => {
            handlers.onReject()
            return rejectSuggestion(v)
          }
        },
        {
          key: 'Escape',
          run: (v) => {
            if (!currentSuggestion(v.state)) return false
            handlers.onReject()
            return rejectSuggestion(v)
          }
        }
      ])
    )
  ]
}
