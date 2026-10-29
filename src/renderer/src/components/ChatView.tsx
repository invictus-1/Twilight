import { useEffect, useState } from 'react'
import type { NodeView } from '@shared/types'
import { useJudge } from '../judgeStore'
import { modelName, useStore } from '../store'
import { CacheBar } from './CacheBar'
import { ChatSettingsPanel } from './ChatSettingsPanel'
import { Composer } from './Composer'
import { DeletedPanel } from './DeletedPanel'
import { SidebarIcon, SlidersIcon, SplitIcon, TrashIcon } from './Icons'
import { DiffSummary, DiffToggle } from './SplitDiff'
import { SplitView } from './SplitView'
import { Thread } from './Thread'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Sends the two panes' latest replies to the Judge, with the prompt and system prompt they came from. */
function JudgeSplitButton() {
  const current = useStore((s) => s.current)!
  const models = useStore((s) => s.models)
  const lastReply = (path: NodeView[]): NodeView | undefined => path.findLast((n) => n.role === 'assistant' && n.status === 'done' && !!n.text)
  const a = lastReply(current.path)
  const b = current.split ? lastReply(current.split.path) : undefined
  const prompt = current.path.findLast((n) => n.role === 'user')?.text ?? ''
  const sysA = current.settings.systemPrompt
  const sysB = current.split?.settings.systemPrompt ?? ''
  return (
    <button
      className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
      disabled={!a || !b}
      title="Compare the two panes' latest replies with a judge model"
      onClick={() => {
        if (!a || !b) return
        useJudge.getState().newDraft({
          title: current.title,
          passageA: a.text,
          passageB: b.text,
          labelA: modelName(models, a.modelId),
          labelB: modelName(models, b.modelId),
          authorPrompt: prompt,
          systemPrompt: sysA === sysB ? sysA : `Pane A's system prompt:\n${sysA}\n\nPane B's system prompt:\n${sysB}`
        })
        useStore.getState().setMode('judge')
      }}
    >
      Judge A vs B
    </button>
  )
}

/** A small evening behind an empty chat: a few stars and a low sun on the horizon. */
function EmptySky() {
  return (
    <div className="empty-sky" aria-hidden="true">
      {STARS.map((s, i) => (
        <span key={i} className="empty-star" style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
      ))}
      <span className="empty-sun" />
      <span className="empty-band empty-band-1" />
      <span className="empty-band empty-band-2" />
    </div>
  )
}

// Fixed, scattered places, the same every time.
const STARS = Array.from({ length: 28 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 61.3) % 55, d: (i % 7) * 0.6 }))

export function ChatView() {
  const current = useStore((s) => s.current)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const deleted = useStore((s) => s.deletions.length)
  const [panel, setPanel] = useState<'settings' | 'deleted' | null>(null)
  const split = !!current?.split
  useEffect(() => {
    const open = (): void => setPanel('settings')
    window.addEventListener('twilight-model-settings', open)
    return () => window.removeEventListener('twilight-model-settings', open)
  }, [])
  const empty = !current || (current.path.length === 0 && !split)

  return (
    <main className="chat">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{current?.title ?? 'New chat'}</h1>
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          aria-pressed={split}
          disabled={!current || current.path.length === 0}
          title={split ? 'Close split (keeps A)' : 'Clone into split (Ctrl+Shift+S)'}
          onClick={() => void (split ? useStore.getState().closeSplit('a') : useStore.getState().cloneIntoSplit())}
        >
          <SplitIcon />
          {split ? 'Close split' : 'Split'}
        </button>
        {split && <DiffToggle />}
        {split && <JudgeSplitButton />}
        {deleted > 0 && (
          <button
            className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
            aria-expanded={panel === 'deleted'}
            title="Recently deleted messages: read or restore them"
            onClick={() => setPanel((p) => (p === 'deleted' ? null : 'deleted'))}
          >
            <TrashIcon />
            {deleted}
          </button>
        )}
        <button
          className="tw-btn tw-btn-ghost tw-btn-sm no-drag"
          aria-expanded={panel === 'settings'}
          onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
          disabled={!current}
        >
          <SlidersIcon />
          Model settings
        </button>
      </header>
      {/* Keys unique among <main>'s children: the thread below is keyed by the chat id too, and
          two siblings sharing a key leave stale panels behind when one closes. */}
      {panel === 'settings' && current && <ChatSettingsPanel key={`settings:${current.id}`} onClose={() => setPanel(null)} />}
      {panel === 'deleted' && current && <DeletedPanel key={`deleted:${current.id}`} onClose={() => setPanel(null)} />}
      {split && <DiffSummary key={`diff:${current.id}`} />}
      {split ? (
        <SplitView key={current.id} />
      ) : empty ? (
        <div className="empty">
          <EmptySky />
          <h2 className="t-display">{greeting()}</h2>
          <p className="empty-sub">Pick a model below and start typing.</p>
        </div>
      ) : (
        <Thread key={current.id} />
      )}
      {!split && current && <CacheBar />}
      <Composer />
    </main>
  )
}
