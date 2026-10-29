import { useEffect, useState } from 'react'
import { formatCost, formatTokens } from '@shared/pricing'
import type { UsageRange, UsageStats, UsageTotals } from '@shared/types'
import { useStore } from '../store'
import { Bars, Stat } from './InsightsView'
import { BoltIcon, PulseIcon, ScaleIcon, SendIcon } from './Icons'

// Settings → Usage: tokens and spend over a range, from every reply's stored usage and the
// Judge's runs. The main process does the counting (and the pricing, with your own prices).

const RANGES: { id: UsageRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '12m', label: '12 months' },
  { id: 'all', label: 'All time' }
]

// Millions as "3.4M" rather than formatTokens' "3400k": totals here run far past one reply's.
const tokens = (v: number): string => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : formatTokens(Math.round(v)))
const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

const dateOf = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d || 1)
}

/** Labels under the bars: every one for a week or a year, about six for longer runs. */
function barLabel(key: string, i: number, count: number, unit: 'day' | 'month'): string {
  const every = Math.ceil(count / (unit === 'day' && count <= 7 ? 7 : 12))
  if (i % every !== 0) return ''
  const d = dateOf(key)
  if (unit === 'month') return d.toLocaleDateString(undefined, count > 12 ? { month: 'short', year: '2-digit' } : { month: 'short' })
  return count <= 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const spend = (t: UsageTotals): string => (t.requests > 0 && t.unpriced === t.requests ? 'No price' : formatCost(t.cost))

export function UsageSection() {
  const [range, setRange] = useState<UsageRange>('30d')
  const [measure, setMeasure] = useState<'tokens' | 'cost'>('tokens')
  const [stats, setStats] = useState<UsageStats | null>(null)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  // Re-counted when your price list changes, since the main process prices every request.
  const prices = useStore((s) => s.prices)
  useEffect(() => {
    let live = true
    void window.twilight.usageStats(range).then((s) => live && setStats(s))
    return () => {
      live = false
    }
  }, [range, prices])

  const t = stats?.totals
  const now = new Date()
  const current = stats?.unit === 'month' ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` : stats?.series.at(-1)?.key
  const modelName = (providerId: string, modelId: string): string => models.find((m) => m.providerId === providerId && m.id === modelId)?.name ?? (modelId || 'Unknown model')
  const providerName = (id: string): string => providers.find((p) => p.id === id)?.name ?? id
  const openChat = (id: string): void => {
    const s = useStore.getState()
    s.setMode('chat')
    void s.open(id)
  }

  return (
    <div className="usage-section" data-range={range} data-loaded={stats?.range === range ? '1' : undefined}>
      <div className="usage-bar">
        <div className="tw-seg ins-seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.id} aria-pressed={range === r.id} data-range={r.id} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="field-note">Costs use today's prices, yours included. Local models are free unless you price them.</span>
      </div>

      {stats && t && (
        <>
          {t.unpriced > 0 && (
            <p className="usage-unpriced">
              {plural(t.unpriced, 'request')} {t.unpriced === 1 ? 'has' : 'have'} no price: add one in{' '}
              <button className="link-btn" onClick={() => useStore.getState().setSettingsOpen(true, 'prices')}>
                Prices
              </button>
              .
            </p>
          )}
          <div className="ins-grid4 usage-stats">
            <Stat index={0} label="Spend" value={t.cost} format={formatCost} sub={t.unpriced ? `${plural(t.unpriced, 'request')} not priced` : 'every request priced'} icon={<ScaleIcon />} tone="var(--horizon)" />
            <Stat index={1} label="Requests" value={t.requests} sub={stats.judge.requests ? `${plural(stats.judge.requests, 'Judge run')} among them` : 'replies in chats'} icon={<SendIcon />} tone="var(--iris)" />
            <Stat
              index={2}
              label="Input tokens"
              value={t.input}
              format={tokens}
              sub={t.input ? `${Math.round((t.cacheRead / t.input) * 100)}% read from cache` : 'nothing sent yet'}
              icon={<PulseIcon />}
              tone="var(--dusk)"
            />
            <Stat index={3} label="Output tokens" value={t.output} format={tokens} sub={t.requests ? `${tokens(t.output / t.requests)} a reply` : 'nothing back yet'} icon={<BoltIcon />} tone="var(--success)" />
          </div>

          <section className="ins-card">
            <div className="panel-head">
              <h3 className="ins-card-title">
                {measure === 'tokens' ? 'Tokens' : 'Spend'} per {stats.unit}
              </h3>
              <div className="tw-seg" role="group" aria-label="Chart shows">
                <button aria-pressed={measure === 'tokens'} onClick={() => setMeasure('tokens')}>
                  Tokens
                </button>
                <button aria-pressed={measure === 'cost'} onClick={() => setMeasure('cost')}>
                  Spend
                </button>
              </div>
            </div>
            <Bars
              key={`${range}:${measure}`}
              label={`${measure === 'tokens' ? 'Tokens' : 'Spend'} each ${stats.unit}`}
              highlight={current}
              format={measure === 'tokens' ? tokens : formatCost}
              floor={measure === 'tokens' ? 1000 : 0.01}
              data={stats.series.map((b, i) => {
                const when = dateOf(b.key).toLocaleDateString(undefined, stats.unit === 'month' ? { month: 'long', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })
                return {
                  key: b.key,
                  label: barLabel(b.key, i, stats.series.length, stats.unit),
                  value: measure === 'tokens' ? b.tokens : b.cost,
                  title: `${when}: ${tokens(b.tokens)} tokens · ${formatCost(b.cost)} · ${plural(b.requests, 'request')}`
                }
              })}
            />
          </section>

          {t.requests === 0 ? (
            <div className="ins-empty">No replies in this range yet.</div>
          ) : (
            <div className="ins-two">
              <section className="ins-card">
                <h3 className="ins-card-title">By model</h3>
                <table className="ins-table usage-models">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Requests</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.models.map((m) => (
                      <tr key={`${m.providerId}:${m.modelId}`} data-model={m.modelId}>
                        <td className="ins-table-file" title={`${m.modelId} · ${providerName(m.providerId)}`}>
                          {modelName(m.providerId, m.modelId)}
                          <span className="usage-provider">{providerName(m.providerId)}</span>
                        </td>
                        <td>{m.requests.toLocaleString()}</td>
                        <td title={`${tokens(m.cacheRead)} read from cache`}>{tokens(m.input)}</td>
                        <td>{tokens(m.output)}</td>
                        <td className={m.unpriced ? 'usage-nocost' : ''} title={m.unpriced ? `${plural(m.unpriced, 'request')} with no price` : undefined}>
                          {spend(m)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="ins-card">
                <h3 className="ins-card-title">Top chats</h3>
                <table className="ins-table usage-chats">
                  <thead>
                    <tr>
                      <th>Chat</th>
                      <th>Tokens</th>
                      <th>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.chats.map((c) => (
                      <tr key={c.id} data-chat={c.id} data-trashed={c.trashed ? '1' : undefined}>
                        <td className="ins-table-file">
                          {c.trashed ? (
                            <span className="usage-chat-trashed" title="Restore it from the trash to open it">
                              {c.title}
                              <span className="tw-badge">In the trash</span>
                            </span>
                          ) : (
                            <button className="usage-chat" title="Open this chat" onClick={() => openChat(c.id)}>
                              {c.title}
                            </button>
                          )}
                        </td>
                        <td>{tokens(c.input + c.output)}</td>
                        <td className={c.unpriced ? 'usage-nocost' : ''}>{spend(c)}</td>
                      </tr>
                    ))}
                    {stats.judge.requests > 0 && (
                      <tr data-chat="judge">
                        <td className="ins-table-file">
                          <span className="usage-chat-trashed">
                            The Judge <span className="usage-provider">{plural(stats.judge.requests, 'run')}</span>
                          </span>
                        </td>
                        <td>{tokens(stats.judge.input + stats.judge.output)}</td>
                        <td className={stats.judge.unpriced ? 'usage-nocost' : ''}>{spend(stats.judge)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
