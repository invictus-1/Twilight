import { app, type BrowserWindow } from 'electron'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
import * as insights from './insights'
import * as insightsAi from './insightsAi'
import * as judge from './judge'
import * as providers from './providers'
import * as updates from './updates'
import * as workspaces from './workspaces'
import * as code from './code/agent'
import { reindex as reindexLibrary, setLibrarySettings } from './docLibrary'
import { lineDiff } from '@shared/code'

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

// Paragraphs for the demo manuscript: shuffled into chapters so the numbers have something to count.
const DEMO_PARAGRAPHS = [
  'Wren counted the steps again, though she knew the number. A hundred and twelve. The count was a rope she could hold in the dark.',
  '"Is it burning?" Grandmother called from the bottom of the stair. "It\'s burning," Wren said, and the old woman went back to her chair.',
  'Rowan came up the path at dusk with a basket of bread and news from the quay. The tenth boat was late. The eleventh had not been seen since noon.',
  'The lens turned. The light swept the Teeth, the Molar, the Two Sisters, and out past them the long dark water where the fishing grounds began.',
  '"You count too much," Rowan said. "Somebody has to," said Wren. Below them the harbour bells answered each other across the water.',
  'In the morning the sea was flat and grey and innocent, as if it had never stood up in the night and tried to climb the rocks.',
  'Grandmother kept a ledger of every ship that had passed the point in forty years. Wren read it by lamplight, slowly, the way other children read stories.',
  'The green light came back on the third night. Wren wrote its bearing in the margin, carefully, and did not tell anyone at all.'
]

function demoChapter(n: number): string {
  const out: string[] = [`# Chapter ${n}`]
  for (let i = 0; i < 70; i++) out.push(DEMO_PARAGRAPHS[(i * (n + 3) + n) % DEMO_PARAGRAPHS.length])
  return out.join('\n\n') + '\n'
}

const DEMO_STORY = {
  breakdown: { Drama: 34, Mystery: 22, 'Slice of Life': 18, Worldbuilding: 14, Adventure: 8, Romance: 4 },
  genres: { Mystery: 82, Drama: 78, Fantasy: 64, 'Slice of Life': 52, Adventure: 40, 'Coming of age': 36 },
  tags: [
    { name: 'The sea', sub: ['Storms', 'Tides', 'Shipwrecks', 'Fishing'] },
    { name: 'Family', sub: ['Grandparents', 'Absent parents', 'Inheritance'] },
    { name: 'Mystery', sub: ['Strange lights', 'Secrets', 'Logbooks'] },
    { name: 'Place', sub: ['Lighthouses', 'Harbour towns', 'Coastal rocks'] }
  ],
  themes: [
    { name: 'Counting as courage', description: 'Wren holds fear at bay by counting what she can. The story asks what happens when something refuses to be counted.' },
    { name: 'Keeping the light', description: 'Tending the lamp is duty passed between generations. Each keeper inherits the work and the silence that comes with it.' },
    { name: 'What the sea returns', description: 'Boats, objects and memories come back changed. The harbour measures time by what it gets back.' },
    { name: 'Secrets kept for others', description: 'Characters hide things to protect someone else. The cost of that kindness grows with every chapter.' }
  ],
  tone: 'Hushed, precise and patient, with a cold undertow.',
  summary: 'An eleven-year-old keeper of a lighthouse counts everything she can, until a green light appears where none should be. As boats go missing, she and her grandmother keep the lamp burning while the harbour town pretends not to notice.'
}

const DEMO_FOCUS = {
  strength: 'Your scenes are grounded in specific, physical detail: the count of steps, the bearing in the margin.',
  areas: [
    { title: 'Vary how paragraphs open', why: 'Many paragraphs begin with a name followed by a verb. Over a chapter the rhythm flattens.', evidence: ['Wren counted the steps again'], exercise: 'Rewrite five openings so they start with place, sound or time.' },
    { title: 'Let silences carry the scene', why: 'Dialogue resolves quickly. A beat of quiet before an answer would raise the tension.', evidence: ['"It\'s burning," Wren said'], exercise: 'Add one unspoken beat to each exchange in your next scene.' },
    { title: 'Name the green light less', why: 'The mystery weakens with every direct mention. Show its effects instead.', evidence: ['The green light came back on the third night'], exercise: 'Cut half its mentions and replace them with what Wren does.' }
  ]
}

