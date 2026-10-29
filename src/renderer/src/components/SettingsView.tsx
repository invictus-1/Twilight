import { ThemePicker } from './ThemePicker'
import { BackgroundPicker, MotionPicker, ScrollFxPicker, ThemeBuilder } from './LookSettings'
import { useEffect, useMemo, useState } from 'react'
import { ShortcutsSection } from './ShortcutsSection'
import { PricesSection } from './PricesSection'
import { LibrarySection } from './LibrarySection'
import { UsageSection } from './UsageSection'
import type { ModelInfo, ProviderConfig } from '@shared/types'
import { readGameFormat, writeGameFormat } from '../gameFormatSettings'
import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { savedTheme, setTheme, type Theme } from '../theme'
import { readHidden, writeHidden } from './ChatSettingsPanel'
import { RoadmapSection } from './RoadmapSection'
import { UpdatesSection } from './UpdatesSection'
import { ToolsSection } from './ToolsSection'
import { DataSection } from './DataSection'
import { ChipIcon, CloseIcon, CloudIcon, PenIcon, PlusIcon, RefreshIcon, TrashIcon } from './Icons'

// The Settings page: a section list on the left, one section on the right. Each section opens
// with a line saying what it's for.

type Section = 'providers' | 'tools' | 'prices' | 'usage' | 'general' | 'library' | 'writing' | 'data' | 'shortcuts' | 'extras' | 'updates' | 'roadmap' | 'about'

const SECTIONS: { id: Section; group: string; label: string; description: string }[] = [
  { id: 'general', group: 'App', label: 'General', description: 'How Twilight looks and how chats behave: the theme, the cache status line, Game Format, and the safety net.' },
  { id: 'library', group: 'App', label: 'Library', description: 'Your personas and prompts. A persona starts a chat with its instructions; a prompt goes into the message box from the composer.' },
  { id: 'writing', group: 'App', label: 'Writing', description: 'Where your documents live. Point it at an Obsidian vault and both apps edit the same files.' },
  { id: 'data', group: 'App', label: 'Data', description: 'Where Twilight keeps your chats and settings, moving them, and backups you can go back to.' },
  { id: 'shortcuts', group: 'App', label: 'Keyboard shortcuts', description: 'Every shortcut Twilight knows, and your own bindings.' },
  { id: 'extras', group: 'App', label: 'Extras', description: "Just for fun: little extras that don't change how anything works. All of them start off." },
  { id: 'providers', group: 'Models', label: 'Model providers', description: 'Connect cloud APIs and local servers, test them, and choose which models appear in the picker.' },
  { id: 'tools', group: 'Models', label: 'Tools', description: 'MCP servers that give chats tools, and the model that makes pictures. Each is switched on per chat in the Tools menu.' },
  { id: 'prices', group: 'Models', label: 'Prices', description: 'What replies cost: your own prices per model, and the built-in ones. A cost the provider reports itself comes first.' },
  { id: 'usage', group: 'Models', label: 'Usage', description: 'Tokens and spend over time, by model and by chat, counted from every reply and Judge run.' },
  { id: 'updates', group: 'About', label: 'Updates', description: 'Your version, new releases, and rolling back to an earlier one. The daily check is the only request Twilight makes on its own.' },
  { id: 'roadmap', group: 'About', label: 'Roadmap', description: 'What has shipped, what comes next, and the ideas further out.' },
  { id: 'about', group: 'About', label: 'About', description: 'Version and where Twilight lives.' }
]

const BUILT_IN = new Set(['anthropic', 'ollama', 'lmstudio'])

/** One-click starting points for the "Add provider" form. */
const PRESETS = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
  { name: 'vLLM', baseUrl: 'http://localhost:8000/v1' }
]

