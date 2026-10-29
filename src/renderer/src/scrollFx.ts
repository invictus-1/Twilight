import type { ScrollFxStyle } from './look'

// Particles that follow your scrolling through a chat: a slow scroll lets a few drift by, a fast
// one throws up a shower. Everything is drawn on one canvas over the thread that ignores the
// mouse, and the frame loop runs only while particles are alive, so a still chat costs nothing.
// Only scrolling you do counts (wheel, keys, the scrollbar, touch); the thread following a reply
// as it streams stays quiet.

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: number
  phase: number
  /** This frame's opacity, worked out before anything is drawn (links need both ends'). */
  alpha: number
}

/** What a canvas reports, for the tests: how many were made and are alive, and the drawing cost. */
export interface FxStats {
  spawned: number
  alive: number
  peak: number
  frames: number
  drawMs: number
  /** The most constellation lines drawn in one frame. */
  links: number
}

interface Style {
  /** Colours to draw with: theme variables (so particles follow the theme) or fixed colours. */
  colors: string[]
  /** Particles per pixel scrolled at a gentle pace; speed multiplies it (see spawnCount). */
  density: number
  /** The most alive at once, when fewer than MAX_ALIVE suits the style. */
  max?: number
  /** Light adds up ("lighter"); solid shapes like bats paint over ("source-over"). */
  blend?: GlobalCompositeOperation
  /** Lines between particles closer than this many pixels, in this colour. */
  links?: { distance: number; color: string }
  spawn(p: Particle, w: number, h: number, dir: number, speed: number): void
  /** Moves one particle on by dt milliseconds. */
  move(p: Particle, dt: number): void
  draw(ctx: CanvasRenderingContext2D, p: Particle, alpha: number, sprite: HTMLCanvasElement): void
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const MAX_ALIVE = 240
// Particles redraw at most this often. On a fast display the text still scrolls at its full
// rate; redrawing the canvas every one of those frames would cost more than it shows.
const DRAW_EVERY_MS = 15
// Soft particles don't need full sharpness on a high-density screen, and fewer pixels are
// quicker to hand to the compositor each time.
const MAX_DENSITY = 1.5

// A bat facing up, wings out, in units of its half-span. The wings are drawn on their own so
// they can beat.
const BAT_BODY = new Path2D('M0 -0.3 L-0.07 -0.42 L-0.09 -0.22 Q-0.14 0 -0.06 0.28 Q0 0.36 0.06 0.28 Q0.14 0 0.09 -0.22 L0.07 -0.42 Z')
const BAT_WING = new Path2D('M0.08 -0.12 Q0.45 -0.5 1 -0.32 Q0.86 -0.12 0.82 0.02 Q0.7 -0.06 0.6 0.06 Q0.48 -0.04 0.36 0.1 Q0.24 0 0.08 0.14 Z')

const STYLES: Record<ScrollFxStyle, Style> = {
  // Fine dust of light that twinkles and drifts against the scroll, like passing through stars.
  stardust: {
    colors: ['--iris', '--dusk', '--ink'],
    density: 0.03,
    spawn(p, w, h, dir, speed) {
      p.x = rand(0, w)
      p.y = rand(0, h)
      p.vx = rand(-0.01, 0.01)
      p.vy = -dir * rand(0.02, 0.06) * (1 + speed)
      p.life = rand(700, 1500)
      p.size = rand(0.6, 2.2)
    },
    move(p, dt) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy *= Math.pow(0.996, dt)
    },
    draw(ctx, p, alpha, sprite) {
      const twinkle = 0.55 + 0.45 * Math.sin(p.phase + p.age / 90)
      ctx.globalAlpha = alpha * twinkle
      const s = p.size * 4
      ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s)
    }
  },
  // Short bright streaks thrown in from the edge the new text comes from.
  sparks: {
    colors: ['--horizon', '--warning', '--dusk'],
    density: 0.022,
    spawn(p, w, h, dir, speed) {
      p.x = rand(0, w)
      p.y = dir > 0 ? h + rand(0, 10) : rand(-10, 0)
      p.vx = rand(-0.12, 0.12)
      p.vy = -dir * rand(0.25, 0.6) * (0.6 + speed * 0.5)
      p.life = rand(350, 800)
      p.size = rand(0.8, 1.8)
    },
    move(p, dt) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      // They slow and fall back a little, like embers.
      p.vx *= Math.pow(0.995, dt)
      p.vy = p.vy * Math.pow(0.995, dt) + 0.0004 * dt
    },
    draw(ctx, p, alpha) {
      ctx.globalAlpha = alpha
      ctx.lineWidth = p.size
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - p.vx * 20, p.y - p.vy * 20)
      ctx.stroke()
    }
  },
  // Soft warm glows that wander and pulse; fewer of them, and slower to fade.
  fireflies: {
    colors: ['--horizon', '--warning', '--success'],
    density: 0.012,
    spawn(p, w, h, dir, speed) {
      p.x = rand(0, w)
      p.y = rand(h * 0.1, h * 0.9)
      p.vx = rand(-0.03, 0.03)
      p.vy = -dir * rand(0.01, 0.04) * (1 + speed * 0.5)
      p.life = rand(1400, 2600)
      p.size = rand(2.5, 5)
    },
    move(p, dt) {
      p.x += (p.vx + Math.sin(p.phase + p.age / 400) * 0.025) * dt
      p.y += (p.vy + Math.cos(p.phase + p.age / 520) * 0.02) * dt
    },
    draw(ctx, p, alpha, sprite) {
      ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(p.phase + p.age / 240))
      const s = p.size * 5
      ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s)
    }
  },
  // Blue stars that drift slowly; those near each other join up into constellations.
  constellations: {
    colors: ['#8cc8ff', '#5d9dff', '#c4e2ff'],
    density: 0.016,
    max: 160,
    links: { distance: 120, color: '#6fb2ff' },
    spawn(p, w, h, dir, speed) {
      p.x = rand(0, w)
      p.y = rand(0, h)
      p.vx = rand(-0.012, 0.012)
      p.vy = -dir * rand(0.01, 0.03) * (1 + speed * 0.5)
      p.life = rand(1600, 2800)
      p.size = rand(1.2, 2.6)
    },
    move(p, dt) {
      p.x += p.vx * dt
      p.y += p.vy * dt
    },
    draw(ctx, p, alpha, sprite) {
      ctx.globalAlpha = alpha * (0.75 + 0.25 * Math.sin(p.phase + p.age / 120))
      const s = p.size * 4
      ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s)
    }
  },
  // Dark bats outlined in green that flap up from the bottom and swoop from side to side.
  bats: {
    colors: ['#5fe08a', '#7af0a0'],
    density: 0.01,
    max: 60,
    blend: 'source-over',
    spawn(p, w, h, _dir, speed) {
      p.x = rand(w * 0.05, w * 0.95)
      p.y = h + rand(10, 40)
      p.vx = rand(-0.06, 0.06)
      p.vy = -rand(0.09, 0.18) * (1 + Math.min(speed, 4) * 0.25)
      p.life = rand(1800, 2900)
      p.size = rand(8, 15)
    },
    move(p, dt) {
      p.vx += Math.sin(p.phase + p.age / 320) * 0.0007 * dt
      p.vx *= Math.pow(0.999, dt)
      p.x += p.vx * dt
      p.y += p.vy * dt
    },
    draw(ctx, p, alpha) {
      const beat = Math.sin(p.phase * 3 + p.age / 55)
      ctx.globalAlpha = Math.min(1, alpha * 1.6)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(Math.max(-0.6, Math.min(0.6, p.vx * 4)))
      ctx.scale(p.size, p.size)
      ctx.lineWidth = 1.3 / p.size
      ctx.fillStyle = '#0b0d1c'
      for (const side of [1, -1]) {
        ctx.save()
        ctx.scale(side, 0.25 + 0.75 * beat)
        ctx.fill(BAT_WING)
        ctx.stroke(BAT_WING)
        ctx.restore()
      }
      ctx.fill(BAT_BODY)
      ctx.stroke(BAT_BODY)
      ctx.restore()
    }
  },
  // Flakes that sway down, swept up or down by the scroll.
  snow: {
    colors: ['--ink', '--ink-muted'],
    density: 0.02,
    spawn(p, w, h, dir, speed) {
      p.x = rand(0, w)
      p.y = dir > 0 ? rand(h * 0.4, h) : rand(0, h * 0.6)
      p.vx = rand(-0.015, 0.015)
      p.vy = -dir * rand(0.03, 0.08) * (1 + speed * 0.7)
      p.life = rand(1200, 2400)
      p.size = rand(1, 3)
    },
    move(p, dt) {
      p.x += (p.vx + Math.sin(p.phase + p.age / 300) * 0.02) * dt
      // The scroll's push fades and the flakes settle into falling.
      p.vy = p.vy * Math.pow(0.997, dt) + (0.035 - p.vy) * 0.002 * dt
      p.y += p.vy * dt
    },
    draw(ctx, p, alpha, sprite) {
      ctx.globalAlpha = alpha * 0.85
      const s = p.size * 3
      ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s)
    }
  }
}