const DEMO_NOTES = {
  observations: [
    { title: 'An evening writer', text: 'Most of your words land between 8 and 11 pm, and your longest sessions start after 9.' },
    { title: 'Weekends carry the load', text: 'Saturdays and Sundays hold nearly half your words, with shorter, steadier sessions on weekdays.' },
    { title: 'Wren holds the stage', text: 'Wren is in most scenes. Grandmother and Rowan appear mostly beside her rather than on their own.' },
    { title: 'Dialogue in short bursts', text: 'A fifth of your prose is spoken, usually in quick two-line exchanges.' }
  ],
  nextStep: 'Write one scene this week from Rowan\'s point of view, without Wren in it.'
}

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
      } else if (system.startsWith('You analyse a long work')) {
        reply = JSON.stringify(DEMO_STORY)
      } else if (system.startsWith('You are a candid, encouraging writing coach')) {
        reply = JSON.stringify(DEMO_FOCUS)
      } else if (system.startsWith("You read a writer's own statistics")) {
        reply = JSON.stringify(DEMO_NOTES)
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

      // Insights: a few chapters, read once as the baseline, then an invented month of writing.
      for (let n = 3; n <= 8; n++) {
        const doc = await docs.createDoc(`Chapter ${n}`, 'The Lantern Coast')
        await docs.writeDoc(doc.path, demoChapter(n))
      }
      await insights.scan()
      await insights.setCharacters([
        { name: 'Wren', aliases: [], color: '#c4a0ff' },
        { name: 'Grandmother', aliases: [], color: '#ffb48a' },
        { name: 'Rowan', aliases: [], color: '#7dd3fc' }
      ])
      const h = db.handle()
      const today = new Date()
      for (let i = 34; i >= 0; i--) {
        if ([3, 9, 10, 17, 24, 25, 31].includes(i)) continue
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
        const words = Math.round(600 + ((i * 7919) % 2300) + (d.getDay() % 6 === 0 ? 1400 : 0))
        h.prepare('INSERT OR REPLACE INTO writing_days (day, written, removed) VALUES (?, ?, 0)').run(insights.dayOf(d), words)
      }
      db.kvSet('insights.since', insights.dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 34)))
      db.kvSet('insights.hours', [120, 40, 0, 0, 0, 0, 0, 80, 300, 420, 380, 260, 180, 220, 310, 290, 340, 520, 760, 1480, 2210, 2650, 1890, 640])
      await insights.scan()
      insightsAi.setConfig({ providerId: 'demo', modelId: 'demo-editor', effort: null, parallel: 3 })
      await insightsAi.runStory('quick', '')
      await insightsAi.runFocus()
      await insightsAi.runNotes()

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

      await js(`document.querySelector('[data-mode="chat"]').click(); await wait(200); document.querySelector('.rail [data-rail="settings"]').click(); await wait(300);
        [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Model providers'))?.click(); await wait(300);
        [...document.querySelectorAll('.provider-item')].find((r) => r.textContent.includes('demo'))?.click()`)
      await shot('providers')

      const size = win.getSize()
      win.setSize(1800, size[1])
      await js(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Roadmap'))?.click(); await wait(1600)`)
      await shot('roadmap')
      win.setSize(size[0], size[1])
      await wait(300)

      await js(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Updates'))?.click()`)
      await shot('updates')

      // Insights pages, with the achievements notice from the invented month dismissed.
      await js(`document.querySelector('.ach-toast [aria-label="Dismiss"]')?.click(); document.querySelector('[data-mode="insights"]').click(); await wait(600)`)
      await shot('insights')
      await js(`[...document.querySelectorAll('.insights-nav-item')].find((b) => b.textContent.startsWith('Story analysis'))?.click(); await wait(700)`)
      await shot('story')
      await js(`[...document.querySelectorAll('.insights-nav-item')].find((b) => b.textContent.startsWith('Characters'))?.click(); await wait(500)`)
      await shot('characters')

      // Split differences on the storm chat.
      await js(`document.querySelector('[data-mode="chat"]').click(); await wait(300);
        [...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('Two takes on the storm'))?.click(); await wait(600);
        [...document.querySelectorAll('.chat-head button')].find((b) => b.textContent.trim() === 'Differences')?.click(); await wait(400)`)
      await shot('diff')
      await js(`[...document.querySelectorAll('.chat-head button')].find((b) => b.textContent.trim() === 'Differences')?.click()`)

      // The command menu, mid-search.
      await js(`[...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('The lighthouse at Gull Point'))?.click(); await wait(500)`)
      win.webContents.focus()
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control'] })
      await wait(300)
      await win.webContents.insertText('th')
      await shot('command')
      await js(`document.querySelector('.overlay-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)

      // Usage, from the demo chats' replies.
      await js(`document.querySelector('.rail [data-rail="settings"]').click(); await wait(300);
        [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Usage'))?.click(); await wait(700)`)
      await shot('usage')

      // The document library over the demo manuscript, with a search tried.
      setLibrarySettings({ folders: [join(app.getPath('userData'), 'vault')] })
      await reindexLibrary()
      await js(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('Writing'))?.click(); await wait(500);
        const input = document.querySelector('.library-try input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'who lights the lamps on the bridge');
        input.dispatchEvent(new Event('input', { bubbles: true })); await wait(100);
        document.querySelector('.library-try button').click(); await wait(500);
        // The demo folder sits in the throwaway profile; the picture shows a tidy place for it.
        document.querySelectorAll('.library-folder .folder-path').forEach((e) => (e.textContent = 'Documents\\\\Writing'));
        document.querySelector('.library-card')?.scrollIntoView({ block: 'start' })`)
      await shot('library')

      // The Code tab: a small fix in a demo project, as the agent left it.
      const project = join(app.getPath('userData'), 'lighthouse-log')
      mkdirSync(project, { recursive: true })
      const before = "import { lamps } from './lamps'\n\nexport function logEntry(night: string): string {\n  return `${night}: lit eight lamps on the bridge`\n}\n"
      const after = "import { lamps } from './lamps'\n\nexport function logEntry(night: string): string {\n  return `${night}: lit ${lamps.length} lamps on the bridge`\n}\n"
      writeFileSync(join(project, 'log.ts'), after)
      writeFileSync(join(project, 'lamps.ts'), "export const lamps = ['quay', 'quay', 'quay', 'bridge', 'bridge', 'bridge', 'hill', 'hill', 'hill']\n")
      writeFileSync(join(project, 'AGENTS.md'), 'Keep changes small. Run npm test after each one.\n')
      const session = (await code.newSession(null, project))!
      code.showcaseSession(session.id, {
        title: 'The log says eight lamps; there are nine',
        tasks: [
          { title: 'Find where the log gets its count', status: 'done' },
          { title: 'Read the count from lamps.ts', status: 'done' },
          { title: 'Run the tests', status: 'done' }
        ],
        entries: [
          { kind: 'user', text: 'The bridge has nine lamps but the nightly log says eight. Fix it so the log always matches the lamp list.' },
          { kind: 'assistant', text: "I'll find where the log writes its count first." },
          { kind: 'tool', id: 't1', tool: 'search_files', title: 'Searched for "eight"', status: 'done', output: 'log.ts:4:  return `${night}: lit eight lamps on the bridge`' },
          { kind: 'tool', id: 't2', tool: 'read_file', title: 'Read lamps.ts', status: 'done' },
          { kind: 'tool', id: 't3', tool: 'edit_file', title: 'Edited log.ts', status: 'done', diff: lineDiff(before, after), snapshot: 1 },
          { kind: 'tool', id: 't4', tool: 'run_command', title: 'Ran npm test', status: 'done', output: ' ✓ logEntry counts every lamp (3 ms)\n\n Tests  1 passed' },
          {
            kind: 'assistant',
            text: 'Done. The log hard-coded **eight**; it now counts `lamps` from `lamps.ts`, so adding a lamp updates the log too. The test passes. Undo puts `log.ts` back if you\'d rather keep it as it was.'
          }
        ]
      })
      await js(`document.querySelector('.rail-item[data-mode="code"]').click(); await wait(600);
        document.querySelector('.code-tool[data-tool="edit_file"] .code-tool-head')?.click(); await wait(300)`)
      await shot('code')

      // The light theme, Moonlit Paper, on the lighthouse chat.
      await js(`document.querySelector('[data-mode="chat"]').click(); await wait(300);
        [...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('The lighthouse at Gull Point'))?.click(); await wait(500);
        document.documentElement.dataset.theme = 'moonlit'; await wait(400)`)
      await shot('moonlit')
      await js(`delete document.documentElement.dataset.theme; await wait(200)`)

      // The themes: the lighthouse chat in six of them, set side by side as one picture.
      await js(`document.querySelector('[data-mode="chat"]').click(); await wait(300);
        [...document.querySelectorAll('.tw-conv')].find((r) => r.textContent.includes('The lighthouse at Gull Point'))?.click(); await wait(500)`)
      const tiles: { name: string; src: string }[] = []
      for (const [theme, name] of [['twilight', 'Twilight'], ['ultraviolet', 'Ultraviolet'], ['synthwave', 'Synthwave'], ['aurora', 'Aurora'], ['campfire', 'Campfire'], ['moonlit', 'Moonlit Paper']]) {
        await js(`${theme === 'twilight' ? 'delete document.documentElement.dataset.theme' : `document.documentElement.dataset.theme = '${theme}'`}; await wait(350)`)
        tiles.push({ name, src: (await win.webContents.capturePage()).resize({ width: 960 }).toDataURL() })
      }
      await js(`delete document.documentElement.dataset.theme`)
      // A gallery: each window whole, at its own shape, named, under a heading.
      await js(`const page = document.createElement('div'); page.id = 'showcase-grid';
        page.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;justify-content:center;gap:28px;padding:0 44px;background:radial-gradient(120% 80% at 50% 120%, #3a2245, #05060f 70%)';
        const head = document.createElement('div');
        head.textContent = 'Eleven themes, light and dark, or your own';
        head.style.cssText = 'text-align:center;font-family:var(--font-serif);font-size:40px;font-weight:600;color:#eceefe;letter-spacing:-.02em';
        page.appendChild(head);
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:22px 20px';
        for (const t of ${JSON.stringify(tiles)}) {
          const cell = document.createElement('figure'); cell.style.cssText = 'margin:0;display:flex;flex-direction:column;gap:8px;align-items:center';
          const img = document.createElement('img'); img.src = t.src; img.style.cssText = 'width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border-radius:12px;box-shadow:0 18px 40px -12px #000c, 0 0 0 1px #ffffff14';
          const cap = document.createElement('figcaption'); cap.textContent = t.name; cap.style.cssText = 'font-size:15px;font-weight:500;color:#a6abd8';
          cell.append(img, cap); grid.appendChild(cell)
        }
        page.appendChild(grid);
        document.body.appendChild(page); await wait(500)`)
      await shot('themes')
      await js(`document.getElementById('showcase-grid')?.remove()`)

      // Last, the hero: the welcome's evening, once the sun has set.
      await js(`document.querySelector('.rail [data-rail="settings"]').click(); await wait(300);
        [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.startsWith('About'))?.click(); await wait(300);
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Replay the welcome')?.click(); await wait(3600)`)
      await shot('hero')
      writeFileSync(join(outDir, 'showcase.json'), JSON.stringify({ ok: true }))
    } catch (err) {
      writeFileSync(join(outDir, 'showcase.json'), JSON.stringify({ ok: false, error: String(err) }))
    } finally {
      server?.close()
      app.quit()
    }
  })
}
