import { useEffect, useState } from 'react'
import type { NodeView } from '@shared/types'
import { useJudge } from '../judgeStore'
import { modelName, useStore } from '../store'
import { CacheBar } from './CacheBar'
import { ChatSettingsPanel } from './ChatSettingsPanel'
import { Composer } from './Composer'
import { DeletedPanel } from './DeletedPanel'
import { SidebarIcon, SlidersIcon, SplitIcon, StarIcon, TrashIcon } from './Icons'
import { nextBookmark, useBookmarks } from '../bookmarks'
import { DiffSummary, DiffToggle } from './SplitDiff'
import { SplitView } from './SplitView'
import { SystemPromptCard } from './ChatTop'
import { EmptySky } from './Sky'
import { Thread } from './Thread'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The bookmarks on this branch, and a button that goes to the next one. */
function BookmarkJump() {
  const marks = useBookmarks()
  const path = useStore((s) => s.current?.path)
  const here = path ? path.filter((n) => marks.includes(n.id)).map((n) => n.id) : []
  if (!here.length) return null
  return (
    <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag bookmark-jump" title="Go to the next bookmarked reply" onClick={() => nextBookmark(here)}>
      <StarIcon />
      {here.length}
    </button>
  )
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

export function ChatView() {
  const current = useStore((s) => s.current)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const deleted = useStore((s) => s.deletions.length)
  const [panel, setPanel] = useState<'settings' | 'deleted' | null>(null)
  // The empty chat's quick check of its system prompt, opened from the small button under the greeting.
  const [promptOpen, setPromptOpen] = useState(false)
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
        <BookmarkJump />
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
            {current && (
              <button className="empty-prompt-chip" aria-expanded={promptOpen} onClick={() => setPromptOpen((o) => !o)} title="Check or set this chat's system prompt">
                <SlidersIcon size={13} />
                {current.settings.systemPrompt.trim() ? 'System prompt' : 'No system prompt'}
              </button>
            )}
            {current && promptOpen && <SystemPromptCard compact />}
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
