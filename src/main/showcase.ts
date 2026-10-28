import { app, type BrowserWindow } from 'electron'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
import * as judge from './judge'
import * as providers from './providers'
import * as updates from './updates'
import * as workspaces from './workspaces'

// Screenshots for the releases page, run with TWILIGHT_SHOWCASE=<output folder> (a throwaway
// profile, like the self-test). Everything shown is made up here: a short original story, a
// stand-in model server and its replies. No real chats, keys or documents are ever involved.

const STORY_PROMPT = 'You are a co-writer for a quiet, atmospheric fantasy serial. Third person, past tense. Keep scenes grounded and specific.'

const REPLIES: Record<string, string> = {
  'Open on the lighthouse at dusk. Wren is eleven and counts everything.': `The lamp room smelled of brass polish and old rain. Wren climbed the last of the hundred and twelve steps (she had counted them every evening since spring) and pressed her palm to the cold glass.

Below, the harbour was going blue. Nine boats in. Two still out. Her father's was one of the two.

*Eleven gulls on the rail. Four lamps lit on the quay. One star, low and stubborn, over the Teeth.*

She wound the clockwork, struck the match, and the great lens woke with a sound like a held breath let go.`,

  "She notices a second light out on the water that shouldn't be there.": `The beam swept the water, and on its third pass Wren saw it: a second light, green and low, where no light had any business being. Not a boat. Boats rode the swell. This one held perfectly still, as if the sea had been nailed in place around it.

She counted. *One, two, three.* The green light blinked once, in time with the lighthouse.

Then it blinked again, out of time.

<details>
<summary>Logbook · Gull Point</summary>

\`\`\`
DATE      Third of Harvestmonth
WEATHER   Clear, wind from the north-east
BOATS     9 in · 2 out
LAMP      Lit at 6:42
NOTE      Green light, bearing 040, steady
\`\`\`

</details>

LANTERN · First watch
The lens is hot and the wind is rising. Whatever Wren does, she does it before the next sweep.
1 · SIGNAL BACK

* Three short flashes with the hand lamp
* Risk: whoever is out there learns someone is watching

2 · WAKE GRANDMOTHER

* She kept this light for forty years
* Risk: she'll want to know why Wren is up here alone

3 · SOMETHING ELSE

What does Wren do next?

1. Write the bearing in the logbook
2. Run down to the quay
3. Something else`,

  'Draw me a rough map of the Teeth: the rocks, the channel, and where boats go wrong.': `| Rock | Bearing from the light | What it does to boats |
|---|---|---|
| **The Molar** | 020 | Splits the swell; the safe channel runs east of it |
| **Two Sisters** | 045 | Hidden at high tide, the reason the light exists |
| **The Gap** | 060 | The only way in after dark, if you know the count |

Boats go wrong at the Sisters: they steer for the Gap too early and the tide does the rest.`,

  'How would Grandmother talk? Give me three lines of hers.': `- "A light isn't for the ones who know the way. It's for the ones who've forgotten it."
- "Count the gulls if you like. They won't count you back."
- "Forty years I kept that lamp, and the sea never once said thank you. Neither will you. Wind it anyway."`,

  'Name the eleven boats of the harbour.': `1. *Patience*
2. *The Second Try*
3. *Marrow*
4. *Gull's Due*
5. *Old Nell*
6. *Saltwife*
7. *The Brothers*
8. *Halfpenny*
9. *Lark*
10. *Tidewater*
11. *Ninth Wave*`,

  'Write the storm reaching Gull Point, in under 150 words.': `The storm came in sideways. First the gulls went quiet, then the shutters began to knock in a rhythm Wren could almost count, and then the sea stood up.

It broke over the Molar white and enormous, and for a moment the whole harbour was lit from below by the foam. The lamp held. The lens turned. Somewhere past the Teeth a horn sounded once and did not sound again.

Grandmother didn't come up the stairs. She called from the bottom, the way she always did: "Is it burning?"

"It's burning."

"Then that's all a light can do."`
}

