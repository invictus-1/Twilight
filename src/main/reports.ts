// Writing recaps as single HTML files (styles and charts inline, no scripts, nothing loaded from
// the network), saved in the app's reports folder and opened in the default browser. With "include
// AI", the latest saved Story analysis and Insights results are added; nothing new is run.

import { app, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DayCount } from '@shared/insights'
import * as db from './db'
import { dayOf, summary } from './insights'
import { state as aiState } from './insightsAi'

export type ReportKind = 'week' | 'month' | 'year' | 'all'

const TITLES: Record<ReportKind, string> = { week: 'Week in Writing', month: 'Month in Writing', year: 'Year in Writing', all: 'All-Time Retrospective' }

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const n = (v: number): string => Math.round(v).toLocaleString('en-US')
const parse = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const label = (day: string, opts: Intl.DateTimeFormatOptions): string => parse(day).toLocaleDateString('en-US', opts)

export function reportsFolder(): string {
  return join(app.getPath('userData'), 'reports')
}

/** Bars as inline SVG: one per day (week, month) or per month (year, all time). */
function bars(points: { label: string; value: number }[]): string {
  const w = 760
  const h = 220
  const max = Math.max(1, ...points.map((p) => p.value))
  const slot = w / Math.max(1, points.length)
  const bw = Math.min(48, slot * 0.7)
  const every = Math.ceil(points.length / 16)
  return `<svg viewBox="0 0 ${w} ${h + 28}" class="chart" role="img" aria-label="Words written">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4a0ff"/><stop offset="1" stop-color="#9497ff"/></linearGradient></defs>
    ${points
      .map((p, i) => {
        const bh = (p.value / max) * h
        const x = i * slot + (slot - bw) / 2
        return `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, p.value ? 2 : 0).toFixed(1)}" rx="5" fill="url(#g)"><title>${esc(p.label)}: ${n(p.value)} words</title></rect>${
          i % every === 0 ? `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${h + 20}" text-anchor="middle">${esc(p.label)}</text>` : ''
        }`
      })
      .join('')}
  </svg>`
}

function heatmap(days: DayCount[], year: number): string {
  const by = new Map(days.map((d) => [d.day, d.words]))
  const values = days.filter((d) => d.day.startsWith(String(year))).map((d) => d.words).sort((a, b) => a - b)
  const q = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0
  const cut = [q(0.25), q(0.5), q(0.75)]
  const colors = ['#1b1f45', '#3a3f86', '#5d62c4', '#9497ff', '#c4a0ff']
  const first = new Date(year, 0, 1)
  first.setDate(first.getDate() - first.getDay())
  let cells = ''
  for (let w = 0; w < 54; w++)
    for (let d = 0; d < 7; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7 + d)
      if (date.getFullYear() !== year) continue
      const words = by.get(dayOf(date)) ?? 0
      const l = words <= 0 ? 0 : words <= cut[0] ? 1 : words <= cut[1] ? 2 : words <= cut[2] ? 3 : 4
      cells += `<rect x="${w * 14}" y="${d * 14}" width="11" height="11" rx="2" fill="${colors[l]}"><title>${dayOf(date)}: ${n(words)} words</title></rect>`
    }
  return `<svg viewBox="0 0 ${54 * 14} ${7 * 14}" class="heat" role="img" aria-label="Writing heatmap ${year}">${cells}</svg>`
}

