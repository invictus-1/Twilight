// Every theme Twilight ships. The colours themselves are tokens in styles/themes.css; this list is
// what the pickers, the command menu and the window frame read.

export interface ThemeInfo {
  id: string
  name: string
  note: string
  /** The picker swatch: the theme's ground, and its three accents. */
  swatch: string
  dots: [string, string, string]
  /** Window frame: the title bar overlay's background and its button symbols. */
  night: string
  symbol: string
}

export const THEMES = [
  {
    id: 'twilight',
    name: 'Twilight',
    note: 'Blue dusk, iris and a warm horizon.',
    swatch: 'linear-gradient(180deg, #171a3d, #3a2245)',
    dots: ['#9497ff', '#c4a0ff', '#ffb48a'],
    night: '#0b0d1c',
    symbol: '#a6abd8'
  },
  {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    note: 'Deep violet with magenta and pink.',
    swatch: 'radial-gradient(circle at 80% 0%, #2a1245, #0c0614 70%)',
    dots: ['#b07cff', '#f07cff', '#ff8fc8'],
    night: '#0c0614',
    symbol: '#c2b3dc'
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    note: 'Black and green, like an old terminal.',
    swatch: 'radial-gradient(circle at 80% 0%, #0f3a22, #030604 70%)',
    dots: ['#3dff8f', '#b6ff5c', '#4de8e0'],
    night: '#030604',
    symbol: '#9fd1ae'
  },
  {
    id: 'nightshade',
    name: 'Nightshade',
    note: 'Black with royal purple and lavender.',
    swatch: 'radial-gradient(circle at 80% 0%, #2d1a55, #07050b 70%)',
    dots: ['#a78bfa', '#8f73ff', '#e0b3ff'],
    night: '#07050b',
    symbol: '#bdb2de'
  },
  {
    id: 'ember',
    name: 'Ember',
    note: 'Black and red, with orange and gold.',
    swatch: 'radial-gradient(circle at 80% 0%, #4a1010, #0a0505 70%)',
    dots: ['#ff5a4f', '#ff9a4d', '#ffcf5c'],
    night: '#0a0505',
    symbol: '#e0b8b0'
  }
] as const satisfies readonly ThemeInfo[]

export type Theme = (typeof THEMES)[number]['id']

export const isTheme = (id: unknown): id is Theme => THEMES.some((t) => t.id === id)
export const themeInfo = (id: string): ThemeInfo => THEMES.find((t) => t.id === id) ?? THEMES[0]
