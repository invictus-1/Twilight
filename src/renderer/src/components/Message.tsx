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
import { AlertIcon, ChevronLeft, ChevronRight, CopyIcon, PaperclipIcon, PenIcon, RefreshIcon, SplitIcon } from './Icons'

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

function UserMessage({ node }: { node: NodeView }) {
  const [expanded, setExpanded] = useState(false)
  const long = node.text.length > COLLAPSE_AT
  const words = long ? node.text.split(/\s+/).length : 0
  return (
    <div
      className="msg msg-user-row"
      style={{ containIntrinsicSize: `auto ${estimateHeight(long && !expanded ? node.text.slice(0, 1200) : node.text, 28)}px` }}
    >
      <BranchSwitcher node={node} />
      <div className="tw-msg-user">
        {node.attachments && node.attachments.length > 0 && (
          <div className="msg-attachments">
            {node.attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="tw-badge attach-chip" title={`${a.chars.toLocaleString()} characters, sent in full`}>
                <PaperclipIcon size={13} />
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
  return (
    <>
      {showThinking && thinking && (
        <details className="thinking" open>
          <summary>Thinking</summary>
          <div className="thinking-body">{thinking}</div>
        </details>
      )}
      {text ? (
        <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(extractChoices(text).body) }} />
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
  const detail =
    `Input ${u.input.toLocaleString()} · cache read ${u.cacheRead.toLocaleString()} · ` +
    `cache write ${u.cacheWrite.toLocaleString()} · output ${u.output.toLocaleString()} · ${(u.ms / 1000).toFixed(1)}s`
  return (
    <span className="msg-usage" title={detail}>
      {cost !== null && <>{formatCost(cost)} · </>}
      {formatTokens(total)} tok
      {prompt > 0 && !local && <> · {cachedPct}% cached</>}
    </span>
  )
}

function AssistantMessage({ node, next, isLast }: { node: NodeView; next?: NodeView; isLast: boolean }) {
  const { body, choices } = extractChoices(node.text)
  const models = useStore((s) => s.models)
  const pane = usePane()
  const showThinking = useStore((s) => (s.current ? paneOf(s.current, pane).settings.showThinking : false))
  const streaming = node.status === 'streaming'
  return (
    <div className="msg tw-msg-ai" style={{ containIntrinsicSize: `auto ${estimateHeight(node.text, 80)}px` }}>
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
                <PenIcon />
              </button>
            )}
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
