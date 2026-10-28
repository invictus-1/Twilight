import { useMemo, useState } from 'react'
import { parseRoadmap, type RoadmapItem } from '@shared/roadmap'
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
              <li key={release.version} className={`rm-release ${r === 0 ? 'rm-latest' : ''}`}>
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
  )
}
