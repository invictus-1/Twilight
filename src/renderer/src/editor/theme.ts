import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

// The manuscript surface: Literata prose on the canvas, markdown shown as styled source
// (headings set large, emphasis rendered, the markup itself dimmed).

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--ink)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-serif)', fontSize: '17px', lineHeight: '29px', overflowY: 'auto' },
    '.cm-content': {
      maxWidth: 'var(--measure)',
      margin: '0 auto',
      padding: 'var(--space-12) var(--space-8) 40vh',
      caretColor: 'var(--iris)'
    },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--iris)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--selection) !important'
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-panels': { backgroundColor: 'var(--surface-overlay)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: '13px' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
    '.cm-searchMatch': { backgroundColor: 'var(--horizon-soft)', outline: '1px solid var(--horizon)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--iris-soft)' },
    '.cm-textfield': {
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--ink)'
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--surface-raised)',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--ink)'
    }
  },
  { dark: true }
)

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '28px', lineHeight: '38px', fontWeight: '600' },
  { tag: t.heading2, fontSize: '23px', lineHeight: '32px', fontWeight: '600' },
  { tag: t.heading3, fontSize: '19px', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--iris)' },
  { tag: t.url, color: 'var(--ink-faint)' },
  { tag: t.quote, color: 'var(--ink-muted)', fontStyle: 'italic' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '14px' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--ink-faint)' },
  { tag: t.list, color: 'var(--ink-faint)' }
])

export const twilightEditorTheme: Extension = [editorTheme, syntaxHighlighting(highlight)]
