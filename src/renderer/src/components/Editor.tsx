import { useEffect, useRef, useState } from 'react'
import { editorText } from '../gameCopy'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { modelName, useStore } from '../store'
import { clearStream, readStream, subscribeStream } from '../stream'
import { useWriting } from '../writingStore'
import { cycleHeading, toggleQuote, toggleWrap } from '../editor/format'
import {
  acceptSuggestion,
  currentSuggestion,
  editsField,
  rejectSuggestion,
  restoreEdits,
  revertEdit,
  setSuggestion,
  suggestionExtension,
  updateProposed,
  type AppliedEdit,
  type Suggestion
} from '../editor/suggestion'
import { twilightEditorTheme } from '../editor/theme'
import { FIX_EVENT } from './ContinuityPanel'
import { ChevronDown, CloseIcon, RedoIcon, UndoIcon } from './Icons'

/** Accepted-edit history per document, kept across switching documents for this session. */
const savedEdits = new Map<string, { text: string; edits: AppliedEdit[] }>()

const FORMAT = [
  { label: 'B', title: 'Bold (Ctrl+B)', run: toggleWrap('**'), className: 'fmt-bold' },
  { label: 'I', title: 'Italic (Ctrl+I)', run: toggleWrap('*'), className: 'fmt-italic' },
  { label: 'S', title: 'Strikethrough (Ctrl+Shift+X)', run: toggleWrap('~~'), className: 'fmt-strike' },
  { label: '</>', title: 'Inline code (Ctrl+E)', run: toggleWrap('`'), className: 'fmt-code' },
  { label: 'H', title: 'Heading: cycles #, ##, ###', run: cycleHeading, className: '' },
  { label: '❝', title: 'Quote', run: toggleQuote, className: '' }
]

const timeOf = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const SAVE_DELAY = 700
const CONTEXT_BEFORE = 6000
const CONTEXT_AFTER = 3000

const TOOLS = {
  Rewrite: 'Rewrite this passage so it reads better, keeping its meaning.',
  Tighten: 'Tighten this passage: cut redundancy and filler, keep every important detail.',
  Expand: 'Expand this passage with more concrete detail and texture, about one and a half to two times as long.'
} as const

const TONES = ['warmer', 'darker', 'plainer', 'more vivid', 'more formal']

const countWords = (text: string): number => text.match(/\S+/g)?.length ?? 0

interface Overlay {
  top: number
  left: number
}

