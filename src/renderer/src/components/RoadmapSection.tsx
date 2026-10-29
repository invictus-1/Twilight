import { useMemo, useState } from 'react'
import { parseRoadmap, type Roadmap, type RoadmapItem } from '@shared/roadmap'
import roadmapFile from '../../../../ROADMAP.md?raw'
import { useStore } from '../store'
import { CheckIcon } from './Icons'

// The Roadmap page: ROADMAP.md, bundled at build time, drawn as a page. Planned work as cards by
// area, ideas as quieter tiles, and everything shipped as a timeline of releases.

const AREAS: Record<string, string> = { Core: 'var(--iris)', Chat: 'var(--horizon)', Writing: 'var(--dusk)', Judge: 'var(--success)' }
const areaColor = (area: string): string => AREAS[area] ?? 'var(--ink-faint)'
const sentence = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

function AreaTag({ area }: { area: string }) {
  return (
    <span className="rm-area" style={{ '--area': areaColor(area) } as React.CSSProperties}>
      <span className="rm-area-dot" />
      {area}
    </span>
  )
}

function Card({ item, index }: { item: RoadmapItem; index: number }) {
  return (
    <article
      className={`rm-card is-${item.status}`}
      style={{ '--area': areaColor(item.area), '--i': Math.min(index, 12) } as React.CSSProperties}
    >
      <div className="rm-card-top">
        <AreaTag area={item.area} />
        {item.status === 'doing' && (
          <span className="rm-doing">
            <span className="rm-pulse" />
            In progress
          </span>
        )}
      </div>
      <h5 className="rm-card-title">{item.title}</h5>
      {item.text && <p className="rm-card-text">{sentence(item.text)}.</p>}
    </article>
  )
}

/**
 * The side panel on a wide window: the way to 1.0 as steps (each release, what's left for the one
 * being built, then 1.0), and what has shipped in each area. Hidden when there isn't room.
 */
