import { app, type BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
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
import { anthropicOptions } from './providers/anthropic'
import * as workspaces from './workspaces'
import * as providers from './providers'

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
      const entry: LoggedRequest = { model: parsed.model, messages: parsed.messages, body: parsed, startedAt: Date.now() }
      log.push(entry)
      const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
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
      } else if (lastUser.includes('PLAINCHOICES')) {
        // Choices the way a system prompt of your own might ask for them: a plain numbered list.
        reply = 'The corridor splits three ways.\n\n**What do you do?**\n\n1. Take the left stair\n2. Follow the draft\n3. Wait for the guard'
      } else if (system.includes('Interactive choices:')) {
        reply = `The door creaks open on "${lastUser}".\n\n\`\`\`choices\nWhat do you do?\n1. Light the lamp\n2. Wait in the rain\n3. Call out\n4. Run for the bridge\n\`\`\``
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
      writeFileSync(join(outDir, 'e2e-forge.png'), (await win.webContents.capturePage()).toPNG())

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
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 700))
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
      writeFileSync(join(outDir, 'e2e-settings.png'), (await win.webContents.capturePage()).toPNG())

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
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 700))
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
      writeFileSync(join(outDir, 'e2e-statuscard.png'), (await win.webContents.capturePage()).toPNG())

      // 24. The Judge: blind, both orders, scores mapped back to A and B.
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
        rubricId: 'general-fiction',
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
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 700))
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
      check('result screen shows the verdict, blind', fromSplit.headline === 'A is better written' && fromSplit.rows === 10, fromSplit)
      await new Promise((r) => setTimeout(r, 200))
      writeFileSync(join(outDir, 'e2e-judge.png'), (await win.webContents.capturePage()).toPNG())

      // 26. Choice cards: parsing, the instruction reaching the model, and the card in use.
      const parsedChoices = extractChoices('Story.\n\n```choices\nWhat now?\n1. Go left\n2. Go right\n```')
      check('choices block parsed', parsedChoices.body === 'Story.' && parsedChoices.choices?.question === 'What now?' && parsedChoices.choices?.options.join() === 'Go left,Go right')
      const partial = extractChoices('Story.\n\n```choices\nWhat now?\n1. Go le')
      check('half-streamed choices stay hidden', partial.body === 'Story.' && partial.choices === null)
      check('plain replies untouched', extractChoices('Just text.').choices === null)

      const c3 = chat.create(null).id
      chat.updateSettings(c3, { choiceCards: true })
      const before26 = log.length
      chat.send(contents, c3, 'Start')
      await idle(c3)
      check('choice instruction sent in the system prompt', (log[before26]?.messages[0]?.content ?? '').includes('Interactive choices:'))
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 700))
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
      writeFileSync(join(outDir, 'e2e-choices.png'), (await win.webContents.capturePage()).toPNG())

      // 27. Plain-text choices: a numbered list at the end becomes a card when Choices is on.
      const plain = extractChoices('Rain.\n\n*What now?*\n\n**1.** Run\n**2.** Hide\n\n<details>\n<summary>Day</summary>\nx\n</details>', true)
      check('plain numbered options parsed', plain.choices?.question === 'What now?' && plain.choices?.options.join() === 'Run,Hide' && plain.body.includes('<details>') && !plain.body.includes('Hide'), plain)
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
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await new Promise((r) => setTimeout(r, 700))
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
      writeFileSync(join(outDir, 'e2e-deleted.png'), (await win.webContents.capturePage()).toPNG())
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