export async function exportReport(kind: ReportKind, includeAi: boolean): Promise<string> {
  const s = summary()
  const today = dayOf()
  const t = parse(today)
  const from =
    kind === 'week' ? dayOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)) :
    kind === 'month' ? `${today.slice(0, 7)}-01` :
    kind === 'year' ? `${today.slice(0, 4)}-01-01` :
    (s.trackingSince ?? s.days[0]?.day ?? today)
  const days = s.days.filter((d) => d.day >= from && d.day <= today)
  const written = days.reduce((a, d) => a + d.words, 0)
  const best = days.reduce<DayCount | null>((b, d) => (!b || d.words > b.words ? d : b), null)
  const unlocked = db.kvGet<Record<string, number>>('insights.achievements') ?? {}
  const fromMs = parse(from).getTime()
  const earned = s.achievements.filter((a) => (unlocked[a.def.id] ?? 0) >= fromMs)

  let points: { label: string; value: number }[]
  if (kind === 'week' || kind === 'month') {
    points = []
    for (let d = parse(from); d <= t; d.setDate(d.getDate() + 1)) {
      const day = dayOf(d)
      points.push({ label: label(day, kind === 'week' ? { weekday: 'short' } : { day: 'numeric' }), value: s.days.find((x) => x.day === day)?.words ?? 0 })
    }
  } else {
    const months = new Map<string, number>()
    for (let d = new Date(parse(from).getFullYear(), parse(from).getMonth(), 1); d <= t; d.setMonth(d.getMonth() + 1)) months.set(dayOf(d).slice(0, 7), 0)
    for (const d of days) months.set(d.day.slice(0, 7), (months.get(d.day.slice(0, 7)) ?? 0) + d.words)
    points = [...months].map(([m, value]) => ({ label: label(`${m}-01`, kind === 'year' ? { month: 'short' } : { month: 'short', year: '2-digit' }), value }))
  }

  const range = kind === 'all' ? `Since ${label(from, { month: 'long', day: 'numeric', year: 'numeric' })}` : `${label(from, { month: 'long', day: 'numeric' })} – ${label(today, { month: 'long', day: 'numeric', year: 'numeric' })}`
  const stat = (v: string, l: string): string => `<div class="stat"><b>${v}</b><span>${l}</span></div>`
  const ai = includeAi ? aiState() : null
  const story = ai?.story['']
  const maxChar = Math.max(1, ...s.characters.map((c) => c.mentions))

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLES[kind]} · ${esc(range)}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b0d1c;color:#eceefe;font:15px/1.6 "Segoe UI",system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:56px 24px 72px}
.hero{position:relative;overflow:hidden;border-radius:20px;padding:44px 40px 64px;background:linear-gradient(180deg,#171a3d,#221a4a 55%,#3a2245);border:1px solid #272c5a}
.hero:after{content:"";position:absolute;right:8%;bottom:-80px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle at 50% 40%,#ffd3a8,#ffb48a 45%,#e0708a);box-shadow:0 0 90px 20px #ff9a7a40}
.hero:before{content:"";position:absolute;left:0;right:0;bottom:0;height:24px;background:#0b0d1c;opacity:.85;z-index:1}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#c4a0ff}
h1{margin:6px 0 4px;font:600 40px/1.15 Georgia,serif}
.range{color:#a6abd8}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:28px 0}
.stat{background:#191d40;border:1px solid #272c5a;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column}
.stat b{font-size:26px;line-height:1.2}
.stat span{font-size:13px;color:#a6abd8}
h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#a6abd8;margin:36px 0 12px}
.card{background:#191d40;border:1px solid #272c5a;border-radius:14px;padding:20px 22px}
.chart text{fill:#8a90c4;font-size:11px}
.chart,.heat{width:100%;height:auto;display:block}
.words{display:flex;flex-wrap:wrap;gap:8px}
.words span{background:#111430;border:1px solid #3a4080;border-radius:999px;padding:3px 12px;font-size:13px;color:#a6abd8}
.words b{color:#eceefe;font-weight:600}
.bar{display:grid;grid-template-columns:140px 1fr 70px;gap:12px;align-items:center;margin:6px 0;font-size:14px}
.bar i{display:block;height:10px;border-radius:999px;background:linear-gradient(90deg,#9497ff,var(--c,#c4a0ff))}
.bar em{font-style:normal;color:#a6abd8;text-align:right;font-size:13px}
.ach{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.ach div{background:linear-gradient(160deg,#2a2350,#191d40 60%);border:1px solid #5a4a2a;border-radius:12px;padding:12px 14px}
.ach b{display:block}.ach span{font-size:13px;color:#a6abd8}
.theme{margin:0 0 12px}.theme b{color:#e48ef5}
p.ai{margin:0 0 10px}
footer{margin-top:48px;font-size:12px;color:#8a90c4;text-align:center}
</style></head>
<body><main>
<section class="hero"><div class="eyebrow">Twilight</div><h1>${TITLES[kind]}</h1><div class="range">${esc(range)}</div></section>
<div class="stats">
${stat(n(written), 'words written')}
${stat(n(days.length), `active day${days.length === 1 ? '' : 's'}`)}
${stat(best ? n(best.words) : '0', best ? `best day · ${esc(label(best.day, { month: 'short', day: 'numeric' }))}` : 'best day')}
${stat(`${s.streak}`, `day streak · longest ${s.longestStreak}`)}
${stat(n(s.storyTotal), `words in ${n(s.files)} file${s.files === 1 ? '' : 's'}`)}
</div>
<h2>Words written</h2><div class="card">${bars(points)}</div>
${kind === 'year' || kind === 'all' ? `<h2>Every day of ${t.getFullYear()}</h2><div class="card">${heatmap(s.days, t.getFullYear())}</div>` : ''}
<h2>Your prose</h2>
<div class="stats">
${stat(s.style.avgSentence.toFixed(1), 'words per sentence')}
${stat(`${Math.round(s.style.dialoguePercent)}%`, 'dialogue')}
${stat(s.style.adverbsPer1k.toFixed(1), '-ly words per 1,000')}
${stat(n(s.style.vocabulary), 'different words')}
</div>
<div class="card"><div class="words">${s.style.topWords.slice(0, 24).map((w) => `<span>${esc(w.word)} <b>${n(w.count)}</b></span>`).join('')}</div></div>
${s.characters.length ? `<h2>Screen time</h2><div class="card">${[...s.characters].sort((a, b) => b.mentions - a.mentions).slice(0, 10).map((c) => `<div class="bar"><span style="color:${esc(c.color)}">${esc(c.name)}</span><i style="width:${((c.mentions / maxChar) * 100).toFixed(1)}%;--c:${esc(c.color)}"></i><em>${n(c.mentions)}</em></div>`).join('')}</div>` : ''}
${earned.length ? `<h2>Achievements unlocked</h2><div class="ach">${earned.map((a) => `<div><b>${esc(a.def.name)}</b><span>${esc(a.def.goal)}</span></div>`).join('')}</div>` : ''}
${ai?.notes ? `<h2>Insights</h2><div class="card">${ai.notes.observations.map((o) => `<p class="ai"><b>${esc(o.title)}.</b> ${esc(o.text)}</p>`).join('')}${ai.notes.nextStep ? `<p class="ai"><b>Next:</b> ${esc(ai.notes.nextStep)}</p>` : ''}</div>` : ''}
${story ? `<h2>The story</h2><div class="card"><p class="ai">${esc(story.summary)}</p>${story.themes.map((th) => `<p class="theme"><b>${esc(th.name)}</b> · ${esc(th.description)}</p>`).join('')}</div>` : ''}
<footer>Made by Twilight on ${esc(label(today, { month: 'long', day: 'numeric', year: 'numeric' }))}. This file was made on your computer and links to nothing.</footer>
</main></body></html>`

  await mkdir(reportsFolder(), { recursive: true })
  const file = join(reportsFolder(), `${TITLES[kind]} ${today}.html`)
  await writeFile(file, html, 'utf8')
  return file
}

export async function openReport(file: string): Promise<void> {
  await shell.openPath(file)
}