/** The provider with these models shown or hidden in the picker (converting the older hidden list). */
function showModels(provider: ProviderConfig, ids: string[], show: boolean): ProviderConfig {
  const all = useStore.getState().models.filter((m) => m.providerId === provider.id)
  const shown = new Set(provider.shownModels ?? all.filter((m) => !m.hidden).map((m) => m.id))
  for (const id of ids) show ? shown.add(id) : shown.delete(id)
  return { ...provider, shownModels: [...shown], hiddenModels: undefined }
}

const saveProvider = async (provider: ProviderConfig, apiKey?: string): Promise<void> => {
  useStore.getState().setProviders(await window.twilight.saveProvider(provider, apiKey))
  await useStore.getState().refreshModels(true)
  useStore.getState().setProviders(await window.twilight.listProviders())
}

// ——— Providers ———

function ModelRow({ provider, model }: { provider: ProviderConfig; model: ModelInfo }) {
  const [renaming, setRenaming] = useState(false)
  const toggleHidden = (): void => void saveProvider(showModels(provider, [model.id], model.hidden ?? false))
  return (
    <div className={`model-row ${model.hidden ? 'model-hidden' : ''}`}>
      <label className="check" title={model.hidden ? 'Hidden from the model picker' : 'Shown in the model picker'}>
        <input type="checkbox" checked={!model.hidden} onChange={toggleHidden} aria-label={`Show ${model.name} in the model picker`} />
      </label>
      <div className="model-main">
        {renaming ? (
          <input
            className="tw-conv-edit"
            autoFocus
            defaultValue={model.name}
            onBlur={(e) => {
              setRenaming(false)
              const label = e.currentTarget.value.trim()
              const labels = { ...(provider.labels ?? {}) }
              if (!label || label === (model.originalName ?? model.id)) delete labels[model.id]
              else labels[model.id] = label
              void saveProvider({ ...provider, labels })
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <div className="model-name">
            {model.name}
            {model.originalName && model.originalName !== model.id && <span className="field-note"> ({model.originalName})</span>}
            <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Rename ${model.name}`} title="Rename" onClick={() => setRenaming(true)}>
              <PenIcon size={13} />
            </button>
          </div>
        )}
        <div className="model-id">
          <code>{model.id}</code>
          {model.contextWindow ? <span> · {Math.round(model.contextWindow / 1000)}k context</span> : null}
          {model.options?.maxOutput ? <span> · {Math.round(model.options.maxOutput / 1000)}k output</span> : null}
          {model.custom && <span> · added by hand</span>}
        </div>
        <div className="model-caps">
          {(model.capabilities ?? ['Text']).map((c) => (
            <span key={c} className="tw-badge cap-badge">
              {c}
            </span>
          ))}
          {model.options && model.options.efforts.length > 0 && (
            <span className="tw-badge cap-effort" title={model.options.effortsFromProvider ? 'Levels reported by the provider' : 'Standard level names'}>
              effort: {model.options.efforts.join(' · ')}
            </span>
          )}
        </div>
      </div>
      {model.custom && (
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label={`Remove ${model.id}`}
          onClick={() => void saveProvider({ ...provider, customModels: (provider.customModels ?? []).filter((id) => id !== model.id) })}
        >
          <TrashIcon size={14} />
        </button>
      )}
    </div>
  )
}

const providerIcon = (provider: ProviderConfig): React.ReactElement =>
  provider.kind === 'anthropic' || !/localhost|127\.0\.0\.1/.test(provider.baseUrl ?? '') ? <CloudIcon className="muted" /> : <ChipIcon className="muted" />

/** A provider in the list on the left: name, kind, how it's doing, and its on/off switch. */
function ProviderListItem({ provider, selected, onSelect }: { provider: ProviderConfig; selected: boolean; onSelect: () => void }) {
  const count = useStore((s) => s.models.filter((m) => m.providerId === provider.id).length)
  const status = provider.status
  return (
    <div className={`provider-item ${selected ? 'selected' : ''} ${provider.enabled ? '' : 'off'}`} role="button" tabIndex={0} aria-current={selected || undefined} onClick={onSelect} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}>
      <span className="provider-item-icon">{providerIcon(provider)}</span>
      <span className="provider-item-text">
        <span className="provider-name">{provider.name}</span>
        <span className="provider-item-meta">
          <span className={`provider-dot ${status ? (status.ok ? 'ok' : 'bad') : ''}`} />
          {provider.enabled ? `${count} model${count === 1 ? '' : 's'}` : 'Off'}
        </span>
      </span>
      <label className="switch" onClick={(e) => e.stopPropagation()} title={provider.enabled ? 'On' : 'Off'}>
        <input type="checkbox" checked={provider.enabled} aria-label={`${provider.name} on`} onChange={(e) => void saveProvider({ ...provider, enabled: e.target.checked })} />
        <span className="switch-track" />
      </label>
    </div>
  )
}

/** The selected provider: connection on top, then its models as a grid. */
function ProviderDetail({ provider, filter }: { provider: ProviderConfig; filter: string }) {
  const models = useStore((s) => s.models).filter((m) => m.providerId === provider.id)
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(provider.baseUrl ?? '')
  const [testing, setTesting] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [newModel, setNewModel] = useState('')
  const status = provider.status
  const shown = models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes((modelFilter || filter).toLowerCase()))
  const hiddenCount = models.filter((m) => m.hidden).length
  const anthropic = provider.kind === 'anthropic'

  const test = async (): Promise<void> => {
    setTesting(true)
    await window.twilight.testProvider(provider.id)
    await useStore.getState().refreshModels(true)
    useStore.getState().setProviders(await window.twilight.listProviders())
    setTesting(false)
  }

  return (
    <div className="provider-detail">
      <header className="provider-detail-head">
        <span className="provider-detail-icon">{providerIcon(provider)}</span>
        <div className="provider-detail-title">
          <h3 className="t-heading">{provider.name}</h3>
          <span className="provider-kind-inline">{anthropic ? 'Claude API' : 'OpenAI-compatible'}{provider.baseUrl ? ` · ${provider.baseUrl}` : ''}</span>
        </div>
        <span className="tw-spacer" />
        {status && (
          <span className={`provider-pill ${status.ok ? 'ok' : 'bad'}`} title={status.message}>
            <span className="provider-dot" /> {status.ok ? 'Connected' : 'Problem'}
          </span>
        )}
        <label className="switch" title={provider.enabled ? 'On' : 'Off'}>
          <input type="checkbox" checked={provider.enabled} aria-label={`${provider.name} on`} onChange={(e) => void saveProvider({ ...provider, enabled: e.target.checked })} />
          <span className="switch-track" />
        </label>
      </header>

      {status && !status.ok && (
        <div className="tw-msg-error">
          <strong>{provider.name} says:</strong> {status.message}
        </div>
      )}

      <section className="settings-card">
        <h4 className="provider-section-title">Connection</h4>
        <div className="connection-grid">
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault()
              void saveProvider(provider, key).then(test)
              setKey('')
            }}
          >
            <span className="field-label">API key {!anthropic && '(optional for local servers)'}</span>
            <div className="field-inline">
              <input
                type="password"
                value={key}
                autoComplete="off"
                placeholder={provider.hasKey ? 'Saved (encrypted). Paste to replace' : anthropic ? 'sk-ant-api…' : 'Paste key'}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="tw-btn tw-btn-sm" type="submit" disabled={!key.trim()}>
                Save
              </button>
              {provider.hasKey && (
                <button className="tw-btn tw-btn-sm tw-btn-ghost" type="button" onClick={() => void saveProvider(provider, '')}>
                  Remove
                </button>
              )}
            </div>
            {anthropic && <span className="field-note">An API key from console.anthropic.com → API keys. A Claude subscription can't be used here.</span>}
          </form>
          <label className="field">
            <span className="field-label">{anthropic ? 'Endpoint' : 'Server address'}</span>
            <input
              value={url}
              placeholder={anthropic ? 'https://api.anthropic.com' : 'http://localhost:11434/v1'}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => url !== (provider.baseUrl ?? '') && void saveProvider({ ...provider, baseUrl: url.trim() || undefined })}
            />
            <span className="field-note">{anthropic ? 'Leave empty for api.anthropic.com. No /v1 needed; Twilight adds it.' : 'Most servers end in /v1.'}</span>
          </label>
        </div>
        <div className="field-inline">
          <button className="tw-btn tw-btn-sm" disabled={testing} onClick={() => void test()}>
            <RefreshIcon size={14} className={testing ? 'spinning' : ''} />
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {status && <span className={`field-note ${status.ok ? '' : 'danger-text'}`}>{status.ok ? status.message : 'See the message above.'}</span>}
          <span className="tw-spacer" />
          {!BUILT_IN.has(provider.id) && (
            <button
              className="tw-btn tw-btn-sm tw-btn-ghost danger-text"
              onClick={async () => {
                useStore.getState().setProviders(await window.twilight.deleteProvider(provider.id))
                void useStore.getState().refreshModels(true)
              }}
            >
              Remove provider
            </button>
          )}
        </div>
      </section>

      <section className="settings-card">
        <div className="models-head">
          <h4 className="provider-section-title">
            Models <span className="rm-heading-count">{models.length}</span>
            <span className="field-note">{models.length - hiddenCount} in the picker</span>
          </h4>
          {models.length > 0 && (
            <span className="models-head-actions">
              <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void saveProvider(showModels(provider, shown.map((m) => m.id), true))}>
                Show all
              </button>
              <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void saveProvider(showModels(provider, shown.map((m) => m.id), false))}>
                Hide all
              </button>
              <input placeholder="Filter models" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} />
            </span>
          )}
        </div>
        {models.length === 0 ? (
          <div className="models-empty">
            <span className="models-empty-icon">{providerIcon(provider)}</span>
            <div>
              <div className="t-label">No models yet</div>
              <ol className="models-empty-steps">
                {anthropic ? <li>Paste an API key above and press Save.</li> : <li>Start {provider.name} on this computer, or check the server address.</li>}
                <li>Press Test connection. The models and what each can do appear here.</li>
                <li>Or add a model id by hand below.</li>
              </ol>
            </div>
          </div>
        ) : (
          <>
            <p className="field-note">
              New models start hidden: tick the ones you want in the model picker. What each can do comes from the provider; the pencil gives a model a
              name of your own.
            </p>
            <div className="model-list">
              {shown.map((m) => (
                <ModelRow key={m.id} provider={provider} model={m} />
              ))}
            </div>
          </>
        )}
        <form
          className="field-inline"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newModel.trim()) return
            void saveProvider({ ...provider, customModels: [...new Set([...(provider.customModels ?? []), newModel.trim()])] })
            setNewModel('')
          }}
        >
          <input placeholder={`Add a model id by hand, e.g. ${anthropic ? 'claude-opus-5-5' : 'llama3.3'}`} value={newModel} onChange={(e) => setNewModel(e.target.value)} />
          <button className="tw-btn tw-btn-sm" type="submit" disabled={!newModel.trim()}>
            <PlusIcon size={14} />
            Add model
          </button>
        </form>
      </section>
    </div>
  )
}

function ProvidersSection() {
  const providers = useStore((s) => s.providers)
  const models = useStore((s) => s.models)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visible = useMemo(
    () =>
      providers.filter(
        (p) =>
          !filter.trim() ||
          p.name.toLowerCase().includes(filter.toLowerCase()) ||
          models.some((m) => m.providerId === p.id && `${m.name} ${m.id}`.toLowerCase().includes(filter.toLowerCase()))
      ),
    [providers, models, filter]
  )
  const selected = visible.find((p) => p.id === selectedId) ?? visible[0]

  return (
    <>
      <div className="providers-bar">
        <input className="providers-search" placeholder="Search providers and models" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label="Refresh every provider"
          title="Refresh every provider"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await useStore.getState().refreshModels(true)
            useStore.getState().setProviders(await window.twilight.listProviders())
            setRefreshing(false)
          }}
        >
          <RefreshIcon className={refreshing ? 'spinning' : ''} />
        </button>
      </div>
      <div className="providers-layout">
        <nav className="provider-list" aria-label="Providers">
          {visible.map((p) => (
            <ProviderListItem key={p.id} provider={p} selected={p.id === selected?.id} onSelect={() => setSelectedId(p.id)} />
          ))}
          {visible.length === 0 && <p className="field-note">Nothing matches “{filter}”.</p>}
          {adding ? (
            <div className="add-provider">
              <span className="t-label">Add an OpenAI-compatible provider</span>
              <div className="preset-chips">
                {PRESETS.map((p) => (
                  <button key={p.name} className="tw-btn tw-btn-sm" onClick={() => (setName(p.name), setUrl(p.baseUrl))}>
                    {p.name}
                  </button>
                ))}
              </div>
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input placeholder="https://host/v1" value={url} onChange={(e) => setUrl(e.target.value)} />
              <div className="field-inline">
                <button
                  className="tw-btn tw-btn-sm tw-btn-primary"
                  disabled={!name.trim() || !url.trim()}
                  onClick={async () => {
                    const id = `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                    await saveProvider({ id, kind: 'openai', name: name.trim(), baseUrl: url.trim(), enabled: true, shownModels: [] })
                    setSelectedId(id)
                    setName('')
                    setUrl('')
                    setAdding(false)
                  }}
                >
                  Add
                </button>
                <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="provider-add" onClick={() => setAdding(true)}>
              <PlusIcon size={14} />
              Add provider
            </button>
          )}
          <p className="field-note provider-list-note">Keys are encrypted with Windows' own credential protection and only ever sent to their provider.</p>
        </nav>
        {selected ? <ProviderDetail key={selected.id} provider={selected} filter={filter} /> : <div className="provider-detail" />}
      </div>
    </>
  )
}