// The second model's take on the storm, for split compare and the Judge.
const STORM_B = `Rain arrived before the wind did, fat and slanting, so that by the time the gale reached Gull Point the windows were already streaming.

Wren stood at the lens with both hands on the rail. The sea was no longer a surface but a moving country of hills. She watched the Two Sisters vanish under a wave and come up again, black and shining.

"Keep it turning," she told the clockwork, as if it could hear her.

Below, the door banged open. Grandmother, in her oilskin, a lantern swinging. "Is it lit?"

"It's lit."

The old woman nodded once and closed the door against the dark.`

const CHAPTER_ONE = `# The Count

Wren counted everything. The steps to the lamp room, a hundred and twelve. The boats in the harbour, eleven when the weather was kind. The gulls on the rail, which changed, which was the trouble with gulls.

Her grandmother said counting was a way of holding on. Her father said it was a way of not listening. Both of them were right, which Wren found unbearable.

On the evening the green light came, she had counted to nine boats and stopped, because the tenth and eleventh were still out past the Teeth, and you could not count what was not there.

The lamp was lit at six forty-two. The wind came from the north-east. Wren wrote both in the logbook in her careful, slanting hand, and then she looked up, and the sea was looking back.
`

function json(res: ServerResponse, body: unknown): void {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url.endsWith('/models')) return json(res, { data: [{ id: 'demo-writer' }, { id: 'demo-editor' }] })
    if (url.startsWith('/gh/releases')) {
      const release = (version: string, day: number, notes: string) => ({
        tag_name: `v${version}`,
        name: `Twilight ${version}`,
        body: notes,
        draft: false,
        prerelease: false,
        published_at: new Date(Date.UTC(2026, 9, day, 16)).toISOString(),
        html_url: '',
        assets: [{ name: `Twilight-Setup-${version}.exe`, size: 122_600_000, browser_download_url: '' }]
      })
      return json(res, [
        release(app.getVersion(), 28, '- Clearer key errors\n- Model providers in two panes\n- The Roadmap page'),
        release('0.3.0', 28, '- Choices as a tool call'),
        release('0.2.0', 28, '- Updates page\n- Message actions')
      ])
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      const parsed = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] }
      const system = parsed.messages[0]?.content ?? ''
      const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      let reply: string
      if (system.startsWith('You are a line editor')) {
        reply = 'Wren counted everything. The steps to the lamp room, a hundred and twelve. The boats, eleven when the weather was kind. The gulls on the rail, which changed, which was the trouble with gulls.'
      } else if (system.startsWith('You are an exacting fiction editor')) {
        reply = judgeReply(system, lastUser)
      } else if (lastUser.includes('storm') && parsed.model === 'demo-editor') {
        reply = STORM_B
      } else {
        reply = REPLIES[lastUser] ?? 'The light turned, and the sea waited.'
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const w of reply.split(/(?<= )/)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1840, completion_tokens: Math.ceil(reply.length / 4) } })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** The demo judge prefers the passage with the grandmother's line about what a light can do. */
function judgeReply(system: string, user: string): string {
  const ids = [...system.matchAll(/^- ([\w-]+) · /gm)].map((m) => m[1])
  const x = /<passage id="X">\n([\s\S]*?)\n<\/passage>/.exec(user)?.[1] ?? ''
  const xA = x.includes("that's all a light can do")
  const scores: Record<string, [number, number]> = {
    instructions: [9, 8], character: [8, 7], dialogue: [8, 6], prose: [8, 8], cliche: [7, 7], pacing: [9, 7], impact: [9, 7]
  }
  const criteria = ids.map((id) => {
    const [a, b] = scores[id] ?? [7, 7]
    return { id, X: xA ? a : b, Y: xA ? b : a }
  })
  const [ox, oy] = xA ? [8.5, 7.2] : [7.2, 8.5]
  const better = xA ? 'X' : 'Y'
  return `### Following the brief — X ${xA ? 9 : 8} · Y ${xA ? 8 : 9}
Both stay under 150 words and keep to the scene. ${better} lands the storm's arrival in a single movement, "then the sea stood up."

### Dialogue — X ${xA ? 8 : 6} · Y ${xA ? 6 : 8}
${better}'s exchange does more with less: the call from the bottom of the stairs and the dry answer carry the whole relationship.

### Pacing and ending — X ${xA ? 9 : 7} · Y ${xA ? 7 : 9}
${better} ends on a line that earns its weight; the other closes the door on the scene a beat too neatly.

### Verdict
${better} is the stronger passage: tighter, with a last line that reframes the scene. The other is vivid but more conventional.

\`\`\`json
${JSON.stringify({ criteria, overall: { X: ox, Y: oy }, winner: better, confidence: 'high' })}
\`\`\``
}

