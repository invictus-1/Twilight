import { app, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import * as db from './db'
import { getDefaults } from './chat'
import { seedSelfTest } from './selftest'

// Dev-only benchmark, run with TWILIGHT_BENCH=<folder> (scripts/bench.cjs runs it several times
// against the packaged app and keeps the medians). It times a start of the app on a lived-in
// profile (a 450-turn chat, 150 more chats and a 115k-word manuscript, seeded once), then opening
// things, and writes bench.json. Startup marks are milliseconds since the process started.

const marks: Record<string, number> = {}
/** Notes when a moment of startup happened. */
export const mark = (name: string): void => void (marks[name] ??= Math.round(performance.now()))

const PARAGRAPH =
  'The lamps came on one street at a time, as if the town were remembering itself. Wren counted them from the bridge, nine on the quay and four on the hill, and wrote the number in the book she kept for no one. '

/** The lived-in profile, made the first time: kept between runs so each run measures a start, not a seeding. */
export function seedBench(): void {
  if (db.kvGet<boolean>('bench.seeded')) return
  seedSelfTest()
  const defaults = getDefaults()
  for (let c = 0; c < 150; c++) {
    const conv = db.createConversation(defaults)
    let parent = conv.root_id
    for (let i = 0; i < 6; i++) {
      const user = db.insertNode({ id: randomUUID(), conversation_id: conv.id, parent_id: parent, role: 'user', text: `Question ${i} in chat ${c}`, content: null, thinking: null, model: null, provider_id: null, usage: null, status: 'done', error: null })
      const text = PARAGRAPH.repeat(3)
      parent = db.insertNode({ id: randomUUID(), conversation_id: conv.id, parent_id: user.id, role: 'assistant', text, content: JSON.stringify([{ type: 'text', text }]), thinking: null, model: 'claude-opus-5-5', provider_id: 'anthropic', usage: null, status: 'done', error: null }).id
    }
    db.updateConversation(conv.id, { started: 1, title: `Bench chat ${c}` })
  }
  const vault = join(app.getPath('userData'), 'vault')
  mkdirSync(vault, { recursive: true })
  // About 115k words, in chapters, like a novel in progress.
  const chapters = Array.from({ length: 40 }, (_, i) => `## Chapter ${i + 1}\n\n${Array.from({ length: 70 }, () => PARAGRAPH).join('\n\n')}`)
  if (!existsSync(join(vault, 'Manuscript.md'))) writeFileSync(join(vault, 'Manuscript.md'), `# The lamplighter\n\n${chapters.join('\n\n')}\n`)
  db.kvSet('bench.seeded', true)
}

export function runBench(win: BrowserWindow, outDir: string): void {
  win.once('ready-to-show', () => mark('firstFrame'))
  win.webContents.once('did-finish-load', async () => {
    mark('pageLoaded')
    try {
      const ui = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        while (document.body.dataset.ready !== '1') await wait(2)
        const readyAt = performance.now()
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
        // How long a step takes until what it shows is painted.
        const time = async (go, until) => {
          const t0 = performance.now()
          go()
          for (let end = t0 + 20000; performance.now() < end && !until(); ) await wait(1)
          await frame()
          return Math.round(performance.now() - t0)
        }
        const row = (title) => [...document.querySelectorAll('.tw-conv')].find((r) => r.querySelector('.tw-conv-title')?.textContent === title)
        await wait(300)
        const out = { readyAtMs: Math.round(readyAt), firstPaintMs: fcp && Math.round(fcp) }
        out.openBigChatMs = await time(() => row('Self-test: 350k-token chat')?.click(), () => document.querySelectorAll('.thread-scroll .msg').length > 10)
        await wait(400)
        out.switchChatMs = await time(() => row('Bench chat 3')?.click(), () => document.querySelector('.chat-title')?.textContent === 'Bench chat 3' && !!document.querySelector('.thread-scroll .msg'))
        await wait(300)
        out.openSettingsMs = await time(() => document.querySelector('.rail-item[data-rail="settings"]')?.click(), () => !!document.querySelector('.settings-content .settings-card'))
        document.querySelector('.rail-item[data-rail="settings"]')?.click()
        await wait(300)
        out.openWritingMs = await time(() => document.querySelector('.rail-item[data-mode="write"]')?.click(), () => !!document.querySelector('.doc-item'))
        await wait(300)
        out.openManuscriptMs = await time(() => document.querySelector('.doc-item[data-path="Manuscript.md"]')?.click(), () => (document.querySelector('.cm-content')?.textContent?.length ?? 0) > 1000)
        await wait(300)
        out.openCodeMs = await time(() => document.querySelector('.rail-item[data-mode="code"]')?.click(), () => !!document.querySelector('.code-view'))
        out.domNodes = document.getElementsByTagName('*').length
        out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
        return out
      })()`)
      const pageStart = marks.pageNavigation ?? 0
      const memory = await app.getAppMetrics()
      writeFileSync(
        join(outDir, 'bench.json'),
        JSON.stringify(
          {
            startup: {
              ...marks,
              // The renderer's own clock starts at navigation; laid onto the process timeline.
              firstPaint: ui.firstPaintMs != null ? pageStart + ui.firstPaintMs : null,
              uiReady: pageStart + ui.readyAtMs
            },
            navigation: { openBigChatMs: ui.openBigChatMs, switchChatMs: ui.switchChatMs, openSettingsMs: ui.openSettingsMs, openWritingMs: ui.openWritingMs, openManuscriptMs: ui.openManuscriptMs, openCodeMs: ui.openCodeMs },
            memory: { rendererHeapMB: ui.heapMB, totalWorkingSetMB: Math.round(memory.reduce((n, m) => n + m.memory.workingSetSize, 0) / 1024), domNodes: ui.domNodes }
          },
          null,
          2
        )
      )
    } catch (err) {
      writeFileSync(join(outDir, 'bench.json'), JSON.stringify({ error: String(err) }))
    }
    app.quit()
  })
}
