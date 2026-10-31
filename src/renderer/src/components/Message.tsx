import { memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { gameFormat } from '@shared/gameFormat'
import { costOf, formatCost, formatTokens } from '@shared/pricing'
import { readGameFormat } from '../gameFormatSettings'
import type { NodeView, WebSource, WebStep } from '@shared/types'
import type { GeneratedImage, ToolApproval, ToolStep } from '@shared/mcp'
import { domainOf } from '@shared/webTools'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { usePane } from '../pane'
import { EarlierPrompt } from './ChatTop'
import { CompactionMarker } from './Compaction'
import { toggleBookmark, useBookmarks } from '../bookmarks'
import { modelName, paneOf, useStore } from '../store'
import { readStream, subscribeStream } from '../stream'
import { extractChoices } from '@shared/choices'
import { useWriting } from '../writingStore'
import { ChoiceCard } from './ChoiceCard'
import { savedCount } from './Multiverse'
import { BlindContext } from './Arena'
import { ConfidenceView } from './Confidence'
import { ReadAloudButton } from './Dictate'
import { ContinuityNote } from './ContinuityNote'
import { DiffBody, useDiffed } from './SplitDiff'
import { AlertIcon, BookIcon, BranchIcon, CalendarIcon, ChevronLeft, ImageIcon, SlidersIcon, ChevronRight, CheckIcon, CopyIcon, DocIcon, GridIcon, PaperclipIcon, PenIcon, PulseIcon, RefreshIcon, SearchIcon, SplitIcon, StarIcon, ToolIcon, TrashIcon } from './Icons'

const COLLAPSE_AT = 3000

/**
 * A close guess at a message's rendered height, given to content-visibility as its placeholder
 * size. Off-screen messages are never laid out, so a good guess keeps the scrollbar steady
 * instead of growing as messages scroll into view; once seen, the real size is remembered.
 */
function estimateHeight(text: string, chrome: number): number {
  let lines = 0
  for (const para of text.split('\n')) lines += Math.max(1, Math.ceil(para.length / 92))
  return Math.round(lines * 22 * 0.87 + chrome)
}

/** Edits a message in place; saving makes a new version (the original stays in the switcher). */
function EditBox({ node, onDone }: { node: NodeView; onDone: () => void }) {
  const pane = usePane()
  const [text, setText] = useState(node.text)
  const save = (send = true): void => {
    if (!text.trim() || text === node.text) return onDone()
    void useStore.getState().editMessage(node.id, text, pane, send)
    onDone()
  }
  return (
    <div className="edit-box">
      <textarea
        autoFocus
        value={text}
        rows={Math.min(16, Math.max(3, text.split('\n').length + 1))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
        }}
      />
      <div className="edit-box-actions">
        <span className="field-note">Saved as a new version; the original stays in ‹ › .</span>
        <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={onDone}>
          Cancel
        </button>
        {node.role === 'user' && (
          <button className="tw-btn tw-btn-sm" onClick={() => save(false)} title="Keep the edit without sending it yet; send it from under the message when you're ready">
            Save
          </button>
        )}
        <button className="tw-btn tw-btn-sm tw-btn-primary" onClick={() => save()}>
          {node.role === 'user' ? 'Save and send (Ctrl+Enter)' : 'Save (Ctrl+Enter)'}
        </button>
      </div>
    </div>
  )
}

/** Trash: click deletes this message; right-click offers deleting everything below too. Undoable. */
function DeleteButton({ node }: { node: NodeView }) {
  const pane = usePane()
  const [menu, setMenu] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const run = (kind: 'single' | 'below'): void => {
    setMenu(false)
    void useStore.getState().deleteMessage(node.id, kind, pane)
  }
  // Open until you choose, click elsewhere or press Esc; closing when the pointer left the button
  // shut it before it could be reached.
  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenu(false)
      }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [menu])
  return (
    <span className="delete-wrap" ref={wrap}>
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon delete-btn"
        aria-label="Delete this message"
        title="Delete this message (right-click: delete everything below too)"
        onClick={() => run('single')}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu(true)
        }}
      >
        <TrashIcon />
      </button>
      {menu && (
        <div className="tw-menu delete-menu" role="menu">
          <div className="tw-menu-item" role="menuitem" onClick={() => run('single')}>
            Delete this message
          </div>
          <div className="tw-menu-item danger-text" role="menuitem" onClick={() => run('below')}>
            Delete this and everything below
          </div>
          <div className="delete-menu-note">Both can be restored from “Recently deleted”.</div>
        </div>
      )}
    </span>
  )
}

