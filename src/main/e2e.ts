import { app, clipboard, type BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { logsFolder } from './logs'
import { join } from 'node:path'
import * as chat from './chat'
import * as code from './code/agent'
import * as mcp from './mcp'
import { contextMenuItems, setSpellcheck, showContextMenus } from './contextMenu'
import { codeWebTools } from './code/llm'
import Database from 'better-sqlite3'
import { applyPendingRestore, backupDue, backupSettings, createBackup, listBackups, pruneBackups, setBackupSettings, stageRestore, takeRestoredWindowSettings } from './backups'
import { checkTarget, resolveDataFolder, stageMove } from './location'
import { setImageConfig } from './images'
import { DECLINED } from '@shared/mcp'
import { commandRisk, lineDiff } from '@shared/code'
import * as db from './db'
import * as docs from './docs'
import { extractChoices } from '@shared/choices'
import { gameFormat } from '@shared/gameFormat'
import { compareTexts, plainProse, wordDiff } from '@shared/diff'
import { computeVerdict } from '@shared/judge'
import * as judge from './judge'
import * as library from './library'
import { parseLibrary } from '@shared/library'
import { anthropicOptions, anthropicRequest, anthropicTools, keyShape, replyText, toMessages } from './providers/anthropic'
import { openRouterPlugins } from './providers/openai'
import { clockBlock } from '@shared/attachments'
import { webActivityOf, webSupport } from '@shared/webTools'
import { randomUUID } from 'node:crypto'
import * as workspaces from './workspaces'
import { searchAll } from './search'
import { backgroundVersion, setBackgroundFile } from './background'
import { THEMES } from '@shared/themes'
import { BUILT_IN_PRICES, costOf, setCustomPrices } from '@shared/pricing'
import * as providers from './providers'
import * as updates from './updates'
import * as insights from './insights'
import * as insightsAi from './insightsAi'
import * as reports from './reports'
import { ACHIEVEMENTS, analyzeText } from '@shared/insights'
import type { Usage, UsageRange, UsageTotals } from '@shared/types'
import { usageStats } from './usage'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

// Dev-only end-to-end check, run with TWILIGHT_E2E=<output folder> (and a throwaway profile, see
// selftest.ts). Starts a fake OpenAI-compatible model server in-process, then drives a chat,
// split compare, both-pane sends, a regenerate in B and "Keep B" through the real chat engine,
// and writes the checks and a screenshot to the output folder.

interface LoggedRequest {
  model: string
  messages: { role: string; content: string }[]
  body: Record<string, unknown>
  startedAt: number
  firstTokenAt?: number
}

// A stand-in for GitHub's releases API: one release newer than this build, this build, one older,
// and a newer one whose checksum is wrong.
const bump = (v: string, by: number): string => {
  const [a, b] = v.split('.').map(Number)
  return `${a}.${b + by}.0`
}
const installerBytes = (version: string): Buffer => Buffer.from(`MZ fake installer for ${version}`.repeat(4000))

function mockGithub(url: string, base: string, res: import('node:http').ServerResponse): void {
  const current = app.getVersion()
  const [newer, older, broken] = [bump(current, 1), current === '0.0.0' ? '0.0.0' : bump(current, -1), bump(current, 2)]
  if (url.startsWith('/gh/releases?')) {
    const release = (v: string, notes: string) => ({
      tag_name: `v${v}`,
      name: `Twilight ${v}`,
      body: notes,
      draft: false,
      prerelease: false,
      published_at: new Date(Date.UTC(2026, 9, 1 + Number(v.split('.')[1]))).toISOString(),
      html_url: `${base}/tag/v${v}`,
      assets: [
        { name: `Twilight-Setup-${v}.exe`, size: installerBytes(v).length, browser_download_url: `${base}/download/${v}/Twilight-Setup-${v}.exe` },
        { name: 'latest.yml', size: 100, browser_download_url: `${base}/download/${v}/latest.yml` }
      ]
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify([release(broken, '- Broken checksum'), release(newer, '**New:** something shiny'), release(current, 'This one'), release(older, 'Older'), { ...release('9.9.9-beta', 'beta'), tag_name: 'v9.9.9-beta', prerelease: true }]))
    return
  }
  const m = /^\/gh\/download\/([\d.]+)\/(.+)$/.exec(url)
  if (!m) {
    res.statusCode = 404
    res.end()
    return
  }
  const [, v, file] = m
  if (file === 'latest.yml') {
    const sha = createHash('sha512').update(v === broken ? Buffer.from('other') : installerBytes(v)).digest('base64')
    res.end(`version: ${v}
files:
  - url: Twilight-Setup-${v}.exe
    sha512: ${sha}
path: Twilight-Setup-${v}.exe
sha512: ${sha}
`)
    return
  }
  const bytes = installerBytes(v)
  res.setHeader('content-length', String(bytes.length))
  res.end(bytes)
}

/** A 1×1 picture, for the images endpoint. */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/**
 * An MCP server you start as a program: lamp tools over stdin and stdout. count_lamps says
 * whether the token set for it arrived; light_lamp lights the lamp it's given.
 */
const MCP_STDIO_SERVER = `
let buf = ''
process.stdin.setEncoding('utf8')
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
process.stdout.write('lamp-tools starting\\n')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const m = JSON.parse(line)
    if (m.id === undefined) continue
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'lamp-tools', version: '1.0' } } })
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'count_lamps', description: 'Counts the lamps on a street', inputSchema: { type: 'object', properties: { street: { type: 'string' } }, required: ['street'] }, annotations: { readOnlyHint: true } },
      { name: 'light_lamp', description: 'Lights one lamp', inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] } }
    ] } })
    else if (m.method === 'tools/call') {
      const a = m.params.arguments || {}
      const text = m.params.name === 'count_lamps' ? a.street + ' has 9 lamps (token:' + (process.env.MOCK_TOKEN === 'tok-123' ? 'set' : 'missing') + ')' : 'Lamp ' + a.n + ' is lit.'
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } })
    } else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown' } })
  }
})
`

/** An MCP server at an address (Streamable HTTP), answering in JSON; it wants an x-token header. */
function mockMcpHttp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.method === 'DELETE') return void res.end()
    if (req.headers['x-token'] !== 'shelf') {
      res.statusCode = 401
      return void res.end('missing token')
    }
    const m = JSON.parse(body || '{}') as { id?: number; method?: string; params?: { protocolVersion?: string; arguments?: { title?: string } } }
    if (m.id === undefined) {
      res.statusCode = 202
      return void res.end()
    }
    res.setHeader('content-type', 'application/json')
    res.setHeader('mcp-session-id', 'session-1')
    const result =
      m.method === 'initialize'
        ? { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'library', version: '2.1' } }
        : m.method === 'tools/list'
          ? { tools: [{ name: 'find_book', description: 'Finds a book', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }] }
          : { content: [{ type: 'text', text: `Found ${m.params?.arguments?.title ?? 'nothing'} on shelf 4.` }] }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }))
  })
}

/**
 * The Code tab's scripted agent. The request names a script; each tool result moves it one call
 * on, and after the last call it replies with every result it got, so a check can see them.
 */
