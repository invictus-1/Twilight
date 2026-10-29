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

/**
 * The evening behind an empty chat, drawn retro: a deep field of stars and a band of the galaxy,
 * a striped sun on the horizon and a glowing grid running toward you. The field is one static SVG,
 * so it costs a single paint; only a few stars twinkle, the grid's drift is a transform, and both
 * stop under Gentle and Off motion.
 */
function EmptySky() {
  return (
    <div className="empty-sky is-retro" aria-hidden="true">
      <span className="empty-galaxy" />
      <svg className="empty-field" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        {FIELD.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} className={`empty-dot empty-dot-${s.tone}`} opacity={s.o} />
        ))}
      </svg>
      {STARS.map((s, i) => (
        <span key={i} className={`empty-star ${s.big ? 'is-big' : ''}`} style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
      ))}
      <span className="empty-shooting" />
      <span className="empty-sun" />
      <span className="empty-horizon" />
      <div className="empty-floor">
        <div className="empty-plane">
          <span className="empty-grid" />
        </div>
      </div>
    </div>
  )
}

// Fixed, scattered places, the same every time: a small seeded generator, so the sky never shifts
// between visits and nothing random runs at render.
function seeded(seed: number): () => number {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
const rand = seeded(1987)
// Thinner toward the horizon (y 0–600 is the sky above it), as a real sky looks through more air.
const FIELD = Array.from({ length: 220 }, () => {
  const y = Math.pow(rand(), 1.4) * 560
  const size = rand()
  return {
    x: Math.round(rand() * 1000 * 10) / 10,
    y: Math.round(y * 10) / 10,
    r: size > 0.97 ? 1.6 : size > 0.85 ? 1.1 : 0.6,
    o: Math.round((0.25 + rand() * 0.6) * (1 - y / 900) * 100) / 100,
    tone: rand() > 0.88 ? (rand() > 0.5 ? 'iris' : 'horizon') : 'ink'
  }
})
const STARS = Array.from({ length: 16 }, (_, i) => ({ x: (i * 37.7 + 6) % 100, y: (i * 23.3 + 4) % 50, d: (i % 8) * 0.55, big: i % 5 === 0 }))

export function ChatView() {
  const current = useStore((s) => s.current)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const deleted = useStore((s) => s.deletions.length)
  const [panel, setPanel] = useState<'settings' | 'deleted' | null>(null)
  const split = !!current?.split
  // With no chat open yet, the settings go to the chat the next message would start (an untouched
  // one is reused), so the model and its options can be set before typing.
  const openSettings = async (): Promise<void> => {
    if (!useStore.getState().current) await useStore.getState().newChat()
    if (useStore.getState().current) setPanel('settings')
  }
  useEffect(() => {
    const open = (): void => void openSettings()
    window.addEventListener('twilight-model-settings', open)
    return () => window.removeEventListener('twilight-model-settings', open)
  }, [])
  const empty = !current || (current.path.length === 0 && !split)
  const models = useStore((s) => s.models)
  const fallback = useStore((s) => s.defaults?.modelId)
  const chosen = current?.settings.modelId ?? fallback ?? null
  const ready = chosen && models.some((m) => m.id === chosen) ? modelName(models, chosen) : null

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
          onClick={() => (panel === 'settings' ? setPanel(null) : void openSettings())}
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
          <div className="empty-copy">
            <h2 className="t-display empty-title">{greeting()}</h2>
            <p className="empty-sub">{ready ? `${ready} is ready. Start typing.` : 'Pick a model below and start typing.'}</p>
          </div>
        </div>
      ) : (
        <Thread key={current.id} />
      )}
      {!split && current && <CacheBar />}
      <Composer />
    </main>
  )
}
