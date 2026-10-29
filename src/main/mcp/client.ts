import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'

// A small Model Context Protocol client: JSON-RPC 2.0 to a program Twilight starts (one message
// per line on stdin/stdout) or to a server at a URL (Streamable HTTP: each message is a POST,
// answered with JSON or with a stream of server-sent events). Twilight only lists and calls
// tools, so that's all this speaks; anything the server asks of it is politely refused.

const PROTOCOL = '2025-06-18'
const CONNECT_MS = 30_000
const CALL_MS = 120_000

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; title?: string }
}

export interface McpContent {
  type: string
  text?: string
  data?: string
  mimeType?: string
  resource?: { uri?: string; text?: string; mimeType?: string }
}

export interface McpCallResult {
  content?: McpContent[]
  structuredContent?: unknown
  isError?: boolean
}

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }

export interface StdioOptions {
  kind: 'stdio'
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}
export interface HttpOptions {
  kind: 'http'
  url: string
  headers: Record<string, string>
}

export class McpError extends Error {}

/** Quotes an argument for cmd.exe when it needs it (spaces, quotes, &, | and the like). */
const quote = (a: string): string => (/^[\w./:=@\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)

export class McpClient {
  info = ''
  private next = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private child?: ChildProcess
  private stderr = ''
  private session?: string
  private closed = false

  private constructor(private readonly options: StdioOptions | HttpOptions) {}

  /** Starts or reaches the server and says hello; throws with what went wrong. */
  static async connect(options: StdioOptions | HttpOptions): Promise<McpClient> {
    const client = new McpClient(options)
    if (options.kind === 'stdio') client.start(options)
    try {
      const init = (await client.request(
        'initialize',
        { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Twilight', version: '1' } },
        CONNECT_MS
      )) as { serverInfo?: { name?: string; version?: string } }
      client.info = [init.serverInfo?.name, init.serverInfo?.version].filter(Boolean).join(' ')
      await client.notify('notifications/initialized')
      return client
    } catch (err) {
      client.close()
      throw err
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = []
    let cursor: string | undefined
    // A server can page its list; a few hundred tools is already more than a request should carry.
    for (let page = 0; page < 20; page++) {
      const res = (await this.request('tools/list', cursor ? { cursor } : {}, CONNECT_MS)) as { tools?: McpToolInfo[]; nextCursor?: string }
      tools.push(...(res.tools ?? []))
      cursor = res.nextCursor
      if (!cursor) break
    }
    return tools
  }

  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    return this.request('tools/call', { name, arguments: args }, CALL_MS, signal) as Promise<McpCallResult>
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.reject(new McpError('The connection closed.'))
    this.pending.clear()
    if (this.child && this.child.exitCode === null) {
      this.child.stdin?.end()
      // Programs started through cmd.exe leave their own children; end the whole tree.
      if (process.platform === 'win32' && this.child.pid) spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true })
      else this.child.kill()
    }
    if (this.options.kind === 'http' && this.session) {
      // Ending the session is a courtesy; the server cleans up on its own if it doesn't arrive.
      void fetch(this.options.url, { method: 'DELETE', headers: this.headers() }).catch(() => undefined)
    }
  }

  get alive(): boolean {
    return !this.closed
  }

  // ——— stdio ———

  private start(o: StdioOptions): void {
    // The program gets your environment (so it finds node, python and the like), minus
    // Twilight's own switches, plus what you set for it.
    const env: Record<string, string | undefined> = { ...process.env }
    for (const k of ['TWILIGHT_E2E', 'TWILIGHT_SELFTEST', 'TWILIGHT_SHOWCASE', 'ELECTRON_RUN_AS_NODE']) delete env[k]
    Object.assign(env, o.env)
    const windows = process.platform === 'win32'
    // On Windows commands like npx are .cmd files, which only start through the shell.
    const child = windows
      ? spawn([o.command, ...o.args].map(quote).join(' '), { shell: true, cwd: o.cwd || homedir(), env, windowsHide: true })
      : spawn(o.command, o.args, { cwd: o.cwd || homedir(), env })
    this.child = child
    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          this.receive(JSON.parse(line) as Message)
        } catch {
          // Not a protocol message (some programs print a banner); ignored.
        }
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      // Kept for when it fails: the last of what it said is usually the reason.
      this.stderr = (this.stderr + chunk).slice(-2000)
    })
    const fail = (why: string): void => {
      const said = this.stderr.trim().split('\n').slice(-4).join(' ').trim()
      for (const p of this.pending.values()) p.reject(new McpError(said ? `${why}: ${said}` : why))
      this.pending.clear()
      this.closed = true
    }
    child.on('error', (err) => fail(`Couldn't start ${o.command} (${err.message})`))
    child.on('exit', (code) => fail(`The server stopped${code !== null ? ` (exit code ${code})` : ''}`))
    child.stdin?.on('error', () => undefined)
  }

  private receive(msg: Message): void {
    if (msg.id !== undefined && msg.method) {
      // A request from the server (sampling, roots, elicitation): Twilight offers none of them.
      const reply = msg.method === 'ping' ? { jsonrpc: '2.0', id: msg.id, result: {} } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Twilight does not support this.' } }
      void this.post(reply as Message).catch(() => undefined)
      return
    }
    if (typeof msg.id !== 'number') return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new McpError(msg.error.message || `Error ${msg.error.code}`))
    else p.resolve(msg.result ?? {})
  }

  // ——— both ———

  private request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new McpError('The connection is closed.'))
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpError(`No answer to ${method} after ${Math.round(timeoutMs / 1000)} s.`))
      }, timeoutMs)
      const done = (fn: () => void): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = (): void => {
        this.pending.delete(id)
        void this.notify('notifications/cancelled', { requestId: id, reason: 'Stopped by the user' }).catch(() => undefined)
        done(() => reject(new McpError('Stopped.')))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve: (v) => done(() => resolve(v)), reject: (e) => done(() => reject(e)) })
      this.post({ jsonrpc: '2.0', id, method, params }).catch((err: Error) => {
        this.pending.delete(id)
        done(() => reject(err instanceof McpError ? err : new McpError(err.message)))
      })
    })
  }

  private notify(method: string, params?: unknown): Promise<void> {
    return this.post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })
  }

  private headers(): Record<string, string> {
    const o = this.options as HttpOptions
    return { ...o.headers, ...(this.session ? { 'mcp-session-id': this.session } : {}), 'mcp-protocol-version': PROTOCOL }
  }

  private async post(msg: Message): Promise<void> {
    if (this.options.kind === 'stdio') {
      if (!this.child?.stdin?.writable) throw new McpError('The server is not running.')
      this.child.stdin.write(`${JSON.stringify(msg)}\n`)
      return
    }
    let res: Response
    try {
      res = await fetch(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.headers() },
        body: JSON.stringify(msg)
      })
    } catch (err) {
      throw new McpError(`Couldn't reach ${this.options.url} (${(err as Error).message})`)
    }
    const session = res.headers.get('mcp-session-id')
    if (session) this.session = session
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      throw new McpError(`${res.status === 401 || res.status === 403 ? 'The server refused access' : 'The server answered'} ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    if (msg.id === undefined || msg.method === undefined) return
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('text/event-stream') && res.body) {
      // Events until the answer to this request; others (progress, logs) pass through receive.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let end: number
        while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const event = buffer.slice(0, end)
          buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '')
          const data = event
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n')
          if (!data) continue
          try {
            this.receive(JSON.parse(data) as Message)
          } catch {
            // A malformed event is skipped.
          }
        }
        if (!this.pending.has(msg.id as number)) {
          void reader.cancel().catch(() => undefined)
          return
        }
      }
      return
    }
    const text = await res.text()
    if (!text.trim()) return
    const parsed = JSON.parse(text) as Message | Message[]
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) this.receive(m)
  }
}
