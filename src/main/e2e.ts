import { app, type BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
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
      // Writing tools get a plausible edit of the passage; chats get an echo.
      const reply = parsed.messages[0]?.content.startsWith('You are a line editor')
        ? `No one ever saw who lit them (${parsed.model}).`
        : `**${parsed.model}** replying to "${lastUser}". Here is a short answer with a list:\n\n- one\n- two\n\nDone.`
      const words = reply.split(/(?<= )/)
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
        const frame = () => new Promise((r) => requestAnimationFrame(r))
        document.querySelector('[data-mode="write"]').click()
        for (let i = 0; i < 500 && !document.querySelector('.doc-item[data-path="Big manuscript.md"]'); i++) await wait(10)
        await wait(300)
        const t0 = performance.now()
        document.querySelector('.doc-item[data-path="Big manuscript.md"]').click()
        while (!document.querySelector('.cm-content .cm-line')) await wait(1)
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
      writeFileSync(join(outDir, 'e2e-writing.png'), (await win.webContents.capturePage()).toPNG())
      await win.webContents.executeJavaScript(`document.querySelector('.tw-btn-accept').click()`)
      await new Promise((r) => setTimeout(r, 1500))
      const saved = await docs.readDoc(scene.path)
      check(
        'accepted text autosaved to disk',
        saved.text.startsWith('No one ever saw who lit them (mock-a). Wren stopped on the bridge'),
        saved.text.slice(0, 120)
      )

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
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 600))
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
      writeFileSync(join(outDir, 'e2e-docfolders.png'), (await win.webContents.capturePage()).toPNG())
      await win.webContents.executeJavaScript(`document.querySelector('[data-mode="chat"]').click()`)
      await new Promise((r) => setTimeout(r, 400))
      writeFileSync(join(outDir, 'e2e-chatfolders.png'), (await win.webContents.capturePage()).toPNG())
    } catch (err) {
      check('no exceptions', false, String(err))
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
