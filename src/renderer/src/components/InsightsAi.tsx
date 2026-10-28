import { useEffect, useState } from 'react'
import type { AiState, InsightsSummary, StoryAnalysis, StoryEstimate } from '@shared/insights'
import { formatCost } from '@shared/pricing'
import { useInsights, type InsightsPage } from '../insightsStore'
import { modelName, optionsFor, useStore } from '../store'
import { BulbIcon, ChevronDown, ChevronRight, HistoryIcon, SparkIcon, StopIcon, TargetIcon } from './Icons'
import { ReportsPage as Reports } from './InsightsReports'

// The AI pages of Writer insights: story analysis, focus and insights. Nothing runs until asked,
// and the page says what will be sent where before it is.

const PALETTE = ['#e48ef5', '#9d7bf5', '#38d4e6', '#f5c76a', '#a3e635', '#f472b6', '#b4a2ff', '#7c5cf2', '#c084fc', '#22d3ee', '#fbbf24', '#fb7185']
const ago = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function useAi(): AiState | null {
  return useInsights((s) => s.ai)
}

/** Which model the AI pages use, and how hard it thinks. */
function ModelBar({ ai, sends }: { ai: AiState; sends: string }) {
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const visible = models.filter((m) => !m.hidden || (m.providerId === ai.config.providerId && m.id === ai.config.modelId))
  const options = optionsFor(models, providers, ai.config.providerId, ai.config.modelId)
  const provider = providers.find((p) => p.id === ai.config.providerId)
  const set = (patch: Partial<AiState['config']>): void => void window.twilight.setAiConfig({ ...ai.config, ...patch }).then((state) => useInsights.setState({ ai: state }))
  return (
    <div className="ai-bar">
      <label className="ai-field">
        <span>Model</span>
        <select
          value={`${ai.config.providerId}::${ai.config.modelId}`}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split('::')
            set({ providerId, modelId, effort: null })
          }}
        >
          {!visible.some((m) => m.providerId === ai.config.providerId && m.id === ai.config.modelId) && (
            <option value={`${ai.config.providerId}::${ai.config.modelId}`}>{modelName(models, ai.config.modelId)}</option>
          )}
          {visible.map((m) => (
            <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {options.efforts.length > 0 && (
        <label className="ai-field">
          <span>Effort</span>
          <select value={ai.config.effort ?? ''} onChange={(e) => set({ effort: e.target.value || null })}>
            <option value="">{options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'}</option>
            {options.efforts.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="ai-sends">
        Sends {sends} to {provider?.name ?? ai.config.providerId}. Nothing runs until you press the button.
      </p>
    </div>
  )
}

function RunState({ ai, kind }: { ai: AiState; kind: 'story' | 'focus' | 'notes' }) {
  const r = ai.running
  if (r?.kind === kind) {
    const pct = r.total ? Math.round((r.done / r.total) * 100) : 0
    return (
      <div className="ai-progress">
        <div className="ai-progress-track">
          <span style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
        <span className="field-note">{r.total > 1 ? `${r.done} of ${r.total} calls` : 'Waiting for the model…'}</span>
        <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => void window.twilight.stopAi()}>
          <StopIcon size={14} />
          Stop
        </button>
      </div>
    )
  }
  return ai.error ? <div className="tw-msg-error">{ai.error}</div> : null
}

function Head({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
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

/** Earlier results of one kind: pick one to read it again, or remove it. */
function History<T extends { at: number; model: string }>(props: {
  items: T[]
  viewing: number | null
  onView: (at: number | null) => void
  onForget: (at: number) => void
  describe?: (item: T) => string
}) {
  const { items, viewing } = props
  if (items.length < 2) return null
  const models = useStore.getState().models
  const viewed = items.find((i) => i.at === viewing)
  return (
    <div className="ai-history">
      <label className="ai-history-pick">
        <HistoryIcon size={14} />
        <span>Earlier results</span>
        <select value={viewing ?? items[0].at} onChange={(e) => props.onView(Number(e.target.value) === items[0].at ? null : Number(e.target.value))}>
          {items.map((item, i) => (
            <option key={item.at} value={item.at}>
              {i === 0 ? 'Latest · ' : ''}
              {ago(item.at)} · {modelName(models, item.model)}
              {props.describe ? ` · ${props.describe(item)}` : ''}
            </option>
          ))}
        </select>
      </label>
      {viewed && viewed.at !== items[0].at && (
        <span className="ai-history-viewing">
          Viewing an earlier result.
          <button className="link-btn" onClick={() => props.onView(null)}>
            Back to the latest
          </button>
          <button
            className="link-btn danger-text"
            onClick={() => {
              props.onForget(viewed.at)
              props.onView(null)
            }}
          >
            Remove it
          </button>
        </span>
      )}
    </div>
  )
}

const forget = (kind: 'story' | 'focus' | 'notes', at: number): void =>
  void window.twilight.forgetAiResult(kind, at).then((state) => useInsights.setState({ ai: state }))

// ——— Story analysis ———

function Donut({ parts }: { parts: { name: string; percent: number }[] }) {
  const r = 70
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 200 200" role="img" aria-label="Content breakdown">
        {parts.map((p, i) => {
          const len = (p.percent / 100) * c
          const seg = (
            <circle
              key={p.name}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="28"
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            >
              <title>{`${p.name}: ${p.percent.toFixed(1)}%`}</title>
            </circle>
          )
          offset += len
          return seg
        })}
      </svg>
      <ul className="donut-legend">
        {parts.map((p, i) => (
          <li key={p.name}>
            <span className="donut-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
            {p.name} <b>{p.percent.toFixed(1)}%</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tags({ tags }: { tags: StoryAnalysis['tags'] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="tag-groups">
      {tags.map((t) => (
        <div key={t.name} className={`tag-group ${open === t.name ? 'open' : ''}`}>
          <button className="tag-head" aria-expanded={open === t.name} onClick={() => setOpen(open === t.name ? null : t.name)}>
            {open === t.name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t.name}
            <span className="tag-count">{t.subtags.length}</span>
          </button>
          {open === t.name && (
            <div className="word-chips tag-subs">
              {t.subtags.map((s) => (
                <span key={s} className="word-chip">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function StoryResult({ r }: { r: StoryAnalysis }) {
  return (
    <>
      <p className="ins-note">
        {r.mode === 'deep' ? 'Deep scan' : 'Quick sample'} of {r.words.toLocaleString()} words · {modelName(useStore.getState().models, r.model)} · {ago(r.at)}
        {r.costUsd !== null ? ` · ${formatCost(r.costUsd)}` : ''}
      </p>
      {r.summary && (
        <section className="ins-card">
          <h3 className="ins-card-title">In short</h3>
          <p className="ai-prose">{r.summary}</p>
          {r.tone && <p className="ai-prose ai-tone">{r.tone}</p>}
        </section>
      )}
      <div className="ins-two">
        <section className="ins-card">
          <h3 className="ins-card-title">Content breakdown</h3>
          <Donut parts={r.breakdown} />
        </section>
        <section className="ins-card">
          <h3 className="ins-card-title">Genres</h3>
          <ol className="word-bars genre-bars">
            {r.genres.map((g) => (
              <li key={g.name}>
                <span className="word-bars-word">{g.name}</span>
                <span className="word-bars-track">
                  <span style={{ width: `${Math.min(100, g.percent)}%` }} />
                </span>
                <span className="word-bars-n">{Math.round(g.percent)}%</span>
              </li>
            ))}
          </ol>
          {r.tags.length > 0 && (
            <>
              <h3 className="ins-card-title">Tags</h3>
              <p className="ins-card-note">Click one for its subcategories.</p>
              <Tags tags={r.tags} />
            </>
          )}
        </section>
      </div>
      {r.themes.length > 0 && (
        <section className="ins-card">
          <h3 className="ins-card-title">Themes</h3>
          <div className="theme-grid">
            {r.themes.map((t) => (
              <article key={t.name} className="theme-card">
                <h4>{t.name}</h4>
                <p>{t.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function StoryPage({ ai, s }: { ai: AiState; s: InsightsSummary }) {
  const [scope, setScope] = useState('')
  const [estimate, setEstimate] = useState<Record<'quick' | 'deep', StoryEstimate | null>>({ quick: null, deep: null })
  const busy = !!ai.running
  const [viewing, setViewing] = useState<number | null>(null)
  const earlier = ai.history.story.filter((r) => r.scope === scope)
  const result = (viewing && earlier.find((r) => r.at === viewing)) || ai.story[scope]
  useEffect(() => setViewing(null), [scope, ai.story[scope]?.at])
  const setParallel = (parallel: number): void =>
    void window.twilight.setAiConfig({ ...ai.config, parallel }).then((state) => useInsights.setState({ ai: state }))
  useEffect(() => {
    let live = true
    setEstimate({ quick: null, deep: null })
    void Promise.all([window.twilight.estimateStory('quick', scope), window.twilight.estimateStory('deep', scope)]).then(([quick, deep]) => live && setEstimate({ quick, deep }))
    return () => {
      live = false
    }
  }, [scope, ai.config.modelId, ai.running === null, s.scannedAt])
  const run = (mode: 'quick' | 'deep'): void => {
    void window.twilight.runStory(mode, scope).catch((err) => useStore.getState().setError(errText(err)))
  }
  const cost = (e: StoryEstimate | null): string =>
    e?.costUsd == null ? 'cost unknown for this model' : e.costUsd === 0 ? 'free on a local model' : `about ${formatCost(e.costUsd)}`
  return (
    <>
      <Head title="Story analysis" sub="What your story is made of: content, genres, tags and themes, read by a model you choose" />
      <ModelBar ai={ai} sends={scope ? 'this document' : 'your documents'} />
      <section className="ins-card ai-run">
        <div className="ai-run-row">
          <select className="ins-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="What to analyse">
            <option value="">The whole writing folder</option>
            {s.perFile.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path.replace(/\.md$/i, '')}
              </option>
            ))}
          </select>
          <button className="tw-btn tw-btn-primary" disabled={busy} onClick={() => run('quick')}>
            <SparkIcon size={15} />
            Quick sample
          </button>
          <button className="tw-btn" disabled={busy} onClick={() => run('deep')}>
            Deep scan
          </button>
          <label className="ai-parallel" title="How many parts of a deep scan are read at the same time. More is faster; some providers limit how many requests you can make at once.">
            <span>Calls at once</span>
            <input
              type="number"
              min={1}
              max={10}
              value={ai.config.parallel}
              disabled={busy}
              onChange={(e) => setParallel(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
        <p className="field-note">
          Quick sample: one call reading {estimate.quick ? `${estimate.quick.words > 25000 ? 'about 25,000 words of excerpts' : `all ${estimate.quick.words.toLocaleString()} words`}` : '…'}, {cost(estimate.quick)}. Deep scan:{' '}
          {estimate.deep ? `${estimate.deep.calls} call${estimate.deep.calls === 1 ? '' : 's'} over ${estimate.deep.words.toLocaleString()} words` : '…'}
          {estimate.deep && estimate.deep.cached > 0 ? ` (${estimate.deep.cached} parts already read, never billed twice)` : ''}, {cost(estimate.deep)}, {ai.config.parallel} at a
          time; the same model writes the final themes.
        </p>
        <RunState ai={ai} kind="story" />
      </section>
      <History items={earlier} viewing={viewing} onView={setViewing} onForget={(at) => forget('story', at)} describe={(r) => (r.mode === 'deep' ? 'deep scan' : 'quick sample')} />
      {result ? <StoryResult r={result} /> : !busy && <div className="ins-empty">No analysis of {scope ? 'this document' : 'the folder'} yet. A quick sample is a good start.</div>}
    </>
  )
}

// ——— Focus ———

function FocusPage({ ai }: { ai: AiState }) {
  const [viewing, setViewing] = useState<number | null>(null)
  useEffect(() => setViewing(null), [ai.focus?.at])
  const f = (viewing && ai.history.focus.find((r) => r.at === viewing)) || ai.focus
  return (
    <>
      <Head title="Focus" sub="A few things to work on, chosen from your prose numbers and what you wrote most recently">
        <button className="tw-btn tw-btn-primary" disabled={!!ai.running} onClick={() => void window.twilight.runFocus().catch((e) => useStore.getState().setError(errText(e)))}>
          <TargetIcon size={15} />
          {f ? 'Look again' : 'Find my focus'}
        </button>
      </Head>
      <ModelBar ai={ai} sends="your prose numbers and about 3,600 words from your most recently changed documents" />
      <RunState ai={ai} kind="focus" />
      <History items={ai.history.focus} viewing={viewing} onView={setViewing} onForget={(at) => forget('focus', at)} />
      {f ? (
        <>
          <p className="ins-note">
            {modelName(useStore.getState().models, f.model)} · {ago(f.at)}
          </p>
          {f.strength && (
            <section className="ins-card focus-strength">
              <h3 className="ins-card-title">Already working</h3>
              <p className="ai-prose">{f.strength}</p>
            </section>
          )}
          <div className="theme-grid focus-grid">
            {f.areas.map((a, i) => (
              <article key={a.title} className="focus-card">
                <span className="focus-n">{i + 1}</span>
                <h4>{a.title}</h4>
                <p>{a.why}</p>
                {a.evidence.map((q) => (
                  <blockquote key={q}>{q}</blockquote>
                ))}
                {a.exercise && (
                  <p className="focus-try">
                    <b>Try:</b> {a.exercise}
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      ) : (
        !ai.running && <div className="ins-empty">Nothing yet. Press "Find my focus" to get a few concrete things to work on.</div>
      )}
    </>
  )
}

// ——— Insights ———

function NotesPage({ ai }: { ai: AiState }) {
  const [viewing, setViewing] = useState<number | null>(null)
  useEffect(() => setViewing(null), [ai.notes?.at])
  const n = (viewing && ai.history.notes.find((r) => r.at === viewing)) || ai.notes
  return (
    <>
      <Head title="Insights" sub="What your numbers say about how you write: habits, rhythms and trends">
        <button className="tw-btn tw-btn-primary" disabled={!!ai.running} onClick={() => void window.twilight.runNotes().catch((e) => useStore.getState().setError(errText(e)))}>
          <BulbIcon size={15} />
          {n ? 'Refresh' : 'Read my numbers'}
        </button>
      </Head>
      <ModelBar ai={ai} sends="your statistics only (no manuscript text)" />
      <RunState ai={ai} kind="notes" />
      <History items={ai.history.notes} viewing={viewing} onView={setViewing} onForget={(at) => forget('notes', at)} />
      {n ? (
        <>
          <p className="ins-note">
            {modelName(useStore.getState().models, n.model)} · {ago(n.at)}
          </p>
          <div className="theme-grid">
            {n.observations.map((o) => (
              <article key={o.title} className="theme-card">
                <h4>{o.title}</h4>
                <p>{o.text}</p>
              </article>
            ))}
          </div>
          {n.nextStep && (
            <section className="ins-card focus-strength">
              <h3 className="ins-card-title">For the week ahead</h3>
              <p className="ai-prose">{n.nextStep}</p>
            </section>
          )}
        </>
      ) : (
        !ai.running && <div className="ins-empty">Nothing yet. Only your statistics are sent, never your writing.</div>
      )}
    </>
  )
}

export function AiPage({ page, s }: { page: InsightsPage; s: InsightsSummary }) {
  const ai = useAi()
  if (!ai) return <div className="ins-empty">Loading…</div>
  if (page === 'story') return <StoryPage ai={ai} s={s} />
  if (page === 'focus') return <FocusPage ai={ai} />
  return <NotesPage ai={ai} />
}

export const ReportsPage = Reports