// ——— Other sections ———

function GeneralSection() {
  const [options, setOptions] = useState(readGameFormat)
  const [cacheBar, setCacheBar] = useState(() => !readHidden())
  const [logs, setLogs] = useState<{ enabled: boolean; folder: string } | null>(null)
  useEffect(() => {
    void window.twilight.getRequestLogs().then(setLogs)
  }, [])
  const setGame = (patch: Partial<typeof options>): void => {
    const next = { ...options, ...patch }
    writeGameFormat(next)
    setOptions(next)
  }
  const [theme, setThemeState] = useState<Theme>(savedTheme)
  const pick = (t: Theme): void => {
    setTheme(t)
    setThemeState(t)
  }
  return (
    <>
      <div className="settings-card">
        <h3 className="t-heading">Appearance</h3>
        <ThemePicker value={theme} onPick={pick} custom />
        {theme === 'custom' && <ThemeBuilder />}
        <BackgroundPicker />
        <MotionPicker />
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Chat</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={cacheBar}
            onChange={(e) => {
              writeHidden(!e.target.checked)
              setCacheBar(e.target.checked)
            }}
          />
          Show the prompt cache status line under chats
        </label>
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Game Format</h3>
        <p className="field-note">
          The Game Format button on a reply copies it with each chunk's paragraphs joined by single line breaks. Code blocks and HTML blocks (stat
          sheets, status cards) are copied exactly as they are.
        </p>
        <label className="check">
          <input type="checkbox" checked={options.removeDividers} onChange={(e) => setGame({ removeDividers: e.target.checked })} />
          Remove the --- dividers between chunks too
        </label>
        <label className="check">
          <input type="checkbox" checked={options.stripMarkdown} onChange={(e) => setGame({ stripMarkdown: e.target.checked })} />
          Remove markdown marks from prose (**bold**, *italic*, # headings)
        </label>
      </div>
      {logs && (
        <div className="settings-card">
          <h3 className="t-heading">Safety net</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={logs.enabled}
              onChange={async (e) => {
                await window.twilight.setRequestLogs(e.target.checked)
                setLogs({ ...logs, enabled: e.target.checked })
              }}
            />
            Keep request logs
          </label>
          <p className="field-note">
            Every prompt and reply, from chats, writing tools and the Judge, is added to a daily file. Nothing is ever removed from them. API keys are
            never written. Deleted chats wait in the Trash; deleted messages in “Recently deleted” in each chat.
          </p>
          <div className="field-inline">
            <span className="folder-path log-path">{logs.folder}</span>
            <button className="tw-btn tw-btn-sm" onClick={() => void window.twilight.openLogsFolder()}>
              Open folder
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function WritingSection() {
  const folder = useWriting((s) => s.folder)
  return (
    <div className="settings-card">
      <h3 className="t-heading">Writing folder</h3>
      <div className="field-inline">
        <span className="folder-path log-path">{folder}</span>
        <button className="tw-btn tw-btn-sm" onClick={() => void useWriting.getState().chooseFolder()}>
          Choose…
        </button>
      </div>
      <p className="field-note">Documents are plain .md files. Twilight's per-document context and edit history stay in its own database, never in your files.</p>
    </div>
  )
}

/** Extras: things for fun that have no other home. */
function ExtrasSection() {
  return (
    <div className="settings-card">
      <h3 className="t-heading">Scroll particles</h3>
      <ScrollFxPicker />
    </div>
  )
}

function AboutSection() {
  const [info, setInfo] = useState<{ version: string; electron: string } | null>(null)
  useEffect(() => {
    void window.twilight.getAppInfo().then(setInfo)
  }, [])
  return (
    <div className="settings-card">
      <h3 className="t-heading">Twilight {info?.version}</h3>
      <p className="field-note">Electron {info?.electron}. Local-first: the interface never touches the network; only your configured providers are contacted.</p>
      <div className="field-inline">
        <button className="tw-btn tw-btn-sm" onClick={() => useStore.getState().setWelcomeOpen(true)}>
          Replay the welcome
        </button>
      </div>
    </div>
  )
}

function UpdateDot() {
  const latest = useStore((s) => s.updates?.latest)
  return latest ? <span className="update-dot" title={`Twilight ${latest} is available`} /> : null
}

export function SettingsView() {
  const [section, setSection] = useState<Section>(() => (useStore.getState().settingsSection as Section | null) ?? 'providers')
  const current = SECTIONS.find((s) => s.id === section)!
  const groups = [...new Set(SECTIONS.map((s) => s.group))]
  return (
    <main className="chat settings-view">
      <header className="chat-head drag">
        <h1 className="chat-title">Settings</h1>
        <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag" onClick={() => useStore.getState().setSettingsOpen(false)}>
          <CloseIcon />
          Close (Esc)
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {groups.map((g) => (
            <div key={g}>
              <div className="side-section">{g}</div>
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <button key={s.id} className="settings-nav-item" aria-current={s.id === section ? 'true' : undefined} onClick={() => setSection(s.id)}>
                  {s.label}
                  {s.id === 'updates' && <UpdateDot />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <h2 className="t-title">{current.label}</h2>
          <p className="section-description">{current.description}</p>
          {section === 'providers' && <ProvidersSection />}
          {section === 'tools' && <ToolsSection />}
          {section === 'prices' && <PricesSection />}
          {section === 'usage' && <UsageSection />}
          {section === 'general' && <GeneralSection />}
          {section === 'library' && <LibrarySection />}
          {section === 'writing' && <WritingSection />}
          {section === 'data' && <DataSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'extras' && <ExtrasSection />}
          {section === 'updates' && <UpdatesSection />}
          {section === 'roadmap' && <RoadmapSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </main>
  )
}
