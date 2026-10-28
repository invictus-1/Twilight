import { app, type BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as chat from './chat'
import * as providers from './providers'

// Dev-only end-to-end check, run with TWILIGHT_E2E=<output folder> (and a throwaway profile, see
// selftest.ts). Starts a fake OpenAI-compatible model server in-process, then drives a chat,
// split compare, both-pane sends, a regenerate in B and "Keep B" through the real chat engine,
// and writes the checks and a screenshot to the output folder.

interface LoggedRequest {
  model: string
  messages: { role: string; content: string }[]
  startedAt: number
  firstTokenAt?: number
}

function startMockServer(log: LoggedRequest[]): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'mock-a' }, { id: 'mock-b' }] }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      const parsed = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] }
      const entry: LoggedRequest = { model: parsed.model, messages: parsed.messages, startedAt: Date.now() }
      log.push(entry)
      const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const words = `**${parsed.model}** replying to "${lastUser}". Here is a short answer with a list:\n\n- one\n- two\n\nDone.`.split(/(?<= )/)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const w of words) {
        await new Promise((r) => setTimeout(r, 8))
        entry.firstTokenAt ??= Date.now()
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`)
      }
      const prompt = parsed.messages.reduce((n, m) => n + m.content.length, 0)
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: Math.ceil(prompt / 4), completion_tokens: words.length } })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function idle(id: string): Promise<void> {
  const start = Date.now()
  while (chat.isRunning(id)) {
    if (Date.now() - start > 15000) throw new Error('Timed out waiting for replies')
    await new Promise((r) => setTimeout(r, 20))
  }
}

export function runE2E(win: BrowserWindow, outDir: string): void {
  const checks: { name: string; pass: boolean; detail?: unknown }[] = []
  const check = (name: string, pass: boolean, detail?: unknown): void => void checks.push({ name, pass, detail })
  const log: LoggedRequest[] = []

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
      check('different models ran in parallel', Math.abs((both[0]?.startedAt ?? 0) - (both[1]?.startedAt ?? 0)) < 60)

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
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 900))
      writeFileSync(join(outDir, 'e2e-split.png'), (await win.webContents.capturePage()).toPNG())

      // 7. Keep B: the main thread continues on B's branch.
      const bPath = v.split!.path.map((n) => n.id).join()
      v = chat.closeSplit(id, 'b')
      check('keep B: A now follows B', !v.split && v.path.map((n) => n.id).join() === bPath)
      check('keep B: B settings carried over', v.settings.modelId === 'mock-a')
    } catch (err) {
      check('no exceptions', false, String(err))
    } finally {
      server?.close()
      const failed = checks.filter((c) => !c.pass).length
      writeFileSync(join(outDir, 'e2e.json'), JSON.stringify({ passed: checks.length - failed, failed, checks }, null, 2))
      app.quit()
    }
  })
}
