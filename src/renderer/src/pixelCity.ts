// The cyberpunk horizon, drawn as pixel art: three layers of towers in the theme's colours (far
// ones lost in haze, near ones dark), lit windows, neon signs and billboards, rooftop aerials,
// and the wet street below mirroring it all in rippled rows. It's laid out at one canvas pixel per
// PX screen pixels and scaled up with hard edges. Seeded, so the city is the same every time; drawn
// once per size, theme and time of day, and kept, so opening another chat only copies it.

export const PX = 3

type RGB = [number, number, number]
export interface Palette {
  night: RGB
  dusk: RGB
  iris: RGB
  horizon: RGB
  surface: RGB
  ink: RGB
}

/** Where the moving parts sit, in canvas pixels: signs that flicker and aerials that blink. */
export interface CityLayout {
  w: number
  h: number
  signs: { x: number; y: number; w: number; h: number; color: string }[]
  lights: { x: number; y: number }[]
}

const css = (c: RGB, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB
const MAGENTA: RGB = [255, 63, 190]
const CYAN: RGB = [63, 232, 255]
const BLACK: RGB = [0, 0, 0]

/** The theme's colours as the sky has them (any CSS colour, read back through a 1×1 canvas). */
export function readPalette(el: Element): Palette {
  const style = getComputedStyle(el)
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const read = (name: string, fallback: string): RGB => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = fallback
    probe.fillStyle = style.getPropertyValue(name).trim() || fallback
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  return {
    night: read('--night', '#0b0b22'),
    dusk: read('--dusk', '#7a4bd8'),
    iris: read('--iris', '#9497ff'),
    horizon: read('--horizon', '#ff8a4c'),
    surface: read('--surface', '#15163a'),
    ink: read('--ink', '#e8e8ff')
  }
}

function seeded(seed: number): () => number {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

let kept: { key: string; image: HTMLCanvasElement; layout: CityLayout } | null = null

/**
 * Paints the city into `canvas` (sized w × h canvas pixels, the horizon at row `hy`) and says where
 * its signs and lights are. The same size, colours and time reuse the last painting.
 */
export function paintCity(canvas: HTMLCanvasElement, w: number, h: number, hy: number, p: Palette, time: string): CityLayout {
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const key = `${w}x${h}@${hy}:${time}:${Object.values(p).flat().join(',')}`
  if (kept?.key === key) {
    ctx.drawImage(kept.image, 0, 0)
    return kept.layout
  }
  const rand = seeded(2077)
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]
  const neon: RGB[] = [mix(p.iris, MAGENTA, 0.45), mix(p.ink, CYAN, 0.65), mix(p.horizon, MAGENTA, 0.2), mix(p.iris, CYAN, 0.35)]
  const day = time === 'day'
  const layout: CityLayout = { w, h, signs: [], lights: [] }
  // Each sign casts a streak of its colour down the wet street.
  const glows: { x: number; w: number; c: RGB }[] = []
  const rect = (x: number, y: number, rw: number, rh: number, c: RGB, a = 1): void => {
    ctx.fillStyle = css(c, a)
    ctx.fillRect(x, y, rw, rh)
  }

  // One layer of towers: widths, heights (as a share of the sky above the horizon), how many
  // windows are lit, and whether it carries signs and billboards.
  const layer = (o: { min: number; max: number; lo: number; hi: number; body: RGB; rim: number; lit: number; windows: RGB[]; signs: number; boards: number; aerials: number }): void => {
    for (let x = -4; x < w; ) {
      const bw = Math.round(o.min + rand() * (o.max - o.min))
      const tall = rand() > 0.92 ? 1.25 : 1
      const bh = Math.min(hy - 2, Math.round(hy * (o.lo + rand() * (o.hi - o.lo)) * tall))
      const top = hy - bh
      rect(x, top, bw, bh, o.body)
      // Rim light on the side facing the sunset, and a set-back tier on some roofs.
      rect(x, top, 1, bh, mix(o.body, p.horizon, o.rim))
      if (rand() < 0.4 && bw > 5) {
        const tw = Math.max(2, Math.round(bw * (0.4 + rand() * 0.3)))
        const th = Math.round(2 + rand() * 6)
        rect(x + Math.round((bw - tw) / 2), top - th, tw, th, o.body)
      }
      // Windows: a grid, a few lit.
      for (let yy = top + 2; yy < hy - 1; yy += 2) {
        for (let xx = x + 1; xx < x + bw - 1; xx += 2) if (rand() < o.lit) rect(xx, yy, 1, 1, pick(o.windows), day ? 0.35 : 0.55 + rand() * 0.45)
      }
      // An aerial with a light that blinks.
      if (rand() < o.aerials && bh > hy * 0.3) {
        const ah = Math.round(3 + rand() * 7)
        const ax = x + Math.floor(bw / 2)
        rect(ax, top - ah - 4, 1, ah + 4, o.body)
        layout.lights.push({ x: ax, y: top - ah - 4 })
      }
      // A vertical neon sign down one side, its "letters" left as gaps.
      if (rand() < o.signs && bh > 12) {
        const sh = Math.round(6 + rand() * Math.min(14, bh - 8))
        const sx = rand() < 0.5 ? x + 1 : x + bw - 3
        const sy = top + 2 + Math.round(rand() * Math.max(1, bh - sh - 4))
        const c = pick(neon)
        rect(sx - 1, sy - 1, 4, sh + 2, mix(o.body, BLACK, 0.3))
        for (let yy = 0; yy < sh; yy++) if (yy % 3 !== 2) rect(sx, sy + yy, 2, 1, c, 0.95)
        layout.signs.push({ x: sx, y: sy, w: 2, h: sh, color: css(c) })
        glows.push({ x: sx, w: 2, c })
      }
      // A billboard on a pole, striped in two neons.
      if (rand() < o.boards && bw > 6) {
        const bbw = Math.round(7 + rand() * 8)
        const bbh = Math.round(4 + rand() * 3)
        const bx = x + Math.round((bw - bbw) / 2)
        const by = top - bbh - 3
        if (by > 2) {
          const [c1, c2] = [pick(neon), pick(neon)]
          rect(bx + Math.floor(bbw / 2), by + bbh, 1, 3, o.body)
          rect(bx - 1, by - 1, bbw + 2, bbh + 2, mix(o.body, BLACK, 0.4))
          for (let yy = 0; yy < bbh; yy++) rect(bx, by + yy, bbw, 1, mix(c1, c2, yy / Math.max(1, bbh - 1)), 0.9)
          layout.signs.push({ x: bx, y: by, w: bbw, h: bbh, color: css(c1) })
          glows.push({ x: bx + 1, w: Math.max(1, bbw - 2), c: c1 })
        }
      }
      x += bw + Math.round(rand() * 2)
    }
  }

  const haze = (from: number, to: number, c: RGB, a: number): void => {
    for (let y = from; y < to; y++) rect(0, y, w, 1, c, a * ((y - from) / Math.max(1, to - from)))
  }

  layer({ min: 4, max: 12, lo: 0.4, hi: 0.95, body: mix(p.night, p.dusk, day ? 0.6 : 0.42), rim: 0.12, lit: 0.05, windows: [mix(p.horizon, p.ink, 0.5)], signs: 0.05, boards: 0, aerials: 0.35 })
  haze(Math.round(hy * 0.3), hy, p.dusk, 0.35)
  layer({ min: 6, max: 15, lo: 0.25, hi: 0.68, body: mix(p.night, p.surface, 0.3), rim: 0.18, lit: 0.16, windows: [mix(p.horizon, p.ink, 0.35), mix(p.ink, CYAN, 0.3), p.ink], signs: 0.4, boards: 0.12, aerials: 0.25 })
  haze(Math.round(hy * 0.6), hy, p.night, 0.3)
  layer({ min: 8, max: 18, lo: 0.1, hi: 0.36, body: mix(p.night, BLACK, 0.35), rim: 0.22, lit: 0.1, windows: [mix(p.horizon, p.ink, 0.25), mix(p.iris, p.ink, 0.4)], signs: 0.3, boards: 0.3, aerials: 0.1 })

  // The street: a neon edge at the horizon, then the city mirrored on wet ground in broken rows.
  const ground = mix(p.night, BLACK, 0.4)
  rect(0, hy, w, h - hy, ground)
  ctx.save()
  ctx.globalAlpha = 0.32
  ctx.translate(0, hy * 2)
  ctx.scale(1, -1)
  ctx.drawImage(canvas, 0, 0, w, hy, 0, 0, w, hy)
  ctx.restore()
  for (let y = hy + 1; y < h; y++) if ((y - hy) % 3 === 0) rect(0, y, w, 1, ground, 0.75)
  for (const g of glows) {
    for (let y = hy + 2; y < h; y += 3) if (rand() < 0.75) rect(g.x, y, g.w, 1, g.c, 0.4 * (1 - (y - hy) / (h - hy)))
  }
  rect(0, hy, w, 1, mix(p.horizon, MAGENTA, 0.25), 0.7)
  haze(hy + 1, h, ground, 0.8)

  const image = document.createElement('canvas')
  image.width = w
  image.height = h
  image.getContext('2d')!.drawImage(canvas, 0, 0)
  kept = { key, image, layout }
  return layout
}

/** A flying car, facing right, as a small picture: body, cockpit, head and tail lights, underglow. */
export function carSprite(body: RGB, glow: RGB): string {
  const art = ['...bbbbb....', '..bwwwbbbb..', 'rbbbbbbbbbbh', '.bbbbbbbbbb.', '..nnnnnnnn..']
  const c = document.createElement('canvas')
  c.width = art[0].length
  c.height = art.length
  const ctx = c.getContext('2d')!
  const colours: Record<string, string> = { b: css(body), w: css(CYAN, 0.9), r: css([255, 60, 90]), h: css([255, 255, 240]), n: css(glow, 0.7) }
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    if (colours[ch]) {
      ctx.fillStyle = colours[ch]
      ctx.fillRect(x, y, 1, 1)
    }
  }))
  return c.toDataURL()
}

export const carColours = (p: Palette): { body: RGB; glow: RGB }[] => [
  { body: mix(p.night, p.ink, 0.25), glow: mix(p.iris, MAGENTA, 0.45) },
  { body: mix(p.night, p.dusk, 0.5), glow: mix(p.ink, CYAN, 0.65) },
  { body: mix(p.night, p.horizon, 0.3), glow: mix(p.horizon, MAGENTA, 0.2) }
]