function Journey({ roadmap, version, progress }: { roadmap: Roadmap; version?: string; progress: number }) {
  const building = roadmap.shipped.find((r) => /in progress/i.test(r.date))
  const released = roadmap.shipped.filter((r) => r !== building)
  const left = roadmap.next.filter((i) => i.status !== 'doing').length
  const jump = (v: string): void => document.querySelector(`[data-release="${v}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const byArea = Object.keys(AREAS)
    .map((a) => ({ area: a, done: roadmap.shipped.reduce((n, r) => n + r.items.filter((i) => i.area === a).length, 0) }))
    .filter((a) => a.done > 0)
  const most = Math.max(1, ...byArea.map((a) => a.done))
  const ring = 2 * Math.PI * 34
  return (
    <aside className="rm-aside" aria-label="The way to 1.0">
      <div className="rm-aside-card rm-journey">
        <div className="rm-ring-row">
          <svg className="rm-ring" viewBox="0 0 80 80" aria-hidden="true">
            <circle cx="40" cy="40" r="34" className="rm-ring-track" />
            <circle cx="40" cy="40" r="34" className="rm-ring-fill" style={{ strokeDasharray: `${(ring * progress) / 100} ${ring}` }} />
          </svg>
          <div>
            <div className="rm-ring-n">{progress}%</div>
            <div className="rm-ring-label">of the way to 1.0</div>
          </div>
        </div>
        <ol className="rm-steps">
          <li className="rm-step rm-step-goal">
            <span className="rm-step-dot" />
            <span className="rm-step-v">1.0</span>
            <span className="rm-step-note">the final pass</span>
          </li>
          {building && (
            <li className="rm-step rm-step-now">
              <button className="rm-step-btn" onClick={() => jump(building.version)}>
                <span className="rm-step-dot" />
                <span className="rm-step-v">{building.version.replace(/\.0$/, '')}</span>
                <span className="rm-step-note">
                  {building.items.length} done{left ? ` · ${left} to go` : ''}
                </span>
              </button>
            </li>
          )}
          {released.map((r) => (
            <li key={r.version} className={`rm-step ${r.version === version ? 'rm-step-here' : ''}`}>
              <button className="rm-step-btn" onClick={() => jump(r.version)}>
                <span className="rm-step-dot" />
                <span className="rm-step-v">{r.version.replace(/\.0$/, '')}</span>
                <span className="rm-step-note">
                  {r.items.length} shipped{r.version === version ? ' · installed' : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="rm-aside-card">
        <div className="rm-aside-head">Shipped by area</div>
        {byArea.map((a) => (
          <div key={a.area} className="rm-area-row" style={{ '--area': areaColor(a.area) } as React.CSSProperties}>
            <span className="rm-area-name">{a.area}</span>
            <span className="rm-area-bar">
              <span style={{ width: `${(a.done / most) * 100}%` }} />
            </span>
            <span className="rm-area-n">{a.done}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}

export function RoadmapSection() {
  const roadmap = useMemo(() => parseRoadmap(roadmapFile), [])
  const version = useStore((s) => s.updates?.current)
  const [area, setArea] = useState<string | null>(null)
  const show = (items: RoadmapItem[]): RoadmapItem[] => (area ? items.filter((i) => i.area === area) : items)

  const shippedCount = roadmap.shipped.reduce((n, r) => n + r.items.length, 0)
  const ahead = roadmap.next.length + roadmap.later.length
  const progress = Math.round((shippedCount / Math.max(1, shippedCount + ahead)) * 100)
  const everything = [...roadmap.shipped.flatMap((r) => r.items), ...roadmap.next, ...roadmap.later, ...roadmap.ideas]
  const areas = Object.keys(AREAS).filter((a) => everything.some((i) => i.area === a))
  const next = show(roadmap.next)
  const later = show(roadmap.later)
  const ideas = show(roadmap.ideas)

  return (
    <div className="rm-layout">
      <div className="roadmap">
        <header className="rm-hero">
          <div className="rm-sky" aria-hidden="true">
            <span className="rm-sun" />
            <span className="rm-band rm-band-1" />
            <span className="rm-band rm-band-2" />
            <span className="rm-band rm-band-3" />
          </div>
          <div className="rm-hero-body">
            <span className="rm-eyebrow">{version ? `You're on ${version}` : 'Roadmap'}</span>
            <h3 className="rm-hero-title">Where Twilight is headed</h3>
            <p className="rm-hero-text">What has shipped, what's being built, and what's further out on the horizon.</p>
            <div className="rm-stats">
              <div className="rm-stat">
                <span className="rm-stat-n">{shippedCount}</span>
                <span className="rm-stat-label">shipped</span>
              </div>
              <div className="rm-stat">
                <span className="rm-stat-n">{roadmap.next.length}</span>
                <span className="rm-stat-label">next</span>
              </div>
              <div className="rm-stat">
                <span className="rm-stat-n">{roadmap.later.length}</span>
                <span className="rm-stat-label">later</span>
              </div>
              <div className="rm-stat">
                <span className="rm-stat-n">{roadmap.ideas.length}</span>
                <span className="rm-stat-label">ideas</span>
              </div>
            </div>
            <div className="rm-progress" role="img" aria-label={`${progress}% of the planned roadmap has shipped`}>
              <span className="rm-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="rm-progress-note">{progress}% of what's planned has shipped</span>
          </div>
        </header>

        <div className="rm-filters" role="group" aria-label="Filter by area">
          <button className="rm-chip" aria-pressed={area === null} onClick={() => setArea(null)}>
            Everything
          </button>
          {areas.map((a) => (
            <button key={a} className="rm-chip" aria-pressed={area === a} onClick={() => setArea(area === a ? null : a)} style={{ '--area': areaColor(a) } as React.CSSProperties}>
              <span className="rm-area-dot" />
              {a}
              <span className="rm-chip-count">{everything.filter((i) => i.area === a && i.status !== 'shipped').length}</span>
            </button>
          ))}
        </div>

        {next.length > 0 && (
          <section className="rm-section">
            <h4 className="rm-heading">
              Now and next <span className="rm-heading-count">{next.length}</span>
            </h4>
            <div className="rm-grid">
              {next.map((item, i) => (
                <Card key={item.title} item={item} index={i} />
              ))}
            </div>
          </section>
        )}

        {later.length > 0 && (
          <section className="rm-section">
            <h4 className="rm-heading">
              Later <span className="rm-heading-count">{later.length}</span>
            </h4>
            <div className="rm-grid rm-grid-later">
              {later.map((item, i) => (
                <Card key={item.title} item={item} index={i} />
              ))}
            </div>
          </section>
        )}

        {ideas.length > 0 && (
          <section className="rm-section">
            <h4 className="rm-heading">
              Ideas, not promises <span className="rm-heading-count">{ideas.length}</span>
            </h4>
            <div className="rm-ideas">
              {ideas.map((item) => (
                <div key={item.title} className="rm-idea" style={{ '--area': areaColor(item.area) } as React.CSSProperties} title={sentence(item.text)}>
                  <span className="rm-area-dot" />
                  <span className="rm-idea-title">{item.title}</span>
                  <span className="rm-idea-text">{sentence(item.text)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rm-section">
          <h4 className="rm-heading">
            Shipped <span className="rm-heading-count">{shippedCount}</span>
          </h4>
          <ol className="rm-timeline">
            {roadmap.shipped.map((release, r) => {
              const items = show(release.items)
              if (!items.length) return null
              return (
                <li key={release.version} className={`rm-release ${r === 0 ? 'rm-latest' : ''}`} data-release={release.version}>
                  <span className="rm-node" aria-hidden="true" />
                  <div className="rm-release-head">
                    <span className="rm-version">{release.version}</span>
                    {r === 0 && <span className="rm-latest-badge">Latest</span>}
                    {release.version === version && <span className="rm-here-badge">Installed</span>}
                    <span className="rm-date">{release.date}</span>
                  </div>
                  <ul className="rm-shipped">
                    {items.map((item) => (
                      <li key={item.title} className="rm-shipped-item" style={{ '--area': areaColor(item.area) } as React.CSSProperties}>
                        <span className="rm-check">
                          <CheckIcon size={12} />
                        </span>
                        <span>
                          <span className="rm-shipped-title">{item.title}</span>
                          {item.text && <span className="rm-shipped-text"> — {item.text}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ol>
        </section>
      </div>
      <Journey roadmap={roadmap} version={version} progress={progress} />
    </div>
  )
}
