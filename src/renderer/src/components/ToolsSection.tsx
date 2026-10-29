import { useEffect, useState } from 'react'
import type { ImageConfig, McpServerInput, McpServerView } from '@shared/mcp'
import { useStore } from '../store'
import { PlusIcon, RefreshIcon, TrashIcon } from './Icons'

// Settings → Tools: the MCP servers chats can use, and where pictures come from. Each server is
// switched on per chat in the composer's Tools menu; here it's added, tested and told whether to
// ask before each call.

const api = window.twilight
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const BLANK: McpServerInput = { id: '', name: '', kind: 'stdio', command: '', args: [], cwd: '', url: '', enabled: true, approval: 'ask', allowedTools: [], envKeys: [], headerKeys: [] }

/** "KEY=value" lines, for environment variables and headers. A value left as ••• keeps the saved one. */
const KEEP = '•••'
const pairsText = (keys: string[]): string => keys.map((k) => `${k}=${KEEP}`).join('\n')
function parsePairs(text: string, had: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const at = line.search(/[=:]/)
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    seen.add(key)
    if (value !== KEEP) out[key] = value
  }
  // A line taken away removes that value.
  for (const k of had) if (!seen.has(k)) out[k] = ''
  return out
}

function ServerForm({ server, onDone }: { server: McpServerInput; onDone: () => void }) {
  const [draft, setDraft] = useState(server)
  const [args, setArgs] = useState(server.args.join('\n'))
  const [secrets, setSecrets] = useState(pairsText(server.kind === 'stdio' ? server.envKeys : server.headerKeys))
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<McpServerInput>): void => setDraft({ ...draft, ...patch })
  const save = async (): Promise<void> => {
    const pairs = parsePairs(secrets, draft.kind === 'stdio' ? draft.envKeys : draft.headerKeys)
    try {
      const saved = await api.saveMcpServer({ ...draft, args: args.split('\n'), ...(draft.kind === 'stdio' ? { env: pairs } : { headers: pairs }) })
      useStore.setState({ mcpServers: saved })
      const id = draft.id || saved.at(-1)?.id
      if (id) void api.testMcpServer(id).then((list) => useStore.setState({ mcpServers: list }))
      onDone()
    } catch (err) {
      setError(errText(err))
    }
  }
  return (
    <div className="settings-card mcp-form">
      <div className="field-row">
        <label className="field">
          <span className="field-label">Name</span>
          <input autoFocus value={draft.name} placeholder="For example: Files" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">How it runs</span>
          <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as 'stdio' | 'http' })}>
            <option value="stdio">A program on this PC (stdio)</option>
            <option value="http">A server at an address (HTTP)</option>
          </select>
        </label>
      </div>
      {draft.kind === 'stdio' ? (
        <>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Command</span>
              <input value={draft.command} placeholder="npx, uvx, python, node…" onChange={(e) => set({ command: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Starts in (optional)</span>
              <input value={draft.cwd} placeholder="Your home folder" onChange={(e) => set({ cwd: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Arguments, one per line</span>
            <textarea rows={3} value={args} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\Notes'} onChange={(e) => setArgs(e.target.value)} />
          </label>
        </>
      ) : (
        <label className="field">
          <span className="field-label">Address</span>
          <input value={draft.url} placeholder="https://example.com/mcp" onChange={(e) => set({ url: e.target.value })} />
        </label>
      )}
      <label className="field">
        <span className="field-label">{draft.kind === 'stdio' ? 'Environment variables' : 'Headers'}, one per line as NAME=value (optional)</span>
        <textarea rows={2} value={secrets} placeholder={draft.kind === 'stdio' ? 'API_TOKEN=…' : 'Authorization=Bearer …'} onChange={(e) => setSecrets(e.target.value)} />
        <span className="field-note">Kept encrypted on this PC, like API keys. A saved value shows as {KEEP}; leave it to keep it.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.approval === 'ask'} onChange={(e) => set({ approval: e.target.checked ? 'ask' : 'allow' })} />
        Ask before each tool call
      </label>
      <p className="field-note">
        {draft.approval === 'ask'
          ? 'You see each call and its arguments before it runs, and can allow a tool for good from there.'
          : 'Calls run without asking. Only for servers you trust: a tool can do whatever the server lets it.'}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="mcp-form-actions">
        <button className="tw-btn tw-btn-primary tw-btn-sm" onClick={() => void save()}>
          Save and connect
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const STATE = { idle: 'Not connected yet', connecting: 'Connecting…', ready: 'Connected', error: 'Problem' } as const

function ServerRow({ server, onEdit }: { server: McpServerView; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const s = server.status
  const update = (list: McpServerView[]): void => useStore.setState({ mcpServers: list })
  return (
    <div className="mcp-server" data-server={server.name}>
      <div className="mcp-server-head">
        <span className={`mcp-dot mcp-${s.state}`} aria-hidden="true" />
        <span className="mcp-name">{server.name}</span>
        <span className="tw-badge">{server.kind === 'stdio' ? 'program' : 'HTTP'}</span>
        <span className="mcp-state">
          {STATE[s.state]}
          {s.state === 'ready' && ` · ${s.tools.length} tool${s.tools.length === 1 ? '' : 's'}`}
        </span>
        <span className="tw-spacer" />
        <label className="check mcp-enabled" title="Off: no chat can use it">
          <input type="checkbox" checked={server.enabled} onChange={(e) => void api.saveMcpServer({ ...server, enabled: e.target.checked }).then(update)} />
          On
        </label>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" title="Connect again and list its tools" onClick={() => void api.testMcpServer(server.id).then(update)}>
          <RefreshIcon size={14} />
          Test
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={onEdit}>
          Edit
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Remove ${server.name}`} title="Remove this server" onClick={() => void api.deleteMcpServer(server.id).then(update)}>
          <TrashIcon size={14} />
        </button>
      </div>
      <div className="mcp-sub">
        {server.kind === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}
        {s.info && ` · ${s.info}`}
        {` · ${server.approval === 'ask' ? 'asks before each call' : 'runs calls without asking'}`}
        {server.allowedTools.length > 0 && ` · always allowed: ${server.allowedTools.join(', ')}`}
      </div>
      {s.state === 'error' && <p className="form-error mcp-error">{s.error}</p>}
      {s.tools.length > 0 && (
        <details className="mcp-tools" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Tools</summary>
          <ul>
            {s.tools.map((t) => (
              <li key={t.name}>
                <code>{t.name}</code>
                {t.readOnly && <span className="tw-badge">read-only</span>}
                {t.description && <span className="mcp-tool-desc">{t.description}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ImagePicker() {
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const [config, setConfig] = useState<ImageConfig | null>(null)
  useEffect(() => void api.getImageConfig().then(setConfig), [])
  // Claude doesn't make pictures; every model of the other providers is offered (servers don't
  // say which ones draw).
  const choices = models.filter((m) => providers.find((p) => p.id === m.providerId)?.kind !== 'anthropic')
  const value = config ? `${config.providerId}::${config.modelId}` : ''
  const save = (next: ImageConfig | null): void => void api.setImageConfig(next).then(setConfig)
  return (
    <div className="settings-card">
      <h3 className="t-heading">Pictures</h3>
      <p className="field-note">
        With Pictures on in a chat's Tools menu, the model can make an image when you ask for one. It comes from the model chosen here: OpenAI's image models and servers that copy their images endpoint, or an OpenRouter image model.
      </p>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Image model</span>
          <select
            value={value}
            onChange={(e) => {
              if (!e.target.value) return save(null)
              const [providerId, modelId] = e.target.value.split('::')
              save({ providerId, modelId, size: config?.size ?? '1024x1024' })
            }}
          >
            <option value="">None</option>
            {config && !choices.some((m) => `${m.providerId}::${m.id}` === value) && <option value={value}>{config.modelId}</option>}
            {choices.map((m) => (
              <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                {m.name} · {providers.find((p) => p.id === m.providerId)?.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Default shape</span>
          <select value={config?.size ?? '1024x1024'} disabled={!config} onChange={(e) => config && save({ ...config, size: e.target.value })}>
            <option value="1024x1024">Square</option>
            <option value="1536x1024">Landscape</option>
            <option value="1024x1536">Portrait</option>
          </select>
        </label>
      </div>
      <p className="field-note">Pictures are saved in Twilight's data folder and shown in the reply. Each one is billed by its provider.</p>
    </div>
  )
}

export function ToolsSection() {
  const list = useStore((s) => s.mcpServers)
  const [editing, setEditing] = useState<McpServerInput | null>(null)
  useEffect(() => {
    void api.listMcpServers().then((l) => useStore.setState({ mcpServers: l }))
  }, [])
  return (
    <>
      <div className="settings-card">
        <h3 className="t-heading">MCP servers</h3>
        <p className="field-note">
          Servers that give the model tools: files, search, your notes app, a database. Add one here, then switch it on for a chat in the composer's Tools menu. Only add servers you trust: a program runs on this PC with your permissions.
        </p>
        <div className="mcp-list">
          {list.map((s) => (editing?.id === s.id ? <ServerForm key={s.id} server={editing} onDone={() => setEditing(null)} /> : <ServerRow key={s.id} server={s} onEdit={() => setEditing(s)} />))}
          {list.length === 0 && !editing && <p className="sidebar-empty">No servers yet.</p>}
        </div>
        {editing && !editing.id ? (
          <ServerForm server={editing} onDone={() => setEditing(null)} />
        ) : (
          <button className="tw-btn tw-btn-sm mcp-add" onClick={() => setEditing(BLANK)}>
            <PlusIcon size={14} />
            Add server
          </button>
        )}
      </div>
      <ImagePicker />
    </>
  )
}
