import { useEffect, useRef, useState } from 'react'
import type { ChatSettings } from '@shared/types'
import { webSupport, type WebSupport } from '@shared/webTools'
import { useStore } from '../store'
import { ToolIcon } from './Icons'

/**
 * A small description that appears after the pointer rests on a control for a moment (or when it
 * has keyboard focus), so the composer stays uncluttered but every switch explains itself.
 */
export function Hint({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const show = (): void => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 450)
  }
  const hide = (): void => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <span className="hint-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onMouseDown={hide}>
      {children}
      {open && (
        <span className="hint" role="tooltip">
          <b>{title}</b>
          {text}
        </span>
      )}
    </span>
  )
}

function Row(props: { label: string; note: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; sub?: boolean; tool?: string }) {
  return (
    <label className={`tools-row ${props.sub ? 'sub' : ''} ${props.disabled ? 'disabled' : ''}`} data-tool={props.tool}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        <span className="tools-label">{props.label}</span>
        <span className="tools-note">{props.note}</span>
      </span>
    </label>
  )
}

/** The composer's Tools menu: what the model may use in this chat, switched on and off in one place. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const settings = useStore((s) => s.current?.settings)
  const split = useStore((s) => !!s.current?.split)
  const providerB = useStore((s) => s.current?.split?.settings.providerId)
  const providers = useStore((s) => s.providers)
  const allServers = useStore((s) => s.mcpServers)
  const [hasImageModel, setHasImageModel] = useState(false)
  useEffect(() => {
    if (open) void window.twilight.getImageConfig().then((c) => setHasImageModel(!!c))
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!settings) return null
  const update = (patch: Partial<ChatSettings>): void => {
    const s = useStore.getState()
    void s.updateSettings(patch, 'a')
    if (split) void s.updateSettings(patch, 'b')
  }
  // A web tool is offered when either pane's provider has it; a pane whose provider doesn't
  // simply leaves it out of its requests.
  const panes = [settings.providerId, ...(split && providerB ? [providerB] : [])].map((id) => webSupport(providers.find((p) => p.id === id)))
  const usable = (key: 'search' | 'fetch'): WebSupport => panes.find((p) => p[key] === null) ?? panes[0]
  const searchHas = usable('search')
  const fetchHas = usable('fetch')
  const searchOn = settings.webSearch && searchHas.search === null
  const fetchOn = settings.webFetch && fetchHas.fetch === null
  const servers = allServers.filter((m) => m.enabled)
  const mcpOn = servers.filter((m) => settings.mcpServers.includes(m.id)).length
  const active = (settings.choiceCards ? 1 + (settings.choiceTool ? 1 : 0) : 0) + (searchOn ? 1 : 0) + (fetchOn ? 1 : 0) + (settings.dateTime ? 1 : 0) + mcpOn + (settings.imageGen ? 1 : 0)
  return (
    <div className="tools-menu" ref={box}>
      <Hint title="Tools" text="Switch on what the model can use in this chat: choice cards, web search and fetch, the date and time, MCP servers and pictures.">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
          <ToolIcon size={15} />
          Tools
          {active > 0 && <span className="tools-count">{active}</span>}
        </button>
      </Hint>
      {open && (
        <div className="tools-pop" role="dialog" aria-label="Tools">
          <div className="tools-head">Choices{split ? ' · both panes' : ''}</div>
          <Row
            label="Choice cards"
            note="When the story reaches a decision, the options become a card you can click, edit or answer in your own words."
            checked={settings.choiceCards}
            onChange={(on) => update({ choiceCards: on })}
          />
          <Row
            sub
            label="Choice menu tool (present_choices)"
            note="The model sends the options as data through a tool call. The most reliable way; needs a model with tool calling."
            checked={settings.choiceTool}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choiceTool: on })}
          />
          <Row
            sub
            label="Choices blocks"
            note="Read a choices code block the model writes at the end of its reply."
            checked={settings.choiceFenced}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choiceFenced: on })}
          />
          <Row
            sub
            label="Plain numbered options"
            note={'Read options your own prompt writes as a numbered list, under a title that asks or with "Something else".'}
            checked={settings.choicePlain}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choicePlain: on })}
          />
          <Row
            sub
            label="Tell the model how"
            note="Adds a short instruction to the system prompt. Turn off if your own prompt already covers choices."
            checked={settings.choiceInstructions}
            disabled={!settings.choiceCards}
            onChange={(on) => update({ choiceInstructions: on })}
          />
          <div className="tools-head">Web and time{split ? ' · both panes' : ''}</div>
          <Row
            tool="webSearch"
            label="Web search"
            note={
              searchHas.search ??
              (searchHas.via === 'claude'
                ? "Claude searches when it needs to and cites what it finds. Anthropic bills each search ($10 per 1,000)."
                : "OpenRouter's web plugin searches once for each message and adds the results. OpenRouter bills the search.")
            }
            checked={searchOn}
            disabled={searchHas.search !== null}
            onChange={(on) => update({ webSearch: on })}
          />
          <Row
            tool="webFetch"
            label="Web fetch"
            note={fetchHas.fetch ?? 'Claude can read a page in full: one you link, or one it found. The page counts as input tokens.'}
            checked={fetchOn}
            disabled={fetchHas.fetch !== null}
            onChange={(on) => update({ webFetch: on })}
          />
          <Row
            tool="dateTime"
            label="Date and time"
            note="Puts your local date, time and time zone at the start of each message you send. Earlier messages stay as they were, so the cache holds."
            checked={settings.dateTime}
            onChange={(on) => update({ dateTime: on })}
          />
          <div className="tools-head">MCP servers and pictures{split ? ' · both panes' : ''}</div>
          {servers.map((m) => (
            <Row
              key={m.id}
              tool={`mcp:${m.name}`}
              label={m.name}
              note={
                m.status.state === 'error'
                  ? `Problem: ${m.status.error}`
                  : `${m.status.state === 'ready' ? `${m.status.tools.length} tool${m.status.tools.length === 1 ? '' : 's'}` : 'Connects when the chat sends'}. ${m.approval === 'ask' ? 'Asks before each call.' : 'Runs calls without asking.'}`
              }
              checked={settings.mcpServers.includes(m.id)}
              onChange={(on) => update({ mcpServers: on ? [...settings.mcpServers, m.id] : settings.mcpServers.filter((x) => x !== m.id) })}
            />
          ))}
          {servers.length === 0 && <p className="tools-empty">No MCP servers yet. Add one in Settings → Tools.</p>}
          <Row
            tool="imageGen"
            label="Pictures"
            note={hasImageModel ? 'The model can make an image when you ask for one; it shows under the reply. Billed by the image provider.' : 'Choose an image model in Settings → Tools first.'}
            checked={settings.imageGen && hasImageModel}
            disabled={!hasImageModel}
            onChange={(on) => update({ imageGen: on })}
          />
        </div>
      )}
    </div>
  )
}
