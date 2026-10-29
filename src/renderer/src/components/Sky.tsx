/**
 * The evening behind an empty chat, drawn retro: a deep field of stars and a band of the galaxy,
 * a striped sun on the horizon and a glowing grid running toward you. The field is one static SVG,
 * so it costs a single paint; only a few stars twinkle, the grid's drift is a transform, and both
 * stop under Gentle and Off motion.
 */
export function EmptySky() {
  return (
    <div className="empty-sky is-retro" aria-hidden="true">
      <span className="empty-galaxy" />
      <svg className="empty-field" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        {FIELD.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} className={`empty-dot empty-dot-${s.tone}`} opacity={s.o} />
        ))}
      </svg>
      {STARS.map((s, i) => (
        <span key={i} className={`empty-star ${s.big ? 'is-big' : ''}`} style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
      ))}
      <span className="empty-shooting" />
      <span className="empty-sun" />
      <span className="empty-horizon" />
      <div className="empty-floor">
        <div className="empty-plane">
          <span className="empty-grid" />
        </div>
      </div>
    </div>
  )
}

// Fixed, scattered places, the same every time: a small seeded generator, so the sky never shifts
// between visits and nothing random runs at render.
function seeded(seed: number): () => number {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
const rand = seeded(1987)
// Thinner toward the horizon (y 0–600 is the sky above it), as a real sky looks through more air.
const FIELD = Array.from({ length: 220 }, () => {
  const y = Math.pow(rand(), 1.4) * 560
  const size = rand()
  return {
    x: Math.round(rand() * 1000 * 10) / 10,
    y: Math.round(y * 10) / 10,
    r: size > 0.97 ? 1.6 : size > 0.85 ? 1.1 : 0.6,
    o: Math.round((0.25 + rand() * 0.6) * (1 - y / 900) * 100) / 100,
    tone: rand() > 0.88 ? (rand() > 0.5 ? 'iris' : 'horizon') : 'ink'
  }
})
const STARS = Array.from({ length: 16 }, (_, i) => ({ x: (i * 37.7 + 6) % 100, y: (i * 23.3 + 4) % 50, d: (i % 8) * 0.55, big: i % 5 === 0 }))