/**
 * Copy as an icon that answers: a tick and "Copied" for a moment. It goes through Twilight's own
 * clipboard, since the page's is refused along with every other web permission.
 */
export function CopyIconButton({ text, label = 'Copy' }: { text: () => string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`tw-btn tw-btn-ghost ${copied ? 'tw-btn-sm copy-done' : 'tw-btn-icon'}`}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={() => {
        void window.twilight.copyText(text())
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
    >
      {copied ? (
        <>
          <CheckIcon />
          Copied
        </>
      ) : (
        <CopyIcon />
      )}
    </button>
  )
}

/** Star a reply (a turn in the story, a fact to keep) to jump back to it from the chat's header. */
function StarButton({ nodeId }: { nodeId: string }) {
  const on = useBookmarks().includes(nodeId)
  return (
    <button
      className={`tw-btn tw-btn-ghost tw-btn-icon star-btn ${on ? 'is-on' : ''}`}
      aria-label={on ? 'Remove the bookmark' : 'Bookmark this reply'}
      aria-pressed={on}
      title={on ? 'Bookmarked: click to remove' : 'Bookmark this reply, to jump back to it from the header'}
      onClick={() => void toggleBookmark(nodeId)}
    >
      <StarIcon />
    </button>
  )
}

/** Whether a message is new enough to ease in (one just sent or arriving, not an old one). */
const useFresh = (node: NodeView): boolean => useState(() => Date.now() - node.createdAt < 4000)[0]

function UserMessage({ node, waiting = false }: { node: NodeView; waiting?: boolean }) {
  const pane = usePane()
  const fresh = useFresh(node)
  const slide = useSlideIn()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const long = node.text.length > COLLAPSE_AT
  const words = long ? node.text.split(/\s+/).length : 0
  if (editing) {
    return (
      <div className="msg msg-user-row">
        <EditBox node={node} onDone={() => setEditing(false)} />
      </div>
    )
  }
  return (
    <div
      className={`msg msg-user-row ${fresh ? 'msg-enter' : ''} ${slide}`}
      data-node={node.id}
      style={{ containIntrinsicSize: `auto ${estimateHeight(long && !expanded ? node.text.slice(0, 1200) : node.text, 28)}px` }}
    >
      <div className="tw-msg-user">
        {node.library && node.library.length > 0 && (
          <div className="msg-attachments">
            <span className="tw-badge attach-chip instruction-chip library-chip" title={`From your document library:\n${node.library.map((l) => `${l.source}, line ${l.line}`).join('\n')}`}>
              <BookIcon size={13} />
              From your library · {node.library.length} passage{node.library.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {node.bible && node.bible.length > 0 && (
          <div className="msg-attachments">
            <span className="tw-badge attach-chip instruction-chip bible-chip" title={`From your story bible: ${node.bible.join(', ')}`}>
              <BookIcon size={13} />
              From your bible · {node.bible.length <= 3 ? node.bible.join(', ') : `${node.bible.slice(0, 3).join(', ')} and ${node.bible.length - 3} more`}
            </span>
          </div>
        )}
        {node.dateTime && (
          <div className="msg-attachments">
            <span className="tw-badge attach-chip instruction-chip" title={node.dateTime}>
              <CalendarIcon size={13} />
              Date and time
            </span>
          </div>
        )}
        {node.instructionUpdate && (
          <div className="msg-attachments">
            <span className="tw-badge attach-chip instruction-chip" title={node.instructionUpdate}>
              <SlidersIcon size={13} />
              Instructions updated
            </span>
          </div>
        )}
        {node.attachments && node.attachments.length > 0 && (
          <div className="msg-attachments">
            {node.attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="tw-badge attach-chip"
                title={a.kind === 'image' ? 'Sent as an image' : a.kind === 'pdf' ? 'Sent as a PDF' : `${a.chars.toLocaleString()} characters, sent in full`}
              >
                {a.kind === 'image' ? <ImageIcon size={13} /> : a.kind === 'pdf' ? <DocIcon size={13} /> : <PaperclipIcon size={13} />}
                {a.name}
              </span>
            ))}
          </div>
        )}
        {long && !expanded ? `${node.text.slice(0, 1200)}…` : node.text}
        {long && (
          <button className="msg-expand" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Collapse' : `Show all · ${words.toLocaleString()} words`}
          </button>
        )}
      </div>
      <div className="user-foot">
        {/* The newest message with no reply yet (an edit saved without sending): send it from here. */}
        {waiting && (
          <button className="tw-btn tw-btn-sm tw-btn-primary user-send" onClick={() => void useStore.getState().regenerate(node.id, pane)}>
            Send
          </button>
        )}
        <BranchSwitcher node={node} />
        <span className="user-actions">
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Edit" title="Edit (makes a new version)" onClick={() => setEditing(true)}>
            <PenIcon />
          </button>
          <CopyIconButton text={() => node.text} />
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label="Regenerate the reply"
            title="Regenerate the reply to this message (adds a new version)"
            onClick={() => void useStore.getState().regenerate(node.id, pane)}
          >
            <RefreshIcon />
          </button>
          <DeleteButton node={node} />
        </span>
      </div>
    </div>
  )
}

// The last ‹ › click, so the version it brings in can slide in from that side (Extras).
let lastSwitch = { direction: 1 as -1 | 1, at: 0 }
/** The class that slides a message in, when it's just been switched to. */
const useSlideIn = (): string => useState(() => (Date.now() - lastSwitch.at < 600 ? (lastSwitch.direction > 0 ? 'fx-from-right' : 'fx-from-left') : ''))[0]

function BranchSwitcher({ node }: { node: NodeView }) {
  const pane = usePane()
  if (node.siblingCount < 2) return null
  const switchBranch = (direction: -1 | 1): void => {
    lastSwitch = { direction, at: Date.now() }
    void useStore.getState().switchBranch(node.id, direction, pane)
  }
  return (
    <span className="tw-branch" role="group" aria-label={`Version ${node.siblingIndex + 1} of ${node.siblingCount}`}>
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon"
        aria-label="Previous version"
        disabled={node.siblingIndex === 0}
        onClick={() => switchBranch(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      {node.siblingIndex + 1} / {node.siblingCount}
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon"
        aria-label="Next version"
        disabled={node.siblingIndex === node.siblingCount - 1}
        onClick={() => switchBranch(1)}
      >
        <ChevronRight size={14} />
      </button>
    </span>
  )
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** A source link; the thread opens it in the browser (the window itself never loads it). */
const SourceLink = ({ source }: { source: WebSource }) => (
  <>
    <a href={source.url} title={source.url}>
      {source.title}
    </a>
    <span className="web-domain">{domainOf(source.url)}</span>
  </>
)

/** What a reply searched for and read, above its text. A search opens to the results it found. */
function WebSteps({ steps }: { steps: WebStep[] }) {
  return (
    <div className="web-steps">
      {steps.map((step, i) =>
        step.kind === 'search' ? (
          <details key={i} className="web-step">
            <summary>
              <SearchIcon size={13} />
              <span className="web-what">{step.query ? `Searched: ${step.query}` : 'Searched the web'}</span>
              <span className="web-count">{step.error ? `failed (${step.error})` : plural(step.sources.length, 'result')}</span>
            </summary>
            {step.sources.length > 0 && (
              <ul className="web-links">
                {step.sources.map((source) => (
                  <li key={source.url}>
                    <SourceLink source={source} />
                  </li>
                ))}
              </ul>
            )}
          </details>
        ) : (
          <div key={i} className="web-step">
            <DocIcon size={13} />
            <span className="web-what">
              Read:{' '}
              {step.sources[0] ? (
                <a href={step.sources[0].url} title={step.sources[0].url}>
                  {domainOf(step.sources[0].url)}
                </a>
              ) : (
                domainOf(step.query)
              )}
            </span>
            {step.error && <span className="web-count">failed ({step.error})</span>}
          </div>
        )
      )}
    </div>
  )
}

/** The sources a reply cited, numbered in the order it first cited them. */
function WebSources({ sources }: { sources: WebSource[] }) {
  return (
    <div className="web-sources">
      <div className="web-sources-head">Sources</div>
      <ol>
        {sources.map((source, i) => (
          <li key={source.url}>
            <span className="web-num">{i + 1}</span>
            <SourceLink source={source} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** A tool call the reply is waiting on: what it is, its arguments, and your answer. */
function ApprovalCard({ approval }: { approval: ToolApproval }) {
  const [sent, setSent] = useState(false)
  const answer = (approve: boolean, always = false): void => {
    setSent(true)
    void window.twilight.respondToolApproval(approval.id, { approve, always })
  }
  return (
    <div className="tool-approval" role="dialog" aria-label="Allow this tool call?">
      <div className="tool-approval-head">
        Allow <code>{approval.tool}</code> from {approval.server}?{approval.readOnly && <span className="tw-badge">read-only</span>}
      </div>
      <pre className="tool-approval-input">{approval.input}</pre>
      <div className="tool-approval-actions">
        <button className="tw-btn tw-btn-primary tw-btn-sm" autoFocus disabled={sent} onClick={() => answer(true)}>
          Allow once
        </button>
        <button className="tw-btn tw-btn-sm" disabled={sent} title={`Run ${approval.tool} without asking from now on (Settings → Tools)`} onClick={() => answer(true, true)}>
          Always allow {approval.tool}
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" disabled={sent} onClick={() => answer(false)}>
          Decline
        </button>
      </div>
    </div>
  )
}

/** The tools a finished reply used, each with what it sent and got back. */
function ToolSteps({ steps }: { steps: ToolStep[] }) {
  return (
    <div className="web-steps tool-steps">
      {steps.map((step, i) => (
        <details key={i} className={`web-step tool-step tool-${step.status}`}>
          <summary>
            <ToolIcon size={13} />
            <span className="web-what">
              {step.server ? `${step.server}: ` : ''}
              {step.tool}
            </span>
            {step.status !== 'done' && <span className="web-count">{step.status === 'declined' ? 'declined' : 'failed'}</span>}
          </summary>
          <div className="tool-io">
            <div className="tool-io-label">Sent</div>
            <pre>{step.input}</pre>
            <div className="tool-io-label">Got back</div>
            <pre>{step.output}</pre>
          </div>
        </details>
      ))}
    </div>
  )
}

function Pictures({ images }: { images: GeneratedImage[] }) {
  return (
    <div className="gen-images">
      {images.map((img) => (
        <figure key={img.file} className="gen-image">
          <img src={`twilight-bg://generated/${encodeURIComponent(img.file)}`} alt={img.prompt} title={img.prompt} loading="lazy" />
        </figure>
      ))}
    </div>
  )
}

/** "12s", "1m 13s": how long a reply thought. */
function thoughtFor(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// Replies whose thinking you opened, so it stays open as the reply finishes and re-renders.
const openThoughts = new Set<string>()

/**
 * The model's thinking, as a quiet section under its name: folded, while it's written too, until
 * you open it, and then it stays open.
 */
function Thoughts({ nodeId, text, live, ms }: { nodeId: string; text: string; live: boolean; ms?: number }) {
  return (
    <details
      className={`thinking ${live ? 'is-live' : ''}`}
      open={openThoughts.has(nodeId) || undefined}
      onToggle={(e) => (e.currentTarget.open ? openThoughts.add(nodeId) : openThoughts.delete(nodeId))}
    >
      <summary>
        {live ? <span className="tw-spin" /> : <ChevronRight size={12} />}
        <span>{live ? 'Thinking' : ms ? `Thought for ${thoughtFor(ms)}` : 'Thoughts'}</span>
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  )
}

/**
 * A streaming reply in blocks (split at blank lines outside code fences): finished blocks are drawn
 * once and never touched again, so text in them can be selected and copied while the rest streams.
 * Only the block still being written is redrawn as text arrives.
 */
function liveBlocks(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1].slice(0, 3)
    if (marker) fence = fence === null ? marker : marker === fence ? null : fence
    if (fence === null && !marker && line.trim() === '' && current.length) {
      blocks.push(current.join('\n'))
      current = []
    } else current.push(line)
  }
  blocks.push(current.join('\n'))
  return blocks
}

const LiveBlock = memo(function LiveBlock({ md }: { md: string }) {
  return <div className="md-block" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(md) }} />
})

function StreamingBody({ nodeId }: { nodeId: string }) {
  const subscribe = (cb: () => void): (() => void) => subscribeStream(nodeId, cb)
  const text = useSyncExternalStore(subscribe, () => readStream(nodeId).text)
  const thinking = useSyncExternalStore(subscribe, () => readStream(nodeId).thinking)
  const activity = useSyncExternalStore(subscribe, () => readStream(nodeId).activity)
  const approval = useSyncExternalStore(subscribe, () => readStream(nodeId).approval)
  const pane = usePane()
  // A choices block being written stays hidden until its card can show (only when they're read).
  const fenced = useStore((s) => (s.current ? paneOf(s.current, pane).settings.choiceFenced : true))
  return (
    <>
      {thinking && <Thoughts nodeId={nodeId} text={thinking} live={!text} />}
      {activity.length > 0 && (
        <div className="web-steps">
          {activity.map((line, i) => (
            <div key={i} className="web-step">
              {!text && !approval && i === activity.length - 1 ? (
                <span className="tw-spin" />
              ) : line.startsWith('Reading') ? (
                <DocIcon size={13} />
              ) : line.startsWith('Using') || line.startsWith('Making') ? (
                <ToolIcon size={13} />
              ) : (
                <SearchIcon size={13} />
              )}
              <span className="web-what">{line}</span>
            </div>
          ))}
        </div>
      )}
      {text && (
        <div className="tw-msg-body md">
          {liveBlocks(extractChoices(text, false, fenced).body).map((block, i) => (
            <LiveBlock key={i} md={block} />
          ))}
        </div>
      )}
      {approval && <ApprovalCard key={approval.id} approval={approval} />}
      {/* A small sun rising on the horizon while the reply comes in (Extras). */}
      <div className="sun-progress" aria-hidden="true">
        <span />
      </div>
      {text || approval ? null : activity.length > 0 ? null : (
        <div className="msg-pending">
          <span className="tw-spin" /> {thinking ? 'Thinking' : 'Waiting for the first token'}
        </div>
      )}
    </>
  )
}

/** Copies the reply reflowed for a game's text boxes (see shared/gameFormat.ts). */
function GameFormatButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="tw-btn tw-btn-ghost tw-btn-sm game-format-btn"
      title="Copy for a game: paragraphs joined with single line breaks; code and HTML blocks kept as they are (options in Settings)"
      onClick={() => {
        void window.twilight.copyText(gameFormat(text, readGameFormat()))
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? 'Copied' : 'Game Format'}
    </button>
  )
}

function UsageLine({ node }: { node: NodeView }) {
  const models = useStore((s) => s.models)
  useStore((s) => s.prices) // re-price when your price list changes
  const u = node.usage
  if (!u) return null
  const local = models.find((m) => m.id === node.modelId && m.providerId === node.providerId)?.local ?? false
  const cost = costOf(node.modelId, u, local)
  const prompt = u.input + u.cacheRead + u.cacheWrite
  const total = prompt + u.output
  const cachedPct = prompt ? Math.round((u.cacheRead / prompt) * 100) : 0
  // Speed of generation itself: output tokens over the time after the first token arrived.
  const genMs = u.ms - (u.ttftMs ?? 0)
  const tps = u.output > 1 && genMs > 50 ? u.output / (genMs / 1000) : null
  const detail =
    `Input ${u.input.toLocaleString()} · cache read ${u.cacheRead.toLocaleString()} · ` +
    `cache write ${u.cacheWrite.toLocaleString()} · output ${u.output.toLocaleString()} · ${(u.ms / 1000).toFixed(1)}s` +
    (u.webSearches ? ` · ${plural(u.webSearches, 'web search')}` : '') +
    (typeof u.costUsd === 'number' ? ' · cost as reported by the provider' : '') +
    (u.ttftMs ? ` · first token after ${(u.ttftMs / 1000).toFixed(1)}s` : '')
  return (
    <span className="msg-usage" title={detail}>
      {tps !== null && <>{tps.toFixed(1)} tok/s · </>}
      {cost !== null && <>{formatCost(cost)} · </>}
      {formatTokens(total)} tok
      {prompt > 0 && !local && <> · {cachedPct}% cached</>}
    </span>
  )
}

function AssistantMessage({ node, next, isLast }: { node: NodeView; next?: NodeView; isLast: boolean }) {
  const pane = usePane()
  const plainChoices = useStore((s) => (s.current ? paneOf(s.current, pane).settings.choiceCards && paneOf(s.current, pane).settings.choicePlain : false))
  const fencedChoices = useStore((s) => (s.current ? paneOf(s.current, pane).settings.choiceFenced : true))
  // A present_choices call carries its options as data; otherwise they're read from the text.
  const { body, choices } = node.toolChoices
    ? { body: node.text, choices: node.toolChoices }
    : extractChoices(node.text, plainChoices, fencedChoices)
  const models = useStore((s) => s.models)
  const [editing, setEditing] = useState(false)
  const fresh = useFresh(node)
  const slide = useSlideIn()
  const diffed = useDiffed(pane, node.id)
  const streaming = node.status === 'streaming'
  const blind = useContext(BlindContext)
  // The confidence heatmap stands in for the body while it's on (replies whose probabilities were kept).
  const [heatmap, setHeatmap] = useState(false)
  if (editing) {
    return (
      <div className="msg tw-msg-ai">
        <div className="tw-msg-head">{modelName(models, node.modelId)} · editing</div>
        <EditBox node={node} onDone={() => setEditing(false)} />
      </div>
    )
  }
  return (
    <div className={`msg tw-msg-ai ${fresh ? 'msg-enter' : ''} ${slide}`} data-node={node.id} style={{ containIntrinsicSize: `auto ${estimateHeight(node.text, 80)}px` }}>
      <div className="tw-msg-head">
        {blind ? `Model ${pane.toUpperCase()}` : modelName(models, node.modelId)}
        {node.usage && <span className="msg-time">· {(node.usage.ms / 1000).toFixed(1)}s</span>}
        {node.status === 'stopped' && <span className="msg-time">· stopped</span>}
      </div>
      <EarlierPrompt createdAt={node.createdAt} />
      {streaming ? (
        <StreamingBody nodeId={node.id} />
      ) : (
        <>
          {node.thinking && <Thoughts nodeId={node.id} text={node.thinking} live={false} ms={node.usage?.thinkMs} />}
          {node.web && node.web.steps.length > 0 && <WebSteps steps={node.web.steps} />}
          {node.tools && node.tools.length > 0 && <ToolSteps steps={node.tools} />}
          {body && diffed && (
            <DiffBody pane={pane} nodeId={node.id}>
              <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.id, body) }} />
            </DiffBody>
          )}
          {body && !diffed && heatmap && <ConfidenceView node={node} />}
          {body && !diffed && !heatmap && <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.id, body) }} />}
          {node.images && node.images.length > 0 && <Pictures images={node.images} />}
          {node.web && node.web.cited.length > 0 && <WebSources sources={node.web.cited} />}
          {choices && (
            <ChoiceCard choices={choices} active={isLast} answer={next?.role === 'user' ? next.text : null} />
          )}
        </>
      )}
      {!streaming && pane === 'a' && <ContinuityNote node={node} />}
      {node.status === 'error' && (
        <div className="tw-msg-error" role="alert">
          <AlertIcon className="err-icon" />
          <div>
            <strong>Request failed.</strong> {node.error}
          </div>
        </div>
      )}
      {/* It stopped at the max output tokens: Continue asks for the rest in a new message, so
          everything before stays cached. */}
      {!streaming && isLast && node.usage?.cutOff && (
        <div className="msg-continue">
          <span className="field-note">Stopped at the max output tokens.</span>
          <button className="tw-btn tw-btn-sm tw-btn-primary" onClick={() => void useStore.getState().send('Continue from exactly where you stopped.', [], pane === 'b' ? 'b' : 'a')}>
            Continue
          </button>
        </div>
      )}
      {!streaming && (
        <div className="msg-foot">
          <div className="tw-msg-actions">
            <BranchSwitcher node={node} />
            <CopyIconButton text={() => body} />
            {body && <ReadAloudButton id={node.id} text={body} />}
            <StarButton nodeId={node.id} />
            {node.usage?.confidence && pane === 'a' && (
              <button
                className="tw-btn tw-btn-ghost tw-btn-icon conf-toggle"
                aria-label="Confidence"
                aria-pressed={heatmap}
                title={heatmap ? 'Back to the reply' : 'Confidence: how sure the model was of each word, and the words it nearly wrote'}
                onClick={() => setHeatmap((h) => !h)}
              >
                <PulseIcon />
              </button>
            )}
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon"
              aria-label="Regenerate"
              title="Regenerate (adds a new version)"
              onClick={() => void useStore.getState().regenerate(node.id, pane)}
            >
              <RefreshIcon />
            </button>
            {pane === 'a' && (
              <button
                className="tw-btn tw-btn-ghost tw-btn-icon multiverse-open"
                aria-label="Multiverse drafts"
                title={node.siblingCount > 1 ? 'Multiverse: every version of this reply side by side, and more at once' : 'Multiverse: write several versions at once and compare them side by side'}
                onClick={() => void useStore.getState().openMultiverse(node.id, node.siblingCount > 1 ? undefined : savedCount())}
              >
                <GridIcon />
              </button>
            )}
            <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Edit" title="Edit (saves as a new version)" onClick={() => setEditing(true)}>
              <PenIcon />
            </button>
            {body && <GameFormatButton text={body} />}
            {node.text && (
              <button
                className="tw-btn tw-btn-ghost tw-btn-icon"
                aria-label="Send to Writing"
                title="Send to Writing (opens it as a document you can edit section by section)"
                onClick={() => {
                  const title = useStore.getState().current?.title ?? 'From chat'
                  useStore.getState().setMode('write')
                  void useWriting.getState().fromText(title, body)
                }}
              >
                <DocIcon />
              </button>
            )}
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon branch-btn"
              aria-label="Branch into a new chat"
              title="Branch into a new chat (everything up to here; the original stays as it is)"
              onClick={() => void useStore.getState().branchToNewChat(node.id, pane)}
            >
              <BranchIcon />
            </button>
            {pane === 'a' && (
              <button
                className="tw-btn tw-btn-ghost tw-btn-icon"
                aria-label="Clone into split"
                title="Clone into split (Ctrl+Shift+S)"
                onClick={() => void useStore.getState().cloneIntoSplit(node.id)}
              >
                <SplitIcon />
              </button>
            )}
            <DeleteButton node={node} />
          </div>
          {!blind && <UsageLine node={node} />}
        </div>
      )}
    </div>
  )
}

export const Message = memo(
  function Message({ node, next, isLast = false }: { node: NodeView; next?: NodeView; isLast?: boolean }) {
    if (node.compaction) return <CompactionMarker node={node} />
    return node.role === 'user' ? <UserMessage node={node} waiting={isLast} /> : <AssistantMessage node={node} next={next} isLast={isLast} />
  },
  (a, b) =>
    a.node.id === b.node.id &&
    a.node.status === b.node.status &&
    a.node.text === b.node.text &&
    a.node.siblingIndex === b.node.siblingIndex &&
    a.node.siblingCount === b.node.siblingCount &&
    a.node.usage === b.node.usage &&
    a.node.continuity === b.node.continuity &&
    a.isLast === b.isLast &&
    a.next?.id === b.next?.id &&
    a.next?.text === b.next?.text
)
