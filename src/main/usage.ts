import { costOf } from '@shared/pricing'
import type { Usage, UsageBucket, UsageRange, UsageStats, UsageTotals } from '@shared/types'
import * as db from './db'
import { getProviders } from './providers'
import { isLocal } from './providers/openai'

// Settings → Usage: tokens and spend from every reply's stored usage, plus the Judge's runs.
// Costs are worked out here, request by request, with today's price list (yours included), so
// changing a price re-prices the past as well.

const zero = (): UsageTotals => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 })

function add(t: UsageTotals, u: Usage, cost: number | null): void {
  t.requests++
  t.input += u.input + u.cacheRead + u.cacheWrite
  t.output += u.output
  t.cacheRead += u.cacheRead
  t.cacheWrite += u.cacheWrite
  if (cost === null) t.unpriced++
  else t.cost += cost
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

/** Where the range starts: local midnight for days, the first of the month for months. */
export function rangeStart(range: UsageRange, now = new Date()): number {
  if (range === '7d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
  if (range === '30d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime()
  if (range === '12m') return new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime()
  return 0
}

interface Row {
  c: string | null
  m: string | null
  p: string | null
  t: number
  u: string
}

export function usageStats(range: UsageRange): UsageStats {
  const now = new Date()
  const since = rangeStart(range, now)
  const unit = range === '7d' || range === '30d' ? 'day' : 'month'
  const sql = db.handle()
  // The covering index nodes_usage answers this without reading any message.
  const replies = sql
    .prepare(
      `SELECT conversation_id AS c, model AS m, provider_id AS p, created_at AS t, usage AS u FROM nodes
       WHERE role = 'assistant' AND usage IS NOT NULL AND created_at >= ?`
    )
    .all(since) as Row[]
  // Judgments live in kv as JSON; SQLite picks out each run's usage so only that crosses over.
  const judged = sql
    .prepare(
      `SELECT NULL AS c, coalesce(json_extract(r.value, '$.modelId'), json_extract(k.value, '$.input.judgeModelId')) AS m,
         json_extract(k.value, '$.input.judgeProviderId') AS p, json_extract(k.value, '$.createdAt') AS t, json_extract(r.value, '$.usage') AS u
       FROM kv k, json_each(k.value, '$.runs') r
       WHERE k.key >= 'judgment:' AND k.key < 'judgment;' AND json_extract(r.value, '$.usage') IS NOT NULL AND json_extract(k.value, '$.createdAt') >= ?`
    )
    .all(since) as Row[]

  const local = new Map(getProviders().map((p) => [p.id, p.kind === 'openai' && isLocal(p.baseUrl ?? '')]))
  const totals = zero()
  const judge = zero()
  const models = new Map<string, UsageTotals & { providerId: string; modelId: string }>()
  const chats = new Map<string, UsageTotals>()
  const buckets = new Map<string, UsageBucket>()
  // Bucket keys are local dates; every time zone is a whole number of quarter hours from UTC,
  // so one Date per quarter hour is enough.
  const keys = new Map<number, string>()
  const keyOf = (t: number): string => {
    const slot = Math.floor(t / 900_000)
    let k = keys.get(slot)
    if (k === undefined) {
      k = unit === 'day' ? dayKey(new Date(t)) : monthKey(new Date(t))
      keys.set(slot, k)
    }
    return k
  }
  let earliest = Infinity

  for (const row of [...replies, ...judged]) {
    let u: Usage
    try {
      u = JSON.parse(row.u) as Usage
    } catch {
      continue
    }
    const cost = costOf(row.m ?? undefined, u, local.get(row.p ?? '') ?? false)
    add(totals, u, cost)
    const modelKey = `${row.p ?? ''}\n${row.m ?? ''}`
    let model = models.get(modelKey)
    if (!model) models.set(modelKey, (model = { ...zero(), providerId: row.p ?? '', modelId: row.m ?? '' }))
    add(model, u, cost)
    if (row.c) {
      let c = chats.get(row.c)
      if (!c) chats.set(row.c, (c = zero()))
      add(c, u, cost)
    } else add(judge, u, cost)
    const key = keyOf(row.t)
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = { key, requests: 0, tokens: 0, cost: 0 }))
    b.requests++
    b.tokens += u.input + u.cacheRead + u.cacheWrite + u.output
    b.cost += cost ?? 0
    earliest = Math.min(earliest, row.t)
  }

  // Every day (or month) of the range gets a bar, empty ones included; all time starts at the
  // first month with any usage.
  const series: UsageBucket[] = []
  const first = new Date(since || (Number.isFinite(earliest) ? earliest : now.getTime()))
  const end = unit === 'day' ? dayKey(now) : monthKey(now)
  for (let i = 0; ; i++) {
    const d = unit === 'day' ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + i) : new Date(first.getFullYear(), first.getMonth() + i, 1)
    const key = unit === 'day' ? dayKey(d) : monthKey(d)
    series.push(buckets.get(key) ?? { key, requests: 0, tokens: 0, cost: 0 })
    if (key >= end) break
  }

  const bySpend = (a: UsageTotals, b: UsageTotals): number => b.cost - a.cost || b.input + b.output - (a.input + a.output)
  const top = [...chats.entries()].sort((a, b) => bySpend(a[1], b[1])).slice(0, 10)
  const titles = new Map(
    top.length
      ? (sql.prepare(`SELECT id, title, deleted_at FROM conversations WHERE id IN (${top.map(() => '?').join(',')})`).all(...top.map(([id]) => id)) as {
          id: string
          title: string
          deleted_at: number | null
        }[]).map((r) => [r.id, r])
      : []
  )
  return {
    range,
    unit,
    since,
    totals,
    series,
    models: [...models.values()].sort(bySpend),
    chats: top.map(([id, t]) => ({ ...t, id, title: titles.get(id)?.title ?? 'Untitled chat', trashed: titles.get(id)?.deleted_at != null })),
    judge
  }
}
