import { memo, useState, useSyncExternalStore } from 'react'
import { gameFormat } from '@shared/gameFormat'
import { costOf, formatCost, formatTokens } from '@shared/pricing'
import { readGameFormat } from '../gameFormatSettings'
import type { NodeView } from '@shared/types'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { usePane } from '../pane'
import { modelName, paneOf, useStore } from '../store'
import { readStream, subscribeStream } from '../stream'
import { extractChoices } from '@shared/choices'
import { useWriting } from '../writingStore'
import { ChoiceCard } from './ChoiceCard'
import { AlertIcon, BranchIcon, ChevronLeft, ImageIcon, SlidersIcon, ChevronRight, CopyIcon, DocIcon, PaperclipIcon, PenIcon, RefreshIcon, SplitIcon, TrashIcon } from './Icons'

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
  const save = (): void => {
    if (!text.trim() || text === node.text) return onDone()
    void useStore.getState().editMessage(node.id, text, pane)
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
        <button className="tw-btn tw-btn-sm tw-btn-primary" onClick={save}>
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
  const run = (kind: 'single' | 'below'): void => {
    setMenu(false)
    void useStore.getState().deleteMessage(node.id, kind, pane)
  }
  return (
    <span className="delete-wrap" onMouseLeave={() => setMenu(false)}>
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

function UserMessage({ node }: { node: NodeView }) {
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
      className="msg msg-user-row"
      data-node={node.id}
      style={{ containIntrinsicSize: `auto ${estimateHeight(long && !expanded ? node.text.slice(0, 1200) : node.text, 28)}px` }}
    >
      <span className="user-actions">
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Edit" title="Edit (makes a new version)" onClick={() => setEditing(true)}>
          <PenIcon />
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Copy" title="Copy" onClick={() => void navigator.clipboard.writeText(node.text)}>
          <CopyIcon />
        </button>
        <DeleteButton node={node} />
      </span>
      <BranchSwitcher node={node} />
      <div className="tw-msg-user">
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
    </div>
  )
}

function BranchSwitcher({ node }: { node: NodeView }) {
  const pane = usePane()
  if (node.siblingCount < 2) return null
  const switchBranch = (direction: -1 | 1): void => void useStore.getState().switchBranch(node.id, direction, pane)
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

function StreamingBody({ nodeId, showThinking }: { nodeId: string; showThinking: boolean }) {
  const subscribe = (cb: () => void): (() => void) => subscribeStream(nodeId, cb)
  const text = useSyncExternalStore(subscribe, () => readStream(nodeId).text)
  const thinking = useSyncExternalStore(subscribe, () => readStream(nodeId).thinking)
  const pane = usePane()
  // A choices block being written stays hidden until its card can show (only when they're read).
  const fenced = useStore((s) => (s.current ? paneOf(s.current, pane).settings.choiceFenced : true))
  return (
    <>
      {showThinking && thinking && (
        <details className="thinking" open>
          <summary>Thinking</summary>
          <div className="thinking-body">{thinking}</div>
        </details>
      )}
      {text ? (
        <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(extractChoices(text, false, fenced).body) }} />
      ) : (
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
        void navigator.clipboard.writeText(gameFormat(text, readGameFormat()))
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
  const showThinking = useStore((s) => (s.current ? paneOf(s.current, pane).settings.showThinking : false))
  const [editing, setEditing] = useState(false)
  const streaming = node.status === 'streaming'
  if (editing) {
    return (
      <div className="msg tw-msg-ai">
        <div className="tw-msg-head">{modelName(models, node.modelId)} · editing</div>
        <EditBox node={node} onDone={() => setEditing(false)} />
      </div>
    )
  }
  return (
    <div className="msg tw-msg-ai" data-node={node.id} style={{ containIntrinsicSize: `auto ${estimateHeight(node.text, 80)}px` }}>
      <div className="tw-msg-head">
        {modelName(models, node.modelId)}
        {node.usage && <span className="msg-time">· {(node.usage.ms / 1000).toFixed(1)}s</span>}
        {node.status === 'stopped' && <span className="msg-time">· stopped</span>}
      </div>
      {streaming ? (
        <StreamingBody nodeId={node.id} showThinking={showThinking} />
      ) : (
        <>
          {showThinking && node.thinking && (
            <details className="thinking">
              <summary>Thinking</summary>
              <div className="thinking-body">{node.thinking}</div>
            </details>
          )}
          {body && <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.id, body) }} />}
          {choices && (
            <ChoiceCard choices={choices} active={isLast} answer={next?.role === 'user' ? next.text : null} />
          )}
        </>
      )}
      {node.status === 'error' && (
        <div className="tw-msg-error" role="alert">
          <AlertIcon className="err-icon" />
          <div>
            <strong>Request failed.</strong> {node.error}
          </div>
        </div>
      )}
      {!streaming && (
        <div className="msg-foot">
          <div className="tw-msg-actions">
            <BranchSwitcher node={node} />
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon"
              aria-label="Copy"
              title="Copy"
              onClick={() => void navigator.clipboard.writeText(body)}
            >
              <CopyIcon />
            </button>
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon"
              aria-label="Regenerate"
              title="Regenerate (adds a new version)"
              onClick={() => void useStore.getState().regenerate(node.id, pane)}
            >
              <RefreshIcon />
            </button>
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
          <UsageLine node={node} />
        </div>
      )}
    </div>
  )
}

export const Message = memo(
  function Message({ node, next, isLast = false }: { node: NodeView; next?: NodeView; isLast?: boolean }) {
    return node.role === 'user' ? <UserMessage node={node} /> : <AssistantMessage node={node} next={next} isLast={isLast} />
  },
  (a, b) =>
    a.node.id === b.node.id &&
    a.node.status === b.node.status &&
    a.node.text === b.node.text &&
    a.node.siblingIndex === b.node.siblingIndex &&
    a.node.siblingCount === b.node.siblingCount &&
    a.node.usage === b.node.usage &&
    a.isLast === b.isLast &&
    a.next?.id === b.next?.id &&
    a.next?.text === b.next?.text
)
