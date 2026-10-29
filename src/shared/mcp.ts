// Tools from MCP servers, and pictures made on request. Both are switched on per chat in the
// Tools menu. A model's call to one of them is run by Twilight during the reply (after your
// approval, unless you've allowed it), and the round is stored inside that reply so the next
// request replays it byte-for-byte.

/** An MCP server you've added in Settings → Tools. Secrets (env values, headers) stay in the main process. */
export interface McpServer {
  id: string
  name: string
  /** A program Twilight starts (stdio), or a server at a URL (Streamable HTTP). */
  kind: 'stdio' | 'http'
  command: string
  args: string[]
  /** The folder the program starts in; empty for your home folder. */
  cwd: string
  url: string
  /** Off: no chat can use it. */
  enabled: boolean
  /** Ask before every call, or let calls through. */
  approval: 'ask' | 'allow'
  /** Tools let through without asking ("Always allow" on an approval). */
  allowedTools: string[]
  /** Names of the environment variables (stdio) and headers (http) set; their values are encrypted. */
  envKeys: string[]
  headerKeys: string[]
}

/** A server as saved from Settings: secret values only when they're new or changed (empty string removes one). */
export type McpServerInput = McpServer & { env?: Record<string, string>; headers?: Record<string, string> }

export interface McpToolSummary {
  name: string
  description: string
  readOnly: boolean
}

export interface McpServerStatus {
  id: string
  state: 'idle' | 'connecting' | 'ready' | 'error'
  error?: string
  /** The name and version the server gave when it connected. */
  info?: string
  tools: McpToolSummary[]
}

export type McpServerView = McpServer & { status: McpServerStatus }

/** Where pictures come from when a chat asks for one. */
export interface ImageConfig {
  providerId: string
  modelId: string
  size: string
}

/** An approval the reply is waiting on. */
export interface ToolApproval {
  id: string
  server: string
  tool: string
  /** The arguments, pretty-printed. */
  input: string
  readOnly: boolean
}

export interface ToolApprovalResponse {
  approve: boolean
  /** Let this tool through without asking from now on. */
  always?: boolean
}

/** One tool call a stored reply made, for showing under it. */
export interface ToolStep {
  /** The server's name, or "Pictures" for a generated image. */
  server: string
  tool: string
  input: string
  status: 'done' | 'error' | 'declined'
  output: string
}

export interface GeneratedImage {
  file: string
  prompt: string
}

export const IMAGE_TOOL = 'generate_image'
export const DECLINED = 'The user declined this tool call.'

/** Tool names the API accepts: letters, digits, _ and -, 64 at most. */
const clean = (s: string): string => s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')

/** A server's prefix for its tools: its name, made safe. */
export const serverSlug = (name: string): string => clean(name.toLowerCase()).slice(0, 24) || 'server'

/** The name a server's tool goes by in a request: "<server>__<tool>". */
export const toolName = (server: string, tool: string): string => `${serverSlug(server)}__${clean(tool)}`.slice(0, 64)

type Block = { type: string; [key: string]: unknown }

const short = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** A tool result's text, whichever way it was stored. */
const resultText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Block[]).map((b) => (b.type === 'text' ? String(b.text) : b.type === 'image' ? '[image]' : '')).join('\n')
      : ''

/** Splits "<server>__<tool>" back for showing; the image tool has no server. */
function nameParts(name: string): { server: string; tool: string } {
  if (name === IMAGE_TOOL) return { server: 'Pictures', tool: 'generate image' }
  const at = name.indexOf('__')
  return at > 0 ? { server: name.slice(0, at), tool: name.slice(at + 2) } : { server: '', tool: name }
}

/**
 * The tool calls Twilight ran inside a stored reply: Claude's tool_use blocks answered by a
 * tool_results block, or the OpenAI-compatible tool_round blocks.
 */
export function toolStepsOf(blocks: Block[]): ToolStep[] {
  const steps: ToolStep[] = []
  const calls = new Map<string, { name: string; input: unknown }>()
  const step = (name: string, input: unknown, output: string, isError: boolean): void => {
    const status = output === DECLINED ? 'declined' : isError ? 'error' : 'done'
    steps.push({ ...nameParts(name), input: short(input, 600), status, output: short(output, 2000) })
  }
  for (const b of blocks) {
    if (b.type === 'tool_use') calls.set(String(b.id), { name: String(b.name), input: b.input })
    else if (b.type === 'tool_results' && Array.isArray(b.results)) {
      for (const r of b.results as Block[]) {
        const call = calls.get(String(r.tool_use_id))
        if (call) step(call.name, call.input, resultText(r.content), r.is_error === true)
      }
    } else if (b.type === 'tool_round' && Array.isArray(b.calls)) {
      const results = (b.results ?? []) as { id: string; content: string; isError?: boolean }[]
      for (const c of b.calls as { id: string; name: string; arguments: string }[]) {
        const r = results.find((x) => x.id === c.id)
        let input: unknown = c.arguments
        try {
          input = JSON.parse(c.arguments || '{}')
        } catch {
          // Shown as it came.
        }
        if (r) step(c.name, input, r.content, r.isError === true)
      }
    }
  }
  return steps
}

export function imagesOf(blocks: Block[]): GeneratedImage[] {
  return blocks.filter((b) => b.type === 'generated_image').map((b) => ({ file: String(b.file), prompt: String(b.prompt ?? '') }))
}
