import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { serverSlug, toolName, type McpServer, type McpServerInput, type McpServerStatus, type McpServerView } from '@shared/mcp'
import { kvGet, kvSet } from '../db'
import { deleteSecret, getSecret, setSecret } from '../secrets'
import { McpClient, type McpCallResult, type McpToolInfo } from './client'

// The MCP servers you've added, and live connections to them. A server is started (or reached)
// the first time a chat needs it and kept until it's changed, switched off or the app quits.
// Environment values and headers often hold tokens, so they're encrypted like API keys and
// never sent to the window.

const KEY = 'mcp.servers'

interface Live {
  client: McpClient
  tools: McpToolInfo[]
}

const live = new Map<string, Live>()
const connecting = new Map<string, Promise<Live>>()
const status = new Map<string, McpServerStatus>()

export function servers(): McpServer[] {
  return kvGet<McpServer[]>(KEY) ?? []
}

const secretName = (id: string, kind: 'env' | 'header', key: string): string => `mcp:${id}:${kind}:${key}`

function statusOf(id: string): McpServerStatus {
  return status.get(id) ?? { id, state: 'idle', tools: [] }
}

function setStatus(s: McpServerStatus): void {
  status.set(s.id, s)
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('twilight:mcp', listServers())
}

export function listServers(): McpServerView[] {
  return servers().map((s) => ({ ...s, status: statusOf(s.id) }))
}

function disconnect(id: string): void {
  live.get(id)?.client.close()
  live.delete(id)
  connecting.delete(id)
}

/** Saves a server (new when its id is empty); a changed server reconnects when next used. */
export function saveServer(input: McpServerInput): McpServerView[] {
  const list = servers()
  const id = input.id || randomUUID()
  const name = input.name.trim() || 'Server'
  // Tool names start with the server's name, so two servers can't share one.
  if (list.some((s) => s.id !== id && serverSlug(s.name) === serverSlug(name))) throw new Error(`There's already a server called ${name}. Give this one another name.`)
  if (input.kind === 'stdio' && !input.command.trim()) throw new Error('Give the command that starts the server, like npx or python.')
  if (input.kind === 'http' && !/^https?:\/\//.test(input.url.trim())) throw new Error('Give the server\'s address, starting with https:// (or http:// for one on this PC).')
  const old = list.find((s) => s.id === id)
  const keys = (kind: 'env' | 'header', given: Record<string, string> | undefined, had: string[]): string[] => {
    const names = new Set(had)
    for (const [k, v] of Object.entries(given ?? {})) {
      const key = k.trim()
      if (!key) continue
      if (v === '') {
        deleteSecret(secretName(id, kind, key))
        names.delete(key)
      } else {
        setSecret(secretName(id, kind, key), v)
        names.add(key)
      }
    }
    return [...names]
  }
  const server: McpServer = {
    id,
    name,
    kind: input.kind,
    command: input.command.trim(),
    args: input.args.map((a) => a.trim()).filter(Boolean),
    cwd: input.cwd.trim(),
    url: input.url.trim(),
    enabled: input.enabled,
    approval: input.approval,
    allowedTools: input.allowedTools,
    envKeys: keys('env', input.env, old?.envKeys ?? []),
    headerKeys: keys('header', input.headers, old?.headerKeys ?? [])
  }
  kvSet(KEY, old ? list.map((s) => (s.id === id ? server : s)) : [...list, server])
  // How it starts may have changed (allowing a tool doesn't change anything about the connection).
  const how = (s: McpServer): string => JSON.stringify([s.kind, s.command, s.args, s.cwd, s.url, s.enabled, s.envKeys, s.headerKeys, s.name])
  if (!old || how(old) !== how(server) || input.env || input.headers) {
    disconnect(id)
    status.delete(id)
  }
  return listServers()
}

export function deleteServer(id: string): McpServerView[] {
  const s = servers().find((x) => x.id === id)
  disconnect(id)
  status.delete(id)
  for (const k of s?.envKeys ?? []) deleteSecret(secretName(id, 'env', k))
  for (const k of s?.headerKeys ?? []) deleteSecret(secretName(id, 'header', k))
  kvSet(
    KEY,
    servers().filter((x) => x.id !== id)
  )
  return listServers()
}

/** Lets one tool through without asking, from now on. */
export function allowTool(id: string, tool: string): void {
  kvSet(
    KEY,
    servers().map((s) => (s.id === id && !s.allowedTools.includes(tool) ? { ...s, allowedTools: [...s.allowedTools, tool] } : s))
  )
}

async function connect(server: McpServer): Promise<Live> {
  const have = live.get(server.id)
  if (have?.client.alive) return have
  const pending = connecting.get(server.id)
  if (pending) return pending
  const attempt = (async (): Promise<Live> => {
    setStatus({ id: server.id, state: 'connecting', tools: statusOf(server.id).tools })
    try {
      const secrets = (kind: 'env' | 'header', keys: string[]): Record<string, string> =>
        Object.fromEntries(keys.map((k) => [k, getSecret(secretName(server.id, kind, k)) ?? '']))
      const client = await McpClient.connect(
        server.kind === 'stdio'
          ? { kind: 'stdio', command: server.command, args: server.args, cwd: server.cwd, env: secrets('env', server.envKeys) }
          : { kind: 'http', url: server.url, headers: secrets('header', server.headerKeys) }
      )
      const tools = await client.listTools()
      const entry = { client, tools }
      live.set(server.id, entry)
      setStatus({
        id: server.id,
        state: 'ready',
        info: client.info || undefined,
        tools: tools.map((t) => ({ name: t.name, description: t.description ?? '', readOnly: t.annotations?.readOnlyHint === true }))
      })
      return entry
    } catch (err) {
      setStatus({ id: server.id, state: 'error', error: (err as Error).message, tools: [] })
      throw new Error(`The MCP server ${server.name} couldn't connect: ${(err as Error).message}`)
    } finally {
      connecting.delete(server.id)
    }
  })()
  connecting.set(server.id, attempt)
  return attempt
}

/** Connects (or reconnects) and lists the tools; the outcome shows in Settings. */
export async function testServer(id: string): Promise<McpServerView[]> {
  const server = servers().find((s) => s.id === id)
  if (!server) throw new Error('That server no longer exists.')
  disconnect(id)
  await connect(server).catch(() => undefined)
  return listServers()
}

export interface ChatTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  server: McpServer
  tool: string
  readOnly: boolean
}

/**
 * The tools a chat offers, from the servers switched on for it, in the order the servers were
 * added and each server's own order, so the list is the same on every turn and the cached prefix
 * holds. A server that can't connect fails the reply with the reason, rather than quietly
 * answering without its tools.
 */
export async function chatTools(serverIds: string[]): Promise<ChatTool[]> {
  const out: ChatTool[] = []
  for (const server of servers()) {
    if (!server.enabled || !serverIds.includes(server.id)) continue
    const { tools } = await connect(server)
    for (const t of tools) {
      out.push({
        name: toolName(server.name, t.name),
        // The server's name leads, so the model knows where a tool comes from.
        description: `[${server.name}] ${t.description ?? ''}`.trim().slice(0, 1024),
        input_schema: t.inputSchema && typeof t.inputSchema === 'object' ? { type: 'object', ...t.inputSchema } : { type: 'object', properties: {} },
        server,
        tool: t.name,
        readOnly: t.annotations?.readOnlyHint === true
      })
    }
  }
  return out
}

export async function callTool(server: McpServer, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpCallResult> {
  const { client } = await connect(server)
  return client.callTool(tool, args, signal)
}

export function closeAll(): void {
  for (const id of [...live.keys()]) disconnect(id)
}