/** How many to make for a scroll of dy pixels at speed px/ms: more per pixel the faster you go. */
export function spawnCount(style: ScrollFxStyle, dy: number, speed: number): number {
  return Math.abs(dy) * STYLES[style].density * (0.4 + Math.min(speed, 6) / 2)
}

/** A soft round glow in one colour, drawn once and stamped for every particle. */
function glow(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, color)
  grad.addColorStop(0.35, color)
  grad.addColorStop(1, 'transparent')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return c
}

/**
 * Starts particles on a canvas laid over a scroller. Returns a function that stops them.
 * The canvas must share the scroller's positioned parent.
 */
export function attachScrollFx(scroller: HTMLElement, canvas: HTMLCanvasElement & { fxStats?: FxStats }, styleId: ScrollFxStyle): () => void {
  const style = STYLES[styleId]
  const ctx = canvas.getContext('2d')!
  const stats: FxStats = { spawned: 0, alive: 0, peak: 0, frames: 0, drawMs: 0, links: 0 }
  canvas.fxStats = stats
  let particles: Particle[] = []
  let colors: string[] = []
  let sprites: HTMLCanvasElement[] = []
  let w = 0
  let h = 0
  let frame = 0
  let last = 0

  const fit = (): void => {
    const dpr = Math.min(MAX_DENSITY, window.devicePixelRatio || 1)
    w = scroller.clientWidth
    h = scroller.clientHeight
    Object.assign(canvas.style, { left: `${scroller.offsetLeft}px`, top: `${scroller.offsetTop}px`, width: `${w}px`, height: `${h}px` })
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  const resize = new ResizeObserver(fit)
  resize.observe(scroller)
  fit()

  // Theme colours, read when a burst starts (the theme may have changed since the last).
  let light = false
  const readColors = (): void => {
    const css = getComputedStyle(document.documentElement)
    light = css.colorScheme === 'light'
    const now = style.colors.map((v) => (v.startsWith('--') ? css.getPropertyValue(v).trim() || '#ffffff' : v))
    if (now.join() !== colors.join()) {
      colors = now
      sprites = colors.map(glow)
    }
  }

  const tick = (now: number): void => {
    if (now - last < DRAW_EVERY_MS) {
      frame = requestAnimationFrame(tick)
      return
    }
    const t0 = performance.now()
    const dt = Math.min(50, now - last || 16)
    last = now
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = style.blend ?? (light ? 'source-over' : 'lighter')
    let keep = 0
    for (const p of particles) {
      p.age += dt
      if (p.age >= p.life) continue
      style.move(p, dt)
      // Gone from view: nothing left to draw.
      if (p.y < -80 || p.y > h + 80 || p.x < -80 || p.x > w + 80) continue
      // Fade in quickly, out slowly.
      const t = p.age / p.life
      p.alpha = Math.min(1, t * 8) * (1 - t) * (1 - t)
      particles[keep++] = p
    }
    particles.length = keep
    if (style.links) {
      // Each pair once; the line is as faint as its fainter end, and fades with distance.
      const { distance, color } = style.links
      const far = distance * distance
      ctx.strokeStyle = color
      ctx.lineWidth = 0.8
      let links = 0
      for (let i = 0; i < keep; i++) {
        const a = particles[i]
        for (let j = i + 1; j < keep; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > far) continue
          ctx.globalAlpha = Math.min(a.alpha, b.alpha) * (1 - Math.sqrt(d2) / distance) * 0.7
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
          links++
        }
      }
      stats.links = Math.max(stats.links, links)
    }
    for (const p of particles) {
      ctx.strokeStyle = colors[p.color]
      style.draw(ctx, p, p.alpha, sprites[p.color])
    }
    ctx.globalAlpha = 1
    stats.alive = keep
    stats.frames++
    stats.drawMs += performance.now() - t0
    frame = keep ? requestAnimationFrame(tick) : 0
  }

  // Scrolling you did yourself: a wheel or key turn within the last moment, or a held pointer.
  let intentUntil = 0
  let held = false
  const intent = (): void => void (intentUntil = performance.now() + 450)
  const keys = (e: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) intent()
  }
  const down = (): void => void (held = true)
  const up = (): void => void (held = false)

  let lastTop = scroller.scrollTop
  let lastAt = performance.now()
  let speed = 0
  let owed = 0
  const onScroll = (): void => {
    const now = performance.now()
    const dy = scroller.scrollTop - lastTop
    const dt = Math.max(8, now - lastAt)
    lastTop = scroller.scrollTop
    lastAt = now
    if (!dy || (!held && now > intentUntil)) return
    // Speed in px/ms, smoothed so one big wheel notch doesn't read as a fling.
    speed = speed * 0.6 + (Math.abs(dy) / dt) * 0.4
    owed += spawnCount(styleId, dy, speed)
    const n = Math.min(Math.floor(owed), (style.max ?? MAX_ALIVE) - particles.length)
    owed -= Math.floor(owed)
    if (n <= 0) return
    if (!frame) readColors()
    const dir = Math.sign(dy)
    for (let i = 0; i < n; i++) {
      const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1000, size: 1, color: Math.floor(Math.random() * colors.length), phase: Math.random() * Math.PI * 2, alpha: 0 }
      style.spawn(p, w, h, dir, speed)
      particles.push(p)
    }
    stats.spawned += n
    stats.peak = Math.max(stats.peak, particles.length)
    if (!frame) {
      last = performance.now() - DRAW_EVERY_MS
      frame = requestAnimationFrame(tick)
    }
  }

  scroller.addEventListener('scroll', onScroll, { passive: true })
  scroller.addEventListener('wheel', intent, { passive: true })
  scroller.addEventListener('touchmove', intent, { passive: true })
  scroller.addEventListener('pointerdown', down)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', keys)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    scroller.removeEventListener('scroll', onScroll)
    scroller.removeEventListener('wheel', intent)
    scroller.removeEventListener('touchmove', intent)
    scroller.removeEventListener('pointerdown', down)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', keys)
    ctx.clearRect(0, 0, w, h)
  }
}
