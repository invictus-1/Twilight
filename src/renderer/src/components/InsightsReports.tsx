import { useState } from 'react'
import type { InsightsSummary } from '@shared/insights'
import { useInsights } from '../insightsStore'
import { useStore } from '../store'
import { ExportIcon, FolderIcon, SparkIcon } from './Icons'

type Kind = 'week' | 'month' | 'year' | 'all'

const REPORTS: { kind: Kind; title: string; text: string }[] = [
  { kind: 'week', title: 'Week in Writing', text: 'The last 7 days: words, streak, best day, top words.' },
  { kind: 'month', title: 'Month in Writing', text: 'This calendar month, day by day.' },
  { kind: 'year', title: 'Year in Writing', text: 'The whole year, month by month, with the heatmap.' },
  { kind: 'all', title: 'All-Time Retrospective', text: 'Everything since tracking began.' }
]

/** Recaps as single HTML files, saved in the app's reports folder and opened in the browser. */
export function ReportsPage(_: { s: InsightsSummary }) {
  const ai = useInsights((s) => s.ai)
  const [includeAi, setIncludeAi] = useState(true)
  const [busy, setBusy] = useState<Kind | null>(null)
  const [last, setLast] = useState<string | null>(null)
  const hasAi = !!(ai?.notes || ai?.story[''])
  const exportOne = async (kind: Kind): Promise<void> => {
    setBusy(kind)
    try {
      setLast(await window.twilight.exportReport(kind, includeAi && hasAi, true))
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <header className="ins-head">
        <div>
          <h2 className="ins-title">Reports</h2>
          <p className="ins-sub">Single-file recaps, saved on your computer and opened in your browser</p>
        </div>
        <label className="check" title={hasAi ? 'Adds your latest saved Insights and Story analysis; runs nothing new' : 'Run Insights or Story analysis first'}>
          <input type="checkbox" checked={includeAi && hasAi} disabled={!hasAi} onChange={(e) => setIncludeAi(e.target.checked)} />
          <SparkIcon size={14} />
          Include AI insights
        </label>
      </header>
      <div className="report-grid">
        {REPORTS.map((r) => (
          <article key={r.kind} className="report-card">
            <h3>{r.title}</h3>
            <p>{r.text}</p>
            <button className="tw-btn tw-btn-primary report-btn" disabled={busy !== null} onClick={() => void exportOne(r.kind)}>
              <ExportIcon size={15} />
              {busy === r.kind ? 'Making…' : 'Export'}
            </button>
          </article>
        ))}
      </div>
      <div className="field-inline">
        <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => void window.twilight.openReportsFolder()}>
          <FolderIcon size={14} />
          Open the reports folder
        </button>
        {last && <span className="field-note">Saved {last.split(/[\\/]/).pop()}</span>}
      </div>
    </>
  )
}