function codeAgentReply(messages: { role: string; content: string | null }[], res: import('node:http').ServerResponse): void {
  const at = messages.findLastIndex((m) => m.role === 'user')
  const request = messages[at]?.content ?? ''
  const results = messages.slice(at + 1).filter((m) => m.role === 'tool').map((m) => String(m.content))
  const outside = /CODEESCAPE (\S+)/.exec(request)?.[1] ?? ''
  const scripts: Record<string, { name: string; args: Record<string, unknown> }[]> = {
    CODEFLOW: [
      { name: 'read_file', args: { path: 'notes.txt' } },
      { name: 'edit_file', args: { path: 'notes.txt', old_text: 'lamps: 9', new_text: 'lamps: 12' } },
      { name: 'run_command', args: { command: 'Get-Content notes.txt' } },
      { name: 'ask_user', args: { question: 'Which colour should the lamps be?', options: ['Amber', 'Blue'] } }
    ],
    CODECREATE: [
      { name: 'write_file', args: { path: 'src/new.txt', content: 'fresh\n' } },
      { name: 'edit_file', args: { path: 'notes.txt', old_text: 'keeper: Wren', new_text: 'keeper: Rowan' } }
    ],
    CODEESCAPE: [
      { name: 'read_file', args: { path: '../outside.txt' } },
      { name: 'read_file', args: { path: outside } },
      { name: 'write_file', args: { path: '../outside.txt', content: 'gone' } },
      { name: 'write_file', args: { path: '.git/config', content: 'x' } },
      { name: 'edit_file', args: { path: 'notes.txt', old_text: 'not in the file', new_text: 'y' } }
    ],
    CODEDELETE: [{ name: 'delete_file', args: { path: 'old.txt' } }],
    CODERISKY: [{ name: 'run_command', args: { command: 'Remove-Item -Recurse -Force build' } }],
    CODEALLOW: [
      { name: 'run_command', args: { command: 'Write-Output hi' } },
      { name: 'run_command', args: { command: 'Write-Output hi' } }
    ],
    CODEREAD: [
      { name: 'write_file', args: { path: 'x.txt', content: 'x' } },
      { name: 'run_command', args: { command: 'Write-Output hi' } }
    ],
    CODEASK: [{ name: 'ask_user', args: { question: 'Shall I go on?' } }],
    CODEPLAN: [{ name: 'write_file', args: { path: 'plan.txt', content: 'x' } }],
    CODETASKS: [
      {
        name: 'update_tasks',
        args: {
          tasks: [
            { title: 'Read the notes', status: 'done' },
            { title: 'Change the lamps', status: 'doing' }
          ]
        }
      }
    ]
  }
  const script = Object.entries(scripts).find(([k]) => request.includes(k))?.[1] ?? []
  const call = script[results.length]
  const send = (o: unknown): void => void res.write(`data: ${JSON.stringify(o)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  if (call) {
    if (results.length === 0) send({ choices: [{ delta: { content: 'Looking first.' } }] })
    const args = JSON.stringify(call.args)
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `code_${results.length}`, type: 'function', function: { name: call.name, arguments: '' } }] } }] })
    for (const part of [args.slice(0, 12), args.slice(12)]) send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] } }] })
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  } else {
    send({ choices: [{ delta: { content: `Done. ${results.join(' | ')}` } }] })
    send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  }
  const prompt = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  send({ choices: [], usage: { prompt_tokens: Math.ceil(prompt / 4), completion_tokens: 20, prompt_tokens_details: { cached_tokens: Math.floor(prompt / 8) } } })
  res.end('data: [DONE]\n\n')
}

function startMockServer(log: LoggedRequest[]): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/gh/')) return mockGithub(req.url, `http://${req.headers.host}/gh`, res)
    if (req.url?.endsWith('/images/generations')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG }] }))
      return
    }
    if (req.url === '/mcp') return mockMcpHttp(req, res)
    if (req.url?.endsWith('/models')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'mock-a', context_length: 8000 }, { id: 'mock-b', architecture: { output_modalities: ['image', 'text'] } }] }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      const parsed = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] }
      const entry: LoggedRequest = { model: parsed.model, messages: parsed.messages, body: parsed, startedAt: Date.now() }
      log.push(entry)
      if (parsed.messages[0]?.content?.startsWith('You are a careful coding agent')) return codeAgentReply(parsed.messages, res)
      const lastUser =[...parsed.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const toolResult = parsed.messages.at(-1)?.role === 'tool' ? parsed.messages.at(-1)?.content : null
      if (!toolResult && lastUser.includes('TOOLCHOICE') && (parsed as { tools?: unknown[] }).tools?.length) {
        const args = JSON.stringify({
          groups: [
            { title: 'Outfit', context: 'Cold wind on the bridge.', options: [{ label: 'Coat', details: 'Wool coat, boots' }, { label: 'Cloak' }] },
            { title: 'What do you do?', options: [{ label: 'Cross' }, { label: 'Turn back' }, { label: 'Something else' }] }
          ]
        })
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The bridge sways in the wind.' } }] })}\n\n`)
        entry.firstTokenAt ??= Date.now()
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_e2e', type: 'function', function: { name: 'present_choices', arguments: '' } }] } }] })}\n\n`)
        for (const part of [args.slice(0, 40), args.slice(40)]) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] } }] })}\n\n`)
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }
      // An image model answers with a picture beside its text.
      if (lastUser.includes('IMAGEOUT')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Here is your lamp.', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } }] } }] })}\n\n`)
        entry.firstTokenAt ??= Date.now()
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 1290 } })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }
      // "MCPCALL name {args} ;; name {args}": one tool call per round, in order, then an answer.
      const mcpScript = /MCPCALL (.*)$/s.exec(lastUser)?.[1]
      if (mcpScript && (parsed as { tools?: unknown[] }).tools?.length) {
        const rounds = mcpScript.split(';;').map((r) => r.trim())
        const lastUserAt = parsed.messages.map((m) => m.role).lastIndexOf('user')
        const done = parsed.messages.slice(lastUserAt + 1).filter((m) => m.role === 'assistant').length
        const step = rounds[done]
        if (step) {
          const name = step.split(' ')[0]
          const args = step.slice(name.length).trim() || '{}'
          const send = (o: unknown): void => void res.write(`data: ${JSON.stringify(o)}\n\n`)
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          send({ choices: [{ delta: { content: done ? '' : 'Let me check.' } }] })
          entry.firstTokenAt ??= Date.now()
          send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `mcp_${done}`, type: 'function', function: { name, arguments: '' } }] } }] })
          send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })
          send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
          send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } })
          res.end('data: [DONE]\n\n')
          return
        }
      }
      const system = parsed.messages[0]?.content ?? ''
      let reply: string
      if (system.startsWith('You are a line editor')) {
        // Writing tools get a plausible edit of the passage.
        reply = `No one ever saw who lit them (${parsed.model}).`
      } else if (system.startsWith('You are an exacting fiction editor')) {
        // The judge: the passage containing GOOD scores 8, the other 5; "explicit" doesn't apply.
        const ids = [...system.matchAll(/^- ([\w-]+) · /gm)].map((m) => m[1])
        const x = /<passage id="X">\n([\s\S]*?)\n<\/passage>/.exec(lastUser)?.[1] ?? ''
        const xGood = x.includes('GOOD')
        const criteria = ids.map((id) => (id === 'explicit' ? { id, X: null, Y: null } : { id, X: xGood ? 8 : 5, Y: xGood ? 5 : 8 }))
        reply =
          `### Prose — X ${xGood ? 8 : 5} · Y ${xGood ? 5 : 8}\nX quotes "${x.slice(0, 20)}".\n\n### Verdict\n${xGood ? 'X' : 'Y'} is better.\n\n` +
          '```json\n' + JSON.stringify({ criteria, overall: { X: xGood ? 8 : 5, Y: xGood ? 5 : 8 }, winner: xGood ? 'X' : 'Y', confidence: 'high' }) + '\n```'
      } else if (system.startsWith('You classify one passage')) {
        reply = '```json\n' + JSON.stringify({ breakdown: { Drama: 60, Romance: 25, Worldbuilding: 15 }, genres: ['Drama', 'Romance'], tags: [{ name: 'Weather', sub: ['Rain', 'Wind'] }], themes: ['Belonging', 'Counting'], summary: 'Things happen in this part.' }) + '\n```'
      } else if (system.startsWith('You analyse a long work')) {
        reply = JSON.stringify({ breakdown: { Fantasy: 50, Drama: 50 }, genres: { Fantasy: 90, Drama: 60 }, tags: [{ name: 'Sea', sub: ['Tides'] }], themes: [{ name: 'Home', description: 'Two sentences.' }], tone: 'Quiet.', summary: 'A short summary.' })
      } else if (system.startsWith('You write the closing analysis')) {
        reply = JSON.stringify({ themes: [{ name: 'Belonging', description: 'Who gets to stay.' }, { name: 'Counting', description: 'Order against fear.' }], tone: 'Hushed and precise.', summary: 'A lighthouse keeper counts the world.' })
      } else if (system.startsWith('You are a candid, encouraging writing coach')) {
        reply = JSON.stringify({ strength: 'Clear scenes.', areas: [{ title: 'Vary openings', why: 'Many sentences start the same way.', evidence: ['Wren and Rowan climbed the stair'], exercise: 'Rewrite five openings.' }, { title: 'Trim adverbs', why: 'They pile up.', evidence: ['asked quietly'], exercise: 'Cut half.' }] })
      } else if (system.startsWith("You read a writer's own statistics")) {
        reply = JSON.stringify({ observations: [{ title: 'Steady mornings', text: 'Most words land before noon.' }, { title: 'Dialogue-heavy', text: 'A fifth of the words are spoken.' }], nextStep: 'Write one scene without dialogue.' })
      } else if (toolResult) {
        reply = `Answering the tool result: ${toolResult}`
      } else if (lastUser.includes('MULTICHOICE')) {
        reply = 'The gate creaked.\n\nOUTFIT · Day 2 Morning\nPlace: a cold pier, then a warm cabin.\n1 · PLAIN: \n\n* Pieces: wool coat\n\n2 · BOLD\n\n* Pieces: red scarf\n\n3 · SOMETHING ELSE\n\nChoices (Morning)\n\n1. Head out\n2. Stay in\n3. Something else.'
      } else if (lastUser.includes('PLAINCHOICES')) {
        // Choices the way a system prompt of your own might ask for them: a plain numbered list.
        reply = 'The corridor splits three ways.\n\n**What do you do?**\n\n1. Take the left stair\n2. Follow the draft\n3. Wait for the guard'
      } else if (system.includes('Interactive choices:')) {
        reply = `The door creaks open on "${lastUser}".\n\n\`\`\`choices\nWhat do you do?\n1. Light the lamp\n2. Wait in the rain\n3. Call out\n4. Run for the bridge\n\`\`\``
      } else if (lastUser.includes('CODEBLOCK')) {
        reply = 'Here it is:\n\n```ts\nconst lamps = 9 // lit at dusk\nfunction light(n: number) { return "lit " + n }\n```'
      } else if (lastUser.includes('STATUSCARD')) {
        reply =
          'The rain held.\n\n<details>\n<summary>status card</summary>\n\n```\n═══ STATUS CARD ═══\nDATE     Thursday\n```\n\n</details>\n\n' +
          '<img src="x" onerror="window.__pwned = 1"> <script>window.__pwned = 2</script> <b>bold html</b>'
      } else {
        reply = `**${parsed.model}** replying to "${lastUser}". Here is a short answer with a list:\n\n- one\n- two\n\nDone.`
      }
      const words = reply.split(/(?<= )/)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const w of words) {
        await new Promise((r) => setTimeout(r, 8))
        entry.firstTokenAt ??= Date.now()
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`)
      }
      // A server that searched cites its sources as url_citation annotations.
      if (lastUser.includes('WEBCITE') && !toolResult) {
        const annotations = [{ type: 'url_citation', url_citation: { url: 'https://example.com/lamps', title: 'Lamps at dusk', start_index: 0, end_index: 5 } }]
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { annotations } }] })}\n\n`)
      }
      const prompt = parsed.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: Math.ceil(prompt / 4), completion_tokens: words.length } })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  // Node closes idle connections after 5 s; a request reusing one at that moment is reset
  // ("fetch failed"). Real servers keep them far longer, so the mock does too.
  server.keepAliveTimeout = 120_000
  server.headersTimeout = 125_000
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function idle(id: string): Promise<void> {
  const start = Date.now()
  while (chat.isRunning(id)) {
    if (Date.now() - start > 15000) {
      const last = chat.view(id).path.at(-1)
      throw new Error(`Timed out waiting for replies (last: ${JSON.stringify({ role: last?.role, status: last?.status, model: last?.modelId, error: last?.error, chars: last?.text.length })})`)
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

export function runE2E(win: BrowserWindow, outDir: string): void {
  const checks: { name: string; pass: boolean; detail?: unknown }[] = []
  // Each check is also appended to progress.log as it happens, so a run that hangs shows where.
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (event: unknown) => {
    const e = event as { level?: string | number; message?: string }
    if (e.level === 'error' || e.level === 'warning' || (typeof e.level === 'number' && e.level >= 2)) consoleErrors.push(String(e.message).slice(0, 400))
  })
  const check = (name: string, pass: boolean, detail?: unknown): void => {
    checks.push({ name, pass, detail })
    appendFileSync(join(outDir, 'progress.log'), `${pass ? 'ok  ' : 'FAIL'} ${name}
`)
  }
  const log: LoggedRequest[] = []
  // Screenshots are a record, not a check: Windows' compositor now and then refuses a capture
  // (UnknownVizError), and that mustn't end the run.
  // Reloads the interface and waits until its first load is done (App marks body[data-ready]),
  // then a moment for it to paint. Bounded, and the time it took is logged for comparison.
  const reloadUi = async (): Promise<void> => {
    const t0 = Date.now()
    win.webContents.reload()
    await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
    await win.webContents.executeJavaScript(`(async () => { for (let end = Date.now() + 10000; Date.now() < end && document.body.dataset.ready !== '1'; ) await new Promise((r) => setTimeout(r, 25)) })()`)
    appendFileSync(join(outDir, 'timings.log'), `reload ready in ${Date.now() - t0} ms\n`)
    await new Promise((r) => setTimeout(r, 400))
  }
  // Logs any stretch where the main process stops answering, to find what blocks it.
  let tick = Date.now()
  setInterval(() => {
    const late = Date.now() - tick - 100
    if (late > 400) appendFileSync(join(outDir, 'timings.log'), `main blocked ~${late} ms (after check ${checks.length}: ${checks.at(-1)?.name ?? ''})\n`)
    tick = Date.now()
  }, 100).unref()
  const shot = async (name: string): Promise<void> => {
    // The refusal can come as a throw as well as a rejected promise.
    try {
      writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG())
    } catch {
      appendFileSync(join(outDir, 'timings.log'), `screenshot ${name} refused\n`)
    }
  }
  // Keep timers and frames running when the test window is behind others.
  win.webContents.setBackgroundThrottling(false)

  win.webContents.once('did-finish-load', async () => {
    let server: Server | undefined
    try {
      server = await startMockServer(log)
      const port = (server.address() as AddressInfo).port
      providers.saveProvider({ id: 'mock', kind: 'openai', name: 'Mock', baseUrl: `http://127.0.0.1:${port}/v1`, enabled: true })
      chat.setDefaults({ providerId: 'mock', modelId: 'mock-a', systemPrompt: 'You are a test.' })
      const models = await providers.listModels(true)
      check('mock models listed', models.filter((m) => m.providerId === 'mock').length === 2)

      const contents = win.webContents
      const id = chat.create().id

      // 1. A plain chat turn streams and is stored.
      chat.send(contents, id, 'Hello')
      await idle(id)
      let v = chat.view(id)
      check('first reply done', v.path.length === 2 && v.path[1].status === 'done', v.path.map((n) => n.status))
      check('reply text stored', v.path[1].text.includes('replying to "Hello"'))
      check('system prompt sent', log[0]?.messages[0]?.content === 'You are a test.')

      // 2. Clone into split: B is an exact copy of A.
      v = chat.cloneIntoSplit(id)
      check('split opened as a copy', !!v.split && v.split.path.map((n) => n.id).join() === v.path.map((n) => n.id).join())

      // 3. B gets a different model; send to both.
      chat.updateSettings(id, { modelId: 'mock-b' }, 'b')
      const before = log.length
      chat.send(contents, id, 'Compare this', 'both')
      await idle(id)
      v = chat.view(id)
      const both = log.slice(before)
      check('both panes answered', v.path.length === 4 && v.split?.path.length === 4, [v.path.length, v.split?.path.length])
      check('A used mock-a, B used mock-b', both.map((r) => r.model).sort().join() === 'mock-a,mock-b', both.map((r) => r.model))
      check(
        'B saw the same history as A',
        JSON.stringify(both[0]?.messages) === JSON.stringify(both[1]?.messages),
        both.map((r) => r.messages.length)
      )
      check('the two user turns are versions of each other', v.path[2].siblingCount === 2 && v.split!.path[2].siblingCount === 2)
      // Generous: on a loaded machine two parallel starts can sit tens of milliseconds apart.
      check('different models ran in parallel', Math.abs((both[0]?.startedAt ?? 0) - (both[1]?.startedAt ?? 0)) < 200)

      // 4. Same model in both panes: B waits for A's first token so it can read A's cache.
      chat.updateSettings(id, { modelId: 'mock-a' }, 'b')
      const before2 = log.length
      chat.send(contents, id, 'Same model now', 'both')
      await idle(id)
      const same = log.slice(before2)
      check(
        'same model: B starts after A streams',
        same.length === 2 && same[1].startedAt >= (same[0].firstTokenAt ?? Infinity),
        same.map((r) => ({ started: r.startedAt, first: r.firstTokenAt }))
      )

      // 5. Regenerate in B adds a version there without touching A.
      v = chat.view(id)
      const aBefore = v.path.map((n) => n.id).join()
      chat.regenerate(contents, id, v.split!.path.at(-1)!.id, 'b')
      await idle(id)
      v = chat.view(id)
      check('regenerate in B adds a version', v.split!.path.at(-1)!.siblingCount === 2)
      check('A untouched by B regenerate', v.path.map((n) => n.id).join() === aBefore)

      // 6. Switching versions in B moves only B.
      v = chat.switchBranch(id, v.split!.path.at(-1)!.id, -1, 'b')
      check('B switched to version 1', v.split!.path.at(-1)!.siblingIndex === 0)
      check('A untouched by B switch', v.path.map((n) => n.id).join() === aBefore)

      // Screenshot the split before closing it.
      await reloadUi()
      await shot('e2e-split.png')

      // 7. Keep B: the main thread continues on B's branch.
      const bPath = v.split!.path.map((n) => n.id).join()
      v = chat.closeSplit(id, 'b')
      check('keep B: A now follows B', !v.split && v.path.map((n) => n.id).join() === bPath)
      check('keep B: B settings carried over', v.settings.modelId === 'mock-a')

      // 8. Documents: create without overwriting, save, list, and refuse paths outside the folder.
      const para = 'The lamps came on one street at a time, as if the town were remembering itself. '
      const chapters: string[] = []
      for (let c = 1; c <= 40; c++) chapters.push(`# Chapter ${c}\n\n` + Array.from({ length: 60 }, () => para.repeat(3)).join('\n\n'))
      const big = await docs.createDoc('Big manuscript')
      await docs.writeDoc(big.path, chapters.join('\n\n'))
      const scene = await docs.createDoc('Scene')
      await docs.writeDoc(scene.path, 'Nobody had ever seen who lit them. Wren stopped on the bridge to count them.\n')
      const second = await docs.createDoc('Scene')
      check('new doc never overwrites', second.path === 'Scene 2.md', second.path)
      const listed = (await docs.listDocs()).map((d) => d.path)
      check('docs listed', ['Big manuscript.md', 'Scene.md', 'Scene 2.md'].every((p) => listed.includes(p)), listed)
      check('reading outside the folder is refused', await docs.readDoc('../twilight.db').then(() => false, () => true))
      check('writing a non-markdown file is refused', await docs.writeDoc('notes.txt', 'x').then(() => false, () => true))

      // 9. Open the ~108k-word manuscript in the editor, time it, and scroll it.
      const big100k = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        // A hidden or covered window gets no animation frames; the timer keeps the run moving.
        const frame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 100) })
        document.querySelector('[data-mode="write"]').click()
        for (let i = 0; i < 500 && !document.querySelector('.doc-item[data-path="Big manuscript.md"]'); i++) await wait(10)
        await wait(300)
        const t0 = performance.now()
        document.querySelector('.doc-item[data-path="Big manuscript.md"]').click()
        // Bounded, so a document that never opens fails the check instead of hanging the run.
        for (let i = 0; i < 4000 && !document.querySelector('.cm-content .cm-line'); i++) {
          await wait(1)
          if (i === 2000) document.querySelector('.doc-item[data-path="Big manuscript.md"]')?.click()
        }
        await frame()
        const openMs = performance.now() - t0
        await wait(400)
        const el = document.querySelector('.cm-scroller')
        const times = []
        let prev = performance.now()
        while (el.scrollTop + el.clientHeight < el.scrollHeight - 1 && times.length < 5000) {
          el.scrollTop += 200; await frame(); const now = performance.now(); times.push(now - prev); prev = now
        }
        const s = [...times].sort((a, b) => a - b)
        return {
          openMs: Math.round(openMs), status: document.querySelector('.doc-status')?.textContent,
          frames: times.length, p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(2),
          max: +s[s.length - 1].toFixed(2), framesOver6ms: times.filter((t) => t > 6.3).length, reachedEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 1
        }
      })()`)
      check('100k-word manuscript opens fast', big100k.openMs < 500, big100k)
      const expectedWords = chapters.join('\n\n').match(/\S+/g)!.length
      check('word count shown', (big100k.status ?? '').startsWith(`${expectedWords.toLocaleString('en-US')} words`), [big100k.status, expectedWords])

      // 10. Writing tool round trip: select a sentence, Tighten, see the diff, accept, autosave.
      const tool = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('.doc-item[data-path="Scene.md"]').click()
        for (let i = 0; i < 500 && !(window.__twilightEditor && window.__twilightEditor.state.doc.toString().startsWith('Nobody')); i++) await wait(10)
        const v = window.__twilightEditor
        v.focus()
        v.dispatch({ selection: { anchor: 0, head: 34 } })
        await wait(150)
        const btn = [...document.querySelectorAll('.tw-seltool button')].find((b) => b.textContent === 'Tighten')
        if (!btn) return { step: 'no toolbar' }
        btn.click()
        for (let i = 0; i < 500 && !document.querySelector('.tw-btn-accept'); i++) await wait(10)
        if (!document.querySelector('.tw-btn-accept')) return { step: 'no suggestion', bar: document.querySelector('.tw-suggest')?.textContent }
        await wait(300)
        return {
          step: 'ready', del: !!document.querySelector('.tw-del'), ins: !!document.querySelector('.tw-ins'),
          docUnchanged: v.state.doc.toString().startsWith('Nobody had ever seen'),
          barText: document.querySelector('.tw-suggest')?.textContent
        }
      })()`)
      check('suggestion bar settles on Accept', /Accept/.test(tool.barText ?? '') && !/Stop/.test(tool.barText ?? ''), tool.barText)
      check('tool streams a suggestion', tool.step === 'ready', tool)
      check('suggestion shows a diff', tool.del && tool.ins, tool)
      check('manuscript unchanged until accept', tool.docUnchanged === true)
      await shot('e2e-writing.png')
      await win.webContents.executeJavaScript(`document.querySelector('.tw-btn-accept').click()`)
      await new Promise((r) => setTimeout(r, 1500))
      const saved = await docs.readDoc(scene.path)
      check(
        'accepted text autosaved to disk',
        saved.text.startsWith('No one ever saw who lit them (mock-a). Wren stopped on the bridge'),
        saved.text.slice(0, 120)
      )

      // 10b. Revert puts the original back (and saves it).
      const reverted = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const btn = [...document.querySelectorAll('.applied-pill button')].find((b) => b.textContent === 'Revert')
        if (!btn) return { step: 'no revert pill' }
        btn.click()
        await wait(50)
        return { step: 'ok', text: window.__twilightEditor.state.doc.toString() }
      })()`)
      check('revert restores the original', reverted.text?.startsWith('Nobody had ever seen who lit them. Wren'), reverted)
      await new Promise((r) => setTimeout(r, 1200))
      check('revert saved to disk', (await docs.readDoc(scene.path)).text.startsWith('Nobody had ever seen who lit them.'))

      // 10c. Formatting toggles markdown around the selection.
      const fmt = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const v = window.__twilightEditor
        const at = v.state.doc.toString().indexOf('Wren')
        v.focus()
        v.dispatch({ selection: { anchor: at, head: at + 4 } })
        await wait(150)
        const bold = () => document.querySelector('.tw-seltool [aria-label="Bold (Ctrl+B)"]')
        if (!bold()) return { step: 'no bold button' }
        bold().click()
        await wait(50)
        const once = v.state.doc.toString()
        await wait(150)
        bold().click()
        await wait(50)
        return { once, twice: v.state.doc.toString() }
      })()`)
      check('bold wraps the selection', fmt.once?.includes('**Wren**'), fmt)
      check('bold again unwraps it', fmt.twice?.includes(' Wren ') && !fmt.twice?.includes('**'), fmt)

      // 10d. Document context reaches the model: instructions, references, whole manuscript.
      const bible = await docs.createDoc('Bible')
      await docs.writeDoc(bible.path, 'Wren: eleven years old, counts everything.')
      docs.setDocContext(scene.path, { instructions: 'Past tense. No adverbs.', references: [bible.path], wholeManuscript: true })
      const beforeTool = log.length
      const ctxRun = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        // Reopen so the editor loads the new context.
        document.querySelector('.doc-item[data-path="Big manuscript.md"]').click()
        await wait(300)
        document.querySelector('.doc-item[data-path="Scene.md"]').click()
        for (let i = 0; i < 300 && !(window.__twilightEditor && window.__twilightEditor.state.doc.toString().startsWith('Nobody')); i++) await wait(10)
        const v = window.__twilightEditor
        v.focus()
        v.dispatch({ selection: { anchor: 0, head: 34 } })
        await wait(150)
        const btn = [...document.querySelectorAll('.tw-seltool button')].find((b) => b.textContent === 'Rewrite')
        if (!btn) return { step: 'no toolbar' }
        btn.click()
        for (let i = 0; i < 500 && !document.querySelector('.tw-btn-accept'); i++) await wait(10)
        const reject = [...document.querySelectorAll('.tw-suggest button')].find((b) => b.textContent === 'Reject')
        reject?.click()
        await wait(50)
        return { step: 'ok', unchanged: v.state.doc.toString().startsWith('Nobody had ever seen') }
      })()`)
      const toolReq = log.slice(beforeTool).find((r) => r.messages[0]?.content.startsWith('You are a line editor'))
      const sys = toolReq?.messages[0]?.content ?? ''
      const user = toolReq?.messages.at(-1)?.content ?? ''
      check('writing tool sends the document instructions', sys.includes('<writer_instructions>\nPast tense. No adverbs.'), sys.slice(0, 400))
      check('writing tool sends reference documents', sys.includes('<reference title="Bible">\nWren: eleven years old'))
      check('whole manuscript sent when asked', user.includes('<manuscript title="Scene">\nNobody had ever seen who lit them. Wren stopped'), user.slice(0, 200))
      check('reject leaves the manuscript alone', ctxRun.unchanged === true, ctxRun)

      // 11. Chat folders: create in a folder, pin, and deleting a folder keeps its chats.
      const rpg = db.createFolder('RPG Maker')
      const misc = db.createFolder('Misc')
      const inFolder = chat.create(rpg.id).id
      const filed = (cid: string): db.ConversationRow | undefined => db.listConversations().find((c) => c.id === cid)
      check('new chat lands in its folder', filed(inFolder)?.folder_id === rpg.id)
      db.fileConversation(id, { pinned: 1 })
      db.fileConversation(inFolder, { folder_id: misc.id })
      db.deleteFolder(misc.id)
      check('deleting a folder keeps its chats', !!filed(inFolder) && filed(inFolder)?.folder_id === null)

      // 11b. Trash: delete moves to trash, restore brings it back, forever only from the trash.
      db.trashConversation(inFolder)
      check('deleted chat leaves the list', !filed(inFolder) && db.listTrash().some((c) => c.id === inFolder))
      db.restoreConversation(inFolder)
      check('restore brings it back', !!filed(inFolder) && !db.listTrash().some((c) => c.id === inFolder))
      db.deleteConversationForever(id)
      check('delete forever refuses chats not in the trash', !!filed(id))
      db.trashConversation(inFolder)
      db.deleteConversationForever(inFolder)
      check('delete forever from the trash', !db.listTrash().some((c) => c.id === inFolder) && !filed(inFolder))

      // 11c. Request logs: chat and writing runs land in today's file, with no keys in it.
      await new Promise((r) => setTimeout(r, 300))
      const logFiles = (await readdir(logsFolder())).filter((f) => f.endsWith('.jsonl'))
      const lines = logFiles.length ? (await readFile(join(logsFolder(), logFiles[logFiles.length - 1]), 'utf8')).trim().split('\n') : []
      const entries = lines.map((l) => JSON.parse(l) as { kind: string; prompt?: string; response?: string; instruction?: string })
      check('chat turns logged', entries.some((e) => e.kind === 'chat' && e.prompt === 'Hello' && e.response?.includes('replying to')), entries.length)
      check('writing runs logged', entries.some((e) => e.kind === 'writing' && e.instruction?.startsWith('Tighten')))
      check('logs never contain keys', !lines.some((l) => /api[_-]?key|sk-ant/i.test(l)))

      // 12. Document folders are real folders; moves never overwrite; paths stay inside.
      await docs.createDocFolder('Book/Part 1')
      const docFolders = await docs.listDocFolders()
      check('nested doc folders created', docFolders.includes('Book') && docFolders.includes('Book/Part 1'), docFolders)
      const ch1 = await docs.createDoc('Chapter 1', 'Book/Part 1')
      check('new doc lands in its folder', ch1.path === 'Book/Part 1/Chapter 1.md', ch1.path)
      check('move doc into a folder', (await docs.moveDoc('Scene 2.md', 'Book')) === 'Book/Scene 2.md')
      await docs.createDoc('Clash', 'Book')
      await docs.createDoc('Clash')
      check('move refuses to overwrite', await docs.moveDoc('Clash.md', 'Book').then(() => false, () => true))
      check('original kept after refused move', (await docs.listDocs()).some((d) => d.path === 'Clash.md'))
      check('folder outside the writing folder refused', await docs.createDocFolder('../evil').then(() => false, () => true))
      check('hidden folder refused', await docs.createDocFolder('.obsidian/x').then(() => false, () => true))

      // 13. Sidebar drag and drop, through real DOM drag events.
      const helloId = id
      // The main process changed folders directly, so reload the interface to pick them up.
      await reloadUi()
      const ui = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const drop = (target, mime, value) => {
          const dt = new DataTransfer()
          dt.setData(mime, value)
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
          target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
        }
        const names = [...document.querySelectorAll('.folder-name')].map((e) => e.textContent)
        const sections = [...document.querySelectorAll('.side-section')].map((e) => e.textContent)
        const folderEl = [...document.querySelectorAll('.folder')].find((f) => f.querySelector('.folder-name')?.textContent === 'RPG Maker')
        if (!folderEl) return { names, sections, step: 'no folder element' }
        drop(folderEl, 'application/x-twilight-chat', ${JSON.stringify(helloId)})
        await wait(300)
        document.querySelector('[data-mode="write"]').click()
        for (let i = 0; i < 100 && !document.querySelector('.folder-head[data-folder="Book"]'); i++) await wait(10)
        const bookEl = document.querySelector('.folder-head[data-folder="Book"]').parentElement
        drop(bookEl, 'application/x-twilight-doc', 'Scene.md')
        await wait(400)
        return { names, sections, step: 'done' }
      })()`)
      check('sidebar shows folders and sections', ui.names?.includes('RPG Maker') && ui.sections?.includes('Pinned') && ui.sections?.includes('Recent'), ui)
      check('drag chat into folder', filed(helloId)?.folder_id === rpg.id)
      check('drag doc into folder',(await docs.listDocs()).some((d) => d.path === 'Book/Scene.md'))
      await new Promise((r) => setTimeout(r, 300))
      await shot('e2e-docfolders.png')
      await win.webContents.executeJavaScript(`document.querySelector('[data-mode="chat"]').click()`)
      await new Promise((r) => setTimeout(r, 400))
      await shot('e2e-chatfolders.png')

      // 14. Send a chat reply to Writing.
      const sent = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const hello = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent.endsWith('Hello'))
        hello?.click()
        for (let i = 0; i < 200 && !document.querySelector('[aria-label="Send to Writing"]'); i++) await wait(10)
        const btn = document.querySelector('[aria-label="Send to Writing"]')
        if (!btn) return { step: 'no button' }
        btn.click()
        for (let i = 0; i < 300 && !(window.__twilightEditor && window.__twilightEditor.state.doc.toString().includes('replying to')); i++) await wait(10)
        return { step: 'ok', title: document.querySelector('.chat-title')?.textContent }
      })()`)
      const sentDoc = (await docs.listDocs()).find((d) => d.path.startsWith('Hello'))
      check('reply sent to Writing as a document', !!sentDoc && (await docs.readDoc(sentDoc.path)).text.includes('replying to'), [sent, sentDoc?.path])
      await new Promise((r) => setTimeout(r, 300))
      await shot('e2e-forge.png')

      // 15. System prompt can change after the chat starts, separately per split pane.
      const c2 = chat.create(null).id
      chat.send(contents, c2, 'First')
      await idle(c2)
      chat.updateSettings(c2, { systemPrompt: 'You are a test v2.' })
      chat.cloneIntoSplit(c2)
      chat.updateSettings(c2, { systemPrompt: 'You are pane B.' }, 'b')
      const before15 = log.length
      chat.send(contents, c2, 'Second', 'both')
      await idle(c2)
      const systems = log.slice(before15).map((r) => r.messages[0]?.content).sort()
      check('edited system prompt is sent', systems.includes('You are a test v2.'), systems)
      check('pane B has its own system prompt', systems.includes('You are pane B.'), systems)
      chat.closeSplit(c2, 'a')

      // 16. Workspace defaults: new chats take the workspace's system prompt and model.
      workspaces.updateWorkspace(rpg.id, {
        description: 'A game about lamps.',
        systemPrompt: 'Answer as the game master.',
        includeContext: true,
        providerId: 'mock',
        modelId: 'mock-b'
      })
      const wsChat = chat.create(rpg.id)
      check(
        'workspace system prompt applied',
        wsChat.settings.systemPrompt === 'Workspace: RPG Maker\nA game about lamps.\n\nAnswer as the game master.',
        wsChat.settings.systemPrompt
      )
      check('workspace model applied', wsChat.settings.modelId === 'mock-b')

      // 17. Request options land in the provider's own format.
      chat.updateSettings(c2, { effort: 'high', temperature: 0.4, maxTokens: 1000, extraParams: '{"top_k": 40, "min_p": 0.05}' })
      const before17 = log.length
      chat.send(contents, c2, 'Options please')
      await idle(c2)
      const body = log[before17]?.body ?? {}
      check('effort sent as reasoning_effort', body.reasoning_effort === 'high', body.reasoning_effort)
      check('temperature and max tokens sent', body.temperature === 0.4 && body.max_tokens === 1000, [body.temperature, body.max_tokens])
      check('extra JSON merged into the request', body.top_k === 40 && body.min_p === 0.05, [body.top_k, body.min_p])
      chat.updateSettings(c2, { extraParams: '{ not json' })
      chat.send(contents, c2, 'Broken params')
      await idle(c2)
      const broken = chat.view(c2).path.at(-1)
      check('bad extra JSON gives a clear error', broken?.status === 'error' && /valid JSON/.test(broken.error ?? ''), broken?.error)
      chat.updateSettings(c2, { extraParams: '' })

      // 18. Attachments are injected in full into the message.
      const before18 = log.length
      chat.send(contents, c2, 'What does the note say?', 'a', [{ name: 'notes.md', text: 'The bridge has nine lamps.' }])
      await idle(c2)
      const lastUser = log[before18]?.messages.at(-1)?.content ?? ''
      check('attachment text sent in the message', lastUser.includes('<document name="notes.md">\nThe bridge has nine lamps.\n</document>'), lastUser.slice(0, 200))
      const userView = chat.view(c2).path.at(-2)
      check('attachment shown on the message', userView?.attachments?.[0]?.name === 'notes.md' && userView.text === 'What does the note say?')

      // 19. Recent message limit trims in steps, so the cached prefix holds between cuts.
      const msgs = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', i }))
      const cuts = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40].map((n) => chat.trimHistory(msgs.slice(0, n), 20)[0]?.i ?? -1)
      check('trim keeps at most the limit', chat.trimHistory(msgs, 20).length <= 20)
      check('trim starts on a user message', cuts.every((c) => c % 2 === 0), cuts)
      check('trim cut moves in steps, not every turn', new Set(cuts).size <= 3, cuts)

      // 20. Anthropic effort levels come from the Models API capability tree, in its own names.
      const opts = anthropicOptions(
        'claude-opus-5-5',
        {
          effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } },
          thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }
        } as never,
        128000
      )
      check('effort levels read from capabilities', opts.efforts.join() === 'low,medium,high,xhigh,max' && opts.effortsFromProvider, opts)
      check('Opus 5.5 default effort is medium', opts.defaultEffort === 'medium')
      const haiku45 = anthropicOptions('claude-haiku-4-5', { effort: { supported: false }, thinking: { supported: true, types: { adaptive: { supported: false } } } } as never)
      check('models without effort get none', haiku45.efforts.length === 0 && !haiku45.adaptiveThinking)

      // 21. The interface: cache status bar and the model settings panel.
      await reloadUi()
      const ui2 = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'First')
        row?.click()
        await wait(400)
        const bar = document.querySelector('.cache-bar')?.textContent ?? null
        const btn = [...document.querySelectorAll('.chat-head button')].find((b) => b.textContent.includes('Model settings'))
        btn?.click()
        await wait(300)
        const panel = document.querySelector('.settings-panel')
        return { bar, panel: !!panel, efforts: [...(panel?.querySelectorAll('select') ?? [])].map((s) => [...s.options].map((o) => o.textContent)) }
      })()`)
      check('cache status bar shown', typeof ui2.bar === 'string' && ui2.bar.length > 0, ui2.bar)
      check('model settings panel opens', ui2.panel === true, ui2)
      await new Promise((r) => setTimeout(r, 200))
      await shot('e2e-settings.png')
      // Close it with its X, and toggle it with the header button: real clicks at the controls'
      // positions (not element.click()), so anything covering them would show up here.
      const realClick = async (selector: string, nth = 0): Promise<boolean> => {
        const box = await win.webContents.executeJavaScript(`(() => {
          const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${nth}]
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        })()`)
        if (!box) return false
        win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
        await new Promise((r) => setTimeout(r, 300))
        return true
      }
      const panelOpen = (): Promise<boolean> => win.webContents.executeJavaScript(`!!document.querySelector('.settings-panel')`)
      await realClick('.settings-panel .panel-head [aria-label="Close"]')
      const afterX = await panelOpen()
      const headerBtn = '.chat-head button[aria-expanded]'
      const settingsIndex = await win.webContents.executeJavaScript(`[...document.querySelectorAll('${headerBtn}')].findIndex((b) => b.textContent.includes('Model settings'))`)
      await realClick(headerBtn, settingsIndex)
      const afterOpen = await panelOpen()
      await realClick(headerBtn, settingsIndex)
      const afterToggle = await panelOpen()
      // Opening and closing again and again must never leave a panel behind (it once did: two
      // siblings shared a React key, so each close left the old panel on screen).
      const cycles = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const btn = () => [...document.querySelectorAll('.chat-head button')].find((b) => b.textContent.includes('Model settings'))
        const counts = []
        for (let i = 0; i < 3; i++) {
          btn().click(); await wait(200)
          counts.push(document.querySelectorAll('.settings-panel').length)
          btn().click(); await wait(200)
          counts.push(document.querySelectorAll('.settings-panel').length)
        }
        return counts
      })()`)
      check('model settings closes with its X', afterX === false, { afterX })
      check('opening and closing leaves no panels behind', cycles.join() === '1,0,1,0,1,0', cycles)
      check('the Model settings button opens and closes the panel', afterOpen === true && afterToggle === false, { afterOpen, afterToggle })

      // 22. Game Format: paragraphs joined within chunks, dividers kept, code and HTML untouched.
      const sample = 'ofjasdoifjasodif\n\najosdfjasoidfj\n\nasdofjiasodf\n\n---\n\noidsfjsodjfids\n\nsdfjosidjf\n\nsdojfsoidfj'
      check(
        'game format matches the wanted layout',
        gameFormat(sample) === 'ofjasdoifjasodif\najosdfjasoidfj\nasdofjiasodf\n\n---\n\noidsfjsodjfids\nsdfjosidjf\nsdojfsoidfj',
        gameFormat(sample)
      )
      const withBlocks = 'Para one.\n\nPara two.\n\n```\nSTATUS  Wren\n\n        Rowan\n```\n\n<details>\n<summary>status card</summary>\n\n```\nDATE x\n```\n\n</details>\n\nAfter.\n\nMore.'
      const formatted = gameFormat(withBlocks)
      check('game format leaves code blocks alone', formatted.includes('```\nSTATUS  Wren\n\n        Rowan\n```'), formatted)
      check('game format leaves <details> alone', formatted.includes('<details>\n<summary>status card</summary>\n\n```\nDATE x\n```\n\n</details>'), formatted)
      check('game format joins prose around blocks', formatted.startsWith('Para one.\nPara two.') && formatted.endsWith('After.\nMore.'), formatted)
      check('game format can drop dividers', !gameFormat(sample, { removeDividers: true, stripMarkdown: false }).includes('---'))
      check('game format can strip markdown', gameFormat('**Bold** and *soft*.\n\n# Title', { removeDividers: false, stripMarkdown: true }) === 'Bold and soft.\nTitle')

      // 23. status card <details> renders; dangerous HTML is stripped.
      chat.send(contents, c2, 'Show the STATUSCARD')
      await idle(c2)
      await reloadUi()
      const html = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'First')
        row?.click()
        await wait(500)
        const msgs = [...document.querySelectorAll('.tw-msg-ai .md')]
        const md = msgs[msgs.length - 1]
        const details = md?.querySelector('details')
        details?.querySelector('summary')?.click()
        await wait(100)
        return {
          summary: details?.querySelector('summary')?.textContent ?? null,
          open: details?.open ?? null,
          code: details?.querySelector('pre code')?.textContent ?? null,
          img: !!md?.querySelector('img'), script: !!md?.querySelector('script'), pwned: window.__pwned ?? null,
          bold: md?.querySelector('b')?.textContent ?? null, escaped: md?.textContent.includes('<details') ?? null,
          gameBtn: !!document.querySelector('.game-format-btn')
        }
      })()`)
      check('<details> status card renders and opens', html.summary === 'status card' && html.open === true && html.code?.includes('STATUS CARD'), html)
      check('dangerous HTML stripped, nothing ran', !html.img && !html.script && html.pwned === null, html)
      check('harmless HTML kept', html.bold === 'bold html' && html.escaped === false, html)
      check('Game Format button on replies', html.gameBtn === true)
      await new Promise((r) => setTimeout(r, 200))
      await shot('e2e-statuscard.png')

      // 24. The Judge: blind, both orders, scores mapped back to A and B. A rubric of your own is
      // imported from a file (none ship with the app beyond the general one).
      check('only the general rubric ships', judge.listRubrics().map((r) => r.id).join() === 'general-fiction')
      const imported = judge.parseRubric(JSON.stringify({ twilightRubric: 1, id: 'test-serial', name: 'Test serial', description: 'From a file', criteria: [
        { id: 'prose', name: 'Prose', weight: 2, guide: 'Specific language.' },
        { id: 'explicit', name: 'Explicit scenes', weight: 2, guide: 'Only when present.' },
        { name: 'No id here', weight: 'x', guide: 'Gets a slug id and weight 1.' }
      ] }))
      check('imported rubric fills in ids and weights', imported.criteria[2].id === 'no-id-here' && imported.criteria[2].weight === 1)
      judge.saveRubric(imported)
      check('imported rubric round-trips through export', judge.parseRubric(judge.rubricFile('test-serial')).criteria.length === 3)
      let badRubric = ''
      try {
        judge.parseRubric('{"name": "x", "criteria": []}')
      } catch (err) {
        badRubric = String(err)
      }
      check('a rubric without criteria is refused', /at least one criterion/.test(badRubric))
      const beforeJudge = log.length
      const judgment = judge.runJudge(contents, {
        title: 'Lamps test',
        passageA: 'GOOD: The lamps came on one street at a time.',
        passageB: 'The lamps turned on.',
        labelA: 'Opus Secret',
        labelB: 'Sonnet Secret',
        authorPrompt: 'Write the lamps.',
        systemPrompt: 'You are a co-writer.',
        contextDocs: [{ name: 'Bible.md', text: 'Wren counts lamps.' }],
        extraInstructions: '',
        judgeProviderId: 'mock',
        judgeModelId: 'mock-a',
        effort: null,
        rubricId: 'test-serial',
        bothOrders: true
      })
      for (let i = 0; i < 400 && judge.getJudgment(judgment.id).runs.some((r) => r.status === 'streaming'); i++) await new Promise((r) => setTimeout(r, 25))
      const judged = judge.getJudgment(judgment.id)
      const verdict = computeVerdict(judged.rubric, judged.runs)
      const judgeReqs = log.slice(beforeJudge).filter((r) => r.messages[0]?.content.startsWith('You are an exacting fiction editor'))
      check('judge ran twice', judgeReqs.length === 2 && judged.runs.every((r) => r.status === 'done'), judged.runs.map((r) => [r.status, r.error]))
      check('both orders agree on A', verdict.winner === 'A' && verdict.agreement === 'agree', verdict)
      check('scores mapped back to A and B', verdict.overallA !== null && Math.abs(verdict.overallA - 8) < 0.01 && Math.abs((verdict.overallB ?? 0) - 5) < 0.01, [verdict.overallA, verdict.overallB])
      check('inapplicable criterion stays empty', verdict.criteria.find((c) => c.id === 'explicit')?.A === null)
      const judgeSent = judgeReqs.map((r) => r.messages.at(-1)?.content ?? '')
      check('the judge never sees model names', !judgeSent.some((s) => s.includes('Secret')))
      check('runs swap the order', judgeSent[0]?.indexOf('GOOD') < judgeSent[0]?.indexOf('turned on') && judgeSent[1]?.indexOf('GOOD') > judgeSent[1]?.indexOf('turned on'))
      check(
        'both runs share the same context prefix (one cache)',
        judgeSent[0]?.split('<passage id="X">')[0] === judgeSent[1]?.split('<passage id="X">')[0] && judgeSent[0]?.includes('<document name="Bible.md">'),
        judgeSent.map((s) => s.length)
      )
      check('second run waits for the first token', judgeReqs[1].startedAt >= (judgeReqs[0].firstTokenAt ?? Infinity))

      // 25. Judge A vs B from a split chat, then the result screen.
      chat.cloneIntoSplit(c2)
      chat.updateSettings(c2, { modelId: 'mock-b' }, 'b')
      chat.send(contents, c2, 'Write the scene', 'both')
      await idle(c2)
      await reloadUi()
      const fromSplit = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'First')
        row?.click()
        await wait(500)
        const btn = [...document.querySelectorAll('.chat-head button')].find((b) => b.textContent === 'Judge A vs B')
        if (!btn) return { step: 'no button' }
        btn.click()
        await wait(300)
        const areas = [...document.querySelectorAll('.judge-passage textarea')].map((t) => t.value)
        const labels = [...document.querySelectorAll('.judge-label')].map((i) => i.value)
        const author = document.querySelector('.judge-form textarea[placeholder="The prompt both models answered"]')?.value
        // Then open the earlier judgment.
        document.querySelector('[data-mode="judge"]').click()
        await wait(200)
        const item = [...document.querySelectorAll('.judgment-item')].find((r) => r.textContent.includes('Lamps test'))
        item?.click()
        await wait(400)
        return { areas, labels, author, headline: document.querySelector('.verdict h2')?.textContent, rows: document.querySelectorAll('.criteria-table tbody tr').length }
      })()`)
      check(
        'Judge A vs B prefills from the panes',
        fromSplit.areas?.[0]?.includes('mock-a') && fromSplit.areas?.[1]?.includes('mock-b') && fromSplit.labels?.[0] === 'mock-a' && fromSplit.author === 'Write the scene',
        fromSplit
      )
      check('result screen shows the verdict, blind', fromSplit.headline === 'A is better written' && fromSplit.rows === 3, fromSplit)
      await new Promise((r) => setTimeout(r, 200))
      await shot('e2e-judge.png')

      // 26. Choice cards: parsing, the instruction reaching the model, and the card in use.
      const parsedChoices = extractChoices('Story.\n\n```choices\nWhat now?\n1. Go left\n2. Go right\n```')
      check('choices block parsed', parsedChoices.body === 'Story.' && parsedChoices.choices?.groups[0].title === 'What now?' && parsedChoices.choices?.groups[0].options.map((o) => o.label).join() === 'Go left,Go right')
      const partial = extractChoices('Story.\n\n```choices\nWhat now?\n1. Go le')
      check('half-streamed choices stay hidden', partial.body === 'Story.' && partial.choices === null)
      check('plain replies untouched', extractChoices('Just text.').choices === null)

      const c3 = chat.create(null).id
      chat.updateSettings(c3, { choiceCards: true })
      const before26 = log.length
      chat.send(contents, c3, 'Start')
      await idle(c3)
      check('choice instruction sent in the system prompt', (log[before26]?.messages[0]?.content ?? '').includes('Interactive choices:'))
      check('no choice tool unless its switch is on', !(log[before26]?.body as { tools?: unknown }).tools)
      check('choices blocks left as written with their switch off', extractChoices('Story.\n\n```choices\nWhat now?\n1. Go left\n2. Go right\n```', true, false).choices === null)
      await reloadUi()
      const card = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[data-mode="chat"]').click()
        await wait(200)
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Start')
        row?.click()
        await wait(500)
        const c = document.querySelector('.choice-card')
        const md = [...document.querySelectorAll('.tw-msg-ai .md')].at(-1)
        const info = {
          question: c?.querySelector('.choice-question')?.textContent ?? null,
          options: [...(c?.querySelectorAll('.choice-text') ?? [])].map((e) => e.textContent),
          rawHidden: !(md?.textContent.includes('choices') || md?.textContent.includes('Light the lamp'))
        }
        ;[...document.querySelectorAll('.choice-pick')][1]?.click()
        return info
      })()`)
      check('choice card shows the question and options', card.question === 'What do you do?' && card.options?.length === 4, card)
      check('raw choices block hidden from the reply', card.rawHidden === true)
      await new Promise((r) => setTimeout(r, 300))
      await idle(c3)
      check('clicking a choice sends it', chat.view(c3).path.at(-2)?.text === 'Wait in the rain', chat.view(c3).path.at(-2)?.text)

      await new Promise((r) => setTimeout(r, 400))
      await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const cards = document.querySelectorAll('.choice-card')
        const cardEl = cards[cards.length - 1]
        cardEl.querySelector('[aria-label="Edit choice 1 before sending"]').click()
        await wait(100)
        const input = cardEl.querySelector('.choice-edit input')
        input.value = 'Light the lamp and sing'
        cardEl.querySelector('.choice-edit').requestSubmit()
      })()`)
      await new Promise((r) => setTimeout(r, 300))
      await idle(c3)
      check('an edited choice sends the edit', chat.view(c3).path.at(-2)?.text === 'Light the lamp and sing', chat.view(c3).path.at(-2)?.text)

      await new Promise((r) => setTimeout(r, 400))
      await win.webContents.executeJavaScript(`(async () => {
        const cards = document.querySelectorAll('.choice-card')
        const cardEl = cards[cards.length - 1]
        const input = cardEl.querySelector('.choice-own input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Dance in the rain')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 50))
        cardEl.querySelector('.choice-own').requestSubmit()
      })()`)
      await new Promise((r) => setTimeout(r, 300))
      await idle(c3)
      check('"Something else" sends your own words', chat.view(c3).path.at(-2)?.text === 'Dance in the rain', chat.view(c3).path.at(-2)?.text)
      await new Promise((r) => setTimeout(r, 500))
      const answered = await win.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.choice-card')]
        return {
          count: cards.length,
          firstPicked: cards[0]?.querySelector('.choice-picked .choice-text')?.textContent ?? null,
          firstActive: !!cards[0]?.querySelector('.choice-own'),
          lastActive: !!cards[cards.length - 1]?.querySelector('.choice-own')
        }
      })()`)
      check('answered cards show the pick and go quiet', answered.firstPicked === 'Wait in the rain' && !answered.firstActive && answered.lastActive, answered)
      await shot('e2e-choices.png')

      // 27. Plain-text choices: a numbered list at the end becomes a card when Choices is on.
      const plain = extractChoices('Rain.\n\n*What now?*\n\n**1.** Run\n**2.** Hide\n\n<details>\n<summary>Day</summary>\nx\n</details>', true)
      check('plain numbered options parsed', plain.choices?.groups[0].title === 'What now?' && plain.choices?.groups[0].options.map((o) => o.label).join() === 'Run,Hide' && plain.body.includes('<details>') && !plain.body.includes('Hide'), plain)
      check('plain options ignored with Choices off', extractChoices('Rain.\n\n1. Run\n2. Hide').choices === null)
      check('lists mid-reply are not choices', extractChoices('1. a\n2. b\n\nThe story goes on.', true).choices === null)
      check('lists not numbered from 1 are not choices', extractChoices('Text\n\n2. a\n3. b', true).choices === null)
      const c4 = chat.create(null).id
      chat.updateSettings(c4, { choiceCards: true })
      chat.send(contents, c4, 'PLAINCHOICES')
      await idle(c4)
      await new Promise((r) => setTimeout(r, 400))
      const plainCard = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'PLAINCHOICES')
        row?.click()
        await wait(500)
        const c = document.querySelector('.choice-card')
        const md = [...document.querySelectorAll('.tw-msg-ai .md')].at(-1)
        return {
          question: c?.querySelector('.choice-question')?.textContent ?? null,
          options: [...(c?.querySelectorAll('.choice-text') ?? [])].map((e) => e.textContent),
          listHidden: !md?.textContent.includes('Follow the draft'),
          storyShown: !!md?.textContent.includes('corridor splits')
        }
      })()`)
      check('plain-text options show as a card', plainCard.question === 'What do you do?' && plainCard.options?.join('|') === 'Take the left stair|Follow the draft|Wait for the guard', plainCard)
      check('plain list moves out of the reply', plainCard.listHidden && plainCard.storyShown, plainCard)

      // 27b. Several decisions in one reply, options with details, "Something else" as a write-in,
      // and ordinary numbered lists left alone.
      const outfitText = 'OUTFIT · Day 2 Morning\nPlace: a cold pier, then a warm cabin.\n1 · PLAIN: \n\n* Pieces: wool coat\n\n2 · BOLD\n\n* Pieces: red scarf\n\n3 · SOMETHING ELSE'
      const multi = extractChoices(`The gate creaked.\n\n${outfitText}\n\nChoices (Morning)\n\n1. Head out\n2. Stay in\n3. Something else.`, true)
      const [g1, g2] = multi.choices?.groups ?? []
      check('several choice groups parsed in order', multi.choices?.groups.length === 2 && g1?.title === 'OUTFIT · Day 2 Morning' && g2?.title === 'Choices (Morning)', multi.choices)
      check('options keep their details and intro', g1?.intro === 'Place: a cold pier, then a warm cabin.' && g1?.options.map((o) => o.label).join() === 'PLAIN,BOLD' && g1?.options[0].details === '* Pieces: wool coat', g1)
      check('"Something else" becomes the write-in', g2?.options.map((o) => o.label).join() === 'Head out,Stay in')
      check('the story stays in the reply', multi.body === 'The gate creaked.', multi.body)
      check('a plain list at the end stays a list', extractChoices('Story.\n\nIn the bag:\n\n1. A lamp\n2. A rope', true).choices === null)
      check('numbered steps stay a list', extractChoices('How to install:\n\n1. Download it.\n2. Run it.', true).choices === null)
      check('one group per character', extractChoices('Story.\n\nAsh:\n1. Leads\n2. Waits\n3. Something else\n\nRowan:\n1. Follows\n2. Leaves\n3. Something else', true).choices?.groups.map((g) => g.title).join() === 'Ash,Rowan')

      const c6 = chat.create(null).id
      chat.updateSettings(c6, { choiceCards: true })
      chat.send(contents, c6, 'MULTICHOICE')
      await idle(c6)
      await new Promise((r) => setTimeout(r, 400))
      const sentBeforeMulti = log.length
      const multiUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'MULTICHOICE')
        row?.click()
        await wait(500)
        const card = document.querySelector('.choice-card')
        const groups = [...card.querySelectorAll('.choice-group')]
        const sendBtn = () => [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Send choices'))
        const out = { groups: groups.length, details: card.querySelector('.choice-details')?.textContent.trim() ?? null, disabledAtStart: sendBtn()?.disabled }
        groups[0].querySelectorAll('.choice-pick')[1].click()
        await wait(150)
        out.disabledAfterOne = sendBtn()?.disabled
        groups[1].querySelectorAll('.choice-pick')[1].click()
        await wait(150)
        out.disabledAfterBoth = sendBtn()?.disabled
        out.count = card.querySelector('.choice-send .field-note')?.textContent ?? null
        sendBtn()?.click()
        return out
      })()`)
      check('multi-group card shows both groups with details', multiUi.groups === 2 && /red scarf|wool coat/.test(multiUi.details ?? ''), multiUi)
      check('one pick out of two sends nothing', multiUi.disabledAtStart === true && multiUi.disabledAfterOne === true && log.length === sentBeforeMulti, multiUi)
      check('Send is ready once every group has a pick', multiUi.disabledAfterBoth === false && multiUi.count === '2 of 2 chosen', multiUi)
      await new Promise((r) => setTimeout(r, 300))
      await idle(c6)
      check('both picks sent as one message', chat.view(c6).path.at(-2)?.text === 'OUTFIT · Day 2 Morning: BOLD\nChoices (Morning): Stay in', chat.view(c6).path.at(-2)?.text)
      await new Promise((r) => setTimeout(r, 400))
      const multiAnswered = await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelectorAll('.choice-card')[0]
        return [...card.querySelectorAll('.choice-picked .choice-text')].map((e) => e.textContent)
      })()`)
      check('answered multi-group card shows each pick', multiAnswered.join() === 'BOLD,Stay in', multiAnswered)

      // 27c. Choices as a tool call: the model calls present_choices, the card draws from the call,
      // and the pick goes back as the call's result.
      const c7 = chat.create(null).id
      chat.updateSettings(c7, { choiceCards: true, choiceTool: true })
      const beforeChoiceTool = log.length
      chat.send(contents, c7, 'TOOLCHOICE')
      await idle(c7)
      const choiceToolReq = log[beforeChoiceTool]?.body as { tools?: { function: { name: string } }[] } | undefined
      check('choice tool sent with the request', choiceToolReq?.tools?.[0]?.function.name === 'present_choices', choiceToolReq?.tools)
      check('tool how-to in the system prompt', (log[beforeChoiceTool]?.messages[0]?.content ?? '').includes('present_choices tool'))
      check('only one how-to with the tool and choices blocks both on', !(log[beforeChoiceTool]?.messages[0]?.content ?? '').includes('fenced block marked "choices"'))
      const toolNode = chat.view(c7).path.at(-1)
      check('tool call read into a card', toolNode?.toolChoices?.groups.map((g) => g.title).join('|') === 'Outfit|What do you do?' && toolNode?.text === 'The bridge sways in the wind.', toolNode?.toolChoices)
      check('tool card drops a "something else" option', toolNode?.toolChoices?.groups[1].options.map((o) => o.label).join() === 'Cross,Turn back')
      await new Promise((r) => setTimeout(r, 400))
      const toolUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'TOOLCHOICE')
        row?.click()
        await wait(500)
        const card = document.querySelector('.choice-card')
        const groups = [...card.querySelectorAll('.choice-group')]
        groups[0].querySelectorAll('.choice-pick')[0].click()
        await wait(100)
        groups[1].querySelectorAll('.choice-pick')[0].click()
        await wait(100)
        const out = { groups: groups.length, details: card.querySelector('.choice-details')?.textContent.trim() ?? null }
        ;[...card.querySelectorAll('button')].find((b) => b.textContent.includes('Send choices'))?.click()
        return out
      })()`)
      check('tool card shows its groups and details', toolUi.groups === 2 && toolUi.details === 'Wool coat, boots', toolUi)
      const beforeAnswer = log.length
      await new Promise((r) => setTimeout(r, 300))
      await idle(c7)
      const answerMsgs = (log[beforeAnswer]?.messages ?? []) as unknown as { role: string; content: string | null; tool_calls?: { id: string }[]; tool_call_id?: string }[]
      const asked = answerMsgs.find((m) => m.role === 'assistant' && m.tool_calls)
      const result = answerMsgs.find((m) => m.role === 'tool')
      check('the call is replayed with the history', asked?.tool_calls?.[0]?.id === 'call_e2e' && asked?.content === 'The bridge sways in the wind.', asked)
      check('the pick goes back as the tool result', result?.tool_call_id === 'call_e2e' && result?.content === 'Outfit: Coat\nWhat do you do?: Cross', result)
      check('the pick is not also sent as a user message', !answerMsgs.slice(answerMsgs.indexOf(result!)).some((m) => m.role === 'user'))
      check('the model answers after the tool result', (chat.view(c7).path.at(-1)?.text ?? '').includes('tool result'), chat.view(c7).path.at(-1)?.text)

      // The same exchange in Claude's format: the answer becomes a tool_result, first in the turn,
      // documents after; other providers' tool bookkeeping is never replayed to Claude.
      const row = (role: string, content: unknown, text = ''): db.NodeRow =>
        ({ id: randomUUID(), conversation_id: 'x', parent_id: 'p', role, text, content: JSON.stringify(content), thinking: null, model: null, provider_id: null, usage: null, status: 'done', error: null, created_at: 0, active_child_id: null }) as unknown as db.NodeRow
      const claudeMsgs = toMessages([
        row('user', [{ type: 'text', text: 'Begin' }]),
        row('assistant', [{ type: 'thinking', thinking: 'hm', signature: 'sig' }, { type: 'text', text: 'Story.' }, { type: 'tool_use', id: 'toolu_1', name: 'present_choices', input: { groups: [] } }]),
        row('user', [{ type: 'text', text: '<document name="notes.md">x</document>' }, { type: 'text', text: 'Cross' }], 'Cross'),
        row('assistant', [{ type: 'text', text: 'Next.' }, { type: 'tool_calls', calls: [{ id: 'c', name: 'present_choices', arguments: '{}' }] }])
      ])
      const answerTurn = claudeMsgs[2]?.content as { type: string; tool_use_id?: string; content?: string; text?: string }[]
      check('Claude gets the pick as a tool_result first', answerTurn?.[0]?.type === 'tool_result' && answerTurn[0].tool_use_id === 'toolu_1' && answerTurn[0].content === 'Cross', answerTurn)
      check('attached documents follow the tool_result', answerTurn?.[1]?.text?.startsWith('<document name=') === true && answerTurn.length === 2)
      check('thinking and tool_use replayed unchanged', (claudeMsgs[1]?.content as { type: string }[]).map((b) => b.type).join() === 'thinking,text,tool_use')
      check("another provider's tool calls aren't replayed to Claude", (claudeMsgs[3]?.content as { type: string }[]).map((b) => b.type).join() === 'text')

      // 30. API keys: what comes along with a pasted key is cleaned off, and a rejected key is
      // described by its shape only (never its characters).
      const keySample = 'sk-ant-api03-SECRETPART'
      const pasted = ['ANTHROPIC_API_KEY=' + keySample, 'export ANTHROPIC_API_KEY="' + keySample + '"', '$env:ANTHROPIC_API_KEY = "' + keySample + '"', 'x-api-key: ' + keySample, 'Bearer ' + keySample, ' ' + keySample.slice(0, 10) + '\n' + keySample.slice(10) + ' ']
      check('pasted keys are cleaned', pasted.every((k) => providers.cleanApiKey(k) === keySample), pasted.map((k) => providers.cleanApiKey(k)))
      const oat = keyShape('sk-ant-oat01-SECRETPART')
      check('a subscription token is called out', /subscription sign-in token/.test(oat) && /console\.anthropic\.com/.test(oat))
      check('a key from elsewhere is called out', /isn't an Anthropic API key/.test(keyShape('sk-proj-SECRETPART')))
      check('a key is never shown in the hint', ![oat, keyShape(keySample), keyShape('sk-proj-SECRETPART')].some((h) => h.includes('SECRETPART')))

      // The providers page: a list on the left, the selected provider's connection and models on the right.
      const provUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('.rail [data-rail="settings"]').click()
        await wait(300)
        ;[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Model providers'))?.click()
        await wait(300)
        const items = [...document.querySelectorAll('.provider-item .provider-name')].map((e) => e.textContent)
        const out = { items, emptyState: !!document.querySelector('.models-empty'), firstTitle: document.querySelector('.provider-detail-head .t-heading')?.textContent }
        ;[...document.querySelectorAll('.provider-item')].find((r) => r.textContent.includes('Mock'))?.click()
        await wait(300)
        out.mockTitle = document.querySelector('.provider-detail-head .t-heading')?.textContent
        out.modelCards = document.querySelectorAll('.provider-detail .model-row').length
        out.grid = getComputedStyle(document.querySelector('.provider-detail .model-list')).display
        return out
      })()`)
      check('providers listed on the left', ['Anthropic', 'Ollama', 'LM Studio', 'Mock'].every((n) => provUi.items.includes(n)), provUi.items)
      check('a provider without models shows how to get them', provUi.firstTitle === 'Anthropic' && provUi.emptyState === true, provUi)
      check('selecting a provider shows its models as a grid', provUi.mockTitle === 'Mock' && provUi.modelCards === 2 && provUi.grid === 'grid', provUi)
      await new Promise((r) => setTimeout(r, 200))
      await shot('e2e-providers.png')

      // 31. The Roadmap page draws ROADMAP.md: planned cards, ideas, and the shipped timeline.
      // Wide enough for the Roadmap's side panel, for this page only.
      const size31 = win.getSize()
      win.setSize(2000, size31[1])
      await new Promise((r) => setTimeout(r, 300))
      const roadmapUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Roadmap'))?.click()
        await wait(1500)
        const out = {
          cards: document.querySelectorAll('.rm-card').length,
          releases: [...document.querySelectorAll('.rm-version')].map((e) => e.textContent),
          ideas: document.querySelectorAll('.rm-idea').length,
          doing: document.querySelectorAll('.rm-card.is-doing').length
        }
        // The side panel shows only when the window is wide enough.
        out.wide = innerWidth >= 1700
        out.aside = getComputedStyle(document.querySelector('.rm-aside')).display !== 'none'
        out.steps = [...document.querySelectorAll('.rm-step-v')].map((e) => e.textContent)
        ;[...document.querySelectorAll('.rm-step-btn')].find((b) => b.querySelector('.rm-step-v')?.textContent === '0.4')?.click()
        await wait(900)
        const box = document.querySelector('.settings-content').getBoundingClientRect()
        out.jumped = Math.abs(document.querySelector('[data-release="0.4.0"]').getBoundingClientRect().top - box.top) < 120
        document.querySelector('.settings-content').scrollTop = 0
        ;[...document.querySelectorAll('.rm-chip')].find((b) => b.textContent.startsWith('Writing'))?.click()
        await wait(200)
        out.writingCards = [...document.querySelectorAll('.rm-card .rm-area')].map((e) => e.textContent)
        ;[...document.querySelectorAll('.rm-chip')].find((b) => b.textContent.startsWith('Everything'))?.click()
        await wait(600)
        return out
      })()`)
      check('roadmap shows planned work as cards', roadmapUi.cards >= 1 && roadmapUi.ideas > 3 && roadmapUi.doing >= 1, roadmapUi)
      check('roadmap timeline lists the releases', roadmapUi.releases.join() === '0.9.0,0.8.0,0.7.0,0.6.0,0.5.0,0.4.0,0.3.0,0.2.0,0.1.0', roadmapUi.releases)
      check(
        'a wide window shows the way to 1.0 beside the roadmap, and a step jumps to its release',
        roadmapUi.wide ? roadmapUi.aside && roadmapUi.steps.join() === '1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1' && roadmapUi.jumped : !roadmapUi.aside,
        roadmapUi
      )
      check('roadmap filters by area', roadmapUi.writingCards.length > 0 && roadmapUi.writingCards.every((a: string) => a === 'Writing'), roadmapUi.writingCards)
      await shot('e2e-roadmap.png')
      win.setSize(size31[0], size31[1])
      await new Promise((r) => setTimeout(r, 300))

      // 32. Writer insights: the first scan is a baseline; growth after it is written today; imports
      // and shrinking aren't writing; characters, pairs and achievements follow.
      await insights.scan()
      let ins = insights.summary()
      check('first scan is a baseline, not writing', ins.written === 0 && ins.today === 0 && ins.storyTotal > 100000 && ins.trackingSince !== null, { written: ins.written, total: ins.storyTotal })
      check('existing manuscripts unlock quietly', ins.achievements.some((a) => a.def.id === 'magnum-opus-2' && a.unlockedAt), ins.achievements.filter((a) => a.unlockedAt).map((a) => a.def.id))
      const growth = Array.from({ length: 60 }, (_, i) => `Wren and Rowan climbed the stair ${i}. "Again?" Rowan asked quietly.`).join('\n\n')
      const tracked = await docs.createDoc('Insights test')
      await docs.writeDoc(tracked.path, 'Wren started here.\n')
      await insights.scan()
      ins = insights.summary()
      check('a new small file counts as written', ins.today === 3, ins.today)
      await docs.writeDoc(tracked.path, `Wren started here.\n\n${growth}\n`)
      await insights.scan()
      ins = insights.summary()
      const grown = 3 + analyzeText(growth).words
      check('growth is booked to today', ins.today === grown && ins.written === grown && ins.activeDays === 1 && ins.streak === 1, { today: ins.today, expected: grown })
      check('the hour of writing is recorded', ins.hours[new Date().getHours()] === grown)
      const importedDoc = await docs.createDoc('Imported novel')
      await docs.writeDoc(importedDoc.path, 'word '.repeat(25000))
      await docs.writeDoc(tracked.path, 'Wren started here.\n')
      await insights.scan()
      ins = insights.summary()
      check('a big new file is an import, and cutting text is not writing', ins.today === grown, ins.today)
      await docs.writeDoc(tracked.path, `Wren started here.\n\n${growth}\n`)
      await insights.scan()
      ins = insights.summary()
      check('writing it back counts again', ins.today === grown + grown - 3, { today: ins.today, grown })
      const pasteDoc = await docs.createDoc('Pasted chapter')
      await insights.scan()
      const beforePaste = insights.summary().today
      await docs.writeDoc(pasteDoc.path, 'paste '.repeat(21000))
      await insights.scan()
      check('pasting a novel into an existing file is not writing', insights.summary().today === beforePaste, { before: beforePaste, after: insights.summary().today })
      await insights.setCharacters([
        { name: 'Wren', aliases: [], color: '' },
        { name: 'Rowan', aliases: ['Ro'], color: '#ffb48a' }
      ])
      ins = insights.summary()
      const wren = ins.characters.find((c) => c.name === 'Wren')
      check('tracked characters are counted', (wren?.mentions ?? 0) >= 60 && ins.characters.find((c) => c.name === 'Rowan')?.mentions === 120 && !!wren?.color, ins.characters)
      check('characters sharing paragraphs are paired', ins.pairs[0]?.a === 'Rowan' && ins.pairs[0]?.b === 'Wren' && ins.pairs[0].scenes >= 60, ins.pairs[0])
      check('writing the same day after a baseline unlocks quietly-earned and new achievements', ins.achievements.some((a) => a.def.id === 'big-day-1' && a.unlockedAt), ins.achievements.filter((a) => a.unlockedAt).map((a) => a.def.id))
      check('style numbers are filled in', ins.style.avgSentence > 0 && ins.style.dialoguePercent > 0 && ins.style.vocabulary > 10 && ins.style.topWords.length > 0)
      check('last 14 days end today', ins.last14.length === 14 && ins.last14.at(-1)?.words === ins.today)

      const insUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[data-mode="insights"]').click()
        await wait(500)
        const page = (label) => [...document.querySelectorAll('.insights-nav-item')].find((b) => b.textContent.startsWith(label))?.click()
        const out = { hero: !!document.querySelector('.ins-hero .ins-hero-n'), tabs: document.querySelectorAll('.insights-nav-item').length, stats: [...document.querySelectorAll('.ins-stat-label')].map((e) => e.textContent), bars: document.querySelectorAll('.ins-bar').length }
        page('Heatmap'); await wait(300)
        out.heatCells = document.querySelectorAll('.heatmap-cell.l4, .heatmap-cell.l3, .heatmap-cell.l2, .heatmap-cell.l1').length - 4
        page('Word analysis'); await wait(300)
        out.topWords = document.querySelectorAll('.word-bars li').length
        page('Characters'); await wait(300)
        out.characters = [...document.querySelectorAll('.char-name')].map((e) => e.textContent)
        out.pairs = document.querySelectorAll('.pair-list li').length
        page('Achievements'); await wait(300)
        out.achievements = document.querySelectorAll('.ach').length
        out.unlocked = document.querySelectorAll('.ach-on').length
        page('Dashboard'); await wait(500)
        return out
      })()`)
      check('insights pages listed', insUi.tabs === 9, insUi.tabs)
      check('dashboard shows today, the stat cards and 14 bars', insUi.hero === true && insUi.stats.includes('Best day') && insUi.bars === 14, insUi)
      check('heatmap marks today', insUi.heatCells >= 1, insUi.heatCells)
      check('word analysis lists words', insUi.topWords > 0, insUi.topWords)
      check('characters page shows screen time and pairs', insUi.characters.join() === 'Rowan,Wren' && insUi.pairs >= 1, insUi)
      check('achievements page shows every achievement', insUi.achievements === ACHIEVEMENTS.length && insUi.unlocked >= 2, insUi)
      await shot('e2e-insights.png')

      // 33. Models start hidden once you've chosen any; the Tools menu and its hover help.
      const mockConfig = providers.getProvider('mock')
      providers.saveProvider({ ...mockConfig, shownModels: ['mock-a'] })
      const optIn = await providers.listModels(true)
      check('only chosen models are shown', optIn.find((m) => m.id === 'mock-a')?.hidden === false && optIn.find((m) => m.id === 'mock-b')?.hidden === true)
      check('new installs start with every model hidden', providers.getProvider('anthropic').shownModels?.length === 0)
      providers.saveProvider({ ...mockConfig })
      await providers.listModels(true)
      const c8 = chat.create(null).id
      chat.send(contents, c8, 'Tools test')
      await idle(c8)
      await reloadUi()
      const toolsUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[data-mode="chat"]').click()
        await wait(200)
        ;[...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('Tools test'))?.click()
        await wait(400)
        const choices = document.querySelector('[aria-label="Choice cards"]')
        choices.closest('.hint-wrap').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        choices.closest('.hint-wrap').dispatchEvent(new MouseEvent('mouseenter'))
        await wait(700)
        const out = { hint: document.querySelector('.hint')?.textContent ?? null }
        choices.closest('.hint-wrap').dispatchEvent(new MouseEvent('mouseleave'))
        ;[...document.querySelectorAll('.tools-menu button')].find((b) => b.textContent.includes('Tools'))?.click()
        await wait(200)
        out.rows = [...document.querySelectorAll('.tools-row .tools-label')].map((e) => e.textContent)
        const row = (label) => [...document.querySelectorAll('.tools-row')].find((r) => r.textContent.includes(label))?.querySelector('input')
        row('Choice cards').click()
        await wait(300)
        row('Choice menu tool').click()
        await wait(300)
        return out
      })()`)
      check('Choices explains itself on hover', /Choice cards/.test(toolsUi.hint ?? '') && /Tools/.test(toolsUi.hint ?? ''), toolsUi.hint)
      check('Tools menu lists the choice switches', toolsUi.rows.includes('Choice cards') && toolsUi.rows.some((r: string) => r.startsWith('Choice menu tool')), toolsUi.rows)
      const c8settings = chat.view(c8).settings
      check('Tools menu turns on the choice tool', c8settings.choiceCards && c8settings.choiceTool, { cards: c8settings.choiceCards, tool: c8settings.choiceTool })
      await shot('e2e-tools.png')

      // 34. Insights AI pages: deep scan in chunks (cached by text), quick sample, focus, notes;
      // reports; and the Ultraviolet theme.
      insightsAi.setConfig({ providerId: 'mock', modelId: 'mock-a', effort: null, parallel: 4 })
      const est1 = await insightsAi.estimate('deep', '')
      check('deep scan estimate counts chunks plus the closing call', est1.calls >= 3 && est1.cached === 0 && est1.words > 100000, est1)
      const beforeDeep = log.length
      let aiState = await insightsAi.runStory('deep', '')
      const deep = aiState.story['']
      const deepCalls = log.length - beforeDeep
      check('deep scan reads every chunk, then writes the themes', deepCalls === est1.calls && deep?.mode === 'deep' && !aiState.error, { deepCalls, error: aiState.error })
      check('content breakdown sums to 100', Math.abs((deep?.breakdown ?? []).reduce((a, b) => a + b.percent, 0) - 100) < 0.5 && deep?.breakdown[0]?.name === 'Drama', deep?.breakdown)
      check('genres, tags and themes merged', (deep?.genres.length ?? 0) >= 2 && deep?.tags[0]?.subtags.length > 0 && deep?.themes.length === 2 && !!deep?.summary, deep)
      const est2 = await insightsAi.estimate('deep', '')
      check('a rescan only pays for text that changed', est2.cached === est1.calls - 1 && est2.calls === 1, est2)
      // An edit near the top of a long manuscript changes the part it's in, not every part after it.
      const bigText = (await docs.readDoc(big.path)).text
      await docs.writeDoc(big.path, `A new opening line, added after the scan.\n\n${bigText}`)
      const est3 = await insightsAi.estimate('deep', '')
      check('an early edit re-reads one part, not the rest', est3.calls <= 3 && est3.cached >= est1.calls - 3, { calls: est3.calls, cached: est3.cached, total: est1.calls - 1 })
      await docs.writeDoc(big.path, bigText)
      check('the parallel setting is kept', insightsAi.state().config.parallel === 4)
      const beforeQuick = log.length
      aiState = await insightsAi.runStory('quick', '')
      check('quick sample is one call', log.length - beforeQuick === 1 && aiState.story['']?.mode === 'quick' && aiState.story['']?.genres[0]?.name === 'Fantasy', aiState.story[''])
      aiState = await insightsAi.runFocus()
      check('focus gives areas with evidence and an exercise', (aiState.focus?.areas.length ?? 0) === 2 && !!aiState.focus?.areas[0].exercise && aiState.focus.areas[0].evidence.length === 1, aiState.focus)
      const beforeNotes = log.length
      aiState = await insightsAi.runNotes()
      const notesReq = JSON.stringify(log[beforeNotes]?.messages ?? [])
      check('insights notes come back', (aiState.notes?.observations.length ?? 0) === 2 && !!aiState.notes?.nextStep, aiState.notes)
      check('insights notes send numbers, not manuscript text', notesReq.includes('words written') && !notesReq.includes('Wren started here') && !notesReq.includes('climbed the stair'))
      const hist = insightsAi.state().history
      check('earlier results are kept', hist.story.length === 2 && hist.story[0].mode === 'quick' && hist.story[1].mode === 'deep' && hist.focus.length === 1 && hist.notes.length === 1, { story: hist.story.length })
      check('an earlier result can be removed', insightsAi.forget('story', hist.story[1].at).history.story.length === 1 && !!insightsAi.state().story[''])
      await insightsAi.runStory('quick', '')
      const reportFile = await reports.exportReport('week', true)
      const reportHtml = await readFile(reportFile, 'utf8')
      check('a report is one self-contained file', reportHtml.includes('Week in Writing') && !/<script/i.test(reportHtml) && !/https?:\/\//.test(reportHtml.replace(/xmlns="[^"]*"/g, '')), reportFile)
      check('reports include saved AI notes on request', reportHtml.includes('Steady mornings'))
      const allTime = await reports.exportReport('all', false)
      check('reports leave AI out unless asked', !(await readFile(allTime, 'utf8')).includes('Steady mornings'))

      await reloadUi()
      const aiUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[data-mode="insights"]').click()
        await wait(300)
        const page = (label) => [...document.querySelectorAll('.insights-nav-item')].find((b) => b.textContent.startsWith(label))?.click()
        page('Story analysis'); await wait(600)
        const out = { donut: document.querySelectorAll('.donut circle').length, themes: document.querySelectorAll('.theme-card').length, estimate: document.querySelector('.ai-run .field-note')?.textContent ?? '' }
        document.querySelector('.tag-head')?.click(); await wait(100)
        out.subtags = document.querySelectorAll('.tag-subs .word-chip').length
        page('Focus'); await wait(300)
        out.focus = document.querySelectorAll('.focus-card').length
        page('Insights'); await wait(300)
        out.notes = document.querySelectorAll('.theme-card').length
        page('Reports'); await wait(300)
        out.reports = document.querySelectorAll('.report-card').length
        document.querySelector('.rail [data-rail="settings"]').click(); await wait(300)
        ;[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('General'))?.click(); await wait(200)
        ;[...document.querySelectorAll('.theme-option')].find((b) => b.textContent.includes('Ultraviolet'))?.click(); await wait(300)
        out.theme = document.documentElement.dataset.theme ?? 'twilight'
        out.night = getComputedStyle(document.documentElement).getPropertyValue('--night').trim()
        return out
      })()`)
      check('story page shows the latest run: donut, themes and tags', aiUi.donut === 2 && aiUi.themes === 1 && aiUi.subtags > 0 && /parts already read/.test(aiUi.estimate), aiUi)
      check('focus, insights and reports pages render', aiUi.focus === 2 && aiUi.notes === 2 && aiUi.reports === 4, aiUi)
      check('Ultraviolet theme applies', aiUi.theme === 'ultraviolet' && aiUi.night === '#0c0614', aiUi)
      await shot('e2e-ultraviolet.png')
      await win.webContents.executeJavaScript(`[...document.querySelectorAll('.theme-option')].find((b) => b.textContent.includes('Twilight'))?.click()`)

      // 35. The first-run welcome, replayed from Settings → About: intro, a local model found and
      // ticked, the writing folder, a look, done.
      const welcome = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('About'))?.click(); await wait(200)
        ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Replay the welcome')?.click(); await wait(400)
        const out = { open: !!document.querySelector('.welcome'), wordmark: document.querySelector('.wl-wordmark')?.textContent ?? null }
        document.querySelector('.wl-begin').click(); await wait(300)
        out.modelTitle = document.querySelector('.wl-title')?.textContent ?? null
        ;[...document.querySelectorAll('.wl-choice')].find((b) => b.textContent.includes('On this computer'))?.click(); await wait(100)
        ;[...document.querySelectorAll('.wl-connect button')][0]?.click()
        for (let i = 0; i < 100 && !document.querySelector('.wl-status'); i++) await wait(50)
        out.status = document.querySelector('.wl-status')?.textContent ?? null
        for (let i = 0; i < 60 && !document.querySelector('.wl-model input'); i++) await wait(50)
        out.models = [...document.querySelectorAll('.wl-model span')].map((e) => e.textContent)
        const next = () => [...document.querySelectorAll('.wl-foot button')].find((b) => b.textContent === 'Next')?.click()
        next(); await wait(400)
        out.folder = document.querySelector('.wl-folder-path')?.textContent ?? null
        next(); await wait(300)
        ;[...document.querySelectorAll('.wl-themes .theme-option')].find((b) => b.textContent.includes('Ultraviolet'))?.click(); await wait(100)
        out.theme = document.documentElement.dataset.theme ?? 'twilight'
        ;[...document.querySelectorAll('.wl-themes .theme-option')].find((b) => b.textContent.includes('Twilight'))?.click(); await wait(100)
        next(); await wait(300)
        out.done = document.querySelector('.wl-title')?.textContent ?? null
        out.tips = document.querySelectorAll('.wl-tip').length
        ;[...document.querySelectorAll('.wl-foot button')].find((b) => b.textContent === 'Start writing')?.click(); await wait(300)
        out.closed = !document.querySelector('.welcome')
        return out
      })()`)
      check('the welcome opens with the intro', welcome.open && welcome.wordmark === 'Twilight', welcome)
      check('the welcome finds a local model server', welcome.modelTitle === 'Connect a model' && /Found/.test(welcome.status ?? '') && welcome.models.length >= 2, welcome)
      check('the welcome shows the writing folder and themes', !!welcome.folder && welcome.theme === 'ultraviolet', welcome)
      check('the welcome finishes with tips and closes', welcome.done === "You're all set" && welcome.tips === 4 && welcome.closed, welcome)
      check('finishing the welcome remembers it', db.kvGet<boolean>('welcomed') === true)

      // 28. Message actions: delete one, delete below, view, restore (also after writing more), edit, tok/s.
      const c5 = chat.create(null).id
      for (const t of ['one', 'two', 'three']) {
        chat.send(contents, c5, t)
        await idle(c5)
      }
      let p5 = chat.view(c5).path
      const [, a1, u2, , u3] = p5
      check('ttft recorded for tok/s', typeof p5[1].usage?.ttftMs === 'number' && p5[1].usage.ttftMs >= 0, p5[1].usage)
      chat.deleteMessage(c5, a1.id, 'single')
      p5 = chat.view(c5).path
      check('delete one message keeps the rest', p5.length === 5 && p5[1].id === u2.id && p5[3].id === u3.id, p5.map((n) => n.id))
      let dels = chat.listDeletions(c5)
      check('deletion listed', dels.length === 1 && dels[0].count === 1 && dels[0].role === 'assistant', dels)
      chat.restoreDeletion(c5, dels[0].id)
      p5 = chat.view(c5).path
      check('restore puts it back in place', p5.length === 6 && p5[1].id === a1.id && p5[2].id === u2.id, p5.map((n) => n.id))
      check('restored deletion leaves the list', chat.listDeletions(c5).length === 0)
      chat.deleteMessage(c5, u2.id, 'below')
      p5 = chat.view(c5).path
      dels = chat.listDeletions(c5)
      check('delete below clears everything under it', p5.length === 2 && p5[1].id === a1.id, p5.length)
      check('delete below counts what it took', dels[0]?.kind === 'below' && dels[0]?.count === 4, dels)
      check('a deletion can be read', chat.viewDeletion(c5, dels[0].id).length === 4)
      chat.send(contents, c5, 'four')
      await idle(c5)
      chat.restoreDeletion(c5, dels[0].id)
      p5 = chat.view(c5).path
      check('restore after writing more comes back as a version', p5.length === 6 && p5[2].id === u2.id && p5[2].siblingCount === 2, { len: p5.length, sib: p5[2]?.siblingCount })
      const before28 = log.length
      chat.editMessage(contents, c5, u3.id, 'three, edited')
      await idle(c5)
      p5 = chat.view(c5).path
      check('editing a message makes a new version and replies', p5.at(-2)?.text === 'three, edited' && p5.at(-2)?.siblingCount === 2 && p5.at(-1)?.status === 'done', p5.at(-2))
      check('the edit is what the model sees', [...(log[before28]?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content === 'three, edited')
      const sentBefore = log.length
      chat.editMessage(contents, c5, p5.at(-1)!.id, 'A rewritten reply.')
      p5 = chat.view(c5).path
      check('editing a reply saves it without a request', p5.at(-1)?.text === 'A rewritten reply.' && log.length === sentBefore)

      // The same actions in the interface: trash, right-click menu, undo toast, recently deleted.
      await reloadUi()
      const actionsUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'one')
        row?.click()
        await wait(500)
        const out = { trashButtons: document.querySelectorAll('.delete-btn').length, tokPerSec: [...document.querySelectorAll('.msg-usage')].some((e) => /tok\\/s/.test(e.textContent)) }
        const lastTrash = [...document.querySelectorAll('.delete-btn')].at(-1)
        lastTrash.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await wait(100)
        out.menu = [...document.querySelectorAll('.delete-menu .tw-menu-item')].map((e) => e.textContent)
        document.querySelector('.delete-menu .tw-menu-item').click()
        await wait(400)
        out.toast = document.querySelector('.toast-info')?.textContent ?? null
        const lastReply = () => [...document.querySelectorAll('.tw-msg-ai .md')].at(-1)?.textContent ?? ''
        out.afterDelete = lastReply()
        ;[...document.querySelectorAll('.toast-info button')].find((b) => b.textContent === 'Undo')?.click()
        await wait(400)
        out.afterUndo = lastReply()
        ;[...document.querySelectorAll('.delete-btn')].at(-1).click()
        await wait(400)
        const head = [...document.querySelectorAll('.chat-head button')].find((b) => b.title.startsWith('Recently deleted'))
        out.headCount = head?.textContent ?? null
        head?.click()
        await wait(200)
        out.panelItems = document.querySelectorAll('.deleted-panel .deleted-item').length
        ;[...document.querySelectorAll('.deleted-panel button')].find((b) => b.textContent === 'View')?.click()
        await wait(200)
        out.viewShown = document.querySelectorAll('.deleted-panel .deleted-msg').length
        return out
      })()`)
      check('every message has a trash button', actionsUi.trashButtons >= 6, actionsUi.trashButtons)
      check('tokens per second shown', actionsUi.tokPerSec === true)
      check('right-click offers delete below', actionsUi.menu?.length === 2 && /everything below/.test(actionsUi.menu[1]), actionsUi.menu)
      check('delete shows an undo toast', /Message deleted/.test(actionsUi.toast ?? ''), actionsUi.toast)
      check('undo brings the message back', actionsUi.afterUndo.includes('A rewritten reply.') && !actionsUi.afterDelete.includes('A rewritten reply.'), actionsUi)
      check('recently deleted panel lists and shows deletions', actionsUi.headCount === '1' && actionsUi.panelItems === 1 && actionsUi.viewShown === 1, actionsUi)
      await shot('e2e-deleted.png')

      // 29. Updates: the releases list, a checksum-verified download, a backup first, and
      // rolling back. In tests the installer is never run.
      updates.setUpdateSource(`http://127.0.0.1:${port}/gh`)
      const cur = app.getVersion()
      let us = await updates.check()
      check('update check lists stable releases newest first', us.releases.map((r) => r.version).join() === [bump(cur, 2), bump(cur, 1), cur, bump(cur, -1)].join(), us.releases.map((r) => r.version))
      check('newest release offered', us.latest === bump(cur, 2) && !us.error, us.latest)
      check('running version recorded', us.history.at(-1)?.version === cur)
      let checksumError = ''
      try {
        await updates.install(bump(cur, 2))
      } catch (err) {
        checksumError = String(err)
      }
      us = updates.state()
      check('a download that fails its checksum is refused and discarded', /checksum/.test(checksumError) && !us.cached.includes(bump(cur, 2)), checksumError)
      await updates.install(bump(cur, 1))
      us = updates.state()
      check('update downloads and verifies the installer', !!updates.lastTestInstall()?.endsWith(`Twilight-Setup-${bump(cur, 1)}.exe`) && existsSync(updates.lastTestInstall()!) && us.cached.includes(bump(cur, 1)))
      const backups = await readdir(join(app.getPath('userData'), 'backups'))
      check('database backed up before switching', backups.some((f) => f.endsWith('.db')), backups)
      await updates.install(bump(cur, -1))
      check('rolling back downloads the older installer', !!updates.lastTestInstall()?.endsWith(`Twilight-Setup-${bump(cur, -1)}.exe`))
      check('daily check can be turned off', updates.setAutoCheck(false).autoCheck === false && updates.setAutoCheck(true).autoCheck === true)

      await reloadUi()
      const updUi = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const out = { toast: document.querySelector('.update-toast')?.textContent ?? null, chip: document.querySelector('.update-chip')?.textContent ?? null }
        document.querySelector('.update-chip')?.click()
        await wait(300)
        out.heading = document.querySelector('.settings-content .t-title')?.textContent ?? null
        out.rows = [...document.querySelectorAll('.release-row')].map((r) => r.dataset.version)
        out.installedBadge = document.querySelector('.release-row[data-version="${cur}"]')?.textContent.includes('Installed') ?? false
        out.status = document.querySelector('.update-status-text')?.textContent ?? null
        const rollback = [...document.querySelectorAll('.release-row[data-version="${bump(cur, -1)}"] button')].find((b) => b.textContent === 'Roll back')
        rollback?.click()
        await wait(100)
        out.confirm = [...document.querySelectorAll('.release-row[data-version="${bump(cur, -1)}"] button')].map((b) => b.textContent)
        return out
      })()`)
      check('update toast and sidebar chip appear', /is available/.test(updUi.toast ?? '') && (updUi.chip ?? '').includes(bump(cur, 2)), updUi)
      check('chip opens Settings at Updates', updUi.heading === 'Updates', updUi.heading)
      check('updates page lists newer, current and older versions', updUi.rows.join() === [bump(cur, 2), bump(cur, 1), cur, bump(cur, -1)].join() && updUi.installedBadge, updUi.rows)
      check('updates page says what is available', /is available/.test(updUi.status ?? ''), updUi.status)
      check('rolling back asks to confirm', updUi.confirm.includes(`Roll back to ${bump(cur, -1)}`), updUi.confirm)
      await new Promise((r) => setTimeout(r, 300))
      // A screenshot is a convenience; a capture hiccup shouldn't fail the run.
      await shot('e2e-updates.png')

      // 30. Context meter, branching, choice keys, highlighting, command menu, rebinding, search.
      const c30 = chat.create().id
      chat.updateSettings(c30, { providerId: 'mock', modelId: 'mock-a' })
      chat.send(contents, c30, 'Lanterns along the quay')
      await idle(c30)
      chat.send(contents, c30, 'CODEBLOCK please')
      await idle(c30)
      const p30 = chat.view(c30).path
      const branch = chat.branchToNewChat(c30, p30[1].id)
      const rowsOf = (id: string): db.NodeRow[] => db.activePath(db.getConversation(id), db.loadNodes(id)).slice(1)
      check(
        'branching copies the thread up to the message, byte for byte',
        branch.path.length === 2 && rowsOf(branch.id).every((n, i) => n.content === rowsOf(c30)[i].content && n.text === rowsOf(c30)[i].text) && branch.title.endsWith('(branch)'),
        { len: branch.path.length, title: branch.title }
      )
      check('branching leaves the original alone', chat.view(c30).path.length === 4)
      const before30 = log.length
      chat.send(contents, branch.id, 'And the bridge?')
      await idle(branch.id)
      const sentOrig = log.find((r) => r.messages.some((m) => m.content === 'CODEBLOCK please'))!.messages.slice(0, 3)
      check('a branch sends the same prefix, so it reads the same cache', JSON.stringify(log[before30]?.messages.slice(0, 3)) === JSON.stringify(sentOrig), log[before30]?.messages.slice(0, 3))

      const adv = db.createFolder('Adventure')
      workspaces.updateWorkspace(adv.id, { choiceCards: true })
      check('an adventure workspace starts chats with choice cards on', chat.create(adv.id).settings.choiceCards === true && chat.create(null).settings.choiceCards === false)

      // Search: messages in every chat and every document; nothing from deleted messages.
      const gone = chat.create().id
      chat.send(contents, gone, 'Zephyrine lantern oil')
      await idle(gone)
      chat.deleteMessage(gone, chat.view(gone).path[0].id, 'below')
      const found = await searchAll('lanterns along')
      check('search finds messages across chats', found.chats.length >= 2 && found.chats.every((h) => h.kind === 'chat' && h.snippet.match.toLowerCase() === 'lanterns along'), found.chats.length)
      check('search leaves deleted messages out', (await searchAll('zephyrine')).chatTotal === 0)
      const wrenSearch = await searchAll('wren')
      check('search counts matches in documents', wrenSearch.docs.some((h) => h.kind === 'doc' && h.count >= 60), wrenSearch.docs.map((h) => (h.kind === 'doc' ? [h.path, h.count] : null)))
      // A message on another version comes forward when revealed.
      chat.regenerate(contents, c30, p30[3].id)
      await idle(c30)
      const shown = chat.revealMessage(c30, p30[3].id)
      check('revealing a message switches to its version', shown.path.at(-1)?.id === p30[3].id, shown.path.at(-1)?.siblingIndex)

      // Choice cards answer number keys.
      const c31 = chat.create(adv.id).id
      chat.send(contents, c31, 'Begin')
      await idle(c31)

      await reloadUi()
      const key = async (keyCode: string, modifiers: ('control' | 'shift' | 'alt')[] = []): Promise<void> => {
        // Key events only reach a page with keyboard focus, and another window (someone using
        // the PC) can take it; give it back first, as a real key press would find it.
        if (!win.webContents.isFocused()) {
          // Giving the page focus back can drop it from the field that had it; put it back there.
          await win.webContents.executeJavaScript(`window.__e2eFocus = document.activeElement`)
          win.webContents.focus()
          await win.webContents.executeJavaScript(`(() => { const el = window.__e2eFocus; if (el && el !== document.body && document.activeElement !== el) el.focus() })()`)
        }
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
        await new Promise((r) => setTimeout(r, 250))
      }
      const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
      await js(`(async () => {
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Lanterns along the quay')
        row?.click()
        await new Promise((r) => setTimeout(r, 500))
      })()`)
      const meterUi = await js<{ meter: string | null; hl: number; branchBtns: number }>(`({
        meter: document.querySelector('.cache-bar .ctx-text')?.textContent ?? null,
        hl: document.querySelectorAll('.tw-codeblock .hl-k, .tw-codeblock .hl-c, .tw-codeblock .hl-s').length,
        branchBtns: document.querySelectorAll('.branch-btn').length
      })`)
      check('the context meter shows tokens against the window', /\/ 8\.0k$/.test(meterUi.meter ?? ''), meterUi.meter)
      check('code blocks are highlighted', meterUi.hl >= 3, meterUi.hl)
      check('every reply offers Branch into a new chat', meterUi.branchBtns >= 2, meterUi.branchBtns)
      await js(`document.activeElement?.blur()`)

      await key('K', ['control'])
      const menu = await js<{ open: boolean; items: number }>(`({ open: !!document.querySelector('.palette'), items: document.querySelectorAll('.palette-item').length })`)
      win.webContents.insertText('splt')
      await new Promise((r) => setTimeout(r, 200))
      const filtered = await js<string[]>(`[...document.querySelectorAll('.palette-item .palette-title')].map((e) => e.textContent)`)
      await key('Escape')
      const menuClosed = await js<boolean>(`!document.querySelector('.palette')`)
      check('Ctrl+K opens the command menu', menu.open && menu.items > 10, menu)
      check('the command menu matches letters in order', filtered[0]?.startsWith('Clone into split'), filtered.slice(0, 3))
      check('Esc closes the command menu', menuClosed)

      await key('K', ['control'])
      win.webContents.insertText('ultraviolet')
      await new Promise((r) => setTimeout(r, 150))
      await key('Return')
      check('running a command from the menu works', (await js<string | undefined>(`document.documentElement.dataset.theme`)) === 'ultraviolet')
      await js(`(() => { delete document.documentElement.dataset.theme; localStorage.removeItem('twilight.theme') })()`)

      await key('/', ['control'])
      const sheet = await js<{ groups: number; rows: number }>(`({ groups: document.querySelectorAll('.sheet-group').length, rows: document.querySelectorAll('.sheet-row').length })`)
      check('Ctrl+/ shows the shortcut sheet', sheet.groups >= 4 && sheet.rows >= 15, sheet)
      await key('Escape')

      // Rebind "Toggle sidebar" to Ctrl+Shift+Y, use it, then put it back.
      await key(',', ['control'])
      await js(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button, .settings-nav a')].find((b) => /Keyboard shortcuts/.test(b.textContent))?.click()
        await wait(200)
        document.querySelector('tr[data-command="sidebar"] .keys-actions button:last-child')?.click()
        await wait(100)
      })()`)
      await key('Y', ['control', 'shift'])
      const rebound = await js<string>(`document.querySelector('tr[data-command="sidebar"] .keys-cell')?.textContent ?? ''`)
      const sidebarBefore = await js<boolean>(`!document.querySelector('.app.sidebar-closed')`)
      await key('Y', ['control', 'shift'])
      const sidebarAfter = await js<boolean>(`!document.querySelector('.app.sidebar-closed')`)
      await key('Y', ['control', 'shift'])
      check('a shortcut can be rebound', rebound === 'CtrlShiftY', rebound)
      check('the new shortcut works', sidebarBefore && !sidebarAfter, { sidebarBefore, sidebarAfter })
      await js(`[...document.querySelectorAll('.settings-card button')].find((b) => b.textContent === 'Reset all')?.click()`)
      check('reset puts the shortcuts back', (await js<string>(`document.querySelector('tr[data-command="sidebar"] .keys-cell')?.textContent ?? ''`)) === 'CtrlB')
      await key('Escape')

      // Search everything, then open a result at its message.
      await key('F', ['control', 'shift'])
      win.webContents.insertText('quay')
      await new Promise((r) => setTimeout(r, 600))
      const searchUi = await js<{ hits: number; marks: string[] }>(`({ hits: document.querySelectorAll('.search-hit').length, marks: [...document.querySelectorAll('.search-hit mark')].map((m) => m.textContent) })`)
      check('Ctrl+Shift+F searches every chat as you type', searchUi.hits >= 2 && searchUi.marks.every((m) => m.toLowerCase() === 'quay'), searchUi)
      await key('Return')
      await new Promise((r) => setTimeout(r, 500))
      const opened = await js<{ title: string; flash: boolean }>(`({ title: document.querySelector('.chat-title')?.textContent ?? '', flash: !!document.querySelector('.msg-flash') })`)
      check('a search result opens its chat at the message', /quay/i.test(opened.title) && opened.flash, opened)

      // Number keys pick a choice; More options asks for others.
      await js(`(async () => {
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Begin')
        row?.click()
        await new Promise((r) => setTimeout(r, 500))
        document.activeElement?.blur()
      })()`)
      const cardUi = await js<{ more: boolean; hint: string }>(`({ more: !!document.querySelector('.choice-more'), hint: document.querySelector('.choice-keys')?.textContent ?? '' })`)
      await key('2')
      await idle(c31)
      const picked = chat.view(c31).path
      check('a number key picks that choice', picked.at(-2)?.text === 'Wait in the rain' && picked.at(-1)?.status === 'done', picked.at(-2)?.text)
      check('choice cards offer More options and say which keys pick', cardUi.more && /1–9/.test(cardUi.hint), cardUi)
      await new Promise((r) => setTimeout(r, 400))
      await js(`document.querySelector('.choice-more')?.click()`)
      await new Promise((r) => setTimeout(r, 100))
      await idle(c31)
      check('More options asks the model for others', chat.view(c31).path.at(-2)?.text === 'Give me a few different options.', chat.view(c31).path.at(-2)?.text)
      await shot('e2e-choicekeys.png')

      // 31. Images and PDFs: sent as the files themselves, in each provider's format.
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const pdf = Buffer.from('%PDF-1.4\n% Twilight test\n').toString('base64')
      const c32 = chat.create().id
      const before32 = log.length
      chat.send(contents, c32, 'What is in these?', 'a', [
        { name: 'dot.png', text: '', kind: 'image', mediaType: 'image/png', data: png },
        { name: 'map.pdf', text: '', kind: 'pdf', mediaType: 'application/pdf', data: pdf }
      ])
      await idle(c32)
      const mediaMsg = log[before32]?.messages.at(-1) as unknown as { content: { type: string; image_url?: { url: string }; file?: { filename: string; file_data: string }; text?: string }[] }
      const parts = Array.isArray(mediaMsg?.content) ? mediaMsg.content : []
      check(
        'images and PDFs go to OpenAI-compatible servers as content parts',
        parts[0]?.image_url?.url === `data:image/png;base64,${png}` && parts[1]?.file?.filename === 'map.pdf' && parts[1]?.file?.file_data.endsWith(pdf) && parts[2]?.text === 'What is in these?',
        parts.map((p) => p.type)
      )
      const c32view = chat.view(c32)
      check('attached files are listed on the message by kind', c32view.path[0].attachments?.map((a) => a.kind).join() === 'image,pdf' && c32view.path[1].status === 'done', c32view.path[0].attachments)
      const c32rows = rowsOf(c32)
      const mediaClaude = toMessages(c32rows)
      check(
        'Claude gets image and document blocks as stored',
        mediaClaude[0].content[0].type === 'image' && (mediaClaude[0].content[1] as { source?: { data?: string } }).source?.data === pdf && mediaClaude[0].content[2].type === 'text'
      )
      chat.send(contents, c32, 'And now?')
      await idle(c32)
      const again = log.at(-1)?.messages.find((m) => Array.isArray(m.content)) as unknown as { content: unknown[] } | undefined
      check('a later turn replays the same parts, so the cache holds', JSON.stringify(again?.content) === JSON.stringify(mediaMsg?.content))

      // Dropping an image on the composer attaches it, with a thumbnail.
      await key('N', ['control'])
      const dropUi = await js<{ chips: number; thumb: boolean; size: string }>(`(async () => {
        const bin = atob(${JSON.stringify(png)})
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
        const dt = new DataTransfer()
        dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }))
        const box = document.querySelector('.tw-composer')
        box.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
        box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
        await new Promise((r) => setTimeout(r, 300))
        return { chips: document.querySelectorAll('.tw-attach .attach-chip').length, thumb: !!document.querySelector('.tw-attach img.attach-thumb'), size: document.querySelector('.tw-attach .attach-size')?.textContent ?? '' }
      })()`)
      check('dropping an image on the composer attaches it with a thumbnail', dropUi.chips === 1 && dropUi.thumb && /B$/.test(dropUi.size), dropUi)
      const before33 = log.length
      await js(`document.querySelector('.tw-send')?.click()`)
      await new Promise((r) => setTimeout(r, 300))
      for (let i = 0; i < 100 && log.length === before33; i++) await new Promise((r) => setTimeout(r, 30))
      const dropped = log[before33]?.messages.at(-1) as unknown as { content: { image_url?: { url: string } }[] } | undefined
      check('a dropped image is sent', Array.isArray(dropped?.content) && dropped.content[0]?.image_url?.url === `data:image/png;base64,${png}`, dropped?.content)
      await new Promise((r) => setTimeout(r, 500))

      // 32. Document folders: rename and remove, with contexts following and insights unfooled.
      await docs.createDocFolder('Drafts e2e/Act one')
      const scene1 = await docs.createDoc('Harbour', 'Drafts e2e/Act one')
      await docs.writeDoc(scene1.path, 'Wren counted the boats twice before dawn.\n')
      docs.setDocContext(scene1.path, { instructions: 'Keep it quiet.', references: [], wholeManuscript: false })
      await insights.scan()
      const todayBefore = insights.summary().today
      const renamedFolder = await docs.renameDocFolder('Drafts e2e', 'Second draft e2e')
      const movedScene = `${renamedFolder}/Act one/Harbour.md`
      const listedAfter = (await docs.listDocs()).map((d) => d.path)
      check('renaming a folder keeps its documents', renamedFolder === 'Second draft e2e' && listedAfter.includes(movedScene) && !listedAfter.some((p) => p.startsWith('Drafts e2e/')), listedAfter.filter((p) => p.includes('e2e')))
      check('a document keeps its context through a folder rename', docs.getDocContext(movedScene).instructions === 'Keep it quiet.')
      await insights.scan()
      check('moving or renaming files is not counted as writing', insights.summary().today === todayBefore, { before: todayBefore, after: insights.summary().today })
      const renamedDoc = await docs.renameDoc(movedScene, 'Harbour at dawn')
      check('renaming a document keeps its context', renamedDoc.endsWith('/Harbour at dawn.md') && docs.getDocContext(renamedDoc).instructions === 'Keep it quiet.', renamedDoc)
      check('renames never overwrite', await docs.renameDocFolder(renamedFolder, 'Second draft e2e').then(() => true) && (await docs.createDocFolder('Taken e2e')) === 'Taken e2e' && (await docs.renameDocFolder(renamedFolder, 'Taken e2e').then(() => false, () => true)))
      await docs.trashDocPath(renamedFolder, 'folder')
      const recycled = await readdir(join(app.getPath('userData'), 'e2e-recycled'))
      check('removing a folder sends it to the bin with everything in it', !(await docs.listDocs()).some((d) => d.path.startsWith(`${renamedFolder}/`)) && recycled.some((f) => f.endsWith('Second draft e2e')) && docs.getDocContext(renamedDoc).instructions === '', recycled)

      const gameDoc = await docs.createDoc('Game e2e')
      await docs.writeDoc(gameDoc.path, 'One line.\n\nTwo lines.\n')

      // The sidebar: rename a folder in place, and removal asks before it acts.
      await reloadUi()
      await key('2', ['control'])
      const folderUi = await js<{ asked: string; stillThere: boolean; renamed: boolean }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const head = () => document.querySelector('.folder-head[data-folder="Taken e2e"]')
        for (let i = 0; i < 60 && !head(); i++) await wait(50)
        head().querySelector('[aria-label^="Rename"]').click()
        await wait(100)
        const input = head().querySelector('input.name-input')
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(input, 'Kept e2e')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
        await wait(600)
        const kept = document.querySelector('.folder-head[data-folder="Kept e2e"]')
        kept.querySelector('[aria-label^="Remove"]').click()
        await wait(100)
        const asked = kept.querySelector('.remove-confirm')?.textContent ?? ''
        return { asked, stillThere: !!document.querySelector('.folder-head[data-folder="Kept e2e"]'), renamed: !!kept }
      })()`)
      check('folders rename in the sidebar, and removing asks first', folderUi.renamed && folderUi.asked === 'Move to Recycle Bin' && folderUi.stillThere, folderUi)
      const undoRename = await js<string>(`document.querySelector('.toast-info')?.textContent ?? ''`)
      check('a rename offers undo', /Renamed to Kept e2e/.test(undoRename), undoRename)

      // Game Format for a whole chat, and in the editor.
      await clipboard.writeText('')
      await js(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('.doc-item[data-path="Game e2e.md"]')?.click()
        await wait(600)
        ;[...document.querySelectorAll('.chat-head button')].find((b) => b.textContent === 'Game Format')?.click()
        await wait(200)
      })()`)
      const editorCopy = await clipboard.readText()
      check('the editor copies a document in Game Format', editorCopy.trim() === 'One line.\nTwo lines.', editorCopy)

      // Undo: a chat moved to the trash comes back.
      await key('1', ['control'])
      await js(`(async () => {
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Lanterns along the quay')
        row?.click()
        await new Promise((r) => setTimeout(r, 400))
      })()`)
      await key('K', ['control'])
      win.webContents.insertText('copy the chat for a game')
      await new Promise((r) => setTimeout(r, 150))
      await key('Return')
      await new Promise((r) => setTimeout(r, 200))
      const chatCopy = await clipboard.readText()
      check('a whole chat copies in Game Format', chatCopy.includes('replying to "Lanterns along the quay"') && chatCopy.includes('list:\n- one') && chatCopy.includes('Done.\nHere it is:') && chatCopy.includes('const lamps = 9'), chatCopy.slice(0, 300))
      const undoUi = await js<{ toast: string; back: boolean }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[aria-label="Move Lanterns along the quay (branch) to the trash"]')?.click()
        await wait(400)
        const toast = document.querySelector('.toast-info')?.textContent ?? ''
        ;[...document.querySelectorAll('.toast-info button')].find((b) => b.textContent === 'Undo')?.click()
        await wait(500)
        return { toast, back: [...document.querySelectorAll('.tw-conv-title')].some((t) => t.textContent === 'Lanterns along the quay (branch)') }
      })()`)
      check('moving a chat to the trash offers undo, and undo brings it back', /moved to the trash/.test(undoUi.toast) && undoUi.back, undoUi)

      // The document picker attaches a document's text.
      await js(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[aria-label="Attach a document from the writing folder"]')?.click()
        await wait(200)
      })()`)
      win.webContents.insertText('game e2e')
      await new Promise((r) => setTimeout(r, 200))
      await key('Return')
      const pickedDoc = await js<string[]>(`[...document.querySelectorAll('.tw-attach .attach-chip')].map((c) => c.textContent)`)
      check('the document picker attaches a document from the writing folder', pickedDoc.length === 1 && pickedDoc[0].startsWith('Game e2e.md'), pickedDoc)

      // 33. Every theme in the picker applies its own colours and frame.
      await key(',', ['control'])
      const themesUi = await js<{ options: string[]; nights: Record<string, string> }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        await wait(200)
        const options = [...document.querySelectorAll('.theme-option')].map((o) => o.dataset.themeId)
        const nights = {}
        for (const id of ${JSON.stringify(THEMES.map((t) => t.id).filter((id) => id !== 'twilight'))}) {
          document.querySelector('.theme-option[data-theme-id="' + id + '"]')?.click()
          await wait(120)
          nights[id] = getComputedStyle(document.documentElement).getPropertyValue('--night').trim()
        }
        return { options, nights }
      })()`)
      const frameTheme = db.kvGet<string>('theme')
      // A look at each new theme on a chat, for the record.
      await key('1', ['control'])
      await new Promise((r) => setTimeout(r, 300))
      for (const id of ['phosphor', 'nightshade', 'ember', 'midnight', 'synthwave', 'aurora', 'campfire', 'moonlit', 'contrast']) {
        await js(`(() => { document.documentElement.dataset.theme = '${id}' })()`)
        await new Promise((r) => setTimeout(r, 250))
        await shot(`e2e-theme-${id}.png`)
      }
      // The light theme: every piece of visible text on the main screens is measured against the
      // background actually behind it, so anything still coloured for a dark theme shows up.
      const audit33 = `(() => {
        // Mixed colours come back as color(srgb r g b / a), with channels from 0 to 1.
        const rgb = (s) => { const m = (s.match(/[\\d.]+/g) ?? ['0', '0', '0', '0']).map(Number); return s.startsWith('color(') ? [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1] : m }
        const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
        const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        const ground = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const c = rgb(getComputedStyle(e).backgroundColor)
            if ((c[3] ?? 1) > 0.5) return c
          }
          return rgb(getComputedStyle(document.body).backgroundColor)
        }
        const bad = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement
          if (!n.textContent.trim() || !el || el.closest('.backdrop, [aria-hidden="true"], .rm-hero, .ins-hero, .welcome')) continue
          const r = el.getBoundingClientRect()
          if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue
          const s = getComputedStyle(el)
          if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue
          const [a, b] = [lum(rgb(s.color)), lum(ground(el))].sort((x, y) => y - x)
          const ratio = (a + 0.05) / (b + 0.05)
          if (ratio < 4.5) bad.push(el.className.toString().slice(0, 40) + ' "' + n.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2))
        }
        return bad
      })()`
      await js(`(() => { document.documentElement.dataset.theme = 'moonlit' })()`)
      await new Promise((r) => setTimeout(r, 300))
      const lowChat33 = await js<string[]>(audit33)
      await key(',', ['control'])
      const lowSettings33: string[] = []
      for (const page of ['General', 'Data', 'Tools', 'Roadmap']) {
        lowSettings33.push(
          ...(await js<string[]>(`(async () => {
            ;[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === ${JSON.stringify(page)})?.click()
            await new Promise((r) => setTimeout(r, 500))
            return ${audit33}.map((x) => ${JSON.stringify(page)} + ': ' + x)
          })()`))
        )
      }
      await shot('e2e-theme-moonlit-settings.png')
      check('Moonlit Paper: every visible text reads at 4.5:1 or better', lowChat33.length === 0 && lowSettings33.length === 0, [...lowChat33, ...lowSettings33].slice(0, 20))
      await key(',', ['control'])
      await js(`(async () => {
        await new Promise((r) => setTimeout(r, 200))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        await new Promise((r) => setTimeout(r, 200))
        document.querySelector('.theme-option[data-theme-id="twilight"]')?.click()
      })()`)
      check('the picker lists every theme, and your own', themesUi.options.join() === [...THEMES.map((t) => t.id), 'custom'].join(), themesUi.options)
      check('every theme applies its own colours', THEMES.filter((t) => t.id !== 'twilight').every((t) => themesUi.nights[t.id] === t.night), themesUi.nights)
      check('the window frame follows the theme', frameTheme === THEMES.at(-1)!.id, frameTheme)
      await key(',', ['control'])
      const builderUi = await js<{ builder: boolean; night: string; iris: string; overlay: string; ratio: number; note: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        await wait(200)
        document.querySelector('.theme-option[data-theme-id="custom"]').click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.theme-builder'); ) await wait(50)
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        const pick = (field, value) => { const el = document.querySelector('.builder-field[data-field="' + field + '"] input'); set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
        pick('ground', '#f0f0f0')
        await wait(100)
        pick('actions', '#202020')
        await wait(200)
        const css = getComputedStyle(document.documentElement)
        const v = (k) => css.getPropertyValue(k).trim()
        const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0) }
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
        return { builder: !!document.querySelector('.theme-builder'), night: v('--night'), iris: v('--iris'), overlay: v('--surface-overlay'), ratio: ratio(v('--iris'), v('--surface-overlay')), note: document.querySelector('.theme-builder .field-note')?.textContent ?? '' }
      })()`)
      const lumOf = (hex: string): number => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
      check('your own theme opens a builder with a live palette', builderUi.builder && db.kvGet<string>('theme') === 'custom' && !!db.kvGet('themeFrame'), builderUi)
      check('a light ground is kept dark, and a dark accent is lightened until it reads at 4.5:1', lumOf(builderUi.night) < 3 * 40 && builderUi.ratio >= 4.5 && /Adjusted to stay readable: ground, actions/.test(builderUi.note), builderUi)
      await js(`[...document.querySelectorAll('.builder-reset')][0]?.click()`)
      await new Promise((r) => setTimeout(r, 300))
      await shot('e2e-theme-builder.png')
      await js(`document.querySelector('.theme-option[data-theme-id="twilight"]')?.click()`)
      await key('Escape')
      await key('Escape')

      // 35. Changing the instructions mid-chat rides in the next message; the system prompt stays.
      const c35 = chat.create().id
      chat.updateSettings(c35, { providerId: 'mock', modelId: 'mock-a', systemPrompt: 'Stay brief.' })
      chat.send(contents, c35, 'First')
      await idle(c35)
      chat.updateSettings(c35, { pendingInstruction: 'Answer in French.' })
      const before35 = log.length
      chat.send(contents, c35, 'Second')
      await idle(c35)
      const instrReq = log[before35]
      const instrUser = instrReq?.messages.at(-1)?.content ?? ''
      check(
        'an instruction change goes into the next message, and the system prompt stays',
        instrReq?.messages[0]?.content === 'Stay brief.' && instrUser.startsWith('<instruction_update>') && instrUser.includes('Answer in French.') && instrUser.endsWith('Second'),
        instrUser.slice(0, 200)
      )
      const v35 = chat.view(c35)
      check('the change is sent once and shown on its message', v35.settings.pendingInstruction === '' && v35.path.at(-2)?.instructionUpdate === 'Answer in French.' && v35.path.at(-2)?.text === 'Second', v35.path.at(-2))
      chat.send(contents, c35, 'Third')
      await idle(c35)
      check('later requests replay it unchanged, so the cache holds', JSON.stringify(log.at(-1)?.messages.slice(0, 4)) === JSON.stringify(instrReq?.messages.slice(0, 4)) && instrReq?.messages.length === 4)

      // 34. The rail: every section with its name; the current one hides and shows the sidebar.
      const railUi = await js<{ labels: string[]; selected: string | null; closed: boolean; railStill: boolean; reopened: boolean; head: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('.rail [data-mode="write"]').click()
        await wait(200)
        const out = {
          labels: [...document.querySelectorAll('.rail .rail-label')].map((e) => e.textContent),
          selected: document.querySelector('.rail [aria-selected="true"] .rail-label')?.textContent ?? null,
          head: document.querySelector('.sidebar .brand')?.textContent ?? ''
        }
        document.querySelector('.rail [data-mode="write"]').click()
        await wait(200)
        out.closed = !!document.querySelector('.app.sidebar-closed')
        out.railStill = document.querySelector('.rail')?.getBoundingClientRect().width > 40
        document.querySelector('.rail [data-mode="write"]').click()
        await wait(200)
        out.reopened = !document.querySelector('.app.sidebar-closed')
        document.querySelector('.rail [data-mode="chat"]').click()
        await wait(200)
        return out
      })()`)
      check('the rail lists every section by name', railUi.labels.join() === 'Chats,Writing,Judge,Insights,Code,Search,Settings' && railUi.selected === 'Writing' && railUi.head === 'Writing', railUi)
      check('the current section on the rail hides and shows the sidebar, and the rail stays', railUi.closed && railUi.railStill && railUi.reopened, railUi)
      await shot('e2e-rail.png')

      // The rail's sections can be dragged into your own order: Writing above Chats, with the
      // others sliding out of the way and an outline where it will land; then back with Alt+Down.
      const railRects34 = await js<{ chat: { x: number; y: number }; write: { x: number; y: number }; slot: number; mode: string }>(`(() => {
        const r = (m) => document.querySelector('.rail-item[data-mode="' + m + '"]').getBoundingClientRect()
        const c = r('chat'), w = r('write')
        return { chat: { x: Math.round(c.left + c.width / 2), y: Math.round(c.top + c.height / 2) }, write: { x: Math.round(w.left + w.width / 2), y: Math.round(w.top + w.height / 2) }, slot: Math.round(w.top - c.top), mode: document.querySelector('.rail-item[aria-selected="true"]')?.dataset.mode ?? '' }
      })()`)
      const { write: from34, slot: slot34 } = railRects34
      win.webContents.sendInputEvent({ type: 'mouseDown', x: from34.x, y: from34.y, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 6; i++) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: from34.x, y: Math.round(from34.y - (slot34 * i) / 6), modifiers: ['leftbuttondown'] })
        await new Promise((r) => setTimeout(r, 30))
      }
      const mid34 = await js<{ held: boolean; chatShift: string; outline: boolean }>(`(async () => {
        await new Promise((r) => setTimeout(r, 250))
        return {
          held: document.querySelector('.rail-item[data-mode="write"]').classList.contains('rail-held'),
          chatShift: document.querySelector('.rail-item[data-mode="chat"]').style.transform,
          outline: !!document.querySelector('.rail-drop')
        }
      })()`)
      win.webContents.sendInputEvent({ type: 'mouseUp', x: from34.x, y: from34.y - slot34, button: 'left', clickCount: 1 })
      const after34 = await js<{ order: string[]; saved: string | null; mode: string }>(`(async () => {
        await new Promise((r) => setTimeout(r, 400))
        return {
          order: [...document.querySelectorAll('.rail-items:not(.rail-foot) .rail-item')].map((b) => b.dataset.mode),
          saved: localStorage.getItem('twilight.railOrder'),
          mode: document.querySelector('.rail-item[aria-selected="true"]')?.dataset.mode ?? ''
        }
      })()`)
      check('dragging a section lifts it, slides the others aside and shows where it will land', mid34.held && mid34.chatShift === `translateY(${slot34}px)` && mid34.outline, mid34)
      check('letting go puts it there and remembers the order', after34.order.join() === 'write,chat,judge,insights,code' && after34.saved === JSON.stringify(after34.order), after34)
      check("a drag doesn't also open the section", after34.mode === railRects34.mode, { before: railRects34.mode, after: after34.mode })
      await js(`document.querySelector('.rail-item[data-mode="write"]').focus()`)
      await key('Down', ['alt'])
      const back34 = await js<string[]>(`(async () => { await new Promise((r) => setTimeout(r, 200)); return [...document.querySelectorAll('.rail-items:not(.rail-foot) .rail-item')].map((b) => b.dataset.mode) })()`)
      check('Alt+Down moves the focused section down the rail', back34.join() === 'chat,write,judge,insights,code', back34)

      // 35. The Judge leaderboard: a running tally by passage label (Elo-style, replayed oldest
      // first), and rounds of more than two passages, every pair judged as its own judgment.
      const judgeBase = {
        authorPrompt: 'Write the harbour at dusk.',
        systemPrompt: 'You are a co-writer.',
        contextDocs: [{ name: 'Harbour.md', text: 'Rowan keeps the harbour lamps.' }],
        extraInstructions: '',
        judgeProviderId: 'mock',
        judgeModelId: 'mock-a',
        effort: null,
        rubricId: 'general-fiction',
        bothOrders: true
      }
      const settled = async (ids: string[]): Promise<void> => {
        for (let i = 0; i < 400 && ids.some((id) => judge.getJudgment(id).runs.some((r) => r.status === 'streaming')); i++) await new Promise((r) => setTimeout(r, 25))
      }
      const strongPassage = 'GOOD: The harbour lamps came on one mooring at a time.'
      const plainPassage = 'The harbour lamps came on.'
      const boardIds = [
        judge.runJudge(contents, { ...judgeBase, title: 'Board 1', passageA: strongPassage, labelA: 'Lark', passageB: plainPassage, labelB: 'Heron' }).id,
        judge.runJudge(contents, { ...judgeBase, title: 'Board 2', passageA: plainPassage, labelA: 'Finch', passageB: strongPassage, labelB: ' Heron ' }).id,
        judge.runJudge(contents, { ...judgeBase, title: 'Board 3', passageA: strongPassage, labelA: 'Lark', passageB: plainPassage, labelB: 'Finch' }).id,
        // Both passages strong: the two orders disagree, so it's too close to call.
        judge.runJudge(contents, { ...judgeBase, title: 'Board 4', passageA: strongPassage, labelA: 'Heron', passageB: strongPassage, labelB: 'Finch' }).id,
        // One side unlabelled: left out of the tally.
        judge.runJudge(contents, { ...judgeBase, title: 'Board 5', passageA: strongPassage, labelA: 'Lark', passageB: plainPassage, labelB: '  ' }).id
      ]
      await settled(boardIds)
      const overallBoard = judge.getLeaderboard()
      const boardRow = (label: string) => overallBoard.entries.find((e) => e.label === label)
      const boardRecord = (label: string): string => {
        const e = boardRow(label)
        return e ? `${e.wins}-${e.losses}-${e.ties}/${e.judgments}` : 'missing'
      }
      check(
        'the leaderboard tallies finished, labelled judgments by label',
        boardRecord('Lark') === '2-0-0/2' && boardRecord('Heron') === '1-1-1/3' && boardRecord('Finch') === '0-2-1/3' && !overallBoard.entries.some((e) => !e.label.trim()),
        overallBoard.entries.map((e) => [e.label, e.wins, e.losses, e.ties, e.judgments])
      )
      check(
        'a too-close call counts as a tie for both',
        computeVerdict(judge.getJudgment(boardIds[3]).rubric, judge.getJudgment(boardIds[3]).runs).winner === 'close' && boardRow('Heron')?.ties === 1 && boardRow('Finch')?.ties === 1
      )
      check(
        'the leaderboard averages the overall score of each label',
        Math.abs((boardRow('Lark')?.averageScore ?? 0) - 8) < 0.01 && Math.abs((boardRow('Heron')?.averageScore ?? 0) - 6.5) < 0.01 && Math.abs((boardRow('Finch')?.averageScore ?? 0) - 5.5) < 0.01,
        [boardRow('Lark')?.averageScore, boardRow('Heron')?.averageScore, boardRow('Finch')?.averageScore]
      )
      // The same Elo replay worked by hand: start 1000, K 24, oldest first, a tie is half a win.
      const elo: Record<string, number> = { Lark: 1000, Heron: 1000, Finch: 1000 }
      for (const [a, b, s] of [['Lark', 'Heron', 1], ['Finch', 'Heron', 0], ['Lark', 'Finch', 1], ['Heron', 'Finch', 0.5]] as const) {
        const d = 24 * (s - 1 / (1 + 10 ** ((elo[b] - elo[a]) / 400)))
        elo[a] += d
        elo[b] -= d
      }
      const birds = overallBoard.entries.filter((e) => e.label in elo)
      check(
        'the leaderboard ranks by an Elo-style rating, replayed oldest first',
        birds.map((e) => e.label).join() === 'Lark,Heron,Finch' && birds.every((e) => Math.abs(e.rating - elo[e.label]) < 0.001),
        birds.map((e) => [e.label, e.rating, elo[e.label]])
      )
      check('ratings are zero-sum', Math.abs(birds.reduce((n, e) => n + e.rating, 0) - 3000) < 0.001)

      let repeatedLabel = ''
      try {
        judge.runRound(contents, { ...judgeBase, title: 'Bad round', passageA: strongPassage, labelA: 'Tern', passageB: plainPassage, labelB: 'Gull', morePassages: [{ passage: plainPassage, label: 'Tern' }] })
      } catch (err) {
        repeatedLabel = String(err)
      }
      check('a round refuses two passages with the same label', /both labelled Tern/.test(repeatedLabel), repeatedLabel)

      const beforeRound = log.length
      const harbourRound = judge.runRound(contents, {
        ...judgeBase,
        title: 'Harbour round',
        passageA: strongPassage,
        labelA: 'Kestrel',
        passageB: plainPassage,
        labelB: 'Plover',
        morePassages: [{ passage: 'The lamps, they came on.', label: 'Swift' }]
      })
      const earlyRound = judge.getLeaderboard(harbourRound.roundId)
      await settled(harbourRound.judgments.map((j) => j.id))
      const roundStored = harbourRound.judgments.map((j) => judge.getJudgment(j.id))
      const roundBoard = judge.getLeaderboard(harbourRound.roundId)
      check(
        'a three-passage round starts three judgments with one round id',
        roundStored.length === 3 &&
          roundStored.every((j) => j.roundId === harbourRound.roundId && j.roundTitle === 'Harbour round' && !('morePassages' in j.input)) &&
          roundStored.map((j) => j.input.title).join('|') === 'Harbour round · Kestrel vs Plover|Harbour round · Kestrel vs Swift|Harbour round · Plover vs Swift',
        roundStored.map((j) => [j.input.title, j.roundId === harbourRound.roundId])
      )
      const roundReqs = log.slice(beforeRound).filter((r) => r.messages[0]?.content.startsWith('You are an exacting fiction editor'))
      const roundSent = roundReqs.map((r) => r.messages.at(-1)?.content ?? '')
      check(
        'each pair is judged blind, in both orders',
        roundReqs.length === 6 && roundStored.every((j) => j.runs.length === 2 && j.runs.every((r) => r.status === 'done')) && !roundSent.some((s) => /Kestrel|Plover|Swift/.test(s)),
        roundStored.map((j) => j.runs.map((r) => [r.status, r.error]))
      )
      check(
        "a round's pairs share one context and wait for the first one's cache",
        roundSent.every((s) => s.split('<passage id="X">')[0] === roundSent[0].split('<passage id="X">')[0]) &&
          roundReqs.slice(1).every((r) => r.startedAt >= (roundReqs[0].firstTokenAt ?? Infinity)),
        roundReqs.map((r) => [r.startedAt, r.firstTokenAt])
      )
      check('a round counts nothing until its pairs finish', earlyRound.running === 3 && earlyRound.counted === 0 && earlyRound.entries.length === 0, earlyRound)
      check(
        "the round's leaderboard ranks only its own passages",
        roundBoard.roundTitle === 'Harbour round' &&
          roundBoard.counted === 3 &&
          roundBoard.judgments.length === 3 &&
          roundBoard.entries.map((e) => e.label).sort().join() === 'Kestrel,Plover,Swift' &&
          roundBoard.entries[0].label === 'Kestrel' &&
          roundBoard.entries[0].wins === 2 &&
          roundBoard.entries.every((e) => e.judgments === 2),
        roundBoard.entries.map((e) => [e.label, e.wins, e.losses, e.ties])
      )
      const plainRound = judge.runRound(contents, { ...judgeBase, title: '', passageA: strongPassage, labelA: '', passageB: plainPassage, labelB: '', morePassages: [{ passage: plainPassage, label: '' }] })
      await settled(plainRound.judgments.map((j) => j.id))
      const plainBoard = judge.getLeaderboard(plainRound.roundId)
      check(
        'an unlabelled round is titled by letter and ranks nothing',
        plainRound.judgments.map((j) => j.input.title).join() === 'A vs B,A vs C,B vs C' && plainBoard.entries.length === 0 && plainBoard.counted === 0 && plainBoard.judgments.length === 3,
        plainRound.judgments.map((j) => j.input.title)
      )

      const boardUi = await js<Record<string, unknown>>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const until = async (fn, ms = 6000) => {
          const end = Date.now() + ms
          while (Date.now() < end) {
            const v = fn()
            if (v) return v
            await wait(50)
          }
          return null
        }
        const setValue = (el, v) => {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const rows = () => [...document.querySelectorAll('.leaderboard .board-table tbody tr[data-label]')].map((r) => ({ label: r.dataset.label, rank: Number(r.dataset.rank), record: r.dataset.record }))
        const out = {}
        document.querySelector('.rail [data-mode="judge"]').click()
        const entry = await until(() => document.querySelector('.judge-board-item'))
        if (!entry) return { step: 'no leaderboard entry' }
        entry.click()
        await until(() => rows().some((r) => r.label === 'Lark'))
        out.overall = rows()
        out.entryCurrent = entry.getAttribute('aria-current')
        out.overallRound = document.querySelector('.leaderboard')?.dataset.round ?? null
        out.note = [...document.querySelectorAll('.leaderboard > p.field-note')].map((p) => p.textContent).join(' ')
        out.title = document.querySelector('.chat-title')?.textContent

        // A round from the form: add passages up to six, take three away, then start it.
        document.querySelectorAll('.sidebar-head .head-actions button')[1].click()
        if (!(await until(() => document.querySelector('.judge-form')))) return { ...out, step: 'no form' }
        out.twoButton = document.querySelector('.judge-run').textContent
        for (let i = 0; i < 4; i++) {
          document.querySelector('.judge-add-passage')?.click()
          await until(() => document.querySelectorAll('.judge-passage').length === 3 + i)
        }
        out.atMost = document.querySelectorAll('.judge-passage').length
        out.addHidden = !document.querySelector('.judge-add-passage')
        for (const side of ['F', 'E', 'D']) {
          document.querySelector('.judge-passage[data-passage="' + side + '"] .judge-passage-remove')?.click()
          await until(() => !document.querySelector('.judge-passage[data-passage="' + side + '"]'))
        }
        out.afterRemove = [...document.querySelectorAll('.judge-passage')].map((p) => p.dataset.passage).join()
        setValue(document.querySelector('.judge-form > label.field input'), 'Pier round')
        await wait(30)
        const fill = [['A', 'GOOD: The pier lamps woke in order.', 'Tern'], ['B', 'The pier lamps came on.', 'Gull'], ['C', 'The lamps on the pier came on.', 'Skua']]
        for (const [side, text, label] of fill) {
          const section = document.querySelector('.judge-passage[data-passage="' + side + '"]')
          setValue(section.querySelector('textarea'), text)
          await wait(30)
          setValue(section.querySelector('.judge-label'), label)
          await wait(30)
        }
        out.roundButton = document.querySelector('.judge-run').textContent
        out.disabled = document.querySelector('.judge-run').disabled
        document.querySelector('.judge-run').click()
        const roundEl = await until(() => {
          const el = document.querySelector('.leaderboard')
          return el && el.dataset.round && rows().length === 3 ? el : null
        }, 8000)
        if (!roundEl) return { ...out, step: 'no round leaderboard', rows: rows(), text: document.querySelector('.judge-scroll')?.textContent?.slice(0, 300) }
        out.roundId = roundEl.dataset.round
        out.round = rows()
        out.roundTitle = document.querySelector('.chat-title')?.textContent
        out.pairs = [...document.querySelectorAll('.board-pair .tw-conv-title')].map((e) => e.textContent)
        await wait(200)
        return out
      })()`)
      check(
        'the Judge sidebar opens the leaderboard, ranked',
        boardUi.entryCurrent === 'true' &&
          boardUi.overallRound === '' &&
          boardUi.title === 'Leaderboard' &&
          (() => {
            const r = (boardUi.overall as { label: string; rank: number; record: string }[] | undefined) ?? []
            const at = (l: string) => r.find((x) => x.label === l)
            return at('Lark')?.record === '2-0-0' && at('Heron')?.record === '1-1-1' && at('Finch')?.record === '0-2-1' && at('Lark')!.rank < at('Heron')!.rank && at('Heron')!.rank < at('Finch')!.rank
          })(),
        boardUi
      )
      check('the leaderboard says how it counts', /Elo-style/.test(String(boardUi.note)) && /both passages are labelled/.test(String(boardUi.note)), boardUi.note)
      check(
        'the form adds passages up to six and removes them',
        boardUi.atMost === 6 && boardUi.addHidden === true && boardUi.afterRemove === 'A,B,C',
        [boardUi.atMost, boardUi.addHidden, boardUi.afterRemove]
      )
      check(
        'the run button says how many judgments a round starts',
        boardUi.twoButton === 'Judge (2 runs)' && boardUi.roundButton === 'Start 3 judgments (6 runs)' && boardUi.disabled === false,
        [boardUi.twoButton, boardUi.roundButton]
      )
      const uiRound = (boardUi.round as { label: string; rank: number; record: string }[] | undefined) ?? []
      check(
        "starting a round opens that round's leaderboard",
        boardUi.roundTitle === 'Pier round' &&
          uiRound.map((r) => r.label).sort().join() === 'Gull,Skua,Tern' &&
          uiRound[0]?.label === 'Tern' &&
          uiRound[0]?.record === '2-0-0' &&
          (boardUi.pairs as string[] | undefined)?.join('|') === 'Pier round · Tern vs Gull|Pier round · Tern vs Skua|Pier round · Gull vs Skua' &&
          judge.listJudgments().filter((j) => j.roundId === boardUi.roundId).length === 3,
        boardUi
      )
      await shot('e2e-leaderboard.png')
      const backUi = await js<{ round: string | null; tern: boolean; lark: boolean; title: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('.board-overall')?.click()
        const has = (l) => !!document.querySelector('.leaderboard .board-table tr[data-label="' + l + '"]')
        for (let end = Date.now() + 4000; Date.now() < end && !(document.querySelector('.leaderboard')?.dataset.round === '' && has('Lark')); ) await wait(50)
        return { round: document.querySelector('.leaderboard')?.dataset.round ?? null, tern: has('Tern'), lark: has('Lark'), title: document.querySelector('.chat-title')?.textContent ?? '' }
      })()`)
      check('the round view leads back to the overall leaderboard', backUi.round === '' && backUi.tern && backUi.lark && backUi.title === 'Leaderboard', backUi)

      // 36. Prices: the provider's own figure first, then yours (with * patterns), then the built-in list.
      const u36 = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, ms: 1 }
      setCustomPrices([{ model: 'mock-*', input: 2, output: 10 }])
      check('your price is used for a model it matches, local ones included', Math.abs((costOf('mock-b', u36, true) ?? 0) - 0.007) < 1e-9, costOf('mock-b', u36, true))
      check("a provider's reported cost comes before any price list", costOf('mock-b', { ...u36, costUsd: 0.5 }, true) === 0.5)
      setCustomPrices([{ model: 'claude-opus-5-5', input: 1, output: 1 }])
      check('your price overrides the built-in one', Math.abs((costOf('claude-opus-5-5', u36, false) ?? 0) - 0.0015) < 1e-9 && costOf('claude-sonnet-5-5', u36, false) === (1000 * 2 + 500 * 10) / 1e6)
      setCustomPrices([])
      await key(',', ['control'])
      const priceUi = await js<{ builtIn: number; after: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === 'Prices')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.price-builtin'); ) await wait(50)
        const builtIn = document.querySelectorAll('.price-builtin tbody tr').length
        const usage = () => [...document.querySelectorAll('.msg-usage')].map((e) => e.textContent).join('|')
        ;[...document.querySelectorAll('.settings-card button')].find((b) => /Add a price/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.price-table input.price-model'); ) await wait(50)
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        const fill = (el, v) => { el.focus(); set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
        const inputs = document.querySelectorAll('.price-table tbody tr:last-child input')
        fill(inputs[0], 'mock-a'); fill(inputs[1], '5000'); fill(inputs[2], '5000')
        inputs[2].blur()
        await wait(300)
        document.querySelector('.rail [data-mode="chat"]').click()
        await wait(200)
        ;[...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Begin')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.msg-usage'); ) await wait(50)
        return { builtIn, after: usage() }
      })()`)
      check('the Prices page lists the built-in prices', priceUi.builtIn === BUILT_IN_PRICES.length, priceUi.builtIn)
      check('a price you add re-prices replies on screen', /\$[0-9.]+/.test(priceUi.after) && !/(^|\|)\$0 ·/.test(priceUi.after) && (db.kvGet<{ model: string }[]>('prices') ?? []).some((p) => p.model === 'mock-a'), priceUi.after.slice(0, 200))

      // 37. The library. Personas and prompts are saved, changed and deleted through the app and
      // travel as a file; a persona starts a chat with its prompt, model and choice setting;
      // applied mid-chat as a change from the next message it leaves the earlier messages byte
      // for byte, so the cache holds; a prompt goes into the message box, {{input}} filled first.
      const until = async (done: () => boolean, ms = 6000): Promise<void> => {
        for (const end = Date.now() + ms; Date.now() < end && !done(); ) await new Promise((r) => setTimeout(r, 25))
      }
      const lampPrompt = 'You are a lamplighter who tells short harbour stories.'
      const ferryPrompt = 'Answer as the ferryman would, in one paragraph.'
      const crud = await js<{ saved: number; changed: string; kept: string[]; prompts: number }>(`(async () => {
        const t = window.twilight
        let lib = await t.savePersona({ id: '', name: 'Lamplighter', description: 'Tells harbour stories', systemPrompt: ${JSON.stringify(lampPrompt)}, providerId: 'mock', modelId: 'mock-b', choiceCards: true })
        const lamp = lib.personas.find((p) => p.name === 'Lamplighter')
        await t.savePersona({ id: '', name: 'Ferryman', description: '', systemPrompt: ${JSON.stringify(ferryPrompt)}, providerId: null, modelId: null, choiceCards: false })
        lib = await t.savePersona({ id: '', name: 'Scratch', description: '', systemPrompt: 'Temporary.', providerId: null, modelId: null, choiceCards: false })
        const saved = lib.personas.length
        lib = await t.savePersona({ ...lamp, description: 'Tells harbour stories at dusk' })
        const changed = lib.personas.filter((p) => p.id === lamp.id).map((p) => p.description).join('|')
        lib = await t.deletePersona(lib.personas.find((p) => p.name === 'Scratch').id)
        await t.savePrompt({ id: '', name: 'Describe a place', text: 'Describe {{input}} at dusk, in three sentences.' })
        lib = await t.savePrompt({ id: '', name: 'Plain ask', text: 'What happens next?' })
        return { saved, changed, kept: lib.personas.map((p) => p.name), prompts: lib.prompts.length }
      })()`)
      check(
        'personas save, change in place and delete through the app',
        crud.saved === 3 && crud.changed === 'Tells harbour stories at dusk' && crud.kept.join() === 'Ferryman,Lamplighter' && crud.prompts === 2,
        crud
      )
      const lamp = library.getLibrary().personas.find((p) => p.name === 'Lamplighter')!
      const ferry = library.getLibrary().personas.find((p) => p.name === 'Ferryman')!
      const libFile = library.libraryFile()
      const reread = parseLibrary(libFile, randomUUID)
      const reimported = library.importLibrary(libFile)
      const single = library.importLibrary(JSON.stringify({ name: 'Cartographer', systemPrompt: 'Draw maps in words.' }))
      const refused = (() => {
        try {
          library.importLibrary(JSON.stringify({ personas: [{ name: 'No prompt' }] }))
          return false
        } catch {
          return true
        }
      })()
      check(
        'a library file round-trips; importing replaces by id, takes a single persona, and refuses an empty one',
        JSON.stringify(reread) === JSON.stringify({ personas: [ferry, lamp], prompts: library.getLibrary().prompts }) &&
          reimported.library.personas.length === 2 &&
          single.added === 1 &&
          single.library.personas.length === 3 &&
          refused &&
          JSON.parse(library.libraryFile([lamp.id])).personas.length === 1 &&
          JSON.parse(library.libraryFile([lamp.id])).prompts.length === 0,
        { again: reimported.library.personas.length, single: single.library.personas.length, refused }
      )
      library.deletePersona(single.library.personas.find((p) => p.name === 'Cartographer')!.id)

      // A new chat from a persona, chosen from the command menu.
      const defaultsBefore = chat.getDefaults().modelId
      await js(`document.activeElement?.blur()`)
      await key('K', ['control'])
      win.webContents.insertText('from a persona')
      await new Promise((r) => setTimeout(r, 200))
      await key('Return')
      const chooser = await js<string[]>(`(async () => {
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.persona-chooser .persona-item').length < 2; ) await new Promise((r) => setTimeout(r, 25))
        return [...document.querySelectorAll('.persona-chooser .persona-item .palette-title')].map((e) => e.textContent)
      })()`)
      check('"New chat from a persona…" opens a chooser of your personas', chooser.join() === 'Ferryman,Lamplighter', chooser)
      win.webContents.insertText('lamp')
      await new Promise((r) => setTimeout(r, 200))
      await key('Return')
      const fresh = await js<{ title: string; empty: boolean; choices: string | null }>(`(async () => {
        for (let end = Date.now() + 3000; Date.now() < end && !(document.querySelector('.chat .empty') && !document.querySelector('.persona-chooser')); ) await new Promise((r) => setTimeout(r, 25))
        document.querySelector('.tw-composer textarea')?.focus()
        return { title: document.querySelector('.chat-title')?.textContent ?? '', empty: !!document.querySelector('.chat .empty'), choices: document.querySelector('.tw-composer [aria-label="Choice cards"]')?.getAttribute('aria-pressed') ?? null }
      })()`)
      const before37 = log.length
      win.webContents.insertText('Light the way')
      await key('Return')
      await until(() => log.slice(before37).some((r) => r.messages.at(-1)?.content === 'Light the way'))
      const lampChat = db.listConversations().find((c) => c.title === 'Light the way')
      if (lampChat) await idle(lampChat.id)
      const firstReq = log.slice(before37).find((r) => r.messages.at(-1)?.content === 'Light the way')
      const lampView = lampChat ? chat.view(lampChat.id) : null
      check(
        "a chat from a persona sends its system prompt, with its model and choice cards",
        fresh.empty &&
          fresh.choices === 'true' &&
          firstReq?.model === 'mock-b' &&
          (firstReq?.messages[0]?.content ?? '').startsWith(lampPrompt) &&
          (firstReq?.messages[0]?.content ?? '').includes('Interactive choices:') &&
          lampView?.settings.systemPrompt === lampPrompt &&
          lampView?.settings.choiceCards === true,
        { fresh, model: firstReq?.model, system: firstReq?.messages[0]?.content.slice(0, 80) }
      )
      check("a persona's model is for its chats, not the default for new ones", chat.getDefaults().modelId === defaultsBefore, [defaultsBefore, chat.getDefaults().modelId])

      // Apply another persona in the started chat as a change from the next message.
      const setPersona = (way: 'next' | 'system'): Promise<{ note: string; pending: string; system: string; chip: boolean }> =>
        js(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms))
          if (!document.querySelector('.settings-panel')) [...document.querySelectorAll('.chat-head button')].find((b) => /Model settings/.test(b.textContent))?.click()
          const pick = () => document.querySelector('.settings-panel select[aria-label="Apply a persona"]')
          for (let end = Date.now() + 3000; Date.now() < end && !(pick() && pick().options.length > 2); ) await wait(25)
          const sel = pick()
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, ${JSON.stringify(ferry.id)})
          sel.dispatchEvent(new Event('change', { bubbles: true }))
          for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.persona-ways'); ) await wait(25)
          const note = document.querySelector('.persona-ways .field-note')?.textContent ?? ''
          document.querySelector('.persona-ways [data-way="${way}"]')?.click()
          for (let end = Date.now() + 3000; Date.now() < end && document.querySelector('.persona-ways'); ) await wait(25)
          await wait(150)
          const out = {
            note,
            pending: document.querySelector('.settings-panel .pending-instruction')?.value ?? '',
            system: document.querySelector('.settings-panel textarea[placeholder="Instructions the model follows for this chat"]')?.value ?? '',
            chip: !!document.querySelector('.tw-composer .pending-chip')
          }
          document.querySelector('.settings-panel button[aria-label="Close"]')?.click()
          await wait(100)
          return out
        })()`)
      const asNext = await setPersona('next')
      const pendingView = lampChat ? chat.view(lampChat.id) : null
      check(
        'applying a persona from the next message queues its prompt and keeps the system prompt',
        asNext.pending === ferryPrompt && asNext.chip && pendingView?.settings.pendingInstruction === ferryPrompt && pendingView?.settings.systemPrompt === lampPrompt && /restarts the prompt cache/.test(asNext.note) && /keeps everything before it cached/.test(asNext.note),
        asNext
      )
      const before37b = log.length
      await js(`document.querySelector('.tw-composer textarea')?.focus()`)
      win.webContents.insertText('Second light')
      await key('Return')
      await until(() => log.slice(before37b).some((r) => (r.messages.at(-1)?.content ?? '').endsWith('Second light')))
      if (lampChat) await idle(lampChat.id)
      const secondReq = log.slice(before37b).find((r) => (r.messages.at(-1)?.content ?? '').endsWith('Second light'))
      const secondUser = secondReq?.messages.at(-1)?.content ?? ''
      check(
        'the persona rides in the next message and the earlier messages are sent byte for byte',
        JSON.stringify(secondReq?.messages.slice(0, 2)) === JSON.stringify(firstReq?.messages) &&
          secondReq?.messages.length === 4 &&
          secondUser.startsWith('<instruction_update>') &&
          secondUser.includes(ferryPrompt),
        secondUser.slice(0, 200)
      )
      if (lampChat) {
        chat.send(contents, lampChat.id, 'Third light')
        await idle(lampChat.id)
      }
      check('later requests replay the change unchanged', JSON.stringify(log.at(-1)?.messages.slice(0, 4)) === JSON.stringify(secondReq?.messages.slice(0, 4)) && log.at(-1)?.messages.length === 6)
      const asSystem = await setPersona('system')
      check(
        'applying a persona as the system prompt replaces it, and the panel shows it',
        asSystem.system === ferryPrompt && (lampChat ? chat.view(lampChat.id).settings.systemPrompt === ferryPrompt : false),
        asSystem
      )

      // Prompts go into the message box from the composer, never sent on their own.
      const before37c = log.length
      const promptUi = await js<{ items: string[]; fill: boolean; value: string; closed: boolean }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('.tw-composer button[aria-label="Prompts"]')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.prompt-pop .prompt-item').length < 2; ) await wait(25)
        return { items: [...document.querySelectorAll('.prompt-pop .prompt-item .palette-title')].map((e) => e.textContent), fill: false, value: '', closed: false }
      })()`)
      win.webContents.insertText('describe')
      await new Promise((r) => setTimeout(r, 200))
      await key('Return')
      const fillShown = await js<boolean>(`!!document.querySelector('.prompt-pop .prompt-fill textarea') && document.activeElement === document.querySelector('.prompt-pop .prompt-fill textarea')`)
      win.webContents.insertText('the harbour')
      await key('Return')
      const afterFill = await js<{ value: string; closed: boolean }>(`({ value: document.querySelector('.tw-composer textarea')?.value ?? '', closed: !document.querySelector('.prompt-pop') })`)
      check('the Prompts popover lists your prompts', promptUi.items.join() === 'Describe a place,Plain ask', promptUi.items)
      check(
        'a prompt with {{input}} asks for it, then goes into the message box filled in',
        fillShown && afterFill.closed && afterFill.value === 'Describe the harbour at dusk, in three sentences.',
        { fillShown, ...afterFill }
      )
      await js(`document.activeElement?.blur()`)
      await key('K', ['control'])
      win.webContents.insertText('insert a prompt')
      await new Promise((r) => setTimeout(r, 200))
      await key('Return')
      await js(`(async () => { for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.prompt-pop .prompt-item').length < 2; ) await new Promise((r) => setTimeout(r, 25)) })()`)
      win.webContents.insertText('plain')
      await new Promise((r) => setTimeout(r, 200))
      await key('Return')
      const plainValue = await js<string>(`document.querySelector('.tw-composer textarea')?.value ?? ''`)
      check(
        '"Insert a prompt" opens the popover; a plain prompt goes in at the caret, and nothing is sent',
        plainValue === 'Describe the harbour at dusk, in three sentences.What happens next?' && log.length === before37c,
        { plainValue, sent: log.length - before37c }
      )
      await shot('e2e-prompts.png')
      await js(`(() => {
        const area = document.querySelector('.tw-composer textarea')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, '')
        area.dispatchEvent(new Event('input', { bubbles: true }))
        area.blur()
      })()`)

      // The Library page: both lists, a persona made and deleted (with an undo) from the page.
      await key(',', ['control'])
      const libUi = await js<{ group: string; personas: string[]; prompts: string[]; badges: string; made: boolean; deleted: boolean; undo: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const nav = [...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === 'Library')
        const group = nav?.parentElement?.querySelector('.side-section')?.textContent ?? ''
        nav?.click()
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.library-item').length < 4; ) await wait(25)
        const names = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent)
        const out = {
          group,
          personas: names('.library-item[data-persona] .library-name'),
          prompts: names('.library-item[data-prompt] .library-name'),
          badges: names('.library-item[data-persona] .tw-badge').join('|'),
          made: false, deleted: false, undo: ''
        }
        ;[...document.querySelectorAll('.library-card[data-kind="personas"] button')].find((b) => /New persona/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.library-editor'); ) await wait(25)
        const editor = document.querySelector('.library-editor')
        const fill = (el, v) => {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        fill(editor.querySelector('input'), 'Tide clerk')
        fill(editor.querySelector('textarea'), 'Keep the tide tables.')
        await wait(50)
        editor.querySelector('.tw-btn-primary')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.library-item[data-persona]').length < 3; ) await wait(25)
        out.made = names('.library-item[data-persona] .library-name').includes('Tide clerk')
        document.querySelector('.library-item[data-persona] button[aria-label="Delete Tide clerk"]')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.library-item[data-persona]').length > 2; ) await wait(25)
        out.deleted = !names('.library-item[data-persona] .library-name').includes('Tide clerk')
        out.undo = document.querySelector('.toast')?.textContent ?? ''
        return out
      })()`)
      check(
        'the Library page lists personas and prompts under App',
        libUi.group === 'App' && libUi.personas.join() === 'Ferryman,Lamplighter' && libUi.prompts.join() === 'Describe a place,Plain ask' && /Mock B|mock-b/i.test(libUi.badges) && /Choices/.test(libUi.badges),
        libUi
      )
      check(
        'a persona made on the Library page is saved, and deleting it offers an undo',
        libUi.made && libUi.deleted && /Tide clerk/.test(libUi.undo) && !library.getLibrary().personas.some((p) => p.name === 'Tide clerk'),
        libUi
      )
      await shot('e2e-library.png')
      await key('Escape')

      // 38. Usage stats: every reply and Judge run counted, by range, by model and by chat, priced
      // with today's list; then Settings → Usage drawing it.
      setCustomPrices([])
      const ledger = chat.create(null).id
      chat.send(contents, ledger, 'Usage ledger')
      await idle(ledger)
      const binned = chat.create(null).id
      chat.send(contents, binned, 'Usage binned')
      await idle(binned)
      const ledgerRoot = db.getConversation(ledger).root_id
      const extra = (conversation: string, parent: string, model: string, provider: string, u: Usage, created_at?: number): void =>
        void db.insertNode(
          { id: randomUUID(), conversation_id: conversation, parent_id: parent, role: 'assistant', text: 'counted', content: null, thinking: null, model, provider_id: provider, usage: JSON.stringify(u), status: 'done', error: null, ...(created_at ? { created_at } : {}) },
          { activate: false }
        )
      const DAY = 86_400_000
      // The biggest chats by far: one trashed, one live. Then one reply 20 days old and one 400
      // days old, from a cloud model with no price.
      extra(binned, db.getConversation(binned).root_id, 'mock-a', 'mock', { input: 2_000_000, output: 1000, cacheRead: 0, cacheWrite: 0, ms: 1 })
      db.trashConversation(binned)
      extra(ledger, ledgerRoot, 'mock-b', 'mock', { input: 1_000_000, output: 500, cacheRead: 0, cacheWrite: 0, ms: 1 })
      extra(ledger, ledgerRoot, 'mock-b', 'mock', { input: 300, output: 40, cacheRead: 700, cacheWrite: 0, ms: 1 }, Date.now() - 20 * DAY)
      extra(ledger, ledgerRoot, 'mystery-model', 'anthropic', { input: 1000, output: 200, cacheRead: 3000, cacheWrite: 500, ms: 1 }, Date.now() - 400 * DAY)

      // The same numbers worked out by hand, from each chat's nodes and each judgment's runs.
      const localProvider = (p: string): boolean => /^http:\/\/127\.0\.0\.1/.test(providers.getProviders().find((x) => x.id === p)?.baseUrl ?? '')
      const handRows = [
        ...[...db.listConversations(), ...db.listTrash()].flatMap((c) =>
          [...db.loadAllNodes(c.id).values()]
            .filter((n) => n.role === 'assistant' && n.usage)
            .map((n) => ({ chat: c.id as string | null, model: n.model ?? '', provider: n.provider_id ?? '', at: n.created_at, u: JSON.parse(n.usage!) as Usage }))
        ),
        ...judge.listJudgments().flatMap((s) => {
          const j = judge.getJudgment(s.id)
          return j.runs.filter((r) => r.usage).map((r) => ({ chat: null, model: r.modelId ?? j.input.judgeModelId, provider: j.input.judgeProviderId ?? '', at: j.createdAt, u: r.usage! }))
        })
      ]
      const today = new Date()
      const startOf: Record<UsageRange, number> = {
        '7d': new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6).getTime(),
        '30d': new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29).getTime(),
        '12m': new Date(today.getFullYear(), today.getMonth() - 11, 1).getTime(),
        all: 0
      }
      const hand = (range: UsageRange, keep: (r: (typeof handRows)[number]) => boolean = () => true) => {
        const rows = handRows.filter((r) => r.at >= startOf[range] && keep(r))
        const costs = rows.map((r) => costOf(r.model, r.u, localProvider(r.provider)))
        return {
          requests: rows.length,
          input: rows.reduce((a, r) => a + r.u.input + r.u.cacheRead + r.u.cacheWrite, 0),
          output: rows.reduce((a, r) => a + r.u.output, 0),
          cacheRead: rows.reduce((a, r) => a + r.u.cacheRead, 0),
          cost: costs.reduce<number>((a, c) => a + (c ?? 0), 0),
          unpriced: costs.filter((c) => c === null).length
        }
      }
      const sameUsage = (t: UsageTotals, h: ReturnType<typeof hand>): boolean =>
        t.requests === h.requests && t.input === h.input && t.output === h.output && t.cacheRead === h.cacheRead && t.unpriced === h.unpriced && Math.abs(t.cost - h.cost) < 1e-9
      const brief = (t: UsageTotals) => [t.requests, t.input, t.output, t.cacheRead, t.unpriced, t.cost]
      const stats = Object.fromEntries((['7d', '30d', '12m', 'all'] as UsageRange[]).map((r) => [r, usageStats(r)])) as Record<UsageRange, ReturnType<typeof usageStats>>
      check(
        'usage totals match every stored reply and Judge run',
        sameUsage(stats.all.totals, hand('all')) && stats.all.totals.requests > 10 && stats.all.totals.unpriced === 1,
        [brief(stats.all.totals), hand('all')]
      )
      check(
        'each range counts only its own requests',
        (['7d', '30d', '12m'] as UsageRange[]).every((r) => sameUsage(stats[r].totals, hand(r))) &&
          stats['30d'].totals.requests === stats['7d'].totals.requests + 1 &&
          stats['12m'].totals.requests === stats['30d'].totals.requests &&
          stats.all.totals.requests === stats['12m'].totals.requests + 1,
        (['7d', '30d', '12m'] as UsageRange[]).map((r) => [r, brief(stats[r].totals), hand(r)])
      )
      const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const old = new Date(Date.now() - 400 * DAY)
      const tokensOf = (s: ReturnType<typeof usageStats>): number => s.series.reduce((a, b) => a + b.tokens, 0)
      check(
        'the series has a bar per day or month and adds up to the totals',
        stats['7d'].series.length === 7 &&
          stats['30d'].series.length === 30 &&
          stats['12m'].series.length === 12 &&
          stats['30d'].series.at(-1)?.key === dayKey(today) &&
          stats['30d'].series.find((b) => b.key === dayKey(new Date(Date.now() - 20 * DAY)))?.tokens === 1040 &&
          stats.all.unit === 'month' &&
          stats.all.series[0]?.key === dayKey(old).slice(0, 7) &&
          (['7d', '30d', '12m', 'all'] as UsageRange[]).every((r) => tokensOf(stats[r]) === stats[r].totals.input + stats[r].totals.output),
        (['7d', '30d', '12m', 'all'] as UsageRange[]).map((r) => [r, stats[r].series.length, stats[r].series[0]?.key, stats[r].series.at(-1)?.key, tokensOf(stats[r])])
      )
      const handModels = [...new Set(handRows.map((r) => `${r.provider}\n${r.model}`))]
      check(
        'usage splits by model',
        stats.all.models.length === handModels.length &&
          stats.all.models.every((m) => sameUsage(m, hand('all', (r) => r.model === m.modelId && r.provider === m.providerId))) &&
          stats.all.models.some((m) => m.modelId === 'mystery-model' && m.unpriced === 1 && m.cost === 0),
        stats.all.models.map((m) => [m.providerId, m.modelId, ...brief(m)])
      )
      check(
        "the Judge's runs are their own bucket",
        stats.all.judge.requests > 0 && sameUsage(stats.all.judge, hand('all', (r) => r.chat === null)),
        [brief(stats.all.judge), hand('all', (r) => r.chat === null)]
      )
      check(
        'the top chats come by spend, trashed ones marked',
        stats.all.chats.length === Math.min(10, new Set(handRows.map((r) => r.chat).filter(Boolean)).size) &&
          stats.all.chats[0].id === binned &&
          stats.all.chats[0].trashed &&
          stats.all.chats[1].id === ledger &&
          stats.all.chats[1].title === 'Usage ledger' &&
          !stats.all.chats[1].trashed &&
          stats.all.chats.every((c) => sameUsage(c, hand('all', (r) => r.chat === c.id))),
        stats.all.chats.slice(0, 3).map((c) => [c.title, c.trashed, ...brief(c)])
      )
      setCustomPrices([{ model: 'mock-*', input: 3, output: 15 }])
      const priced = usageStats('all')
      check(
        'usage is priced with your own prices',
        sameUsage(priced.totals, hand('all')) &&
          priced.totals.cost > 6 &&
          sameUsage(priced.models.find((m) => m.modelId === 'mock-b')!, hand('all', (r) => r.model === 'mock-b')) &&
          priced.chats[0].id === binned &&
          Math.abs(priced.chats[0].cost - hand('all', (r) => r.chat === binned).cost) < 1e-9,
        [brief(priced.totals), hand('all')]
      )
      setCustomPrices([])

      await js(`document.activeElement?.blur()`)
      await key('K', ['control'])
      win.webContents.insertText('usage')
      await new Promise((r) => setTimeout(r, 150))
      await key('Return')
      const usageUi = await js<Record<string, unknown>>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const until = async (fn, ms = 6000) => {
          for (const end = Date.now() + ms; Date.now() < end; await wait(50)) {
            const v = fn()
            if (v) return v
          }
          return null
        }
        const out = {}
        if (!(await until(() => document.querySelector('.usage-section[data-loaded="1"]')))) return { step: 'no usage page', title: document.querySelector('.settings-content .t-title')?.textContent }
        out.heading = document.querySelector('.settings-content .t-title')?.textContent
        out.navCurrent = document.querySelector('.settings-nav-item[aria-current="true"]')?.textContent
        document.querySelector('.usage-section button[data-range="all"]').click()
        await until(() => document.querySelector('.usage-section[data-range="all"][data-loaded="1"]'))
        await wait(900)
        out.stats = [...document.querySelectorAll('.usage-stats .ins-stat-label')].map((e) => e.textContent)
        out.requests = [...document.querySelectorAll('.usage-stats .ins-stat')].find((e) => e.querySelector('.ins-stat-label')?.textContent === 'Requests')?.querySelector('.ins-stat-value')?.getAttribute('title')
        out.bars = document.querySelectorAll('.usage-section .ins-bar').length
        out.models = [...document.querySelectorAll('.usage-models tbody tr')].map((r) => r.dataset.model)
        out.chats = [...document.querySelectorAll('.usage-chats tbody tr')].map((r) => r.dataset.chat)
        out.trashed = [...document.querySelectorAll('.usage-chats tr[data-trashed="1"]')].map((r) => r.dataset.chat)
        out.unpriced = document.querySelector('.usage-unpriced')?.textContent
        ;[...document.querySelectorAll('.usage-section .ins-card .tw-seg button')].find((b) => b.textContent === 'Spend')?.click()
        await wait(200)
        out.axis = [...document.querySelectorAll('.usage-section .ins-bars-axis span')].map((e) => e.textContent).join(' ')
        out.chartTitle = document.querySelector('.usage-section .ins-card-title')?.textContent
        return out
      })()`)
      await shot('e2e-usage.png')
      const usageOpened = await js<string | null>(`(async () => {
        document.querySelector('.usage-chats tr[data-chat="${ledger}"] .usage-chat')?.click()
        for (let end = Date.now() + 4000; Date.now() < end && !(!document.querySelector('.settings-view') && document.querySelector('.chat-title')?.textContent === 'Usage ledger'); ) await new Promise((r) => setTimeout(r, 50))
        return document.querySelector('.chat-title')?.textContent ?? null
      })()`)
      check(
        'Go to Usage opens Settings on the Usage page',
        usageUi.heading === 'Usage' && usageUi.navCurrent === 'Usage',
        usageUi
      )
      check(
        'the Usage page shows the totals, a bar per month, and the rows',
        (usageUi.stats as string[] | undefined)?.join() === 'Spend,Requests,Input tokens,Output tokens' &&
          String(usageUi.requests).replace(/\D/g, '') === String(stats.all.totals.requests) &&
          usageUi.bars === stats.all.series.length &&
          (usageUi.models as string[] | undefined)?.length === stats.all.models.length &&
          (usageUi.models as string[]).includes('mystery-model') &&
          (usageUi.chats as string[] | undefined)?.join() === [...stats.all.chats.map((c) => c.id), 'judge'].join() &&
          (usageUi.trashed as string[] | undefined)?.join() === binned,
        usageUi
      )
      check('the Usage page says plainly what has no price', usageUi.unpriced === '1 request has no price: add one in Prices.', usageUi.unpriced)
      check('the Usage chart switches to spend', /\$/.test(String(usageUi.axis)) && usageUi.chartTitle === 'Spend per month', [usageUi.axis, usageUi.chartTitle])
      check('a chat in the Usage list opens it', usageOpened === 'Usage ledger', usageOpened)

      // 39. Backgrounds and motion: a picture copied in and served to the window, built-in
      // gradients, the motion setting, the empty chat's evening, and new messages easing in.
      const bgSource = join(outDir, 'bg-source.png')
      writeFileSync(bgSource, Buffer.from(png, 'base64'))
      const bgVersion = await setBackgroundFile(bgSource)
      check('a background picture is copied into the data folder', backgroundVersion() === bgVersion && existsSync(join(app.getPath('userData'), 'background', 'image.png')))
      await key('Escape')
      await key(',', ['control'])
      const lookUi = await js<{ served: number; aurora: boolean; layer: string; removed: boolean; motionOff: string | null; motionBack: string | null; options: number }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.bg-picker'); ) await wait(50)
        const img = new Image()
        img.src = 'twilight-bg://image/?v=${bgVersion}'
        const served = await new Promise((r) => { img.onload = () => r(img.naturalWidth); img.onerror = () => r(-1) })
        const out = { served, options: document.querySelectorAll('.bg-option').length }
        document.querySelector('.bg-option[data-gradient="aurora"]').click()
        await wait(150)
        out.aurora = !!document.querySelector('.app.has-backdrop')
        out.layer = getComputedStyle(document.querySelector('.backdrop')).backgroundImage.slice(0, 40)
        ;[...document.querySelectorAll('.motion-seg button')].find((b) => b.textContent === 'Off').click()
        await wait(50)
        out.motionOff = document.documentElement.dataset.motion ?? null
        ;[...document.querySelectorAll('.motion-seg button')].find((b) => b.textContent === 'Full').click()
        await wait(50)
        out.motionBack = document.documentElement.dataset.motion ?? null
        return out
      })()`)
      check('the window loads your picture from the data folder', lookUi.served === 1, lookUi.served)
      check('Settings offers the theme, six gradients and your picture', lookUi.options === 8, lookUi.options)
      check('a gradient goes behind the whole window', lookUi.aurora && /radial-gradient/.test(lookUi.layer), lookUi)
      check('motion can be turned off and back on', lookUi.motionOff === 'off' && lookUi.motionBack === null, lookUi)

      // Every gradient has to draw (a bare colour in the list once made two of them draw nothing),
      // and your picture can be zoomed and dragged to choose which part shows. The picture is put in
      // place the way choosing one leaves it (the file, and its stamp in the window's settings).
      await js(`localStorage.setItem('twilight.backdrop', JSON.stringify({ kind: 'gradient', gradient: 'aurora', image: ${JSON.stringify(bgVersion)}, dim: 55, blur: 0 }))`)
      await reloadUi()
      await key(',', ['control'])
      const frameUi = await js<{ drawn: Record<string, boolean>; frame: boolean; transform: string; before: string; after: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.bg-picker'); ) await wait(50)
        const drawn = {}
        for (const b of document.querySelectorAll('.bg-option[data-gradient]')) {
          b.click()
          await wait(60)
          const img = getComputedStyle(document.querySelector('.backdrop')).backgroundImage
          drawn[b.dataset.gradient] = img !== 'none' && /gradient/.test(img)
        }
        document.querySelector('.bg-option.bg-image').click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.bg-frame'); ) await wait(50)
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        const zoom = [...document.querySelectorAll('.bg-frame-controls input[type="range"]')][0]
        set.call(zoom, '200'); zoom.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(80)
        const before = getComputedStyle(document.querySelector('.backdrop')).backgroundPosition
        const frame = document.querySelector('.bg-frame')
        const box = frame.getBoundingClientRect()
        const at = (x, y) => ({ bubbles: true, pointerId: 1, clientX: box.left + x, clientY: box.top + y, button: 0 })
        frame.dispatchEvent(new PointerEvent('pointerdown', at(130, 80)))
        await wait(50)
        frame.dispatchEvent(new PointerEvent('pointermove', at(70, 50)))
        await wait(50)
        frame.dispatchEvent(new PointerEvent('pointerup', at(70, 50)))
        await wait(80)
        const layer = document.querySelector('.backdrop')
        return { drawn, frame: !!frame, transform: layer.style.transform, before, after: getComputedStyle(layer).backgroundPosition }
      })()`)
      check('every gradient draws', Object.keys(frameUi.drawn).length === 6 && Object.values(frameUi.drawn).every(Boolean), frameUi.drawn)
      check('your picture can be zoomed and dragged to choose which part shows', frameUi.frame && frameUi.transform === 'scale(2)' && frameUi.before === '50% 50%' && frameUi.after !== '50% 50%', frameUi)
      await key('Escape')
      await key('N', ['control'])
      await new Promise((r) => setTimeout(r, 600))
      await shot('e2e-backdrop.png')
      const skyUi = await js<{ sky: boolean }>(`(() => { const s = document.querySelector('.empty .empty-sky'); return { sky: !!s && getComputedStyle(s).display !== 'none' } })()`)
      check("a background hides the empty chat's own sky", skyUi.sky === false, skyUi)
      await key(',', ['control'])
      await js(`(async () => {
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        await new Promise((r) => setTimeout(r, 200))
        document.querySelector('.bg-option.bg-none')?.click()
      })()`)
      await key('Escape')
      await new Promise((r) => setTimeout(r, 1700))
      const emptyUi = await js<{ sky: boolean; sun: boolean; stars: number }>(`({ sky: !!document.querySelector('.empty .empty-sky'), sun: !!document.querySelector('.empty .empty-sun'), stars: document.querySelectorAll('.empty .empty-star').length })`)
      check('an empty chat shows a small evening behind the greeting', emptyUi.sky && emptyUi.sun && emptyUi.stars > 10, emptyUi)
      await shot('e2e-emptysky.png')
      const enterUi = await js<{ fresh: boolean }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const area = document.querySelector('.tw-composer textarea')
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        area.focus(); set.call(area, 'A new evening'); area.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(50)
        document.querySelector('.tw-send').click()
        for (let end = Date.now() + 4000; Date.now() < end && !document.querySelector('.msg-user-row'); ) await wait(50)
        return { fresh: !!document.querySelector('.msg-user-row.msg-enter') }
      })()`)
      check('a message you just sent eases in', enterUi.fresh, enterUi)

      // 40. Split differences: the diff itself on known strings (a long pair falls back to
      // paragraphs), then in the app: each pane's latest reply marked against the other's, a
      // summary, and off putting the replies back. Nothing stored or sent changes.
      const dusk40 = compareTexts('The lamp was lit at dusk.', 'The lamp was lit at dawn.')
      check(
        'the reply diff marks the one word that changed',
        JSON.stringify(dusk40.a) === JSON.stringify([[{ text: 'The lamp was lit at ', changed: false }, { text: 'dusk.', changed: true }]]) &&
          dusk40.b[0]?.[1]?.text === 'dawn.' && dusk40.by === 'words' && dusk40.onlyA === 1 && dusk40.onlyB === 1 && Math.abs(dusk40.similarity - 10 / 12) < 1e-9,
        dusk40
      )
      const twin40 = compareTexts('Wren counted the lamps.\n\nRowan kept the tally.', 'Wren counted  the lamps.\n\n\nRowan kept the tally.\n')
      check('replies differing only in spacing have no differences', twin40.onlyA + twin40.onlyB === 0 && twin40.similarity === 1 && twin40.a.length === 2 && twin40.a.flat().every((r) => !r.changed), twin40)
      const prose40 = plainProse('## The quay\n\n**Wren** saw [the lamps](http://x) and `nine` boats.\n\n- one\n- two')
      check('the diff reads markdown as the words it shows', prose40 === 'The quay\n\nWren saw the lamps and nine boats.\n\none\ntwo', prose40)
      const edit40 = wordDiff('Nobody had ever seen who lit them.', 'No one ever saw who lit them.')
      check(
        'the editor diff still marks removals and insertions',
        edit40.filter((o) => o.type === 'del').map((o) => o.text).join('|') === 'Nobody|had|seen' &&
          edit40.filter((o) => o.type === 'ins').map((o) => o.text).join('|') === 'No|one|saw' &&
          edit40.filter((o) => o.type !== 'ins').map((o) => o.text).join('') === 'Nobody had ever seen who lit them.',
        edit40
      )
      // 4,000 words a side. Changed only in the middle, the shared start and end are set aside and
      // it's still word by word; changed at both ends, the whole of it differs and is too long.
      const para40 = (k: number, tag = ''): string => Array.from({ length: 100 }, (_, i) => `tide${k}w${i}${tag}`).join(' ')
      const long40 = Array.from({ length: 40 }, (_, k) => para40(k)).join('\n\n')
      const mid40 = compareTexts(long40, long40.replace('tide20w50 ', 'tide20w50b '))
      check('a long pair changed in one place is still compared word by word', mid40.by === 'words' && mid40.onlyA === 1 && mid40.onlyB === 1, { by: mid40.by, onlyA: mid40.onlyA, onlyB: mid40.onlyB })
      const ends40 = Array.from({ length: 40 }, (_, k) => para40(k, k === 0 || k === 39 ? 'b' : '')).join('\n\n')
      const t40 = Date.now()
      const big40 = compareTexts(long40, ends40)
      const ms40 = Date.now() - t40
      const changed40 = big40.a.map((p, k) => (p[0]?.changed ? k : -1)).filter((k) => k >= 0)
      check(
        'a long pair falls back to comparing paragraphs, quickly',
        big40.by === 'paragraphs' && big40.a.length === 40 && changed40.join() === '0,39' && big40.onlyA === 200 && big40.onlyB === 200 && Math.abs(big40.similarity - 0.95) < 1e-9 && ms40 < 1000,
        { by: big40.by, changed40, onlyA: big40.onlyA, onlyB: big40.onlyB, similarity: big40.similarity, ms40 }
      )

      const c40 = chat.create().id
      chat.updateSettings(c40, { providerId: 'mock', modelId: 'mock-a' })
      chat.send(contents, c40, 'Two tellings of the tide')
      await idle(c40)
      chat.cloneIntoSplit(c40)
      chat.updateSettings(c40, { modelId: 'mock-b' }, 'b')
      chat.send(contents, c40, 'Tell it again', 'both')
      await idle(c40)
      const stored40 = (): string => JSON.stringify([chat.view(c40).path.map((n) => n.text), chat.view(c40).split?.path.map((n) => n.text)])
      const before40 = stored40()
      const requests40 = log.length
      await reloadUi()
      type DiffUi = { split: boolean; pressed: string | null; bodies: number; aOnly: string[]; bOnly: string[]; paras: number; bar: string[]; colours: string[]; latestMd: boolean; strong: string | null }
      const readDiff = `(() => {
        const latest = (p) => [...document.querySelectorAll('.tw-pane-' + p + ' .tw-msg-ai')].at(-1)
        const only = (p) => [...document.querySelectorAll('.tw-pane-' + p + ' .diff-only')]
        return {
          split: !!document.querySelector('.tw-split'),
          pressed: [...document.querySelectorAll('.chat-head button')].find((b) => b.textContent === 'Differences')?.getAttribute('aria-pressed') ?? null,
          bodies: document.querySelectorAll('.diff-body').length,
          aOnly: only('a').map((e) => e.textContent), bOnly: only('b').map((e) => e.textContent),
          paras: latest('a')?.querySelectorAll('.diff-para').length ?? 0,
          bar: [...(document.querySelector('.split-diff-bar')?.children ?? [])].map((e) => e.textContent),
          colours: [only('a')[0], only('b')[0]].filter(Boolean).map((e) => getComputedStyle(e).backgroundColor),
          latestMd: !!latest('a')?.querySelector('.tw-msg-body.md'),
          strong: latest('a')?.querySelector('.tw-msg-body.md strong')?.textContent ?? null
        }
      })()`
      const diffOn = await js<DiffUi>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const row = [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Two tellings of the tide')
        row?.click()
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.tw-split .tw-msg-ai').length < 4; ) await wait(50)
        ;[...document.querySelectorAll('.chat-head button')].find((b) => b.textContent === 'Differences')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && document.querySelectorAll('.diff-body').length < 2; ) await wait(50)
        await wait(100)
        return ${readDiff}
      })()`)
      check('the Differences toggle shows in split view and turns on', diffOn.split && diffOn.pressed === 'true' && diffOn.bodies === 2, diffOn)
      check('words only in A are marked in A, words only in B in B', diffOn.aOnly.join('|') === 'mock-a' && diffOn.bOnly.join('|') === 'mock-b', diffOn)
      check("each pane's mark takes its own colour", diffOn.colours.length === 2 && diffOn.colours[0] !== diffOn.colours[1] && !diffOn.colours.includes('rgba(0, 0, 0, 0)'), diffOn.colours)
      check('the diff keeps the reply readable as plain paragraphs', diffOn.paras === 3 && !diffOn.latestMd, diffOn)
      check('the summary counts the differing words and the similarity', diffOn.bar.join(' · ') === '2 words differ · 1 only in A · 1 only in B · 94% similar', diffOn.bar)
      await shot('e2e-split-diff.png')
      await js(`document.activeElement?.blur()`)
      await key('K', ['control'])
      win.webContents.insertText('differences between')
      await new Promise((r) => setTimeout(r, 200))
      const diffCommand = await js<string | null>(`document.querySelector('.palette-item .palette-title')?.textContent ?? null`)
      await key('Return')
      await new Promise((r) => setTimeout(r, 200))
      const diffOff = await js<DiffUi>(readDiff)
      check('the command menu offers the differences toggle', diffCommand === 'Show or hide differences between panes', diffCommand)
      check('turning differences off restores the normal reply', diffOff.pressed === 'false' && diffOff.bodies === 0 && diffOff.bar.length === 0 &&diffOff.latestMd && diffOff.strong === 'mock-a', diffOff)
      check('differences never change stored messages or send anything', stored40() === before40 && log.length === requests40, { requests: log.length - requests40 })

      // 41. Tools: web search and fetch (Claude's server tools, OpenRouter's web plugin) and the
      // date and time. The mock is a local server, so it gets the date and time but no web tools;
      // Claude's request shape is checked on the pure builders, with no calls to Anthropic.
      const c41 = chat.create().id
      chat.updateSettings(c41, { providerId: 'mock', modelId: 'mock-a', dateTime: true, webSearch: true, webFetch: true, choiceCards: false })
      const before41 = log.length
      chat.send(contents, c41, 'What day is it?')
      await idle(c41)
      chat.send(contents, c41, 'And now?')
      await idle(c41)
      const [first41, second41] = [log[before41], log[before41 + 1]]
      const firstUser41 = first41?.messages.at(-1)?.content ?? ''
      const secondUser41 = second41?.messages.at(-1)?.content ?? ''
      check(
        'the date and time open each new message',
        /^<current_time>\nSent .+, \d\d:\d\d local time \(.*UTC[+-]\d\d:\d\d\)\.\n<\/current_time>\n\nWhat day is it\?$/.test(firstUser41) && /^<current_time>\n[\s\S]*\n\nAnd now\?$/.test(secondUser41),
        [firstUser41, secondUser41]
      )
      check(
        'the date and time never go into the system prompt',
        [first41, second41].every((r) => r?.messages.filter((m) => m.role === 'system').every((m) => !String(m.content).includes('current_time'))),
        first41?.messages[0]
      )
      check(
        'earlier messages, the date and time included, go byte for byte the same in the next request',
        !!first41 && JSON.stringify(second41?.messages.slice(0, first41.messages.length)) === JSON.stringify(first41.messages) && second41.messages.length === first41.messages.length + 2
      )
      check('a local server gets no web tools or plugin', !!first41 && !('tools' in first41.body) && !('plugins' in first41.body), Object.keys(first41?.body ?? {}))
      const v41 = chat.view(c41)
      check('the message keeps what was typed and shows the time it was sent with', v41.path[0].text === 'What day is it?' && /^Sent .+ local time/.test(v41.path[0].dateTime ?? ''), v41.path[0])

      // After a present_choices call the date and time follow the tool result, like documents.
      const c40c = chat.create().id
      chat.updateSettings(c40c, { providerId: 'mock', modelId: 'mock-a', choiceCards: true, choiceTool: true, dateTime: true })
      chat.send(contents, c40c, 'TOOLCHOICE start')
      await idle(c40c)
      const before40c = log.length
      chat.send(contents, c40c, 'Cross')
      await idle(c40c)
      const choiceMsgs41 = log[before40c]?.messages ?? []
      const tool41 = choiceMsgs41.findIndex((m) => m.role === 'tool')
      check(
        'after a tool call the answer is the tool result and the time follows it',
        tool41 > 0 && choiceMsgs41[tool41].content === 'Cross' && choiceMsgs41[tool41 + 1]?.role === 'user' && String(choiceMsgs41[tool41 + 1]?.content).startsWith('<current_time>'),
        choiceMsgs41.slice(tool41).map((m) => [m.role, String(m.content).slice(0, 30)])
      )
      const clock41 = clockBlock(new Date(2026, 9, 28, 9, 5))
      const claudeChoice41 = toMessages([
        row('user', [{ type: 'text', text: 'Begin' }]),
        row('assistant', [{ type: 'text', text: 'Story.' }, { type: 'tool_use', id: 'toolu_9', name: 'present_choices', input: { groups: [] } }]),
        row('user', [{ type: 'text', text: clock41 }, { type: 'text', text: 'Cross' }], 'Cross')
      ])[2]?.content as { type: string; content?: string; text?: string }[]
      check(
        'Claude gets the pick as the tool_result with the time after it',
        claudeChoice41?.length === 2 && claudeChoice41[0].type === 'tool_result' && claudeChoice41[0].content === 'Cross' && claudeChoice41[1].text === clock41,
        claudeChoice41
      )

      // Claude's server tools: a reply that searched (with a citation) and read a page.
      const webReply41 = [
        { type: 'text', text: "I'll look that up.", citations: null },
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'lighthouse keepers' }, caller: { type: 'direct' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          caller: { type: 'direct' },
          content: [
            { type: 'web_search_result', url: 'https://example.com/keepers', title: 'Keepers of the light', encrypted_content: 'enc-1', page_age: null },
            { type: 'web_search_result', url: 'https://lamps.example.net/wicks', title: 'Trimming wicks', encrypted_content: 'enc-2', page_age: '2 years ago' }
          ]
        },
        {
          type: 'text',
          text: 'Keepers trimmed the wicks at dusk',
          citations: [{ type: 'web_search_result_location', url: 'https://example.com/keepers', title: 'Keepers of the light', encrypted_index: 'idx-1', cited_text: 'trimmed the wicks' }]
        },
        { type: 'text', text: '.', citations: null },
        { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_fetch', input: { url: 'https://www.example.org/log' }, caller: { type: 'direct' } },
        {
          type: 'web_fetch_tool_result',
          tool_use_id: 'srvtoolu_2',
          caller: { type: 'direct' },
          content: { type: 'web_fetch_result', url: 'https://www.example.org/log', retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Lamps lit at six.' }, title: 'The keeper log', citations: null } }
        },
        { type: 'text', text: 'The log agrees.', citations: null }
      ]
      check('the reply text joins citation pieces and breaks after a tool call', replyText(webReply41) === "I'll look that up.\n\nKeepers trimmed the wicks at dusk.\n\nThe log agrees.", replyText(webReply41))
      const claude41 = { ...chat.getDefaults(), providerId: 'anthropic', modelId: 'claude-opus-5-5', systemPrompt: '', extraParams: '', choiceCards: false, webSearch: true, webFetch: true, caching: true, cacheTtl: '1h' as const }
      const hist41 = [
        row('user', [{ type: 'text', text: clock41 }, { type: 'text', text: 'Who lit the lamps?' }], 'Who lit the lamps?'),
        row('assistant', webReply41, replyText(webReply41)),
        row('user', [{ type: 'text', text: clockBlock(new Date(2026, 9, 28, 9, 7)) }, { type: 'text', text: 'Thanks' }], 'Thanks')
      ]
      const req41 = anthropicRequest({ system: 'Stay brief.', history: hist41, settings: claude41 })
      const msgs41 = req41.body.messages as { role: string; content: { type: string; text?: string }[] }[]
      check(
        'Claude gets web search and web fetch as server tools with caps',
        JSON.stringify(req41.body.tools) ===
          JSON.stringify([
            { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
            { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5, max_content_tokens: 20000 }
          ]),
        req41.body.tools
      )
      check('the web tools need no beta header', !req41.betas.some((b) => /web/.test(b)), req41.betas)
      check(
        'models without dynamic filtering get the basic web tool versions',
        anthropicTools({ ...claude41, modelId: 'claude-haiku-4-5' }).map((t) => t.type).join() === 'web_search_20250305,web_fetch_20250910'
      )
      check(
        'the choice tool comes first, then the web tools',
        anthropicTools({ ...claude41, choiceCards: true, choiceTool: true }).map((t) => t.name).join() === 'present_choices,web_search,web_fetch'
      )
      check('server tool blocks and citations are replayed exactly as stored', JSON.stringify(msgs41[1]?.content) === JSON.stringify(webReply41), msgs41[1]?.content.map((b) => b.type))
      check(
        'the date and time ride in the user turn for Claude, not the system prompt',
        msgs41[0]?.content[0]?.text === clock41 && !JSON.stringify(req41.body.system).includes('current_time'),
        req41.body.system
      )
      const later41 = anthropicRequest({
        system: 'Stay brief.',
        history: [...hist41, row('assistant', [{ type: 'text', text: 'You are welcome.', citations: null }], 'You are welcome.'), row('user', [{ type: 'text', text: 'More' }], 'More')],
        settings: claude41
      })
      check(
        'a later Claude request starts with the earlier one byte for byte',
        JSON.stringify(later41.body.messages).startsWith(JSON.stringify(req41.body.messages).slice(0, -1)) &&
          JSON.stringify(later41.body.tools) === JSON.stringify(req41.body.tools) &&
          JSON.stringify(later41.body.system) === JSON.stringify(req41.body.system)
      )
      const off41 = anthropicRequest({ system: '', history: hist41, settings: { ...claude41, webSearch: false, webFetch: false } })
      const offReply41 = (off41.body.messages as { content: Record<string, unknown>[] }[])[1]?.content ?? []
      check(
        'with the web tools off, their calls and citations are left out',
        !('tools' in off41.body) && offReply41.map((b) => b.type).join() === 'text,text,text,text' && offReply41.every((b) => !('citations' in b) || b.citations === null),
        offReply41
      )
      const searchOnly41 = anthropicRequest({ system: '', history: hist41, settings: { ...claude41, webFetch: false } })
      check(
        'with only search on, the page read is left out and the search kept',
        (searchOnly41.body.messages as { content: { type: string }[] }[])[1]?.content.map((b) => b.type).join() === 'text,server_tool_use,web_search_tool_result,text,text,text'
      )
      const paused41 = toMessages(
        [row('user', [{ type: 'text', text: 'Go' }]), row('assistant', [{ type: 'text', text: 'Looking.' }, { type: 'server_tool_use', id: 'srvtoolu_3', name: 'web_search', input: { query: 'tides' } }])],
        new Set(['web_search'])
      )
      check('a search left without its result is not replayed', paused41[1]?.content.map((b) => b.type).join() === 'text', paused41[1]?.content)
      const activity41 = webActivityOf(webReply41)
      check(
        'the reply lists its search, its page read and its cited source',
        activity41?.steps.map((s) => `${s.kind}:${s.query}:${s.sources.length}`).join() === 'search:lighthouse keepers:2,fetch:https://www.example.org/log:1' &&
          activity41.steps[1].sources[0].title === 'The keeper log' &&
          activity41.cited.map((c) => c.url).join() === 'https://example.com/keepers',
        activity41
      )
      const usage41: Usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, ms: 1 }
      check(
        'each Claude web search adds a cent to the price',
        Math.abs((costOf('claude-opus-5-5', { ...usage41, webSearches: 3 }, false) ?? 0) - ((costOf('claude-opus-5-5', usage41, false) ?? 0) + 0.03)) < 1e-9
      )

      // OpenRouter: search through its web plugin; fetch isn't offered. Other servers get neither.
      const openRouter41 = { id: 'or', kind: 'openai' as const, name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: true }
      check('OpenRouter gets its web plugin when search is on', JSON.stringify(openRouterPlugins(openRouter41.baseUrl, { webSearch: true })) === JSON.stringify([{ id: 'web', max_results: 5 }]))
      check('no plugin when search is off or on a local server', openRouterPlugins(openRouter41.baseUrl, { webSearch: false }) === null && openRouterPlugins('http://127.0.0.1:1234/v1', { webSearch: true }) === null)
      const support41 = [webSupport({ id: 'anthropic', kind: 'anthropic', name: 'Anthropic', enabled: true }), webSupport(openRouter41), webSupport({ id: 'l', kind: 'openai', name: 'Local', baseUrl: 'http://localhost:11434/v1', enabled: true })]
      check(
        'web tools are offered with Claude, search only through OpenRouter, neither on local servers',
        support41[0].search === null && support41[0].fetch === null && support41[1].search === null && !!support41[1].fetch && /local servers/.test(support41[2].search ?? '') && !!support41[2].fetch,
        support41
      )
      // Sources an OpenAI-compatible server cites (url_citation annotations) show, and aren't replayed.
      const c40o = chat.create().id
      chat.updateSettings(c40o, { providerId: 'mock', modelId: 'mock-a', choiceCards: false })
      chat.send(contents, c40o, 'WEBCITE lamps')
      await idle(c40o)
      const cited41 = chat.view(c40o).path[1]
      chat.send(contents, c40o, 'Go on')
      await idle(c40o)
      const replayed41 = log.at(-1)?.messages.filter((m) => m.role === 'assistant').at(-1)
      check('cited sources from annotations are listed with the reply', cited41?.web?.cited.map((s) => s.url).join() === 'https://example.com/lamps' && cited41.web.steps.length === 1, cited41?.web)
      check('the sources are not sent back to the model', replayed41?.content === cited41?.text, replayed41)

      // The interface: the time on the message, the Tools rows on a local server, and a reply
      // that searched and read, with its sources as links.
      const c40w = chat.create().id
      const root41 = db.getConversation(c40w).root_id
      const user41 = db.insertNode({ id: randomUUID(), conversation_id: c40w, parent_id: root41, role: 'user', text: 'Who lit the lamps?', content: hist41[0].content, thinking: null, model: null, provider_id: null, usage: null, status: 'done', error: null })
      db.insertNode({ id: randomUUID(), conversation_id: c40w, parent_id: user41.id, role: 'assistant', text: replyText(webReply41), content: JSON.stringify(webReply41), thinking: null, model: 'claude-opus-5-5', provider_id: 'anthropic', usage: JSON.stringify({ ...usage41, webSearches: 1 }), status: 'done', error: null })
      db.updateConversation(c40w, { started: 1, title: 'Keepers on the web' })
      await reloadUi()
      const toolsUi41 = await js<{
        chip: string | null
        chipTitle: string | null
        rows: { tool: string; disabled: boolean; inputDisabled: boolean; checked: boolean; note: string }[]
        badge: string | null
        steps: string[]
        links: string[]
        sources: string[]
        body: string
      }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        document.querySelector('[data-mode="chat"]')?.click()
        await wait(200)
        const open = async (title, text) => {
          ;[...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === title)?.click()
          for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.tw-msg-user')?.textContent.includes(text); ) await wait(50)
          await wait(200)
        }
        await open('What day is it?', 'What day is it?')
        const chip = document.querySelector('.msg-user-row .instruction-chip')
        const out = { chip: chip?.textContent ?? null, chipTitle: chip?.getAttribute('title') ?? null }
        const toolsBtn = () => [...document.querySelectorAll('.tools-menu button')].find((b) => b.textContent.includes('Tools'))
        toolsBtn()?.click()
        await wait(250)
        const row = (t) => document.querySelector('.tools-row[data-tool="' + t + '"]')
        out.rows = ['webSearch', 'webFetch', 'dateTime'].map((tool) => ({
          tool,
          disabled: !!row(tool)?.classList.contains('disabled'),
          inputDisabled: !!row(tool)?.querySelector('input')?.disabled,
          checked: !!row(tool)?.querySelector('input')?.checked,
          note: row(tool)?.querySelector('.tools-note')?.textContent ?? ''
        }))
        out.badge = document.querySelector('.tools-count')?.textContent ?? null
        toolsBtn()?.click()
        await wait(150)
        await open('Keepers on the web', 'Who lit the lamps?')
        const reply = [...document.querySelectorAll('.tw-msg-ai')].at(-1)
        reply?.querySelector('.web-step summary')?.click()
        await wait(150)
        out.steps = [...(reply?.querySelectorAll('.web-step .web-what') ?? [])].map((e) => e.textContent)
        out.links = [...(reply?.querySelectorAll('.web-links a, .web-step > .web-what a') ?? [])].map((a) => a.getAttribute('href'))
        out.sources = [...(reply?.querySelectorAll('.web-sources li a') ?? [])].map((a) => a.getAttribute('href'))
        out.body = reply?.querySelector('.tw-msg-body')?.textContent ?? ''
        return out
      })()`)
      check('the message shows it carried the date and time', toolsUi41.chip === 'Date and time' && /^Sent /.test(toolsUi41.chipTitle ?? ''), toolsUi41)
      const rows41 = Object.fromEntries(toolsUi41.rows.map((r) => [r.tool, r]))
      check(
        'on a local server the web tools show switched off with the reason',
        rows41.webSearch?.disabled && rows41.webSearch.inputDisabled && !rows41.webSearch.checked && /Not on local servers/.test(rows41.webSearch.note) && rows41.webFetch?.inputDisabled && !rows41.webFetch.checked,
        toolsUi41.rows
      )
      check('the date and time switch is on and usable there', !!rows41.dateTime && rows41.dateTime.checked && !rows41.dateTime.inputDisabled, rows41.dateTime)
      check('the Tools badge counts only the tools that are on and usable', toolsUi41.badge === '1', toolsUi41.badge)
      check('the reply shows what it searched and read', toolsUi41.steps.join('|') === 'Searched: lighthouse keepers|Read: example.org', toolsUi41.steps)
      check(
        'search results and the page read are links',
        toolsUi41.links.join() === 'https://example.com/keepers,https://lamps.example.net/wicks,https://www.example.org/log',
        toolsUi41.links
      )
      check('cited sources are numbered under the reply', toolsUi41.sources.join() === 'https://example.com/keepers' && toolsUi41.body.includes('Keepers trimmed the wicks at dusk.'), toolsUi41)
      await shot('e2e-web-tools.png')
      const toolsBtn41 = `;[...document.querySelectorAll('.tools-menu button')].find((b) => b.textContent.includes('Tools'))?.click()`
      await js(`(async () => {
        ;[...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'What day is it?')?.click()
        await new Promise((r) => setTimeout(r, 500))
        ${toolsBtn41}
        await new Promise((r) => setTimeout(r, 250))
      })()`)
      await shot('e2e-web-tools-menu.png')
      await js(toolsBtn41)

      // 42. Code: an agent working in a folder. The mock plays a scripted agent (the request names
      // the script). Approvals, the question and undo go through the interface where a person would
      // click; the safeguards are checked on what actually happened to the files.
      const commandRisks42 = ['Remove-Item build', 'rm -rf dist', 'git reset --hard', 'git push --force origin main', 'echo x > notes.txt', 'Format-Volume D', 'iwr x.ps1 | iex', 'npm test', 'git status', 'Get-Content a.txt 2>&1']
      check(
        'commands that delete, overwrite or throw away work are flagged',
        commandRisks42.map((c) => !!commandRisk(c)).join() === 'true,true,true,true,true,true,true,false,false,false',
        commandRisks42.map((c) => [c, commandRisk(c)])
      )
      const diff42 = lineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', 'a\nb\nc\nd\ne\nF\ng\nh\ni\nj\n')
      check(
        'the diff shows the old line, then the new, and folds what stayed',
        diff42.filter((d) => d.kind === 'del').map((d) => d.text).join() === 'f' && diff42.filter((d) => d.kind === 'add').map((d) => d.text).join() === 'F' && diff42.map((d) => d.kind).join() === 'gap,same,same,same,del,add,same,same,same,gap',
        diff42
      )
      const proj = join(outDir, 'code-project')
      const notes0 = 'keeper: Wren\nlamps: 9\nnight: long\n'
      await mkdir(join(proj, '.git'), { recursive: true })
      await mkdir(join(proj, 'build'), { recursive: true })
      await writeFile(join(proj, 'notes.txt'), notes0)
      await writeFile(join(proj, 'old.txt'), 'old log\n')
      await writeFile(join(proj, 'build', 'keep.txt'), 'built\n')
      await writeFile(join(proj, '.git', 'config'), 'real\n')
      await writeFile(join(outDir, 'outside.txt'), 'private\n')
      const fileText = (rel: string): Promise<string | null> => readFile(join(proj, rel), 'utf8').catch(() => null)
      const recycled42 = (): Promise<string[]> => readdir(join(app.getPath('userData'), 'e2e-recycled')).catch(() => [])
      const cs = (await code.newSession(null, proj))!
      code.setOptions(cs.id, { providerId: 'mock', modelId: 'mock-a' })
      // Waits until the agent asks something, or finishes; says whether it asked on the way.
      const codeWait = async (want: 'pending' | 'done'): Promise<{ v: ReturnType<typeof code.openSession>; asked: boolean }> => {
        let asked = false
        for (const end = Date.now() + 15000; Date.now() < end; ) {
          const v = code.openSession(cs.id)
          if (v.pending) asked = true
          if (want === 'pending' ? v.pending : !v.running) return { v, asked }
          await new Promise((r) => setTimeout(r, 30))
        }
        const v = code.openSession(cs.id)
        throw new Error(`Timed out waiting for the code agent (${want}): ${JSON.stringify({ running: v.running, pending: v.pending?.kind, error: v.error, last: v.entries.at(-1) })}`)
      }
      const toolEntries = (v: ReturnType<typeof code.openSession>) => v.entries.filter((e) => e.kind === 'tool') as Extract<(typeof v.entries)[number], { kind: 'tool' }>[]
      const lastText42 = (v: ReturnType<typeof code.openSession>): string => (v.entries.filter((e) => e.kind === 'assistant').at(-1) as { text: string } | undefined)?.text ?? ''
      const card42 = `(() => {
        const card = document.querySelector('.code-pending')
        return card && {
          head: card.querySelector('.code-pending-head')?.textContent ?? '',
          adds: [...card.querySelectorAll('.diff-add')].map((e) => e.textContent.trim()),
          dels: [...card.querySelectorAll('.diff-del')].map((e) => e.textContent.trim()),
          command: card.querySelector('.code-command')?.textContent ?? null,
          risk: card.querySelector('.code-risk')?.textContent ?? null,
          question: card.querySelector('.code-question-text')?.textContent ?? null,
          buttons: [...card.querySelectorAll('button')].map((b) => b.textContent.trim())
        }
      })()`
      const click42 = (label: string, scope = '.code-pending'): Promise<boolean> =>
        js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b })()`)
      const untilUi = (cond: string): Promise<boolean> =>
        js(`(async () => { for (let end = Date.now() + 5000; Date.now() < end; ) { if (${cond}) return true; await new Promise((r) => setTimeout(r, 30)) } return false })()`)

      await js(`document.querySelector('.rail-item[data-mode="code"]')?.click()`)
      const opened42 = await untilUi(`document.querySelector('.code-view .code-folder')?.textContent === 'code-project'`)
      const listed42 = await js<string[]>(`[...document.querySelectorAll('.code-session-item .tw-conv-title')].map((e) => e.textContent)`)
      check('the Code tab opens the session in its folder', opened42 && listed42.includes('code-project'), listed42)
      const before42 = log.length
      win.webContents.focus()
      await js(`document.querySelector('.code-view textarea')?.focus()`)
      win.webContents.insertText('CODEFLOW make it twelve lamps')
      await untilUi(`!document.querySelector('.code-view .tw-send')?.disabled`)
      await js(`document.querySelector('.code-view .tw-send')?.click()`)
      let w42 = await codeWait('pending')
      await untilUi(`!!document.querySelector('.code-pending .code-diff')`)
      const editCard = await js<{ head: string; adds: string[]; dels: string[]; buttons: string[] } | null>(card42)
      check(
        'an edit waits for approval, with its diff',
        w42.v.pending?.kind === 'edit' && !!editCard?.head.includes('Make this change?') && editCard.head.includes('notes.txt') && editCard.dels.join() === '− lamps: 9' && editCard.adds.join() === '+ lamps: 12',
        editCard
      )
      check('nothing is written before you approve', (await fileText('notes.txt')) === notes0)
      check('reading a file needs no approval', toolEntries(w42.v)[0]?.tool === 'read_file' && toolEntries(w42.v)[0]?.status === 'done', toolEntries(w42.v))
      await shot('e2e-code-approval.png')
      await click42('Approve')
      w42 = await codeWait('pending')
      check('the approved edit is written and can be undone', (await fileText('notes.txt')) === notes0.replace('lamps: 9', 'lamps: 12') && w42.v.undoable.length === 1, w42.v.undoable)
      await untilUi(`!!document.querySelector('.code-pending .code-command')`)
      const cmdCard = await js<{ command: string | null; risk: string | null; buttons: string[] } | null>(card42)
      check(
        'a command waits for approval, and can be allowed for the session',
        w42.v.pending?.kind === 'command' && cmdCard?.command === 'Get-Content notes.txt' && cmdCard.risk === null && cmdCard.buttons.includes('Always allow this command'),
        cmdCard
      )
      await click42('Run it')
      w42 = await codeWait('pending')
      const ran42 = toolEntries(w42.v).find((e) => e.tool === 'run_command')
      check('the command runs in the folder and its output is kept', ran42?.status === 'done' && !!ran42.output?.includes('lamps: 12'), ran42)
      await untilUi(`!!document.querySelector('.code-question')`)
      const qCard = await js<{ question: string | null; buttons: string[] } | null>(card42)
      check('the agent can ask, with suggested answers', qCard?.question === 'Which colour should the lamps be?' && qCard.buttons.includes('Amber') && qCard.buttons.includes('Blue'), qCard)
      await click42('Amber')
      w42 = await codeWait('done')
      check('your answer goes back to the agent', lastText42(w42.v).includes('The user answered: Amber'), lastText42(w42.v))
      const steps42 = log.slice(before42).filter((r) => String(r.messages[0]?.content ?? '').startsWith('You are a careful coding agent'))
      check(
        'each step resends the one before unchanged, so the cache holds',
        steps42.length === 5 && steps42.every((r, i) => i === 0 || JSON.stringify(r.messages.slice(0, steps42[i - 1].messages.length)) === JSON.stringify(steps42[i - 1].messages)),
        steps42.map((r) => r.messages.length)
      )
      const replayed42 = steps42.at(-1)?.messages.find((m) => (m as { tool_calls?: unknown[] }).tool_calls) as { tool_calls: { id: string; function: { arguments: string } }[] } | undefined
      check('tool calls are replayed with their arguments exactly as they came', replayed42?.tool_calls[0]?.function.arguments === JSON.stringify({ path: 'notes.txt' }), replayed42)
      const offered42 = ((steps42[0]?.body as { tools?: { function: { name: string } }[] }).tools ?? []).map((t) => t.function.name)
      check('the agent is offered its tools', offered42.join() === 'list_files,read_file,search_files,edit_file,write_file,delete_file,run_command,update_tasks,ask_user', offered42)
      const usage42 = await js<string>(`document.querySelector('.code-usage')?.textContent ?? ''`)
      check('the session shows what it used and how much came from the cache', /^[\d.]+k? in · [\d.]+k? out · \d+% cached$/.test(usage42), usage42)
      await js(`(() => { const t = [...document.querySelectorAll('.code-tool')].find((e) => e.dataset.tool === 'edit_file'); t?.querySelector('.code-tool-head')?.click() })()`)
      await shot('e2e-code.png')

      // Undo, and the agent hears about it with your next message.
      await click42('Undo', '.code-view .chat-head')
      await untilUi(`[...document.querySelectorAll('.code-tool')].some((e) => e.classList.contains('code-tool-undone'))`)
      check('Undo puts the file back as it was', (await fileText('notes.txt')) === notes0 && code.openSession(cs.id).entries.some((e) => e.kind === 'note' && e.text === 'Undid: edited notes.txt'))
      code.send(cs.id, 'CODEPLAIN thanks')
      await codeWait('done')
      const noted42 = String(log.at(-1)?.messages.at(-1)?.content ?? '')
      check('the agent is told what you undid', noted42.startsWith('<note>') && noted42.includes('undid your change "edited notes.txt"') && noted42.endsWith('CODEPLAIN thanks'), noted42)

      // Accept edits: no approvals for changes, and Undo all puts every file back.
      await click42('Accept edits', '.code-modes')
      check('the mode can be changed from the header', (await untilUi(`document.querySelector('.code-modes [aria-checked="true"]')?.textContent === 'Accept edits'`)) && code.openSession(cs.id).mode === 'edits')
      code.send(cs.id, 'CODECREATE')
      w42 = await codeWait('done')
      check('with edits accepted, changes go through without asking', !w42.asked && (await fileText('src/new.txt')) === 'fresh\n' && !!(await fileText('notes.txt'))?.includes('keeper: Rowan'), w42.v.entries)
      await untilUi(`[...document.querySelectorAll('.code-view .chat-head button')].some((b) => b.textContent.trim() === 'Undo all' && !b.disabled)`)
      await click42('Undo all', '.code-view .chat-head')
      for (let end = Date.now() + 5000; Date.now() < end && (await fileText('src/new.txt')) !== null; ) await new Promise((r) => setTimeout(r, 30))
      check(
        'Undo all restores changed files and sends new ones to the Recycle Bin',
        (await fileText('notes.txt')) === notes0 && (await fileText('src/new.txt')) === null && (await recycled42()).some((f) => f.endsWith('-new.txt')),
        await recycled42()
      )

      // The folder is a fence: nothing outside it, nothing inside .git, no edit that doesn't match.
      code.send(cs.id, `CODEESCAPE ${join(outDir, 'outside.txt')}`)
      w42 = await codeWait('done')
      const escape42 = toolEntries(w42.v).slice(-5)
      check(
        'the agent cannot read or write outside its folder',
        escape42.slice(0, 3).every((e) => e.status === 'error' && /outside the folder/.test(e.output ?? '')) && (await readFile(join(outDir, 'outside.txt'), 'utf8')) === 'private\n',
        escape42
      )
      check("the agent cannot change files inside .git", escape42[3]?.status === 'error' && /inside \.git/.test(escape42[3].output ?? '') && (await fileText('.git/config')) === 'real\n', escape42[3])
      check("an edit whose text isn't in the file fails and changes nothing", escape42[4]?.status === 'error' && /wasn't found/.test(escape42[4].output ?? '') && (await fileText('notes.txt')) === notes0, escape42[4])
      check('the agent sees why each one failed', lastText42(w42.v).includes('outside the folder') && lastText42(w42.v).includes('inside .git'), lastText42(w42.v))

      // Deleting always asks, even with edits accepted; the file goes to the Recycle Bin and comes back.
      code.send(cs.id, 'CODEDELETE')
      w42 = await codeWait('pending')
      await untilUi(`!!document.querySelector('.code-pending')`)
      const delCard = await js<{ head: string } | null>(card42)
      check('deleting asks even when edits are accepted', w42.v.pending?.kind === 'delete' && w42.v.mode === 'edits' && !!delCard?.head.includes('Move this file to the Recycle Bin?'), delCard)
      await click42('Approve')
      w42 = await codeWait('done')
      check('a deleted file goes to the Recycle Bin', (await fileText('old.txt')) === null && (await recycled42()).some((f) => f.endsWith('-old.txt')))
      await code.undo(cs.id, false)
      check('and Undo brings it back', (await fileText('old.txt')) === 'old log\n')

      // A risky command always asks with a warning, can't be allowed for good, and a no is explained.
      code.send(cs.id, 'CODERISKY')
      w42 = await codeWait('pending')
      await untilUi(`!!document.querySelector('.code-pending .code-risk')`)
      const riskCard = await js<{ risk: string | null; buttons: string[] } | null>(card42)
      check(
        'a risky command is flagged and cannot be allowed for the session',
        w42.v.pending?.risk === 'it deletes files' && !!riskCard?.risk?.includes('it deletes files') && !riskCard.buttons.includes('Always allow this command'),
        riskCard
      )
      win.webContents.focus()
      await js(`document.querySelector('.code-decline-note')?.focus()`)
      win.webContents.insertText('Keep the build')
      await untilUi(`document.querySelector('.code-decline-note')?.value === 'Keep the build'`)
      await click42('Decline')
      w42 = await codeWait('done')
      check('declining tells the agent why, and nothing runs', lastText42(w42.v).includes('The user declined. They said: Keep the build') && (await fileText('build/keep.txt')) === 'built\n', lastText42(w42.v))

      // Allowing a command for the session lets that exact command through next time.
      code.send(cs.id, 'CODEALLOW')
      w42 = await codeWait('pending')
      code.respond(cs.id, w42.v.pending!.id, { approve: true, always: true })
      w42 = await codeWait('done')
      const allow42 = toolEntries(w42.v).slice(-2)
      check(
        'a command allowed for the session runs again without asking',
        !w42.asked && w42.v.allowed.includes('Write-Output hi') && allow42.every((e) => e.tool === 'run_command' && e.status === 'done' && e.output?.trim() === 'hi'),
        allow42
      )

      // Read only: changes and commands are declined without asking.
      code.setOptions(cs.id, { mode: 'read' })
      code.send(cs.id, 'CODEREAD')
      w42 = await codeWait('done')
      check('read only declines changes and commands', !w42.asked && (await fileText('x.txt')) === null && toolEntries(w42.v).slice(-2).every((e) => e.status === 'declined'), toolEntries(w42.v).slice(-2))

      // Stopping while the agent waits closes its open call, so the next request is still valid.
      code.send(cs.id, 'CODEASK')
      await codeWait('pending')
      code.stop(cs.id)
      w42 = await codeWait('done')
      code.send(cs.id, 'CODEPLAIN after a stop')
      w42 = await codeWait('done')
      const afterStop = log.at(-1)?.messages ?? []
      const callIds = afterStop.flatMap((m) => ((m as { tool_calls?: { id: string }[] }).tool_calls ?? []).map((c) => c.id))
      const answered42 = new Set(afterStop.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id?: string }).tool_call_id))
      check('a stop leaves every call answered', !w42.v.error && callIds.length > 0 && callIds.every((id) => answered42.has(id)), { callIds, answered: [...answered42], error: w42.v.error })

      // Deleting a session drops its snapshots, never the project's files.
      await code.deleteSession(cs.id)
      check(
        "deleting a session removes its history and snapshots, not your files",
        !code.listSessions().some((x) => x.id === cs.id) && !existsSync(join(app.getPath('userData'), 'code-snapshots', cs.id)) && (await fileText('notes.txt')) === notes0,
        code.listSessions()
      )
      await untilUi(`!document.querySelector('.code-session-item')`)
      await js(`document.querySelector('.rail-item[data-mode="chat"]')?.click()`)

      // 42b. More in Code: plan mode, the agent's task list, the project's instructions file, web
      // tools (Claude's) and rewinding to any message.
      await writeFile(join(proj, 'AGENTS.md'), 'Use two spaces for indents.\n')
      const cp42 = (await code.newSession(null, proj))!
      code.setOptions(cp42.id, { providerId: 'mock', modelId: 'mock-a', mode: 'plan' })
      const done42 = async (want: 'pending' | 'done' = 'done'): Promise<ReturnType<typeof code.openSession>> => {
        for (const end = Date.now() + 15000; Date.now() < end; ) {
          const v = code.openSession(cp42.id)
          if (want === 'pending' ? v.pending : !v.running) return v
          await new Promise((r) => setTimeout(r, 30))
        }
        throw new Error('Timed out waiting for the code agent (42b)')
      }
      const lastUser42 = (): string => String([...(log.at(-1)?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '')
      check('the project instructions file is read into the session', cp42.instructions === 'AGENTS.md')
      const before42b = log.length
      code.send(cp42.id, 'CODEPLAN tidy the notes')
      let v42 = await done42()
      const system42 = String(log[before42b]?.messages[0]?.content ?? '')
      check("the agent is given the project's instructions", system42.includes('<project_instructions>') && system42.includes('Use two spaces for indents.'), system42.slice(-200))
      check('plan mode is told to the model with the message', String(log[before42b]?.messages.at(-1)?.content ?? '').includes('Plan mode:'))
      const planned42 = v42.entries.filter((e) => e.kind === 'tool').at(-1) as { status?: string; output?: string } | undefined
      check('in plan mode, changes are declined until the plan is run', planned42?.status === 'declined' && (await fileText('plan.txt')) === null && v42.planReady, { planned42, planReady: v42.planReady })

      await js(`document.querySelector('.rail-item[data-mode="code"]')?.click()`)
      await untilUi(`!!document.querySelector('.code-session-item')`)
      await js(`(() => { const row = [...document.querySelectorAll('.code-session-item')].find((r) => r.querySelector('.tw-conv-title')?.textContent.startsWith('CODEPLAN')); row?.click(); return !!row })()`)
      const bar42 = await untilUi(`!!document.querySelector('.code-plan-bar')`)
      await new Promise((r) => setTimeout(r, 600))
      await shot('e2e-code-plan.png')
      await click42('Run this plan, asking first', '.code-plan-bar')
      await new Promise((r) => setTimeout(r, 200))
      v42 = await done42()
      check('Run this plan carries it out, and the model hears it was approved', bar42 && v42.mode === 'ask' && lastUser42().includes('The user approved the plan') && !v42.planReady, { bar42, mode: v42.mode })

      code.setOptions(cp42.id, { mode: 'edits' })
      code.send(cp42.id, 'CODETASKS')
      v42 = await done42()
      const tasksUi42 = await js<string>(`(async () => { for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.code-tasks'); ) await new Promise((r) => setTimeout(r, 30)); return document.querySelector('.code-tasks-head')?.textContent ?? '' })()`)
      await new Promise((r) => setTimeout(r, 400))
      await shot('e2e-code-tasks.png')
      check('the agent keeps a task list that shows above the message box', v42.tasks.map((t) => `${t.status}:${t.title}`).join() === 'done:Read the notes,doing:Change the lamps' && tasksUi42 === 'Tasks · 1 of 2 done', { tasks: v42.tasks, tasksUi42 })

      await writeFile(join(proj, 'AGENTS.md'), 'Use tabs.\n')
      const before42c = log.length
      code.send(cp42.id, 'CODEPLAIN again')
      await done42()
      check(
        'a changed instructions file goes in with the next message, and the system prompt stays',
        lastUser42().includes('<project_instructions>') && lastUser42().includes('Use tabs.') && log[before42c]?.messages[0]?.content === log[before42b]?.messages[0]?.content
      )

      const before42d = log.length
      code.send(cp42.id, 'CODECREATE')
      v42 = await done42()
      const madeFile42 = (await fileText('src/new.txt')) === 'fresh\n'
      const at42 = v42.entries.findIndex((e) => e.kind === 'user' && e.text === 'CODECREATE')
      await untilUi(`[...document.querySelectorAll('.code-user-row')].some((r) => r.querySelector('.code-user')?.textContent === 'CODECREATE')`)
      await js(`(() => { const row = [...document.querySelectorAll('.code-user-row')].find((r) => r.querySelector('.code-user')?.textContent === 'CODECREATE'); row?.querySelector('.code-rewind')?.click() })()`)
      await new Promise((r) => setTimeout(r, 100))
      await js(`document.querySelector('.code-rewind.tw-btn-danger')?.click()`)
      const back42 = await untilUi(`document.querySelector('.code-view textarea')?.value === 'CODECREATE'`)
      v42 = code.openSession(cp42.id)
      check(
        'rewinding puts files back, cuts the conversation there, and returns the message to the box',
        madeFile42 && back42 && (await fileText('src/new.txt')) === null && (await fileText('notes.txt')) === notes0 && v42.entries.length === at42 && v42.undoable.length === 0,
        { madeFile42, back42, entries: v42.entries.length, at42 }
      )
      code.send(cp42.id, 'CODEPLAIN after rewinding')
      await done42()
      const prefix42 = log[before42d]!.messages.length - 1
      check('after a rewind, the next request starts from the same cached prefix', JSON.stringify(log.at(-1)!.messages.slice(0, prefix42)) === JSON.stringify(log[before42d]!.messages.slice(0, prefix42)))
      check('web tools are offered only with Claude', !v42.webAvailable && codeWebTools('claude-opus-5-5').map((t) => `${t.name}:${t.type}`).join() === 'web_search:web_search_20260209,web_fetch:web_fetch_20260209')
      await code.deleteSession(cp42.id)
      await rename(join(proj, 'AGENTS.md'), join(outDir, 'AGENTS-used.md'))
      await js(`document.querySelector('.rail-item[data-mode="chat"]')?.click()`)

      // 43. Scroll particles: off until switched on, then each style makes a few on a slow scroll
      // and a shower on a fast one, fades out and stops drawing. Scrolls you didn't make (a reply
      // being followed) make none, and Motion other than Full turns them off.
      const c43 = chat.create().id
      let parent43 = db.getConversation(c43).root_id
      for (let i = 0; i < 30; i++) {
        const u = db.insertNode({ id: randomUUID(), conversation_id: c43, parent_id: parent43, role: 'user', text: `Light lamp ${i}.`, content: null, thinking: null, model: null, provider_id: null, usage: null, status: 'done', error: null })
        const text = `Wren climbed to lamp ${i} and trimmed the wick. `.repeat(12)
        parent43 = db.insertNode({ id: randomUUID(), conversation_id: c43, parent_id: u.id, role: 'assistant', text, content: JSON.stringify([{ type: 'text', text }]), thinking: null, model: 'mock-a', provider_id: 'mock', usage: null, status: 'done', error: null }).id
      }
      db.updateConversation(c43, { started: 1, title: 'Particles in the lamplight' })
      await reloadUi()
      const openFx = `
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const frame = () => new Promise((r) => requestAnimationFrame(r))
        const toChat = async () => {
          document.querySelector('.rail-item[data-mode="chat"]')?.click()
          await wait(150)
          ;[...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Particles in the lamplight')?.click()
          for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.thread-scroll .msg'); ) await wait(30)
          await wait(200)
        }`
      const fxOff43 = await js<{ canvas: boolean }>(`(async () => {
        ${openFx}
        await toChat()
        return { canvas: !!document.querySelector('.scroll-fx') }
      })()`)
      await key(',', ['control'])
      const fxSwitch43 = await js<{ offered: boolean; styles: string[]; note: string }>(`(async () => {
        ${openFx}
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /Extras/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('label.check'); ) await wait(50)
        const box = [...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('Particles when scrolling chats'))?.querySelector('input')
        const offered = !!box && !box.checked
        box?.click()
        await wait(100)
        return { offered, styles: [...document.querySelectorAll('.fx-seg button')].map((b) => b.textContent), note: document.querySelector('.fx-seg + .field-note')?.textContent ?? '' }
      })()`)
      check('scroll particles are off until you switch them on', !fxOff43.canvas && fxSwitch43.offered, { fxOff43, fxSwitch43 })
      check('Settings → Extras offers them, with six styles', fxSwitch43.styles.join() === 'Stardust,Sparks,Fireflies,Snow,Constellations,Bats' && fxSwitch43.note.includes('faster you scroll'), fxSwitch43)
      // A slow scroll (3 px a frame) then a fast one (40 px a frame), each step a wheel turn.
      const runFx = async (style: string): Promise<{ style: string | null; slow: number; fast: number; peak: number; links: number; alive: number; after: number; quietSpawned: number; avgDrawMs: number; sized: boolean; ignoresMouse: boolean }> => {
        await key(',', ['control'])
        await js(`(async () => {
          ${openFx}
          ;[...document.querySelectorAll('.settings-nav button')].find((b) => /Extras/.test(b.textContent))?.click()
          for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.fx-seg'); ) await wait(50)
          ;[...document.querySelectorAll('.fx-seg button')].find((b) => b.textContent === ${JSON.stringify(style)})?.click()
          await wait(100)
          await toChat()
        })()`)
        const out = await js<{ style: string | null; slow: number; fast: number; peak: number; links: number; alive: number; sized: boolean; ignoresMouse: boolean }>(`(async () => {
          ${openFx}
          const el = document.querySelector('.thread-scroll')
          const fx = () => document.querySelector('.scroll-fx')
          const canvas = fx()
          if (!canvas) return { style: null, slow: 0, fast: 0, peak: 0, links: 0, alive: 0, sized: false, ignoresMouse: false }
          el.scrollTop = 0
          await wait(400)
          const s0 = canvas.fxStats.spawned
          for (let i = 0; i < 90; i++) { el.dispatchEvent(new WheelEvent('wheel')); el.scrollTop += 3; await frame() }
          const slow = canvas.fxStats.spawned - s0
          await wait(2800)
          const s1 = canvas.fxStats.spawned
          for (let i = 0; i < 60; i++) { el.dispatchEvent(new WheelEvent('wheel')); el.scrollTop += 40; await frame() }
          return {
            style: canvas.dataset.style,
            slow,
            fast: canvas.fxStats.spawned - s1,
            peak: canvas.fxStats.peak,
            links: canvas.fxStats.links,
            alive: canvas.fxStats.alive,
            sized: Math.abs(canvas.getBoundingClientRect().height - el.clientHeight) < 2 && Math.abs(canvas.getBoundingClientRect().width - el.clientWidth) < 2,
            ignoresMouse: getComputedStyle(canvas).pointerEvents === 'none'
          }
        })()`)
        await shot(`e2e-particles-${style.toLowerCase()}.png`)
        const rest = await js<{ after: number; quietSpawned: number; avgDrawMs: number }>(`(async () => {
          ${openFx}
          const el = document.querySelector('.thread-scroll')
          const canvas = document.querySelector('.scroll-fx')
          await wait(3200)
          const after = canvas.fxStats.alive
          // Scrolling with no wheel, key or pointer behind it, like following a streaming reply.
          const s2 = canvas.fxStats.spawned
          for (let i = 0; i < 30; i++) { el.scrollTop -= 30; await frame() }
          return { after, quietSpawned: canvas.fxStats.spawned - s2, avgDrawMs: +(canvas.fxStats.drawMs / Math.max(1, canvas.fxStats.frames)).toFixed(3) }
        })()`)
        return { ...out, ...rest }
      }
      for (const style of ['Stardust', 'Sparks', 'Fireflies', 'Snow', 'Constellations', 'Bats']) {
        const r = await runFx(style)
        check(`${style}: the particles draw over the chat without taking the mouse`, r.style === style.toLowerCase() && r.sized && r.ignoresMouse, r)
        check(`${style}: a slow scroll makes a few, a fast one many more`, r.slow >= 1 && r.slow <= 12 && r.fast >= 30 && r.fast >= r.slow * 6, r)
        check(`${style}: they fade out and drawing stops`, r.alive > 0 && r.after === 0, r)
        check(`${style}: scrolls you didn't make leave them alone`, r.quietSpawned === 0, r)
        check(`${style}: drawing stays cheap`, r.avgDrawMs < 4 && r.peak <= 240, r)
        if (style === 'Constellations') check('constellations join nearby stars with lines', r.links > 0, r)
        else check(`${style}: no constellation lines`, r.links === 0, r)
      }
      // Motion other than Full turns them off; switching them off removes the canvas.
      await key(',', ['control'])
      const fxMotion43 = await js<{ gentle: boolean; note: string }>(`(async () => {
        ${openFx}
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /Extras/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.fx-seg'); ) await wait(50)
        const general = async () => { ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click(); for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.motion-seg'); ) await wait(50) }
        const extras = async () => { ;[...document.querySelectorAll('.settings-nav button')].find((b) => /Extras/.test(b.textContent))?.click(); for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.fx-seg'); ) await wait(50) }
        await general()
        ;[...document.querySelectorAll('.motion-seg button')].find((b) => b.textContent === 'Gentle').click()
        await wait(100)
        await extras()
        const note = document.querySelector('.fx-seg + .field-note')?.textContent ?? ''
        await toChat()
        return { gentle: !!document.querySelector('.scroll-fx'), note }
      })()`)
      await key(',', ['control'])
      const fxBack43 = await js<{ off: boolean }>(`(async () => {
        ${openFx}
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /Extras/.test(b.textContent))?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.fx-seg'); ) await wait(50)
        const general = async () => { ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click(); for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.motion-seg'); ) await wait(50) }
        const extras = async () => { ;[...document.querySelectorAll('.settings-nav button')].find((b) => /Extras/.test(b.textContent))?.click(); for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.fx-seg'); ) await wait(50) }
        await general()
        ;[...document.querySelectorAll('.motion-seg button')].find((b) => b.textContent === 'Full').click()
        await wait(100)
        await extras()
        ;[...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('Particles when scrolling chats'))?.querySelector('input')?.click()
        await wait(100)
        await toChat()
        return { off: !document.querySelector('.scroll-fx') }
      })()`)
      check('with Motion on Gentle there are no particles, and Settings says why', !fxMotion43.gentle && fxMotion43.note.includes('only with Motion set to Full'), fxMotion43)
      check('switching them off removes them', fxBack43.off)

      // Settings' group names have to read as headings, not as one more page.
      await key(',', ['control'])
      const groups44 = await js<{ names: string[]; heading: string; page: string; weight: string; ruled: boolean }>(`(async () => {
        await new Promise((r) => setTimeout(r, 200))
        const head = document.querySelector('.settings-nav .side-section')
        const item = document.querySelector('.settings-nav-item:not([aria-current="true"])')
        const second = document.querySelectorAll('.settings-nav > div')[1]
        return {
          names: [...document.querySelectorAll('.settings-nav .side-section')].map((e) => e.textContent),
          heading: getComputedStyle(head).color,
          page: getComputedStyle(item).color,
          weight: getComputedStyle(head).fontWeight,
          ruled: getComputedStyle(second).borderTopStyle === 'solid'
        }
      })()`)
      check('Settings group names stand out from the pages under them', groups44.names.join() === 'App,Models,About' && groups44.heading !== groups44.page && Number(groups44.weight) >= 700 && groups44.ruled, groups44)
      await shot('e2e-settings-groups.png')
      await js(`document.querySelector('.rail-item[data-mode="chat"]')?.click()`)

      // 45. MCP servers and pictures. A program started over stdio and a server at an address
      // give the chat tools; calls wait for approval in the reply unless allowed; rounds are stored
      // in the reply and replayed exactly; pictures come from the images endpoint.
      const script45 = join(outDir, 'mcp-lamps.cjs')
      writeFileSync(script45, MCP_STDIO_SERVER)
      let list45 = mcp.saveServer({
        id: '', name: 'Lamp tools', kind: 'stdio', command: process.execPath, args: [script45], cwd: '', url: '', enabled: true, approval: 'ask', allowedTools: [], envKeys: [], headerKeys: [],
        env: { ELECTRON_RUN_AS_NODE: '1', MOCK_TOKEN: 'tok-123' }
      })
      const lamps45 = list45.find((s) => s.name === 'Lamp tools')!
      list45 = await mcp.testServer(lamps45.id)
      const st45 = list45.find((s) => s.id === lamps45.id)!.status
      check('a program started over stdio connects and lists its tools', st45.state === 'ready' && st45.info === 'lamp-tools 1.0' && st45.tools.map((t) => t.name).join() === 'count_lamps,light_lamp' && st45.tools[0].readOnly, st45)
      check("its environment values stay out of the window's view", !JSON.stringify(mcp.listServers()).includes('tok-123') && lamps45.envKeys.join() === 'ELECTRON_RUN_AS_NODE,MOCK_TOKEN', lamps45.envKeys)
      check('two servers cannot share a name', (() => { try { mcp.saveServer({ ...lamps45, id: '', name: 'lamp tools' }); return false } catch { return true } })())

      const c45 = chat.create().id
      chat.updateSettings(c45, { providerId: 'mock', modelId: 'mock-a', mcpServers: [lamps45.id], choiceCards: false })
      db.updateConversation(c45, { started: 1, title: 'Lamps with tools' })
      await reloadUi()
      await js(`(async () => {
        ;[...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Lamps with tools')?.click()
        await new Promise((r) => setTimeout(r, 500))
      })()`)
      const waitApproval = (): Promise<{ head: string; input: string } | null> =>
        js(`(async () => {
          for (let end = Date.now() + 8000; Date.now() < end; ) {
            const card = document.querySelector('.tool-approval')
            if (card) return { head: card.querySelector('.tool-approval-head').textContent, input: card.querySelector('.tool-approval-input').textContent }
            await new Promise((r) => setTimeout(r, 30))
          }
          return null
        })()`)
      const clickApproval = (label: string): Promise<boolean> =>
        js(`(() => { const b = [...document.querySelectorAll('.tool-approval button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b })()`)
      // Sent from the composer, as you would, so the window follows the reply it started.
      const uiSend = async (text: string): Promise<void> => {
        win.webContents.focus()
        await js(`document.querySelector('.tw-composer textarea')?.focus()`)
        win.webContents.insertText(text)
        await js(`(async () => {
          for (let end = Date.now() + 2000; Date.now() < end && document.querySelector('.tw-composer .tw-send')?.disabled; ) await new Promise((r) => setTimeout(r, 30))
          document.querySelector('.tw-composer .tw-send')?.click()
          await new Promise((r) => setTimeout(r, 100))
        })()`)
      }
      const before45 = log.length
      await uiSend('MCPCALL lamp_tools__light_lamp {"n":3}')
      const card45 = await waitApproval()
      check('a tool call waits for approval, showing the tool and its arguments', !!card45?.head.includes('light_lamp') && card45.head.includes('Lamp tools') && card45.input.includes('"n": 3'), card45)
      await shot('e2e-mcp-approval.png')
      await clickApproval('Allow once')
      await idle(c45)
      let last45 = chat.view(c45).path.at(-1)!
      check('an allowed call runs and the reply carries on with its result', last45.text.includes('Answering the tool result: Lamp 3 is lit.') && last45.tools?.[0]?.tool === 'light_lamp' && last45.tools[0].status === 'done', last45)
      const req45 = log.slice(before45)
      const tools45 = ((req45[0]?.body as { tools?: { function: { name: string; description: string } }[] }).tools ?? []).map((t) => t.function)
      check("the chat offers the server's tools under its name", tools45.map((t) => t.name).join() === 'lamp_tools__count_lamps,lamp_tools__light_lamp' && tools45[0].description.startsWith('[Lamp tools]'), tools45)
      check(
        'the second request is the first plus the round, unchanged',
        req45.length === 2 && JSON.stringify(req45[1].messages.slice(0, req45[0].messages.length)) === JSON.stringify(req45[0].messages) && req45[1].messages.at(-1)?.role === 'tool',
        req45.map((r) => r.messages.length)
      )

      await uiSend('MCPCALL lamp_tools__light_lamp {"n":4}')
      await waitApproval()
      await clickApproval('Decline')
      await idle(c45)
      last45 = chat.view(c45).path.at(-1)!
      check('a declined call tells the model so, and shows as declined', last45.text.includes(DECLINED) && last45.tools?.[0]?.status === 'declined', last45.tools)

      await uiSend('MCPCALL lamp_tools__light_lamp {"n":5}')
      await waitApproval()
      await clickApproval('Always allow light_lamp')
      await idle(c45)
      const allowed45 = mcp.listServers().find((s) => s.id === lamps45.id)!.allowedTools
      const before45b = log.length
      chat.send(contents, c45, 'MCPCALL lamp_tools__light_lamp {"n":6}')
      await idle(c45)
      check('an always-allowed tool runs without asking next time', allowed45.join() === 'light_lamp' && chat.view(c45).path.at(-1)!.text.includes('Lamp 6 is lit.') && log.length - before45b === 2, allowed45)

      // Several rounds in one reply, each replayed in the next request; the server's token arrived.
      mcp.saveServer({ ...mcp.listServers().find((s) => s.id === lamps45.id)!, approval: 'allow' })
      const before45c = log.length
      await uiSend('MCPCALL lamp_tools__count_lamps {"street":"Harrow Lane"} ;; lamp_tools__light_lamp {"n":1}')
      await idle(c45)
      last45 = chat.view(c45).path.at(-1)!
      const req45c = log.slice(before45c)
      check('a reply can run several rounds of tools', req45c.length === 3 && last45.tools?.map((t) => t.tool).join() === 'count_lamps,light_lamp' && last45.text.includes('Lamp 1 is lit.'), last45.tools)
      check('a server gets the environment values set for it', !!last45.tools?.[0]?.output.includes('token:set'), last45.tools?.[0])
      check('each round is replayed exactly in the next', req45c.every((r, i) => i === 0 || JSON.stringify(r.messages.slice(0, req45c[i - 1].messages.length)) === JSON.stringify(req45c[i - 1].messages)), req45c.map((r) => r.messages.length))
      const ui45 = await js<{ steps: string[]; open: string }>(`(async () => {
        await new Promise((r) => setTimeout(r, 300))
        const msg = [...document.querySelectorAll('.tw-msg-ai')].at(-1)
        const steps = [...(msg?.querySelectorAll('.tool-step .web-what') ?? [])].map((e) => e.textContent)
        msg?.querySelector('.tool-step summary')?.click()
        await new Promise((r) => setTimeout(r, 150))
        return { steps, open: msg?.querySelector('.tool-step[open] .tool-io')?.textContent ?? '' }
      })()`)
      check('the reply lists the tools it used, with what went in and out', ui45.steps.join('|') === 'lamp_tools: count_lamps|lamp_tools: light_lamp' && ui45.open.includes('Harrow Lane has 9 lamps'), ui45)
      await shot('e2e-mcp-steps.png')

      // With the server switched off for the chat, earlier rounds are told as text.
      chat.updateSettings(c45, { mcpServers: [] })
      chat.send(contents, c45, 'And now?')
      await idle(c45)
      const off45 = log.at(-1)!
      check(
        "rounds whose tools aren't offered any more are replayed as text",
        !(off45.body as { tools?: unknown }).tools && !off45.messages.some((m) => m.role === 'tool') && off45.messages.some((m) => String(m.content).includes('(Called lamp_tools__light_lamp')),
        off45.messages.length
      )

      // Stopping while a call waits declines it and ends the reply.
      mcp.saveServer({ ...mcp.listServers().find((s) => s.id === lamps45.id)!, approval: 'ask', allowedTools: [] })
      chat.updateSettings(c45, { mcpServers: [lamps45.id] })
      await uiSend('MCPCALL lamp_tools__light_lamp {"n":8}')
      await waitApproval()
      chat.stop(c45)
      await idle(c45)
      const gone45 = await js<boolean>(`(async () => { await new Promise((r) => setTimeout(r, 300)); return !document.querySelector('.tool-approval') })()`)
      check('stopping a reply that waits on a tool declines it', chat.view(c45).path.at(-1)!.status === 'stopped' && gone45)

      // A server at an address, with a header it needs.
      let http45 = mcp.saveServer({ id: '', name: 'Library', kind: 'http', command: '', args: [], cwd: '', url: `http://127.0.0.1:${port}/mcp`, enabled: true, approval: 'allow', allowedTools: [], envKeys: [], headerKeys: [], headers: { 'x-token': 'wrong' } })
      const lib45 = http45.find((s) => s.name === 'Library')!
      http45 = await mcp.testServer(lib45.id)
      const bad45 = http45.find((s) => s.id === lib45.id)!.status
      check('a server that refuses shows why', bad45.state === 'error' && /401/.test(bad45.error ?? ''), bad45)
      mcp.saveServer({ ...lib45, headers: { 'x-token': 'shelf' } })
      http45 = await mcp.testServer(lib45.id)
      const good45 = http45.find((s) => s.id === lib45.id)!.status
      check('a server at an address connects over HTTP', good45.state === 'ready' && good45.info === 'library 2.1' && good45.tools[0]?.name === 'find_book', good45)
      chat.updateSettings(c45, { mcpServers: [lib45.id] })
      chat.send(contents, c45, 'MCPCALL library__find_book {"title":"The Lamplighter\'s Log"}')
      await idle(c45)
      check('its tools run in a chat', chat.view(c45).path.at(-1)!.text.includes("Found The Lamplighter's Log on shelf 4."), chat.view(c45).path.at(-1)!.text)

      // A server that won't start fails the reply with the reason.
      const broken45 = mcp.saveServer({ id: '', name: 'Broken', kind: 'stdio', command: 'twilight-no-such-program', args: [], cwd: '', url: '', enabled: true, approval: 'ask', allowedTools: [], envKeys: [], headerKeys: [] }).find((s) => s.name === 'Broken')!
      chat.updateSettings(c45, { mcpServers: [broken45.id] })
      chat.send(contents, c45, 'Hello')
      await idle(c45)
      const err45 = chat.view(c45).path.at(-1)!
      check("a server that can't start fails the reply with the reason", err45.status === 'error' && /Broken couldn't connect/.test(err45.error ?? ''), err45.error)
      mcp.deleteServer(broken45.id)

      // Pictures from the images endpoint, saved and shown in the reply.
      setImageConfig({ providerId: 'mock', modelId: 'mock-img', size: '1024x1024' })
      chat.updateSettings(c45, { mcpServers: [], imageGen: true })
      const before45d = log.length
      await uiSend('MCPCALL generate_image {"prompt":"a lamp at dusk"}')
      await idle(c45)
      const pic45 = chat.view(c45).path.at(-1)!
      const imgTool45 = ((log[before45d]?.body as { tools?: { function: { name: string } }[] }).tools ?? []).map((t) => t.function.name)
      check('with Pictures on, the chat offers generate_image', imgTool45.join() === 'generate_image', imgTool45)
      check('a picture is made, saved and kept with the reply', pic45.images?.length === 1 && pic45.images[0].prompt === 'a lamp at dusk' && existsSync(join(app.getPath('userData'), 'generated', pic45.images[0].file)), pic45.images)
      const shown45 = await js<number>(`(async () => {
        for (let end = Date.now() + 4000; Date.now() < end; ) {
          const img = [...document.querySelectorAll('.gen-image img')].at(-1)
          if (img?.complete && img.naturalWidth) return img.naturalWidth
          await new Promise((r) => setTimeout(r, 50))
        }
        return 0
      })()`)
      check('the picture shows in the reply', shown45 === 1, shown45)

      // An image model as the chat's own model: asked for pictures, and the one it sends is kept.
      const drawer45 = (await providers.listModels()).find((m) => m.id === 'mock-b')
      check('a model that outputs images is marked so', !!drawer45?.options?.imageOutput && !!drawer45.capabilities?.includes('Image output'), drawer45?.capabilities)
      chat.updateSettings(c45, { modelId: 'mock-b', imageGen: false })
      const before45e = log.length
      await uiSend('IMAGEOUT a lamp at dusk')
      await idle(c45)
      const drew45 = chat.view(c45).path.at(-1)!
      check('an image model is asked for pictures as well as text', JSON.stringify((log[before45e]?.body as { modalities?: string[] }).modalities) === '["image","text"]', log[before45e]?.body)
      check("the picture an image model sends is kept with its reply", drew45.text === 'Here is your lamp.' && drew45.images?.length === 1 && drew45.images[0].prompt === 'IMAGEOUT a lamp at dusk', drew45.images)
      const drawn45 = await js<number>(`(async () => {
        for (let end = Date.now() + 4000; Date.now() < end; ) {
          const img = [...document.querySelectorAll('.tw-msg-ai')].at(-1)?.querySelector('.gen-image img')
          if (img?.complete && img.naturalWidth) return img.naturalWidth
          await new Promise((r) => setTimeout(r, 50))
        }
        return 0
      })()`)
      check('and it shows under the reply', drawn45 === 1, drawn45)
      const plain45 = log.length
      chat.updateSettings(c45, { modelId: 'mock-a' })
      chat.send(contents, c45, 'Plain words')
      await idle(c45)
      check('other models are not asked for pictures', !(log[plain45]?.body as { modalities?: unknown }).modalities)

      // Claude's side, on the pure builders: a stored round splits into the turns it took, and a
      // round whose tools aren't offered is told as text.
      const round45 = row('assistant', [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_9', name: 'lamp_tools__count_lamps', input: { street: 'Quay' } },
        { type: 'tool_results', results: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: [{ type: 'text', text: '9 lamps' }] }] },
        { type: 'generated_image', file: 'x.png', prompt: 'p' },
        { type: 'text', text: 'Nine.' }
      ])
      const split45 = toMessages([row('user', [{ type: 'text', text: 'Count' }]), round45], new Set(), new Set(['lamp_tools__count_lamps']))
      check('a Claude reply with a round replays as assistant, results, assistant', split45.map((m) => m.role).join() === 'user,assistant,user,assistant' && (split45[2].content as { type: string }[])[0].type === 'tool_result' && (split45[3].content as { text?: string }[])[0].text === 'Nine.', split45)
      const told45 = toMessages([row('user', [{ type: 'text', text: 'Count' }]), round45], new Set(), new Set())
      check('without its tool, the round is told as text', !JSON.stringify(told45).includes('"tool_use"') && JSON.stringify(told45).includes('9 lamps'), told45)
      const claudeTools45 = anthropicTools({ ...chat.getDefaults(), webSearch: true }, [{ name: 'lamp_tools__count_lamps', description: 'x', input_schema: { type: 'object' } }]).map((t) => t.name)
      check("Claude gets MCP tools after its own, in a fixed order", claudeTools45.join() === 'web_search,lamp_tools__count_lamps', claudeTools45)

      // Settings → Tools and the Tools menu.
      await key(',', ['control'])
      const settings45 = await js<{ servers: string[]; states: string[] }>(`(async () => {
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === 'Tools')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.mcp-server'); ) await new Promise((r) => setTimeout(r, 50))
        return { servers: [...document.querySelectorAll('.mcp-name')].map((e) => e.textContent), states: [...document.querySelectorAll('.mcp-state')].map((e) => e.textContent) }
      })()`)
      check('Settings → Tools lists the servers and how they are', settings45.servers.join() === 'Lamp tools,Library' && settings45.states.every((s) => s.startsWith('Connected')), settings45)
      await shot('e2e-mcp-settings.png')
      // The chat's switches were changed from here, so the window loads it afresh.
      await reloadUi()
      const menu45 = await js<string[]>(`(async () => {
        ;[...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === 'Lamps with tools')?.click()
        await new Promise((r) => setTimeout(r, 500))
        ;[...document.querySelectorAll('.tools-menu button')].find((b) => b.textContent.includes('Tools'))?.click()
        await new Promise((r) => setTimeout(r, 250))
        const rows = [...document.querySelectorAll('.tools-row[data-tool^="mcp:"], .tools-row[data-tool="imageGen"]')].map((r) => r.dataset.tool + '=' + r.querySelector('input').checked)
        ;[...document.querySelectorAll('.tools-menu button')].find((b) => b.textContent.includes('Tools'))?.click()
        return rows
      })()`)
      check('the Tools menu switches servers and pictures per chat', menu45.join() === 'mcp:Lamp tools=false,mcp:Library=false,imageGen=false', menu45)
      mcp.closeAll()

      // Your own message has a regenerate button too: it adds another version of the reply to it.
      const regenUi45 = await js<boolean>(`(() => {
        const mine = [...document.querySelectorAll('.msg-user-row')].at(-1)
        const b = mine?.querySelector('button[aria-label="Regenerate the reply"]')
        b?.click()
        return !!b
      })()`)
      await new Promise((r) => setTimeout(r, 200))
      await idle(c45)
      const again45 = chat.view(c45).path.at(-1)!
      check('your message can regenerate the reply to it', regenUi45 && again45.role === 'assistant' && again45.siblingCount === 2 && again45.siblingIndex === 1, { regenUi45, siblings: again45.siblingCount })

      // 47. Spelling: Windows' own spellchecker marks a misspelled word as you type, offline, and a
      // right-click offers suggestions that replace it.
      showContextMenus(false)
      check('spelling is checked by default', win.webContents.session.isSpellCheckerEnabled())
      win.webContents.focus()
      await js(`(() => { const t = document.querySelector('.tw-composer textarea'); t.focus(); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      win.webContents.insertText('teh ')
      await new Promise((r) => setTimeout(r, 1500))
      const at47 = await js<{ x: number; y: number }>(`(() => { const r = document.querySelector('.tw-composer textarea').getBoundingClientRect(); return { x: Math.round(r.left + 14), y: Math.round(r.top + 14) } })()`)
      const menu47 = await new Promise<Electron.ContextMenuParams | null>((resolve) => {
        const done = setTimeout(() => resolve(null), 4000)
        win.webContents.once('context-menu', (_e, p) => {
          clearTimeout(done)
          resolve(p)
        })
        win.webContents.sendInputEvent({ type: 'mouseDown', x: at47.x, y: at47.y, button: 'right', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x: at47.x, y: at47.y, button: 'right', clickCount: 1 })
      })
      check('a misspelled word is found offline, with suggestions', menu47?.misspelledWord === 'teh' && menu47.dictionarySuggestions.includes('the'), menu47 && { word: menu47.misspelledWord, suggestions: menu47.dictionarySuggestions })
      const items47 = menu47 ? contextMenuItems(win.webContents, menu47) : []
      check('the right-click menu offers the suggestions, adding the word, and editing', ['the', 'Add to dictionary', 'Cut', 'Copy', 'Paste'].every((l) => items47.some((i) => i.label === l)), items47.map((i) => i.label))
      items47.find((i) => i.label === 'the')?.click?.(undefined as never, undefined, undefined as never)
      const fixed47 = await js<string>(`(async () => { await new Promise((r) => setTimeout(r, 300)); return document.querySelector('.tw-composer textarea').value })()`)
      check('choosing a suggestion fixes the word', fixed47.startsWith('the'), fixed47)
      await js(`(() => { const t = document.querySelector('.tw-composer textarea'); t.select(); return true })()`)
      win.webContents.delete()
      setSpellcheck(win, false)
      const off47 = win.webContents.session.isSpellCheckerEnabled()
      setSpellcheck(win, true)
      check('spelling can be switched off and on', !off47 && win.webContents.session.isSpellCheckerEnabled())
      showContextMenus(true)

      // 46. Backups and where the data lives. Backups are made from the running app; a restore
      // and a move are done at start, so they're checked on folders of their own here.
      const H = 60 * 60 * 1000
      check(
        'backups are due on schedule',
        !backupDue({ schedule: 'off', keep: 10, folder: '' }, undefined, Date.now()) &&
          backupDue({ schedule: 'daily', keep: 10, folder: '' }, undefined, Date.now()) &&
          !backupDue({ schedule: 'daily', keep: 10, folder: '' }, Date.now() - 23 * H, Date.now()) &&
          backupDue({ schedule: 'daily', keep: 10, folder: '' }, Date.now() - 25 * H, Date.now()) &&
          !backupDue({ schedule: 'weekly', keep: 10, folder: '' }, Date.now() - 6 * 24 * H, Date.now())
      )
      check('backups start daily by default', backupSettings().schedule === 'daily' && backupSettings().keep === 10)
      const made46 = await createBackup('manual')
      const chats46 = (db.handle().prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n
      const copy46 = new Database(join(made46.path, 'twilight.db'), { readonly: true })
      const titles46 = (copy46.prepare('SELECT title FROM conversations').all() as { title: string }[]).map((r) => r.title)
      copy46.close()
      const windowSettings46 = JSON.parse(await readFile(join(made46.path, 'window-settings.json'), 'utf8')) as Record<string, string>
      check('a backup holds the whole database, consistent while it runs', made46.chats === chats46 && titles46.includes('Lamps with tools'), { chats: made46.chats, chats46 })
      check('it holds the pictures and the background too', existsSync(join(made46.path, 'generated')) && existsSync(join(made46.path, 'background', 'image.png')), made46.path)
      check("and the window's own settings", Object.keys(windowSettings46).length > 0 && Object.keys(windowSettings46).every((k) => k.startsWith('twilight.')), Object.keys(windowSettings46))

      setBackupSettings({ keep: 2 })
      const scheduled46: string[] = []
      for (let i = 0; i < 3; i++) {
        scheduled46.push((await createBackup('scheduled')).name)
        await new Promise((r) => setTimeout(r, 20))
      }
      const pruned46 = await pruneBackups()
      const left46 = await listBackups()
      check(
        'only the newest scheduled backups are kept, the rest go to the Recycle Bin',
        pruned46.join() === scheduled46[0] && !left46.some((b) => b.name === scheduled46[0]) && left46.some((b) => b.name === made46.name) && (await readdir(join(app.getPath('userData'), 'e2e-recycled'))).some((f) => f.endsWith(scheduled46[0])),
        { pruned46, left: left46.map((b) => `${b.reason}:${b.name}`) }
      )
      setBackupSettings({ keep: 10 })

      // A restore: staged now (backing up what's there first), done on a folder standing in for the data.
      await stageRestore(made46.path)
      const fake46 = join(outDir, 'restore-test')
      await mkdir(join(fake46, 'generated'), { recursive: true })
      await writeFile(join(fake46, 'twilight.db'), 'not the backup')
      await writeFile(join(fake46, 'twilight.db-wal'), 'stale')
      await writeFile(join(fake46, 'generated', 'old.png'), 'x')
      await rename(join(app.getPath('userData'), 'restore.json'), join(fake46, 'restore.json'))
      check('a restore backs up what is there first', (await listBackups()).some((b) => b.reason === 'before-restore'))
      const restored46 = applyPendingRestore(fake46)
      // Looked at before the database is opened (opening it starts a journal of its own).
      const files46 = { wal: existsSync(join(fake46, 'twilight.db-wal')), old: existsSync(join(fake46, 'generated', 'old.png')), pending: existsSync(join(fake46, 'restore.json')) }
      const back46 = new Database(join(fake46, 'twilight.db'), { readonly: true })
      const restoredChats46 = (back46.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n
      back46.close()
      check(
        'a restore puts the backup in place before the database opens',
        restored46 === made46.name && restoredChats46 === made46.chats && !files46.wal && !files46.old && !files46.pending,
        { restored46, restoredChats46, chats: made46.chats, files46 }
      )
      const settings46 = takeRestoredWindowSettings(fake46)
      check("the window's settings come back once", !!settings46 && Object.keys(settings46).length === Object.keys(windowSettings46).length && takeRestoredWindowSettings(fake46) === null)
      check('nothing happens at start without a restore', applyPendingRestore(fake46) === null)

      // A move: copied and checked at start; caches left behind, the old copy kept.
      const std46 = join(outDir, 'move-standard')
      const to46 = join(outDir, 'move-target')
      await mkdir(join(std46, 'background'), { recursive: true })
      await mkdir(join(std46, 'Cache'), { recursive: true })
      await writeFile(join(std46, 'twilight.db'), 'database bytes')
      await writeFile(join(std46, 'background', 'image.png'), 'picture')
      await writeFile(join(std46, 'Cache', 'big'), 'cache')
      check('a move needs an empty folder outside the data', !!checkTarget(std46, std46, std46) && !!checkTarget(join(std46, 'inner'), std46, std46) && !!checkTarget(join(outDir, 'mcp-lamps.cjs').replace('mcp-lamps.cjs', ''), std46, std46) && checkTarget(to46, std46, std46) === null)
      stageMove(to46, std46)
      const using46 = resolveDataFolder(std46)
      const pointer46 = JSON.parse(await readFile(join(std46, 'location.json'), 'utf8')) as { path?: string; last?: { kind: string } }
      check(
        'a move copies the data, checks it and uses the new folder',
        using46 === to46 && (await readFile(join(to46, 'twilight.db'), 'utf8')) === 'database bytes' && existsSync(join(to46, 'background', 'image.png')) && !existsSync(join(to46, 'Cache')) && pointer46.path === to46 && pointer46.last?.kind === 'moved',
        pointer46
      )
      check('the old copy stays until you remove it', existsSync(join(std46, 'twilight.db')))
      check('the next start keeps using the new folder', resolveDataFolder(std46) === to46)
      await writeFile(join(to46, 'twilight.db'), 'changed in the new place')
      stageMove(std46, std46)
      const home46 = resolveDataFolder(std46)
      const pointerBack46 = JSON.parse(await readFile(join(std46, 'location.json'), 'utf8')) as { path?: string }
      check('moving back brings the newer data to the standard place', home46 === std46 && !pointerBack46.path && (await readFile(join(std46, 'twilight.db'), 'utf8')) === 'changed in the new place')
      await writeFile(join(outDir, 'not-a-folder'), 'x')
      stageMove(join(outDir, 'not-a-folder'), std46)
      const failed46 = resolveDataFolder(std46)
      const pointerFail46 = JSON.parse(await readFile(join(std46, 'location.json'), 'utf8')) as { last?: { kind: string } }
      check('a move that fails keeps the data where it was, and says so', failed46 === std46 && pointerFail46.last?.kind === 'move-failed', pointerFail46)

      // Settings → Data.
      await key(',', ['control'])
      const data46 = await js<{ items: number; reasons: string[]; after: number; folder: string }>(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === 'Data')?.click()
        for (let end = Date.now() + 3000; Date.now() < end && !document.querySelector('.backup-item'); ) await wait(50)
        const items = document.querySelectorAll('.backup-item').length
        const reasons = [...new Set([...document.querySelectorAll('.backup-item')].map((e) => e.dataset.reason))]
        document.querySelector('.backup-now')?.click()
        for (let end = Date.now() + 5000; Date.now() < end && document.querySelectorAll('.backup-item').length === items; ) await wait(50)
        return { items, reasons, after: document.querySelectorAll('.backup-item').length, folder: document.querySelector('.data-backups .folder-path')?.textContent ?? '' }
      })()`)
      check('Settings → Data lists the backups, and Back up now adds one', data46.items >= 4 && data46.after === data46.items + 1 && data46.reasons.includes('manual') && data46.reasons.includes('before-restore'), data46)
      await shot('e2e-data.png')
      await js(`document.querySelector('.rail-item[data-mode="chat"]')?.click()`)

      check('the page logged no errors', consoleErrors.length === 0, consoleErrors.slice(0, 5))
    } catch (err) {
      // What the mock server saw last, so a stalled reply shows whether its request ever arrived.
      const recent = log.slice(-3).map((r) => ({ model: r.model, ago: Date.now() - r.startedAt, firstToken: r.firstTokenAt ? r.firstTokenAt - r.startedAt : null, last: String([...r.messages].reverse().find((m) => m.role === 'user')?.content ?? '').slice(0, 40) }))
      check('no exceptions', false, { error: String(err), requests: log.length, recent })
    } finally {
      server?.close()
      const failed = checks.filter((c) => !c.pass).length
      writeFileSync(
        join(outDir, 'e2e.json'),
        JSON.stringify({ passed: checks.length - failed, failed, failures: checks.filter((c) => !c.pass), checks }, null, 2)
      )
      app.quit()
    }
  })
}