async function idle(id: string): Promise<void> {
  for (let i = 0; i < 750 && chat.isRunning(id); i++) await new Promise((r) => setTimeout(r, 20))
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function runShowcase(win: BrowserWindow, outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  win.setContentSize(1440, 900)
  win.webContents.once('did-finish-load', async () => {
    let server: Server | undefined
    try {
      server = await startServer()
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      providers.saveProvider({
        id: 'demo',
        kind: 'openai',
        name: 'Local server (demo)',
        baseUrl: `${base}/v1`,
        enabled: true,
        labels: { 'demo-writer': 'Demo Writer', 'demo-editor': 'Demo Editor' }
      })
      for (const id of ['ollama', 'lmstudio']) providers.saveProvider({ ...providers.getProvider(id), enabled: false })
      updates.setUpdateSource(`${base}/gh`)
      chat.setDefaults({ providerId: 'demo', modelId: 'demo-writer', systemPrompt: STORY_PROMPT })
      await providers.listModels(true)
      await updates.check()
      const contents = win.webContents

      // The sidebar: a workspace, a pinned chat, and a few recent ones.
      const coast = db.createFolder('The Lantern Coast')
      workspaces.updateWorkspace(coast.id, { color: 'dusk', description: 'A lighthouse serial', systemPrompt: STORY_PROMPT })
      db.createFolder('Research')
      const say = async (id: string, text: string, title?: string): Promise<void> => {
        chat.send(contents, id, text)
        await idle(id)
        if (title) db.updateConversation(id, { title })
      }
      for (const [text, title] of [
        ['Name the eleven boats of the harbour.', 'Naming the boats'],
        ['How would Grandmother talk? Give me three lines of hers.', "Grandmother's voice"],
        ['Draw me a rough map of the Teeth: the rocks, the channel, and where boats go wrong.', 'Map of the Teeth']
      ] as const) {
        const c = chat.create(coast.id).id
        await say(c, text, title)
      }

      // Split compare: the same storm from two models, B regenerated with the second one.
      const storm = chat.create().id
      await say(storm, 'Write the storm reaching Gull Point, in under 150 words.', 'Two takes on the storm')
      const stormView = chat.cloneIntoSplit(storm)
      chat.updateSettings(storm, { modelId: 'demo-editor' }, 'b')
      chat.regenerate(contents, storm, stormView.path.at(-1)!.id, 'b')
      await idle(storm)

      // The main chat, last so it sits on top: a scene, then a reply with choices.
      const main = chat.create(coast.id).id
      chat.updateSettings(main, { choiceCards: true, choicePlain: true, choiceInstructions: false })
      await say(main, 'Open on the lighthouse at dusk. Wren is eleven and counts everything.', 'The lighthouse at Gull Point')
      await say(main, "She notices a second light out on the water that shouldn't be there.")
      db.fileConversation(main, { pinned: 1 })

      // The Judge, on the two storms.
      const verdict = judge.runJudge(contents, {
        title: 'Two takes on the storm',
        passageA: REPLIES['Write the storm reaching Gull Point, in under 150 words.'],
        passageB: STORM_B,
        labelA: 'Demo Writer',
        labelB: 'Demo Editor',
        authorPrompt: 'Write the storm reaching Gull Point, in under 150 words.',
        systemPrompt: STORY_PROMPT,
        contextDocs: [],
        extraInstructions: '',
        judgeProviderId: 'demo',
        judgeModelId: 'demo-editor',
        effort: null,
        rubricId: 'general-fiction',
        bothOrders: true
      })
      for (let i = 0; i < 400 && judge.getJudgment(verdict.id).runs.some((r) => r.status === 'streaming'); i++) await wait(25)

      // Writing: a chapter and its notes.
      await docs.createDocFolder('The Lantern Coast')
      const ch1 = await docs.createDoc('Chapter 1', 'The Lantern Coast')
      await docs.writeDoc(ch1.path, CHAPTER_ONE)
      const ch2 = await docs.createDoc('Chapter 2', 'The Lantern Coast')
      await docs.writeDoc(ch2.path, '# Green Light\n\nThe tenth boat came in after midnight.\n')
      const notes = await docs.createDoc('Characters', 'The Lantern Coast')
      await docs.writeDoc(notes.path, '# Characters\n\n- **Wren**, eleven. Counts everything.\n- **Grandmother**, kept the light for forty years.\n')

      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      await wait(900)
      const shot = async (name: string): Promise<void> => {
        await wait(500)
        const image = await win.webContents.capturePage()
        writeFileSync(join(outDir, `${name}.png`), image.toPNG())
      }
      const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); ${code} })()`)

      await js(`localStorage.setItem('twilight.hideCacheBar', '1'); window.dispatchEvent(new Event('twilight-cachebar'))
        const style = document.createElement('style')
        style.textContent = '.folder-btn, .updates-dev-note { display: none !important; }'
        document.head.appendChild(style)`)
      await js(`[...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('The lighthouse at Gull Point'))?.click(); await wait(600); const t = document.querySelector('.thread'); if (t) t.scrollTop = t.scrollHeight`)
      await shot('chat')

      await js(`[...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('Two takes on the storm'))?.click()`)
      await shot('split')

      await js(`document.querySelector('[data-mode="judge"]').click(); await wait(300); [...document.querySelectorAll('.judgment-item')][0]?.click()`)
      await shot('judge')

      await js(`
        document.querySelector('[data-mode="write"]').click()
        await wait(400)
        document.querySelector('.doc-item[data-path="${ch1.path}"]')?.click()
        for (let i = 0; i < 300 && !(window.__twilightEditor && window.__twilightEditor.state.doc.toString().includes('Wren counted')); i++) await wait(10)
        const v = window.__twilightEditor
        const text = v.state.doc.toString()
        const from = text.indexOf('Wren counted')
        const to = text.indexOf('trouble with gulls.') + 'trouble with gulls.'.length
        v.focus()
        v.dispatch({ selection: { anchor: from, head: to } })
        await wait(200)
        ;[...document.querySelectorAll('.tw-seltool button')].find((b) => b.textContent === 'Tighten')?.click()
        for (let i = 0; i < 300 && !document.querySelector('.tw-btn-accept'); i++) await wait(10)
      `)
      await shot('writing')

      await js(`document.querySelector('[data-mode="chat"]').click(); await wait(200); document.querySelector('.sidebar-foot .tw-btn').click(); await wait(300);
        [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Model providers'))?.click(); await wait(300);
        [...document.querySelectorAll('.provider-item')].find((r) => r.textContent.includes('demo'))?.click()`)
      await shot('providers')

      await js(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Roadmap'))?.click(); await wait(1600)`)
      await shot('roadmap')

      await js(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Updates'))?.click()`)
      await shot('updates')
      writeFileSync(join(outDir, 'showcase.json'), JSON.stringify({ ok: true }))
    } catch (err) {
      writeFileSync(join(outDir, 'showcase.json'), JSON.stringify({ ok: false, error: String(err) }))
    } finally {
      server?.close()
      app.quit()
    }
  })
}
