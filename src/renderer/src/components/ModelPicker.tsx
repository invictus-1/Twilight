import { useEffect, useMemo, useRef, useState } from 'react'
import { usePane } from '../pane'
import { modelName, paneOf, useStore } from '../store'
import { CheckIcon, ChevronDown, ChipIcon, CloudIcon, RefreshIcon } from './Icons'

/**
 * The model chip and its menu. Opens upward from the composer, downward from a header. With
 * scope "defaults" it picks the default model (used by new chats and the writing tools).
 */
export function ModelPicker({ placement = 'up', scope = 'chat' }: { placement?: 'up' | 'down'; scope?: 'chat' | 'defaults' }) {
  const pane = usePane()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const settings = useStore((s) => (s.current && scope === 'chat' ? paneOf(s.current, pane).settings : s.defaults))
  const started = useStore((s) => (s.current && scope === 'chat' ? paneOf(s.current, pane).path.length > 0 : false))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return providers
      .filter((p) => p.enabled)
      .map((p) => ({
        provider: p,
        models: models.filter((m) => m.providerId === p.id && !m.hidden && (!f || `${m.name} ${m.id}`.toLowerCase().includes(f)))
      }))
      .filter((g) => g.models.length)
  }, [providers, models, filter])

  const pick = (providerId: string, modelId: string): void => {
    if (scope === 'defaults') void useStore.getState().setDefaultModel(providerId, modelId)
    else void useStore.getState().updateSettings({ providerId, modelId }, pane)
    setOpen(false)
  }

  return (
    <div className="picker" ref={root}>
      <button className="tw-chip" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Model">
        {modelName(models, settings?.modelId)}
        <ChevronDown size={14} className="chip-chevron" />
      </button>
      {open && (
        <div className={`tw-menu picker-menu picker-${placement}`} role="listbox">
          <div className="picker-search">
            <input autoFocus placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button
              className="tw-btn tw-btn-ghost tw-btn-icon"
              aria-label="Refresh model list"
              title="Refresh model list"
              onClick={() => void useStore.getState().refreshModels(true)}
            >
              <RefreshIcon size={14} />
            </button>
          </div>
          <div className="picker-list">
            {groups.map(({ provider, models: list }) => (
              <div key={provider.id}>
                <div className="tw-menu-label">
                  {provider.name} · {provider.kind === 'anthropic' ? 'API' : list[0]?.local ? 'Local' : 'API'}
                </div>
                {list.map((m) => {
                  const selected = settings?.modelId === m.id && settings?.providerId === m.providerId
                  return (
                    <div
                      key={`${m.providerId}:${m.id}`}
                      className="tw-menu-item"
                      role="option"
                      aria-selected={selected}
                      onClick={() => pick(m.providerId, m.id)}
                    >
                      {m.local ? <ChipIcon className="muted" /> : <CloudIcon className="muted" />}
                      <span className="picker-name">{m.name}</span>
                      <span className="tw-meta">
                        {selected ? (
                          <CheckIcon className="iris" />
                        ) : m.contextWindow ? (
                          `${Math.round(m.contextWindow / 1000)}k`
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="picker-empty">
                No models found. Add an Anthropic API key, or start Ollama or LM Studio, in{' '}
                <button className="link-btn" onClick={() => useStore.getState().setSettingsOpen(true)}>
                  Settings
                </button>
                .
              </div>
            )}
          </div>
          {started && <div className="picker-note">Switching models mid-chat starts a fresh prompt cache.</div>}
        </div>
      )}
    </div>
  )
}
