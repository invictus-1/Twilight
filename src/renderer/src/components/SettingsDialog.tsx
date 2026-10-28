import { useEffect, useState } from 'react'
import type { ProviderConfig } from '@shared/types'
import { readGameFormat, writeGameFormat } from '../gameFormatSettings'
import { useStore } from '../store'
import { CloseIcon, TrashIcon } from './Icons'

const BUILT_IN = new Set(['anthropic', 'ollama', 'lmstudio'])

function ProviderRow({ provider }: { provider: ProviderConfig }) {
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(provider.baseUrl ?? '')
  const [saved, setSaved] = useState(false)
  const store = useStore.getState()

  const save = async (patch: Partial<ProviderConfig>, apiKey?: string): Promise<void> => {
    const providers = await window.twilight.saveProvider({ ...provider, ...patch }, apiKey)
    store.setProviders(providers)
    setKey('')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    void store.refreshModels(true)
  }

  return (
    <div className="provider">
      <div className="provider-head">
        <label className="check">
          <input type="checkbox" checked={provider.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
          <span className="t-label">{provider.name}</span>
        </label>
        <span className="provider-kind">{provider.kind === 'anthropic' ? 'Claude API' : 'OpenAI-compatible'}</span>
        {saved && <span className="provider-saved">Saved</span>}
        {!BUILT_IN.has(provider.id) && (
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label={`Remove ${provider.name}`}
            onClick={async () => store.setProviders(await window.twilight.deleteProvider(provider.id))}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      {provider.kind === 'openai' && (
        <label className="field">
          <span className="field-label">Server address</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== provider.baseUrl && void save({ baseUrl: url })} />
        </label>
      )}
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          void save({}, key)
        }}
      >
        <span className="field-label">API key {provider.kind === 'openai' && '(optional)'}</span>
        <div className="field-inline">
          <input
            type="password"
            value={key}
            autoComplete="off"
            placeholder={provider.hasKey ? 'Saved — type to replace' : 'Paste key'}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="tw-btn tw-btn-sm" type="submit" disabled={!key}>
            Save key
          </button>
          {provider.hasKey && (
            <button className="tw-btn tw-btn-sm tw-btn-ghost" type="button" onClick={() => void save({}, '')}>
              Remove
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

/** Request logs: every prompt and reply appended to daily files, as a safety net. */
function RequestLogs() {
  const [state, setState] = useState<{ enabled: boolean; folder: string } | null>(null)
  useEffect(() => {
    void window.twilight.getRequestLogs().then(setState)
  }, [])
  if (!state) return null
  return (
    <div className="provider">
      <label className="check">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={async (e) => {
            await window.twilight.setRequestLogs(e.target.checked)
            setState({ ...state, enabled: e.target.checked })
          }}
        />
        <span className="t-label">Keep request logs</span>
      </label>
      <p className="field-note">
        Every prompt and reply, from chats and writing tools, is added to a daily file (one JSON object per line). Nothing is ever removed from
        them, so a deleted chat or a lost edit can always be found again. API keys are never written.
      </p>
      <div className="field-inline">
        <span className="folder-path log-path">{state.folder}</span>
        <button className="tw-btn tw-btn-sm" onClick={() => void window.twilight.openLogsFolder()}>
          Open folder
        </button>
      </div>
    </div>
  )
}

/** How the "Game Format" button on replies reflows text for pasting into a game. */
function GameFormatOptions() {
  const [options, setOptions] = useState(readGameFormat)
  const set = (patch: Partial<typeof options>): void => {
    const next = { ...options, ...patch }
    writeGameFormat(next)
    setOptions(next)
  }
  return (
    <div className="provider">
      <p className="field-note">
        The Game Format button on a reply copies it with each chunk's paragraphs joined by single line breaks. Code blocks and HTML blocks
        (stat sheets, status cards) are copied exactly as they are.
      </p>
      <label className="check">
        <input type="checkbox" checked={options.removeDividers} onChange={(e) => set({ removeDividers: e.target.checked })} />
        Remove the --- dividers between chunks too
      </label>
      <label className="check">
        <input type="checkbox" checked={options.stripMarkdown} onChange={(e) => set({ stripMarkdown: e.target.checked })} />
        Remove markdown marks from prose (**bold**, *italic*, # headings)
      </label>
    </div>
  )
}

export function SettingsDialog() {
  const providers = useStore((s) => s.providers)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const add = async (): Promise<void> => {
    if (!name.trim() || !url.trim()) return
    const id = `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const list = await window.twilight.saveProvider({ id, kind: 'openai', name: name.trim(), baseUrl: url.trim(), enabled: true })
    useStore.getState().setProviders(list)
    setName('')
    setUrl('')
    void useStore.getState().refreshModels(true)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="panel-head">
          <h2 className="t-title">Settings</h2>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close (Esc)" onClick={() => setOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <h3 className="t-heading section">Providers</h3>
        <p className="field-note">Keys are encrypted with Windows' own credential protection and never leave this machine except to their provider.</p>
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
        <div className="provider">
          <span className="t-label">Add an OpenAI-compatible server</span>
          <div className="field-inline">
            <input placeholder="Name, e.g. llama.cpp" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="http://localhost:8080/v1" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="tw-btn tw-btn-sm" disabled={!name.trim() || !url.trim()} onClick={() => void add()}>
              Add
            </button>
          </div>
        </div>
        <h3 className="t-heading section">Safety net</h3>
        <RequestLogs />
        <h3 className="t-heading section">Game Format</h3>
        <GameFormatOptions />
      </div>
    </div>
  )
}
