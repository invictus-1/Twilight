import { app, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as db from './db'
import { getDefaults } from './chat'

// Dev-only performance check, run with TWILIGHT_SELFTEST=<output folder>. Seeds a chat of about
// 350k tokens into a throwaway profile, opens it, scrolls top to bottom one step per frame,
// and writes frame timings plus a screenshot to the output folder. Never active otherwise.

const PARAGRAPH =
  'The lamps came on one street at a time, as if the town were remembering itself. Nobody in Harrow Lane had ever seen who lit them, only the smell of oil afterward, drifting down from the bridge where Wren stood counting. '

function assistantText(i: number): string {
  return [
    `## Scene ${i}`,
    PARAGRAPH.repeat(4),
    '- **Continuity:** the bridge has nine lamps, not eight.\n- *Tone:* keep it quiet; no one runs.\n- [ ] Check the oil smell in chapter two.',
    '```ts\nconst lamps = streets.map((s) => s.light())\n```',
    PARAGRAPH.repeat(5),
    '| Character | Wants | Fears |\n| --- | --- | --- |\n| Wren | the truth | the dark |\n| Lamplighter | to stay unseen | being named |',
    PARAGRAPH.repeat(4)
  ].join('\n\n')
}

export function prepareSelfTest(dir: string): void {
  app.setPath('userData', join(dir, 'profile'))
}

export function seedSelfTest(): string {
  const conv = db.createConversation(getDefaults())
  let parent = conv.root_id
  const turns = 450
  for (let i = 0; i < turns; i++) {
    const user = db.insertNode({
      id: randomUUID(), conversation_id: conv.id, parent_id: parent, role: 'user',
      text: `Draft scene ${i} and flag continuity errors.`, content: null, thinking: null, model: null,
      provider_id: null, usage: null, status: 'done', error: null, created_at: i * 2
    })
    const text = assistantText(i)
    const reply = db.insertNode({
      id: randomUUID(), conversation_id: conv.id, parent_id: user.id, role: 'assistant', text,
      content: JSON.stringify([{ type: 'text', text }]), thinking: null, model: 'claude-opus-5-5', provider_id: 'anthropic',
      usage: JSON.stringify({ input: 1200, output: 900, cacheRead: 300_000, cacheWrite: 2100, ms: 4200, cacheTtl: '1h' }),
      status: 'done', error: null, created_at: i * 2 + 1
    })
    parent = reply.id
  }
  db.updateConversation(conv.id, { started: 1, title: 'Self-test: 350k-token chat' })
  return conv.id
}

export function runSelfTest(win: BrowserWindow, outDir: string): void {
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const frame = () => new Promise((r) => requestAnimationFrame(r))
        const t0 = performance.now()
        while (!document.querySelector('.thread-scroll .msg')) await wait(5)
        const openMs = performance.now() - t0
        const el = document.querySelector('.thread-scroll')
        // Frame times while the post-open layout runs: it must not stutter an idle screen.
        const warmFrames = []
        let wprev = performance.now()
        while (document.querySelector('.msg:not(.warm)') && performance.now() - t0 < 20000) {
          await frame(); const now = performance.now(); warmFrames.push(now - wprev); wprev = now
        }
        const warmupMs = performance.now() - t0
        warmFrames.sort((a, b) => a - b)
        const warmP99 = warmFrames.length ? +warmFrames[Math.floor(warmFrames.length * 0.99)].toFixed(2) : 0
        await wait(300)
        el.scrollTop = 0
        await wait(500)
        // Measure the display's own frame interval first, then a full top-to-bottom scroll.
        const idle = []
        let last = performance.now()
        for (let i = 0; i < 120; i++) { await frame(); const now = performance.now(); idle.push(now - last); last = now }
        idle.sort((a, b) => a - b)
        const refresh = idle[Math.floor(idle.length / 2)]
        const startHeight = el.scrollHeight
        if (startHeight - el.clientHeight < el.clientHeight) throw new Error('Thread is not scrollable: clientHeight ' + el.clientHeight + ', scrollHeight ' + el.scrollHeight)
        // Scroll the whole thread top to bottom, a fixed distance every frame.
        const pass = async (stepPx) => {
          el.scrollTop = 0
          await wait(300)
          const t = []
          let prev = performance.now()
          while (el.scrollTop + el.clientHeight < el.scrollHeight - 1 && t.length < 20000) {
            el.scrollTop += stepPx; await frame(); const now = performance.now(); t.push(now - prev); prev = now
          }
          const s = [...t].sort((a, b) => a - b)
          const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2)
          return {
            pxPerSecond: Math.round(stepPx * 1000 / refresh),
            frames: t.length,
            p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(2),
            framesOverBudget: t.filter((x) => x > refresh * 1.5).length
          }
        }
        // First pass lays out every message once (a cold, extreme fling); the second is a fast
        // wheel flick over a thread that has been seen.
        const fling = await pass(240)
        const heightDriftPx = el.scrollHeight - startHeight
        const flick = await pass(60)
        const scrolledPx = el.scrollTop + el.clientHeight
        return {
          messages: document.querySelectorAll('.msg').length,
          characters: [...document.querySelectorAll('.md')].reduce((n, e) => n + e.textContent.length, 0),
          scrollHeightPx: el.scrollHeight,
          viewportPx: el.clientHeight,
          scrolledPx,
          heightDriftPx,
          openToFirstMessageMs: +openMs.toFixed(1),
          warmupDoneMs: +warmupMs.toFixed(0),
          frameP99DuringWarmup: warmP99,
          displayFrameMs: +refresh.toFixed(2),
          displayHz: Math.round(1000 / refresh),
          coldFling: fling,
          fastFlick: flick,
          heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
        }
      })()`)
      writeFileSync(join(outDir, 'selftest.json'), JSON.stringify(result, null, 2))
      const midway = await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('.thread-scroll'); el.scrollTop = el.scrollHeight * 0.4; return true })()`
      )
      if (midway) await new Promise((r) => setTimeout(r, 400))
      writeFileSync(join(outDir, 'selftest.png'), (await win.webContents.capturePage()).toPNG())
    } catch (err) {
      writeFileSync(join(outDir, 'selftest.json'), JSON.stringify({ error: String(err) }))
    }
    app.quit()
  })
}
