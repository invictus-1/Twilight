import { memo, useState, useSyncExternalStore } from 'react'
import { costOf, formatCost, formatTokens } from '@shared/pricing'
import type { NodeView } from '@shared/types'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { modelName, useStore } from '../store'
import { readStream, subscribeStream } from '../stream'
import { AlertIcon, ChevronLeft, ChevronRight, CopyIcon, RefreshIcon } from './Icons'

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
  if (node.siblingCount < 2) return null
  const switchBranch = useStore.getState().switchBranch
  return (
    <span className="tw-branch" role="group" aria-label={`Version ${node.siblingIndex + 1} of ${node.siblingCount}`}>
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon"
        aria-label="Previous version"
        disabled={node.siblingIndex === 0}
        onClick={() => void switchBranch(node.id, -1)}
      >
        <ChevronLeft size={14} />
      </button>
      {node.siblingIndex + 1} / {node.siblingCount}
      <button
        className="tw-btn tw-btn-ghost tw-btn-icon"
        aria-label="Next version"
        disabled={node.siblingIndex === node.siblingCount - 1}
        onClick={() => void switchBranch(node.id, 1)}
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
        <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(text) }} />
      ) : (
        <div className="msg-pending">
          <span className="tw-spin" /> {thinking ? 'Thinking' : 'Waiting for the first token'}
        </div>
      )}
    </>
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

function AssistantMessage({ node }: { node: NodeView }) {
  const models = useStore((s) => s.models)
  const showThinking = useStore((s) => s.current?.settings.showThinking ?? false)
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
          {node.text && <div className="tw-msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.id, node.text) }} />}
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
              onClick={() => void navigator.clipboard.writeText(node.text)}
            >
              <CopyIcon />
            </button>
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon"
              aria-label="Regenerate"
              title="Regenerate (adds a new version)"
              onClick={() => void useStore.getState().regenerate(node.id)}
            >
              <RefreshIcon />
            </button>
          </div>
          <UsageLine node={node} />
        </div>
      )}
    </div>
  )
}

export const Message = memo(
  function Message({ node }: { node: NodeView }) {
    return node.role === 'user' ? <UserMessage node={node} /> : <AssistantMessage node={node} />
  },
  (a, b) =>
    a.node.id === b.node.id &&
    a.node.status === b.node.status &&
    a.node.text === b.node.text &&
    a.node.siblingIndex === b.node.siblingIndex &&
    a.node.siblingCount === b.node.siblingCount &&
    a.node.usage === b.node.usage
)