export function Editor({ docPath }: { docPath: string }) {
  /** Outer box: overlays position against it. CodeMirror owns `host`; React never renders into it. */
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimer = useRef<number>(0)
  const wordTimer = useRef<number>(0)
  const request = useRef<{ id: string; label: string; instruction: string } | null>(null)
  const [toolbar, setToolbar] = useState<Overlay | null>(null)
  const [bar, setBar] = useState<(Overlay & { suggestion: Suggestion }) | null>(null)
  const [asking, setAsking] = useState(false)
  const [toneOpen, setToneOpen] = useState(false)
  const [edits, setEdits] = useState<AppliedEdit[]>([])
  const [applied, setApplied] = useState<AppliedEdit | null>(null)
  const appliedTimer = useRef<number>(0)
  const historyOpen = useWriting((s) => s.historyOpen)
  const models = useStore((s) => s.models)
  const defaultModel = useStore((s) => s.defaults?.modelId)

  /** Mirrors the edit history into React only when an edit is added or changes state. */
  const syncEdits = (view: EditorView): void => {
    const next = view.state.field(editsField)
    setEdits((prev) => {
      const sig = (list: AppliedEdit[]): string => list.map((e) => e.id + e.state).join()
      if (sig(prev) === sig(next)) return prev
      const fresh = next.find((e) => e.state === 'applied' && !prev.some((p) => p.id === e.id))
      if (fresh) {
        setApplied(fresh)
        window.clearTimeout(appliedTimer.current)
        appliedTimer.current = window.setTimeout(() => setApplied(null), 8000)
      }
      useWriting.getState().setEditCount(next.filter((e) => e.state === 'applied').length)
      return next
    })
  }

  const revert = (id: string): void => {
    const view = viewRef.current
    if (!view) return
    if (!revertEdit(view, id)) useWriting.setState({ error: 'That passage was edited after the change, so it can’t be reverted on its own. Use Ctrl+Z.' })
    setApplied(null)
    view.focus()
  }

  /** Positions the selection toolbar and the suggestion bar relative to the editor. */
  const layoutOverlays = (view: EditorView): void => {
    const outer = box.current
    const rect = outer?.getBoundingClientRect()
    if (!outer || !rect) return
    const s = currentSuggestion(view.state)
    if (s) {
      // In the right margin beside the passage when there's room; otherwise under its
      // paragraph, so the bar never covers manuscript text.
      const textRight = view.contentDOM.getBoundingClientRect().right - 32
      const start = view.coordsAtPos(s.from)
      if (start && rect.right - textRight >= 400) {
        setBar({ top: start.top - rect.top - 4, left: textRight - rect.left + 24, suggestion: s })
      } else {
        const below = view.coordsAtPos(view.state.doc.lineAt(s.to).to) ?? view.coordsAtPos(s.to)
        setBar(below ? { top: below.bottom - rect.top + 8, left: Math.max(16, Math.min(below.left - rect.left - 120, rect.width - 380)), suggestion: s } : null)
      }
      setToolbar(null)
      return
    }
    setBar(null)
    const sel = view.state.selection.main
    // Focus moving into the toolbar itself (the Ask box) keeps it open.
    const focused = view.hasFocus || outer.contains(document.activeElement)
    if (sel.empty || !focused) {
      setToolbar(null)
      setAsking(false)
      setToneOpen(false)
      return
    }
    const start = view.coordsAtPos(sel.from)
    if (!start) return setToolbar(null)
    setToolbar({ top: Math.max(8, start.top - rect.top - 48), left: Math.max(16, Math.min(start.left - rect.left, rect.width - 660)) })
  }

  const save = async (view: EditorView): Promise<void> => {
    window.clearTimeout(saveTimer.current)
    const text = view.state.doc.toString()
    useWriting.getState().setStatus('saving')
    try {
      const mtime = await window.twilight.writeDoc(docPath, text)
      if (viewRef.current === view && view.state.doc.toString() === text) useWriting.getState().markSaved(mtime, text)
    } catch {
      useWriting.getState().setStatus('error')
    }
  }

  // Create the editor for this document.
  useEffect(() => {
    const open = useWriting.getState().open
    if (!host.current || !open) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: open.text,
        extensions: [
          history(),
          search({ top: true }),
          suggestionExtension({ onReject: () => request.current && void window.twilight.stopWritingTool(request.current.id) }),
          keymap.of([
            { key: 'Mod-s', run: (v) => (void save(v), true) },
            { key: 'Mod-j', run: () => (setAsking(true), true) },
            { key: 'Mod-b', run: toggleWrap('**') },
            { key: 'Mod-i', run: toggleWrap('*') },
            { key: 'Mod-Shift-x', run: toggleWrap('~~') },
            { key: 'Mod-e', run: toggleWrap('`') },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap
          ]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Manuscript' }),
          twilightEditorTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              useWriting.getState().setStatus('unsaved')
              window.clearTimeout(saveTimer.current)
              saveTimer.current = window.setTimeout(() => void save(u.view), SAVE_DELAY)
              window.clearTimeout(wordTimer.current)
              wordTimer.current = window.setTimeout(() => useWriting.getState().setWords(countWords(u.view.state.doc.toString())), 300)
            }
            if (u.docChanged || u.selectionSet || u.focusChanged || u.transactions.some((t) => t.effects.length)) {
              requestAnimationFrame(() => layoutOverlays(u.view))
            }
            if (u.docChanged || u.transactions.some((t) => t.effects.length)) syncEdits(u.view)
          })
        ]
      })
    })
    viewRef.current = view
    editorText.get = () => {
      const { from, to } = view.state.selection.main
      return from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to)
    }
    useWriting.getState().setWords(countWords(open.text))
    // Bring back this session's edit history if the text is as we left it.
    const kept = savedEdits.get(docPath)
    if (kept && kept.text === open.text) view.dispatch({ effects: restoreEdits.of(kept.edits) })
    else useWriting.getState().setEditCount(0)
    const onScroll = (): void => void requestAnimationFrame(() => layoutOverlays(view))
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    view.focus()
    if (location.hash === '#e2e') (window as unknown as { __twilightEditor: EditorView }).__twilightEditor = view
    return () => {
      // Flush an unsaved edit before the editor goes away.
      if (useWriting.getState().status === 'unsaved') void save(view)
      savedEdits.set(docPath, { text: view.state.doc.toString(), edits: view.state.field(editsField) })
      window.clearTimeout(appliedTimer.current)
      view.scrollDOM.removeEventListener('scroll', onScroll)
      view.destroy()
      viewRef.current = null
      editorText.get = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath])

  // A search result: select the first place the text appears and bring it into view.
  const reveal = useWriting((s) => s.reveal)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal || reveal.path !== docPath) return
    const at = view.state.doc.toString().toLowerCase().indexOf(reveal.text.toLowerCase())
    if (at >= 0) view.dispatch({ selection: { anchor: at, head: at + reveal.text.length }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    view.focus()
  }, [reveal, docPath])

  // The continuity panel's Fix the text: the passage is found and rewritten as a suggestion.
  const runToolRef = useRef<((label: string, instruction: string, range?: { from: number; to: number }) => void) | null>(null)
  useEffect(() => {
    const onFix = (e: Event): void => {
      const view = viewRef.current
      const { quote, instruction } = (e as CustomEvent<{ quote: string; instruction: string }>).detail
      if (!view) return
      const at = view.state.doc.toString().indexOf(quote)
      if (at >= 0) runToolRef.current?.('Continuity', instruction, { from: at, to: at + quote.length })
    }
    window.addEventListener(FIX_EVENT, onFix)
    return () => window.removeEventListener(FIX_EVENT, onFix)
  }, [])

  // Stream a tool's output into the suggestion, then switch it to a diff when done.
  useEffect(
    () =>
      window.twilight.onStream((event) => {
        const view = viewRef.current
        if (!view || event.kind !== 'done' || event.nodeId !== request.current?.id) return
        clearStream(event.nodeId)
        view.dispatch({
          effects: updateProposed.of({
            proposed: event.node.text,
            status: event.node.status === 'done' && event.node.text ? 'ready' : 'error',
            error: event.node.error ?? (event.node.text ? undefined : 'The model returned nothing.')
          })
        })
      }),
    []
  )

  // Pick up edits made outside Twilight (in Obsidian, say) when the window regains focus.
  useEffect(() => {
    const onFocus = async (): Promise<void> => {
      const view = viewRef.current
      const open = useWriting.getState().open
      if (!view || !open || useWriting.getState().status !== 'saved') return
      const fresh = await window.twilight.readDoc(open.path).catch(() => null)
      if (!fresh || fresh.mtime <= open.mtime || fresh.text === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: fresh.text }, effects: setSuggestion.of(null) })
      useWriting.getState().markSaved(fresh.mtime, fresh.text)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const runTool = (label: string, instruction: string, range?: { from: number; to: number }): void => {
    const view = viewRef.current
    if (!view) return
    const sel = range ?? view.state.selection.main
    if (sel.from === sel.to) return
    const doc = view.state.doc
    const id = crypto.randomUUID()
    request.current = { id, label, instruction }
    setAsking(false)
    setToneOpen(false)
    view.dispatch({
      effects: setSuggestion.of({ from: sel.from, to: sel.to, original: doc.sliceString(sel.from, sel.to), proposed: '', label, status: 'streaming' }),
      selection: { anchor: sel.to } // drop the highlight so the diff reads cleanly
    })
    const unsubscribe = subscribeStream(id, () => {
      const v = viewRef.current
      if (!v || request.current?.id !== id) return unsubscribe()
      if (currentSuggestion(v.state)?.status === 'streaming') v.dispatch({ effects: updateProposed.of({ proposed: readStream(id).text }) })
    })
    void window.twilight.runWritingTool(id, {
      docPath,
      instruction,
      passage: doc.sliceString(sel.from, sel.to),
      before: doc.sliceString(Math.max(0, sel.from - CONTEXT_BEFORE), sel.from),
      after: doc.sliceString(sel.to, Math.min(doc.length, sel.to + CONTEXT_AFTER)),
      manuscript: useWriting.getState().context?.wholeManuscript ? doc.toString() : undefined
    })
  }
  runToolRef.current = runTool

  const retry = (): void => {
    const view = viewRef.current
    const s = view && currentSuggestion(view.state)
    if (!view || !s || !request.current) return
    const { label, instruction } = request.current
    rejectSuggestion(view)
    runTool(label, instruction, { from: s.from, to: s.to })
  }

  const reject = (): void => {
    if (request.current) void window.twilight.stopWritingTool(request.current.id)
    if (viewRef.current) rejectSuggestion(viewRef.current)
    viewRef.current?.focus()
  }

  return (
    <div className="editor-box" ref={box}>
      <div className="editor-host" ref={host} />
      {toolbar && (
        <div
          className="tw-seltool"
          role="toolbar"
          aria-label="Writing tools"
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}
        >
          {asking ? (
            <form
              className="seltool-ask"
              onSubmit={(e) => {
                e.preventDefault()
                const value = new FormData(e.currentTarget).get('ask')?.toString().trim()
                if (value) runTool('Ask', value)
              }}
            >
              <input name="ask" autoFocus placeholder="What should change? Enter to run" onKeyDown={(e) => e.key === 'Escape' && setAsking(false)} />
            </form>
          ) : (
            <>
              <button className="tw-btn tw-btn-ghost tw-btn-sm tw-ask" title="Ask (Ctrl+J)" onClick={() => setAsking(true)}>
                Ask
              </button>
              <span className="tw-sep" />
              {(Object.keys(TOOLS) as (keyof typeof TOOLS)[]).map((name) => (
                <button key={name} className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => runTool(name, TOOLS[name])}>
                  {name}
                </button>
              ))}
              <span className="tone">
                <button className="tw-btn tw-btn-ghost tw-btn-sm" aria-expanded={toneOpen} onClick={() => setToneOpen((o) => !o)}>
                  Tone
                  <ChevronDown size={12} />
                </button>
                {toneOpen && (
                  <div className="tw-menu tone-menu">
                    {TONES.map((tone) => (
                      <div key={tone} className="tw-menu-item" onClick={() => runTool(`Tone: ${tone}`, `Rewrite this passage in a ${tone} tone.`)}>
                        {tone[0].toUpperCase() + tone.slice(1)}
                      </div>
                    ))}
                  </div>
                )}
              </span>
              <span className="tw-sep" />
              {FORMAT.map((f) => (
                <button
                  key={f.title}
                  className={`tw-btn tw-btn-ghost tw-btn-icon fmt ${f.className}`}
                  title={f.title}
                  aria-label={f.title}
                  onClick={() => viewRef.current && f.run(viewRef.current)}
                >
                  {f.label}
                </button>
              ))}
              <span className="tw-sep" />
              <button className="tw-btn tw-btn-ghost tw-btn-icon" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => viewRef.current && undo(viewRef.current)}>
                <UndoIcon size={15} />
              </button>
              <button className="tw-btn tw-btn-ghost tw-btn-icon" title="Redo (Ctrl+Y)" aria-label="Redo" onClick={() => viewRef.current && redo(viewRef.current)}>
                <RedoIcon size={15} />
              </button>
            </>
          )}
        </div>
      )}
      {applied && !bar && (
        <div className="applied-pill" role="status">
          <span>
            <b>{applied.label}</b> applied
          </span>
          <button className="tw-btn tw-btn-sm" onClick={() => revert(applied.id)}>
            Revert
          </button>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Dismiss" onClick={() => setApplied(null)}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {historyOpen && (
        <aside className="edit-history" aria-label="AI edits">
          <div className="panel-head">
            <h2 className="t-heading">AI edits this session</h2>
            <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={() => useWriting.getState().toggleHistory()}>
              <CloseIcon />
            </button>
          </div>
          {edits.length === 0 && <p className="field-note">Accepted suggestions appear here, each with a way back.</p>}
          {edits.map((e) => (
            <div key={e.id} className={`edit-item edit-${e.state}`}>
              <div className="edit-meta">
                <b>{e.label}</b> · {timeOf(e.at)}
                {e.state === 'reverted' && ' · reverted'}
                {e.state === 'changed' && ' · edited since'}
              </div>
              <div className="edit-text">
                <span className="tw-del">{e.original.length > 140 ? `${e.original.slice(0, 140)}…` : e.original}</span>
              </div>
              <div className="edit-actions">
                {e.state === 'applied' && (
                  <>
                    <button
                      className="tw-btn tw-btn-ghost tw-btn-sm"
                      onClick={() => {
                        const v = viewRef.current
                        if (!v) return
                        v.dispatch({ selection: { anchor: e.from, head: e.to }, scrollIntoView: true })
                        v.focus()
                      }}
                    >
                      Show
                    </button>
                    <button className="tw-btn tw-btn-sm" onClick={() => revert(e.id)}>
                      Revert
                    </button>
                  </>
                )}
                {e.state === 'changed' && <span className="field-note">Use Ctrl+Z to step back past later typing.</span>}
              </div>
            </div>
          ))}
        </aside>
      )}
      {bar && (
        <div className="tw-suggest" role="group" aria-label="Suggestion" style={{ top: bar.top, left: bar.left }} onMouseDown={(e) => e.preventDefault()}>
          {bar.suggestion.status === 'error' ? (
            <span className="suggest-error">{bar.suggestion.error}</span>
          ) : (
            <span>
              <b>{bar.suggestion.label}</b> · {modelName(models, defaultModel)}
              {bar.suggestion.status === 'streaming' && <span className="tw-spin" />}
            </span>
          )}
          <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={retry}>
            Retry
          </button>
          <button className="tw-btn tw-btn-sm" onClick={reject} title="Reject (Alt+Backspace)">
            {bar.suggestion.status === 'streaming' ? 'Stop' : 'Reject'}
          </button>
          {bar.suggestion.status === 'ready' && (
            <button
              className="tw-btn tw-btn-sm tw-btn-accept"
              title="Accept (Alt+Enter)"
              onClick={() => {
                if (viewRef.current) acceptSuggestion(viewRef.current)
                viewRef.current?.focus()
              }}
            >
              Accept <span className="tw-kbd accept-kbd">Alt+Enter</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
