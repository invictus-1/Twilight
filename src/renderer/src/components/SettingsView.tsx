import { useEffect, useMemo, useState } from 'react'
import type { ModelInfo, ProviderConfig } from '@shared/types'
import { readGameFormat, writeGameFormat } from '../gameFormatSettings'
import { useStore } from '../store'
import { useWriting } from '../writingStore'
import { readHidden, writeHidden } from './ChatSettingsPanel'
import { ChevronDown, ChevronRight, ChipIcon, CloseIcon, CloudIcon, PenIcon, PlusIcon, RefreshIcon, TrashIcon } from './Icons'

// The Settings page: a section list on the left, one section on the right. Each section opens
// with a line saying what it's for.

type Section = 'providers' | 'general' | 'writing' | 'data' | 'shortcuts' | 'about'

const SECTIONS: { id: Section; group: string; label: string; description: string }[] = [
  { id: 'general', group: 'App', label: 'General', description: 'How chats behave and look: the cache status line, Game Format, and the safety net.' },
  { id: 'writing', group: 'App', label: 'Writing', description: 'Where your documents live. Point it at an Obsidian vault and both apps edit the same files.' },
  { id: 'data', group: 'App', label: 'Data', description: 'Where Twilight keeps your chats, settings and request logs on this machine.' },
  { id: 'shortcuts', group: 'App', label: 'Keyboard shortcuts', description: 'Every shortcut Twilight knows.' },
  { id: 'providers', group: 'Models', label: 'Model providers', description: 'Connect cloud APIs and local servers, test them, and choose which models appear in the picker.' },
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

const saveProvider = async (provider: ProviderConfig, apiKey?: string): Promise<void> => {
  useStore.getState().setProviders(await window.twilight.saveProvider(provider, apiKey))
  await useStore.getState().refreshModels(true)
  useStore.getState().setProviders(await window.twilight.listProviders())
}

// ——— Providers ———

function ModelRow({ provider, model }: { provider: ProviderConfig; model: ModelInfo }) {
  const [renaming, setRenaming] = useState(false)
  const toggleHidden = (): void => {
    const hidden = new Set(provider.hiddenModels ?? [])
    if (hidden.has(model.id)) hidden.delete(model.id)
    else hidden.add(model.id)
    void saveProvider({ ...provider, hiddenModels: [...hidden] })
  }
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
            {model.originalName && <span className="field-note"> ({model.originalName})</span>}
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

function ProviderCard({ provider, filter }: { provider: ProviderConfig; filter: string }) {
  const models = useStore((s) => s.models).filter((m) => m.providerId === provider.id)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(provider.baseUrl ?? '')
  const [testing, setTesting] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [newModel, setNewModel] = useState('')
  const status = provider.status
  const shown = models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes((modelFilter || filter).toLowerCase()))
  const hiddenCount = models.filter((m) => m.hidden).length

  const test = async (): Promise<void> => {
    setTesting(true)
    await window.twilight.testProvider(provider.id)
    await useStore.getState().refreshModels(true)
    useStore.getState().setProviders(await window.twilight.listProviders())
    setTesting(false)
  }

  return (
    <section className={`provider-card ${open ? 'open' : ''}`}>
      <header className="provider-card-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={16} className="folder-chevron" /> : <ChevronRight size={16} className="folder-chevron" />}
        {provider.kind === 'anthropic' || !/localhost|127\.0\.0\.1/.test(provider.baseUrl ?? '') ? <CloudIcon className="muted" /> : <ChipIcon className="muted" />}
        <span className="provider-name">{provider.name}</span>
        <span className="provider-kind">{provider.kind === 'anthropic' ? 'Claude API' : 'OpenAI-compatible'}</span>
        <span className="tw-spacer" />
        {status && (
          <span className={`provider-status ${status.ok ? 'ok' : 'bad'}`} title={status.message}>
            <span className="cache-dot" /> {status.ok ? 'Connected' : 'Problem'}
          </span>
        )}
        <span className="provider-count">
          {models.length} model{models.length === 1 ? '' : 's'}
          {hiddenCount ? ` · ${hiddenCount} hidden` : ''}
        </span>
        <label className="switch" onClick={(e) => e.stopPropagation()} title={provider.enabled ? 'On' : 'Off'}>
          <input type="checkbox" checked={provider.enabled} onChange={(e) => void saveProvider({ ...provider, enabled: e.target.checked })} />
          <span className="switch-track" />
        </label>
      </header>
      {open && (
        <div className="provider-card-body">
          {status && !status.ok && <div className="tw-msg-error"><strong>{provider.name} says:</strong> {status.message}</div>}
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault()
              void saveProvider(provider, key).then(test)
              setKey('')
            }}
          >
            <span className="field-label">API key {provider.kind === 'openai' && '(optional for local servers)'}</span>
            <div className="field-inline">
              <input
                type="password"
                value={key}
                autoComplete="off"
                placeholder={provider.hasKey ? 'Saved (encrypted) — paste to replace' : 'Paste key'}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="tw-btn tw-btn-sm" type="submit" disabled={!key.trim()}>
                Save key
              </button>
              {provider.hasKey && (
                <button className="tw-btn tw-btn-sm tw-btn-ghost" type="button" onClick={() => void saveProvider(provider, '')}>
                  Remove key
                </button>
              )}
            </div>
          </form>
          <label className="field">
            <span className="field-label">{provider.kind === 'anthropic' ? 'Endpoint (leave empty for api.anthropic.com)' : 'Server address'}</span>
            <input
              value={url}
              placeholder={provider.kind === 'anthropic' ? 'https://api.anthropic.com' : 'http://localhost:11434/v1'}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => url !== (provider.baseUrl ?? '') && void saveProvider({ ...provider, baseUrl: url.trim() || undefined })}
            />
          </label>
          <div className="field-inline">
            <button className="tw-btn tw-btn-sm" disabled={testing} onClick={() => void test()}>
              <RefreshIcon size={14} />
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {status && <span className={`field-note ${status.ok ? '' : 'danger-text'}`}>{status.message}</span>}
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

          <div className="models-head">
            <h3 className="t-heading">Models</h3>
            <input placeholder="Filter models" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} />
          </div>
          <p className="field-note">
            Abilities come from the provider: Anthropic reports each model's capabilities and effort levels; OpenRouter reports supported parameters.
            Untick a model to keep it out of the picker.
          </p>
          <div className="model-list">
            {shown.map((m) => (
              <ModelRow key={m.id} provider={provider} model={m} />
            ))}
            {models.length === 0 && <p className="field-note">No models yet. Save a key or start the server, then Test connection.</p>}
          </div>
          <form
            className="field-inline"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newModel.trim()) return
              void saveProvider({ ...provider, customModels: [...new Set([...(provider.customModels ?? []), newModel.trim()])] })
              setNewModel('')
            }}
          >
            <input placeholder="Add a model id by hand, e.g. claude-opus-5-5" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
            <button className="tw-btn tw-btn-sm" type="submit" disabled={!newModel.trim()}>
              <PlusIcon size={14} />
              Add model
            </button>
          </form>
        </div>
      )}
    </section>
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
          <RefreshIcon />
        </button>
        <button className="tw-btn tw-btn-primary" onClick={() => setAdding((a) => !a)}>
          <PlusIcon />
          Add provider
        </button>
      </div>
      {adding && (
        <section className="provider-card open add-provider">
          <div className="provider-card-body">
            <span className="t-label">Add an OpenAI-compatible provider</span>
            <div className="preset-chips">
              {PRESETS.map((p) => (
                <button key={p.name} className="tw-btn tw-btn-sm" onClick={() => (setName(p.name), setUrl(p.baseUrl))}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="field-inline">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input placeholder="https://host/v1" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button
                className="tw-btn tw-btn-sm tw-btn-primary"
                disabled={!name.trim() || !url.trim()}
                onClick={async () => {
                  const id = `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                  await saveProvider({ id, kind: 'openai', name: name.trim(), baseUrl: url.trim(), enabled: true })
                  setName('')
                  setUrl('')
                  setAdding(false)
                }}
              >
                Add
              </button>
              <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Cancel" onClick={() => setAdding(false)}>
                <CloseIcon />
              </button>
            </div>
            <p className="field-note">Then open it below to add an API key if it needs one.</p>
          </div>
        </section>
      )}
      {visible.map((p) => (
        <ProviderCard key={p.id} provider={p} filter={filter} />
      ))}
      <p className="field-note">Keys are encrypted with Windows' own credential protection and only ever sent to their provider.</p>
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
  return (
    <>
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

function DataSection() {
  const [info, setInfo] = useState<{ version: string; dataFolder: string } | null>(null)
  useEffect(() => {
    void window.twilight.getAppInfo().then(setInfo)
  }, [])
  return (
    <div className="settings-card">
      <h3 className="t-heading">App data</h3>
      <p className="field-note">Chats, workspaces, settings and encrypted keys live in one database here. Updating or reinstalling Twilight never touches it.</p>
      <div className="field-inline">
        <span className="folder-path log-path">{info?.dataFolder}</span>
        <button className="tw-btn tw-btn-sm" onClick={() => void window.twilight.openDataFolder()}>
          Open folder
        </button>
      </div>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N', 'New chat'],
  ['Ctrl+Shift+N', 'New document'],
  ['Ctrl+B', 'Toggle sidebar'],
  ['Ctrl+,', 'Settings'],
  ['Enter / Shift+Enter', 'Send / new line'],
  ['Esc', 'Stop generating; close settings'],
  ['Ctrl+Shift+S', 'Clone into split / close split'],
  ['Alt+1 / Alt+2 / Alt+3', 'Send to A / B / Both'],
  ['Ctrl+J', 'Ask about the selection (Writing)'],
  ['Ctrl+B / Ctrl+I / Ctrl+E', 'Bold / italic / code (Writing)'],
  ['Alt+Enter / Alt+Backspace', 'Accept / reject a suggestion'],
  ['Alt+↑ / Alt+↓', 'Move a paragraph (Writing)'],
  ['Ctrl+F', 'Find in document']
]

function ShortcutsSection() {
  return (
    <div className="settings-card">
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={keys}>
              <td>
                {keys.split(' / ').map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' / '}
                    <kbd className="tw-kbd">{k}</kbd>
                  </span>
                ))}
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-note">Rebinding is on the roadmap.</p>
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
    </div>
  )
}

export function SettingsView() {
  const [section, setSection] = useState<Section>('providers')
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
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <h2 className="t-title">{current.label}</h2>
          <p className="section-description">{current.description}</p>
          {section === 'providers' && <ProvidersSection />}
          {section === 'general' && <GeneralSection />}
          {section === 'writing' && <WritingSection />}
          {section === 'data' && <DataSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </main>
  )
}
