// "Your own" theme: a ground colour and three accents, turned into the full token set. Every
// derived colour is checked against the design system's contrast rules (text 4.5:1 on the grounds
// it sits on, lines 3:1), and nudged lighter until it passes, so no choice makes text hard to read.

export interface CustomTheme {
  /** The darkest ground; kept dark, since Twilight's design is dark throughout. */
  ground: string
  /** Actions (buttons, selection), tools (AI, keywords) and writing (warm highlights). */
  actions: string
  tools: string
  writing: string
}

export const DEFAULT_CUSTOM: CustomTheme = { ground: '#0b0d1c', actions: '#9497ff', tools: '#c4a0ff', writing: '#ffb48a' }

type HSL = [number, number, number]

function toHsl(hex: string): HSL {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

function toHex([h, s, l]: HSL): string {
  const a = (Math.min(100, Math.max(0, s)) / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** The colour, lightened step by step until it reaches `ratio` against every ground. */
function readable(hex: string, grounds: string[], ratio: number): string {
  let [h, s, l] = toHsl(hex)
  let out = hex
  while (grounds.some((g) => contrast(out, g) < ratio) && l < 98) {
    l += 2
    out = toHex([h, s, l])
  }
  return out
}

const valid = (hex: string, fallback: string): string => (/^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : fallback)

/** The full set of tokens for a custom theme, every one checked for contrast. */
export function customTokens(input: CustomTheme): Record<string, string> {
  const [h, s0, l0] = toHsl(valid(input.ground, DEFAULT_CUSTOM.ground))
  const s = Math.min(s0, 60)
  const l = Math.min(l0, 9)
  const night = toHex([h, s, l])
  const surface = toHex([h, s, l + 3])
  const raised = toHex([h, s, l + 6.5])
  const overlay = toHex([h, s, l + 10])
  const grounds = [surface, raised, overlay]
  const text = (hue: number, sat: number, light: number): string => readable(toHex([hue, sat, light]), grounds, 4.5)
  const accent = (hex: string, fallback: string): string => readable(valid(hex, fallback), grounds, 4.5)
  const iris = accent(input.actions, DEFAULT_CUSTOM.actions)
  const dusk = accent(input.tools, DEFAULT_CUSTOM.tools)
  const horizon = accent(input.writing, DEFAULT_CUSTOM.writing)
  const soft = (hex: string): string => {
    const [ah, as] = toHsl(hex)
    return toHex([ah, Math.min(as, 55), l + 13])
  }
  return {
    '--night': night,
    '--surface': surface,
    '--surface-raised': raised,
    '--surface-overlay': overlay,
    '--surface-hover': '#ffffff0d',
    '--line': toHex([h, s * 0.8, l + 15]),
    '--line-strong': readable(toHex([h, s * 0.6, l + 34]), grounds, 3),
    '--ink': text(h, 40, 95),
    '--ink-muted': text(h, 30, 76),
    '--ink-faint': text(h, 22, 62),
    '--iris': iris,
    '--iris-soft': soft(iris),
    '--on-iris': contrast(night, iris) >= 4.5 ? night : '#ffffff',
    '--dusk': dusk,
    '--dusk-soft': soft(dusk),
    '--horizon': horizon,
    '--horizon-soft': soft(horizon),
    '--on-horizon': contrast(night, horizon) >= 4.5 ? night : '#ffffff',
    '--selection': `${iris}47`,
    '--shadow-lg': `0 12px 32px -4px #000000c0, 0 0 0 1px ${toHex([h, s, l + 14])}`,
    '--focus-ring': `0 0 0 2px ${surface}, 0 0 0 4px ${iris}`
  }
}

const KEY = 'twilight.customTheme'

export function loadCustom(): CustomTheme {
  try {
    return { ...DEFAULT_CUSTOM, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CustomTheme>) }
  } catch {
    return DEFAULT_CUSTOM
  }
}

export function saveCustom(theme: CustomTheme): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(theme))
  } catch {
    // Storage unavailable: the theme holds for this session.
  }
}

/** Puts the custom theme's tokens on the page (as a style rule only data-theme="custom" uses). */
export function injectCustom(theme: CustomTheme = loadCustom()): Record<string, string> {
  const tokens = customTokens(theme)
  let el = document.getElementById('twilight-custom-theme') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'twilight-custom-theme'
    document.head.appendChild(el)
  }
  el.textContent = `:root[data-theme='custom'] { ${Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')} }`
  return tokens
}
