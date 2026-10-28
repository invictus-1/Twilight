import { DEFAULT_GAME_FORMAT, type GameFormatOptions } from '@shared/gameFormat'

// Game Format options are a per-machine preference, kept in local storage.
const KEY = 'twilight.gameFormat'

export function readGameFormat(): GameFormatOptions {
  try {
    return { ...DEFAULT_GAME_FORMAT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<GameFormatOptions>) }
  } catch {
    return DEFAULT_GAME_FORMAT
  }
}

export function writeGameFormat(options: GameFormatOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(options))
  } catch {
    /* storage unavailable: defaults apply */
  }
}
