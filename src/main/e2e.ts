import { app, clipboard, type BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { appendFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { logsFolder } from './logs'
import { join } from 'node:path'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
import { extractChoices } from '@shared/choices'
import { gameFormat } from '@shared/gameFormat'
import { computeVerdict } from '@shared/judge'
import * as judge from './judge'
import { anthropicOptions, keyShape, toMessages } from './providers/anthropic'
import { randomUUID } from 'node:crypto'
import * as workspaces from './workspaces'
import { searchAll } from './search'
import { BUILT_IN_PRICES, costOf, setCustomPrices } from '@shared/pricing'
import * as providers from './providers'
import * as updates from './updates'
import * as insights from './insights'
import * as insightsAi from './insightsAi'
import * as reports from './reports'
import { ACHIEVEMENTS, analyzeText } from '@shared/insights'
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

function startMockServer(log: LoggedRequest[]): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/gh/')) return mockGithub(req.url, `http://${req.headers.host}/gh`, res)
    if (req.url?.endsWith('/models')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'mock-a', context_length: 8000 }, { id: 'mock-b' }] }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      const parsed = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] }
      const entry: LoggedRequest = { model: parsed.model, messages: parsed.messages, body: parsed, startedAt: Date.now() }
      log.push(entry)
      const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
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
    await win.webContents.capturePage().then((img) => writeFileSync(join(outDir, name), img.toPNG()), () => undefined)
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
        ;[...document.querySelectorAll('.rm-chip')].find((b) => b.textContent.startsWith('Writing'))?.click()
        await wait(200)
        out.writingCards = [...document.querySelectorAll('.rm-card .rm-area')].map((e) => e.textContent)
        ;[...document.querySelectorAll('.rm-chip')].find((b) => b.textContent.startsWith('Everything'))?.click()
        await wait(600)
        return out
      })()`)
      check('roadmap shows planned work as cards', roadmapUi.cards > 10 && roadmapUi.ideas > 3 && roadmapUi.doing >= 1, roadmapUi)
      check('roadmap timeline lists the releases', roadmapUi.releases.join() === '0.7.0,0.6.0,0.5.0,0.4.0,0.3.0,0.2.0,0.1.0', roadmapUi.releases)
      check('roadmap filters by area', roadmapUi.writingCards.length > 0 && roadmapUi.writingCards.every((a: string) => a === 'Writing'), roadmapUi.writingCards)
      await shot('e2e-roadmap.png')

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
        if (!win.webContents.isFocused()) win.webContents.focus()
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
        for (const id of ['phosphor', 'nightshade', 'ember']) {
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
      for (const id of ['phosphor', 'nightshade', 'ember']) {
        await js(`(() => { document.documentElement.dataset.theme = '${id}' })()`)
        await new Promise((r) => setTimeout(r, 250))
        await shot(`e2e-theme-${id}.png`)
      }
      await key(',', ['control'])
      await js(`(async () => {
        await new Promise((r) => setTimeout(r, 200))
        ;[...document.querySelectorAll('.settings-nav button')].find((b) => /General/.test(b.textContent))?.click()
        await new Promise((r) => setTimeout(r, 200))
        document.querySelector('.theme-option[data-theme-id="twilight"]')?.click()
      })()`)
      check('the picker lists every theme', themesUi.options.join() === 'twilight,ultraviolet,phosphor,nightshade,ember', themesUi.options)
      check('Phosphor, Nightshade and Ember apply their colours', themesUi.nights.phosphor === '#030604' && themesUi.nights.nightshade === '#07050b' && themesUi.nights.ember === '#0a0505', themesUi.nights)
      check('the window frame follows the theme', frameTheme === 'ember', frameTheme)
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
      check('the rail lists every section by name', railUi.labels.join() === 'Chats,Writing,Judge,Insights,Search,Settings' && railUi.selected === 'Writing' && railUi.head === 'Writing', railUi)
      check('the current section on the rail hides and shows the sidebar, and the rail stays', railUi.closed && railUi.railStill && railUi.reopened, railUi)
      await shot('e2e-rail.png')

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
