import { useEffect, useMemo, useRef, useState } from 'react'
import type { AchievementDef, InsightsSummary, TrackedCharacter } from '@shared/insights'
import { useInsights, type InsightsPage } from '../insightsStore'
import { useStore } from '../store'
import {
  BoltIcon,
  BookIcon,
  CalendarIcon,
  CloseIcon,
  FeatherIcon,
  FlameIcon,
  LockIcon,
  MoonIcon,
  PeopleIcon,
  PlusIcon,
  PulseIcon,
  ScaleIcon,
  SidebarIcon,
  SpeechIcon,
  SunIcon,
  TrendIcon,
  TrophyIcon
} from './Icons'
import { AiPage, ReportsPage } from './InsightsAi'

// Writer insights: the writing folder seen as numbers. Every page reads the one summary the main
// process keeps up to date; the AI pages live in InsightsAi.tsx.

const n = (v: number): string => Math.round(v).toLocaleString()
const short = (v: number): string => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : n(v))
const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions): string => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

function PageHead({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <header className="ins-head">
      <div>
        <h2 className="ins-title">{title}</h2>
        <p className="ins-sub">{sub}</p>
      </div>
      {children}
    </header>
  )
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A number that counts up to its value when it first shows (and glides when it changes). */
function useCountUp(target: number, ms = 750): number {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0))
  const shown = useRef(value)
  useEffect(() => {
    if (reducedMotion()) {
      shown.current = target
      setValue(target)
      return
    }
    const from = shown.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / ms)
      shown.current = from + (target - from) * (1 - (1 - p) ** 3)
      setValue(shown.current)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, ms])
  return value
}

export function Stat(props: { label: string; value: number | string; format?: (v: number) => string; sub?: string; icon: React.ReactNode; tone: string; index?: number }) {
  const counted = useCountUp(typeof props.value === 'number' ? props.value : 0)
  const shown = typeof props.value === 'number' ? (props.format ?? n)(counted) : props.value
  return (
    <div className="ins-stat" style={{ '--tone': props.tone, '--i': props.index ?? 0 } as React.CSSProperties}>
      <div className="ins-stat-text">
        <span className="ins-stat-label">{props.label}</span>
        <span className="ins-stat-value" title={typeof props.value === 'number' ? n(props.value) : props.value}>
          {shown}
        </span>
        {props.sub && <span className="ins-stat-sub">{props.sub}</span>}
      </div>
      <span className="ins-stat-icon">{props.icon}</span>
    </div>
  )
}

/**
 * Bars with a few labelled gridlines; used for the last 14 days, the hours of the day, and
 * Settings → Usage (which formats its axis as tokens or dollars, and has a smaller floor for cost).
 */
