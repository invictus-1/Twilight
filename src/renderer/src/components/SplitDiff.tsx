import { useMemo, type ReactNode } from 'react'
import { extractChoices } from '@shared/choices'
import { compareTexts, plainProse, type Comparison } from '@shared/diff'
import type { ChatSettings, NodeView, Pane } from '@shared/types'
import { paneOf, useStore } from '../store'

// Split differences: each pane's latest reply drawn as a word diff against the other's, words
// only in A in A's colour and words only in B in B's. Only the drawing changes; the stored
// messages, and everything sent to a model, stay as they are.

/** A pane's latest reply, the one the diff covers. */
const latestReply = (path: NodeView[]): NodeView | undefined => path.findLast((n) => n.role === 'assistant')

const finished = (n: NodeView | undefined): n is NodeView => !!n && (n.status === 'done' || n.status === 'stopped') && !!n.text

/** The words a reply shows: its body without a choices block, with the markdown read as plain text. */
function shownText(node: NodeView, settings: ChatSettings): string {
  const body = node.toolChoices ? node.text : extractChoices(node.text, settings.choiceCards && settings.choicePlain, settings.choiceFenced).body
  return plainProse(body)
}

// Both panes and the summary ask for the same comparison; it's worked out once per pair of texts.
let cached: { a: string; b: string; result: Comparison } | null = null
function compare(a: string, b: string): Comparison {
  if (!cached || cached.a !== a || cached.b !== b) cached = { a, b, result: compareTexts(a, b) }
  return cached.result
}

type SplitDiff = { state: 'off' } | { state: 'waiting' } | { state: 'ready'; ids: Record<Pane, string>; cmp: Comparison }

export function useSplitDiff(): SplitDiff {
  const on = useStore((s) => s.splitDiff && !!s.current?.split)
  const a = useStore((s) => (s.splitDiff && s.current?.split ? latestReply(s.current.path) : undefined))
  const b = useStore((s) => (s.splitDiff && s.current?.split ? latestReply(s.current.split.path) : undefined))
  const settingsA = useStore((s) => s.current?.settings)
  const settingsB = useStore((s) => s.current?.split?.settings)
  return useMemo((): SplitDiff => {
    if (!on) return { state: 'off' }
    if (!finished(a) || !finished(b) || !settingsA || !settingsB) return { state: 'waiting' }
    return { state: 'ready', ids: { a: a.id, b: b.id }, cmp: compare(shownText(a, settingsA), shownText(b, settingsB)) }
  }, [on, a, b, settingsA, settingsB])
}

/** Whether this reply is the one its pane's diff covers; false (and cheap) while differences are off. */
export const useDiffed = (pane: Pane, nodeId: string): boolean =>
  useStore((s) => s.splitDiff && !!s.current?.split && latestReply(paneOf(s.current, pane).path)?.id === nodeId)

/** A pane's latest reply drawn as the diff while differences are on; otherwise `children`. */
export function DiffBody({ pane, nodeId, children }: { pane: Pane; nodeId: string; children: ReactNode }) {
  const diff = useSplitDiff()
  if (diff.state !== 'ready' || diff.ids[pane] !== nodeId) return <>{children}</>
  const whole = diff.cmp.by === 'paragraphs'
  return (
    <div className="tw-msg-body diff-body" data-diff={diff.cmp.by}>
      {diff.cmp[pane].map((runs, k) =>
        whole ? (
          <p key={k} className={runs[0].changed ? 'diff-para diff-para-only' : 'diff-para'}>
            {runs[0].text}
          </p>
        ) : (
          <p key={k} className="diff-para">
            {runs.map((r, i) => (
              <span key={i} className={r.changed ? 'diff-only' : undefined}>
                {r.text}
              </span>
            ))}
          </p>
        )
      )}
    </div>
  )
}

const percent = (x: number): number => (x === 1 ? 100 : Math.min(99, Math.round(x * 100)))

/** One line above the panes: how much the latest replies differ, with the colour key. */
export function DiffSummary() {
  const diff = useSplitDiff()
  if (diff.state === 'off') return null
  if (diff.state === 'waiting') {
    return (
      <div className="split-diff-bar" role="status">
        Differences show once both panes have a finished reply.
      </div>
    )
  }
  const { onlyA, onlyB, similarity, by } = diff.cmp
  const n = onlyA + onlyB
  return (
    <div className="split-diff-bar" role="status">
      {n === 0 ? (
        <span className="diff-count">The latest replies match word for word</span>
      ) : (
        <>
          <span className="diff-count">
            {n.toLocaleString()} {n === 1 ? 'word differs' : 'words differ'}
          </span>
          <span className="diff-key diff-key-a">{onlyA.toLocaleString()} only in A</span>
          <span className="diff-key diff-key-b">{onlyB.toLocaleString()} only in B</span>
          <span className="diff-similar">{percent(similarity)}% similar</span>
        </>
      )}
      {by === 'paragraphs' && <span className="diff-mode">Long replies, so compared paragraph by paragraph</span>}
    </div>
  )
}

export function DiffToggle() {
  const on = useStore((s) => s.splitDiff)
  return (
    <button
      className="tw-btn tw-btn-ghost tw-btn-sm no-drag diff-toggle"
      aria-pressed={on}
      title={on ? 'Back to the replies as written' : "Mark the words that differ between the panes' latest replies"}
      onClick={() => useStore.getState().setSplitDiff(!on)}
    >
      Differences
    </button>
  )
}
