import type { InsightsSummary } from '@shared/insights'
import type { InsightsPage } from '../insightsStore'

export function AiPage({ page }: { page: InsightsPage; s: InsightsSummary }) {
  return <div className="ins-empty">{page}</div>
}

export function ReportsPage(_: { s: InsightsSummary }) {
  return <div className="ins-empty">Reports</div>
}