export function Bars({
  data,
  label,
  highlight,
  format = short,
  floor = 1
}: {
  data: { key: string; label: string; value: number; title: string }[]
  label: string
  highlight?: string
  format?: (v: number) => string
  floor?: number
}) {
  const max = Math.max(floor, ...data.map((d) => d.value))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).reverse()
  return (
    <div className="ins-bars" role="img" aria-label={label}>
      <div className="ins-bars-axis">
        {ticks.map((t) => (
          <span key={t}>{format(t)}</span>
        ))}
      </div>
      <div className="ins-bars-plot">
        {ticks.map((t) => (
          <span key={t} className="ins-bars-grid" style={{ bottom: `${(t / top) * 100}%` }} />
        ))}
        {data.map((d) => (
          <div key={d.key} className="ins-bar-col" title={d.title}>
            <span className={`ins-bar ${d.key === highlight ? 'now' : ''}`} style={{ height: `${(d.value / top) * 100}%` }} />
            <span className="ins-bar-label">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function niceStep(max: number): number {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="ins-empty">{children}</div>
}

// ——— Dashboard ———

/** Today, front and centre: the evening sky from the Roadmap, with today's count in the writing face. */
function TodayHero({ s }: { s: InsightsSummary }) {
  const today = useCountUp(s.today, 900)
  const now = new Date()
  return (
    <section className="ins-hero">
      <div className="rm-sky" aria-hidden="true">
        <span className="rm-sun" />
        <span className="rm-band rm-band-1" />
        <span className="rm-band rm-band-2" />
        <span className="rm-band rm-band-3" />
      </div>
      <div className="ins-hero-body">
        <span className="rm-eyebrow">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <div className="ins-hero-count">
          <span className="ins-hero-n">{n(today)}</span>
          <span className="ins-hero-unit">word{s.today === 1 ? '' : 's'} today</span>
        </div>
        <div className="ins-hero-chips">
          <span className={`ins-chip ${s.streak ? 'lit' : ''}`}>
            <FlameIcon size={14} />
            {s.streak ? `${s.streak}-day streak` : 'No streak yet'}
            {s.longestStreak > s.streak && <em>best {s.longestStreak}</em>}
          </span>
          {s.bestDay && (
            <span className="ins-chip">
              <TrophyIcon size={14} />
              Best day {n(s.bestDay.words)}
            </span>
          )}
          {s.trackingSince && (
            <span className="ins-chip">
              <CalendarIcon size={14} />
              Since {dayLabel(s.trackingSince, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

function Dashboard({ s }: { s: InsightsSummary }) {
  const today = s.last14.at(-1)?.day
  const avg = s.activeDays ? s.written / s.activeDays : 0
  return (
    <>
      <PageHead title="Dashboard" sub="Words written, counted as your files grow, wherever you write them" />
      <TodayHero s={s} />
      <div className="ins-grid3">
        <Stat index={0} label="This week" value={s.week} sub="last 7 days" icon={<FeatherIcon />} tone="var(--dusk)" />
        <Stat index={1} label="This month" value={s.month} sub={new Date().toLocaleDateString(undefined, { month: 'long' })} icon={<TrendIcon />} tone="var(--horizon)" />
        <Stat index={2} label="This year" value={s.year} sub={String(new Date().getFullYear())} icon={<CalendarIcon />} tone="var(--success)" />
        <Stat index={3} label="Story total" value={s.storyTotal} sub={`${n(s.files)} file${s.files === 1 ? '' : 's'}`} icon={<BookIcon />} tone="var(--iris)" />
        <Stat
          index={4}
          label="Written since tracking"
          value={s.written}
          sub={`${n(s.activeDays)} active day${s.activeDays === 1 ? '' : 's'} · ${n(avg)} a day`}
          icon={<PulseIcon />}
          tone="var(--dusk)"
        />
        <Stat
          index={5}
          label="Best day"
          value={s.bestDay?.words ?? 0}
          sub={s.bestDay ? dayLabel(s.bestDay.day, { month: 'short', day: 'numeric', year: 'numeric' }) : 'not yet'}
          icon={<BoltIcon />}
          tone="var(--warning)"
        />
      </div>
      <section className="ins-card">
        <h3 className="ins-card-title">Last 14 days</h3>
        <Bars
          label="Words written each of the last 14 days"
          highlight={today}
          data={s.last14.map((d) => ({
            key: d.day,
            label: dayLabel(d.day, { weekday: 'short' }),
            value: d.words,
            title: `${dayLabel(d.day, { weekday: 'long', month: 'short', day: 'numeric' })}: ${n(d.words)} words`
          }))}
        />
      </section>
      {s.written === 0 && (
        <p className="ins-note">
          Your folder's existing {n(s.storyTotal)} words are the starting point, not today's work. From here on, words you add (in Twilight, Obsidian or anywhere
          else) are counted on the day you write them.
        </p>
      )}
    </>
  )
}

// ——— Heatmap ———

function Heatmap({ s }: { s: InsightsSummary }) {
  const years = useMemo(() => {
    const ys = new Set(s.days.map((d) => Number(d.day.slice(0, 4))))
    ys.add(new Date().getFullYear())
    return [...ys].sort((a, b) => b - a)
  }, [s.days])
  const [year, setYear] = useState(years[0])
  const byDay = new Map(s.days.map((d) => [d.day, d.words]))
  const inYear = s.days.filter((d) => d.day.startsWith(String(year)))
  const total = inYear.reduce((a, d) => a + d.words, 0)
  // Four levels from the year's own spread, so a light year still shows its shape.
  const values = inYear.map((d) => d.words).sort((a, b) => a - b)
  const q = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0
  const cut = [q(0.25), q(0.5), q(0.75)]
  const level = (w: number): number => (w <= 0 ? 0 : w <= cut[0] ? 1 : w <= cut[1] ? 2 : w <= cut[2] ? 3 : 4)

  const start = new Date(year, 0, 1)
  const first = new Date(year, 0, 1 - start.getDay())
  const weeks: { day: string; inYear: boolean; words: number }[][] = []
  const months: { col: number; label: string }[] = []
  for (let w = 0; w < 54; w++) {
    const col: { day: string; inYear: boolean; words: number }[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7 + d)
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      col.push({ day, inYear: date.getFullYear() === year, words: byDay.get(day) ?? 0 })
      if (date.getFullYear() === year && date.getDate() === 1) months.push({ col: w, label: date.toLocaleDateString(undefined, { month: 'short' }) })
    }
    if (col.some((c) => c.inYear)) weeks.push(col)
  }
  return (
    <>
      <PageHead title="Writing heatmap" sub={`${n(total)} words across ${inYear.length} active day${inYear.length === 1 ? '' : 's'} in ${year}`}>
        <select className="ins-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </PageHead>
      <section className="ins-card">
        <div className="heatmap" style={{ '--weeks': weeks.length } as React.CSSProperties}>
          <div className="heatmap-months">
            {months.map((m) => (
              <span key={m.label} style={{ gridColumn: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heatmap-days">
            <span>Sun</span>
            <span />
            <span />
            <span>Wed</span>
            <span />
            <span />
            <span>Sat</span>
          </div>
          <div className="heatmap-grid">
            {weeks.map((col, i) => (
              <div key={i} className="heatmap-col">
                {col.map((c) => (
                  <span
                    key={c.day}
                    className={`heatmap-cell l${c.inYear ? level(c.words) : 'x'}`}
                    title={c.inYear ? `${dayLabel(c.day, { weekday: 'short', month: 'short', day: 'numeric' })}: ${n(c.words)} words` : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="heatmap-legend">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`heatmap-cell l${l}`} />
          ))}
          More
        </div>
      </section>
      <section className="ins-card">
        <h3 className="ins-card-title">When you write</h3>
        <Bars
          label="Words written by hour of the day"
          data={s.hours.map((v, h) => ({
            key: String(h),
            label: h % 3 === 0 ? `${h}:00` : '',
            value: v,
            title: `${h}:00–${h + 1}:00: ${n(v)} words`
          }))}
        />
      </section>
    </>
  )
}

// ——— Word analysis ———

function Words({ s }: { s: InsightsSummary }) {
  const st = s.style
  const maxWord = st.topWords[0]?.count ?? 1
  return (
    <>
      <PageHead title="Word analysis" sub="Prose health and vocabulary across the whole writing folder" />
      <div className="ins-grid4">
        <Stat index={0} label="Avg sentence" value={st.avgSentence} format={(v) => `${v.toFixed(1)} words`} sub={`longest: ${n(st.longestSentence)} words`} icon={<PulseIcon />} tone="var(--horizon)" />
        <Stat index={1} label="Dialogue" value={st.dialoguePercent} format={(v) => `${Math.round(v)}%`} sub="of the prose is spoken" icon={<SpeechIcon />} tone="var(--dusk)" />
        <Stat index={2} label="Adverb density" value={st.adverbsPer1k} format={(v) => v.toFixed(1)} sub="-ly words per 1,000" icon={<FeatherIcon />} tone="var(--warning)" />
        <Stat index={3} label="Vocabulary" value={st.vocabulary} sub={`different words · richness ${st.richness.toFixed(2)}%`} icon={<BookIcon />} tone="var(--success)" />
      </div>
      <div className="ins-two">
        <section className="ins-card">
          <h3 className="ins-card-title">Most used words</h3>
          <p className="ins-card-note">Common words like "the" and "said", and your tracked characters, are left out.</p>
          <ol className="word-bars">
            {st.topWords.slice(0, 20).map((w) => (
              <li key={w.word}>
                <span className="word-bars-word">{w.word}</span>
                <span className="word-bars-track">
                  <span style={{ width: `${(w.count / maxWord) * 100}%` }} />
                </span>
                <span className="word-bars-n">{n(w.count)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="ins-card">
          <h3 className="ins-card-title">Most used -ly words</h3>
          <p className="ins-card-note">Worth a look when one keeps coming back.</p>
          <div className="word-chips">
            {st.topAdverbs.map((w) => (
              <span key={w.word} className="word-chip">
                {w.word} <b>{n(w.count)}</b>
              </span>
            ))}
            {st.topAdverbs.length === 0 && <span className="ins-card-note">None yet.</span>}
          </div>
        </section>
      </div>
      <section className="ins-card">
        <h3 className="ins-card-title">By file</h3>
        <table className="ins-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Words</th>
              <th>Avg sentence</th>
              <th>Dialogue</th>
            </tr>
          </thead>
          <tbody>
            {s.perFile.map((f) => (
              <tr key={f.path}>
                <td className="ins-table-file">{f.path.replace(/\.md$/i, '')}</td>
                <td>{n(f.words)}</td>
                <td>{f.avgSentence.toFixed(1)}</td>
                <td>{Math.round(f.dialoguePercent)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

// ——— Characters ———

function CharacterEditor({ list, onSave, onClose }: { list: TrackedCharacter[]; onSave: (l: TrackedCharacter[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(list.map((c) => ({ ...c, aliasText: c.aliases.join(', ') })))
  return (
    <section className="ins-card char-editor">
      <h3 className="ins-card-title">Tracked characters</h3>
      <p className="ins-card-note">Aliases count as the same character (nicknames, titles). Separate them with commas.</p>
      {draft.map((c, i) => (
        <div key={i} className="char-edit-row">
          <input type="color" value={c.color || '#9497ff'} aria-label={`Color for ${c.name}`} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
          <input value={c.name} placeholder="Name" onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input value={c.aliasText} placeholder="Aliases" onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, aliasText: e.target.value } : x)))} />
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Stop tracking ${c.name}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
      <div className="field-inline">
        <button className="tw-btn tw-btn-sm" onClick={() => setDraft([...draft, { name: '', aliases: [], color: '', aliasText: '' }])}>
          <PlusIcon size={14} />
          Add character
        </button>
        <span className="tw-spacer" />
        <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="tw-btn tw-btn-sm tw-btn-primary"
          onClick={() => onSave(draft.map(({ aliasText, ...c }) => ({ ...c, aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean) })))}
        >
          Save and recount
        </button>
      </div>
    </section>
  )
}

function Characters({ s }: { s: InsightsSummary }) {
  const [editing, setEditing] = useState(false)
  const setCharacters = useInsights((st) => st.setCharacters)
  const total = s.characters.reduce((a, c) => a + c.mentions, 0)
  const ranked = [...s.characters].sort((a, b) => b.mentions - a.mentions)
  const max = ranked[0]?.mentions || 1
  const colorOf = new Map(s.characters.map((c) => [c.name, c.color]))
  const tracked = s.characters.map(({ name, aliases, color }) => ({ name, aliases, color }))
  return (
    <>
      <PageHead title="Characters" sub={`${n(total)} mentions across ${s.characters.length} tracked character${s.characters.length === 1 ? '' : 's'}`}>
        <button className="tw-btn tw-btn-sm" onClick={() => setEditing((e) => !e)}>
          <PeopleIcon size={14} />
          Edit characters
        </button>
      </PageHead>
      {editing && (
        <CharacterEditor
          list={tracked}
          onClose={() => setEditing(false)}
          onSave={(list) => {
            setEditing(false)
            void setCharacters(list)
          }}
        />
      )}
      {s.characters.length === 0 ? (
        <Empty>No characters tracked yet. Add names above, or pick from the suggestions below.</Empty>
      ) : (
        <div className="ins-two">
          <section className="ins-card">
            <h3 className="ins-card-title">Screen time</h3>
            <ol className="char-bars">
              {ranked.map((c) => (
                <li key={c.name}>
                  <span className="char-name" style={{ color: c.color }}>
                    {c.name}
                  </span>
                  <span className="char-track">
                    <span style={{ width: `${(c.mentions / max) * 100}%`, '--c': c.color } as React.CSSProperties} />
                  </span>
                  <span className="char-n">
                    {n(c.mentions)} · {Math.round(c.share)}%
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <div className="ins-stack">
            <section className="ins-card">
              <h3 className="ins-card-title">Most paired</h3>
              <p className="ins-card-note">Characters named in the same paragraph.</p>
              <ul className="pair-list">
                {s.pairs.map((p) => (
                  <li key={`${p.a}|${p.b}`}>
                    <span>
                      <b style={{ color: colorOf.get(p.a) }}>{p.a}</b> <span className="pair-x">×</span> <b style={{ color: colorOf.get(p.b) }}>{p.b}</b>
                    </span>
                    <span className="pair-n">{n(p.scenes)} scenes</span>
                  </li>
                ))}
                {s.pairs.length === 0 && <li className="ins-card-note">No two tracked characters share a paragraph yet.</li>}
              </ul>
            </section>
            <section className="ins-card">
              <h3 className="ins-card-title">Where they live</h3>
              <ul className="pair-list where-list">
                {s.perFile
                  .filter((f) => f.topCharacter)
                  .map((f) => (
                    <li key={f.path}>
                      <span className="ins-table-file">{f.path.replace(/\.md$/i, '')}</span>
                      <span className="pair-n" style={{ color: colorOf.get(f.topCharacter!) }}>
                        {f.topCharacter} · {n(f.topMentions)}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          </div>
        </div>
      )}
      {s.suggestions.length > 0 && (
        <section className="ins-card">
          <h3 className="ins-card-title">Names Twilight noticed</h3>
          <p className="ins-card-note">Capitalised words that keep turning up mid-sentence. Click one to track it.</p>
          <div className="word-chips">
            {s.suggestions.map((sg) => (
              <button
                key={sg.name}
                className="word-chip word-chip-add"
                onClick={() => void setCharacters([...tracked, { name: sg.name, aliases: [], color: '' }])}
                title={`Track ${sg.name}`}
              >
                <PlusIcon size={12} /> {sg.name} <b>{n(sg.count)}</b>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

// ——— Achievements ———

const ACH_ICONS: Record<string, (p: { size?: number }) => React.ReactElement> = {
  book: BookIcon,
  pen: FeatherIcon,
  bolt: BoltIcon,
  flame: FlameIcon,
  calendar: CalendarIcon,
  people: PeopleIcon,
  feather: FeatherIcon,
  moon: MoonIcon,
  sun: SunIcon,
  speech: SpeechIcon,
  scale: ScaleIcon
}
const ACH_TONES: Record<string, string> = {
  'Magnum Opus': 'var(--iris)',
  'Ink Spilled': 'var(--dusk)',
  'Big Day': 'var(--warning)',
  Unbroken: 'var(--horizon)',
  Regular: 'var(--success)',
  'Full Cast': '#7dd3fc',
  Wordsmith: '#f9a8d4',
  Hours: 'var(--dusk)',
  Style: 'var(--horizon)',
  Judge: 'var(--success)'
}

function AchievementCard({ def, value, unlockedAt }: { def: AchievementDef; value: number; unlockedAt: number | null }) {
  const Ico = ACH_ICONS[def.icon] ?? TrophyIcon
  const pct = Math.min(100, (value / def.target) * 100)
  return (
    <article className={`ach ${unlockedAt ? 'ach-on' : 'ach-off'}`} style={{ '--tone': ACH_TONES[def.family] ?? 'var(--iris)' } as React.CSSProperties}>
      <div className="ach-top">
        <span className="ach-icon">{unlockedAt ? <Ico size={20} /> : <LockIcon size={18} />}</span>
        {unlockedAt && <TrophyIcon size={16} className="ach-trophy" />}
      </div>
      <h4 className="ach-name">{def.name}</h4>
      <p className="ach-goal">{def.goal}</p>
      <div className="ach-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="ach-foot">
        <span>{Math.floor(pct)}%</span>
        {unlockedAt && <span>{new Date(unlockedAt).toLocaleDateString()}</span>}
      </div>
    </article>
  )
}

function Achievements({ s }: { s: InsightsSummary }) {
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')
  const on = s.achievements.filter((a) => a.unlockedAt).length
  const shown = s.achievements.filter((a) => (filter === 'all' ? true : filter === 'on' ? a.unlockedAt : !a.unlockedAt))
  return (
    <>
      <PageHead title="Achievements" sub={`${on} of ${s.achievements.length} unlocked`}>
        <div className="tw-seg ins-seg" role="group" aria-label="Show">
          {(['all', 'on', 'off'] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'on' ? 'Unlocked' : 'Locked'}
            </button>
          ))}
        </div>
      </PageHead>
      <div className="ach-grid">
        {shown.map((a) => (
          <AchievementCard key={a.def.id} {...a} />
        ))}
      </div>
    </>
  )
}

// ——— The view ———

export function InsightsView() {
  const summary = useInsights((s) => s.summary)
  const page = useInsights((s) => s.page)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  return (
    <main className="chat insights-view">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">Insights</h1>
      </header>
      <div className="insights-scroll">
        <div className="insights-page" key={page}>
          {!summary ? (
            <Empty>Reading your writing folder…</Empty>
          ) : summary.files === 0 && !summary.scanning ? (
            <Empty>
              No documents yet. Insights read the markdown files in your writing folder ({summary.folder}). Write in the Writing tab, or point Settings → Writing
              at your manuscript folder.
            </Empty>
          ) : (
            <PageBody page={page} s={summary} />
          )}
        </div>
      </div>
    </main>
  )
}

function PageBody({ page, s }: { page: InsightsPage; s: InsightsSummary }) {
  switch (page) {
    case 'dashboard':
      return <Dashboard s={s} />
    case 'heatmap':
      return <Heatmap s={s} />
    case 'words':
      return <Words s={s} />
    case 'characters':
      return <Characters s={s} />
    case 'achievements':
      return <Achievements s={s} />
    case 'reports':
      return <ReportsPage s={s} />
    default:
      return <AiPage page={page} s={s} />
  }
}

