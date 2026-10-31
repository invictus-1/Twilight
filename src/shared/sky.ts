// The sky's time of day and season, from the date: used by the sky (Extras) and checked by the tests.

/** The time of day the sky shows, from the clock. */
export function clockTime(date = new Date()): 'dawn' | 'day' | 'dusk' | 'night' {
  const h = date.getHours() + date.getMinutes() / 60
  if (h >= 5 && h < 8) return 'dawn'
  if (h >= 8 && h < 17) return 'day'
  if (h >= 17 && h < 20.5) return 'dusk'
  return 'night'
}

/** The season's touch for a date, with a few special nights. */
export function seasonFor(date = new Date()): 'snow' | 'petals' | 'fireflies' | 'leaves' | 'halloween' | 'newyear' {
  const m = date.getMonth() + 1
  const d = date.getDate()
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) return 'newyear'
  if (m === 10 && d >= 24) return 'halloween'
  if (m === 12 || m <= 2) return 'snow'
  if (m <= 5) return 'petals'
  if (m <= 8) return 'fireflies'
  return 'leaves'
}

export type Weather = 'clear' | 'rain' | 'snow'

/** How long one spell of weather lasts: the roll is the same all through it, so switching chats
 *  doesn't start or stop the rain. */
export const WEATHER_SPELL_MS = 20 * 60 * 1000

/**
 * The weather in the sky for a moment, rolled once per spell: mostly clear, now and then rain, and
 * snow either only in winter (December to February) or any time. No rain or snow over the desert.
 */
export function weatherFor(date: Date, horizon: string, snow: 'winter' | 'always'): Weather {
  if (horizon === 'dunes') return 'clear'
  // A small hash of the spell's number, so every spell has its own roll and the same one each visit.
  let t = Math.floor(date.getTime() / WEATHER_SPELL_MS) * 2654435761
  t = Math.imul(t ^ (t >>> 15), 0x2c1b3c6d)
  t = Math.imul(t ^ (t >>> 12), 0x297a2d39)
  const roll = ((t ^ (t >>> 15)) >>> 0) / 4294967296
  const m = date.getMonth() + 1
  const winter = m === 12 || m <= 2
  // In winter snow takes most of rain's share; out of it, snow only if you've asked for it any time.
  const snowChance = winter ? 0.22 : snow === 'always' ? 0.1 : 0
  const rainChance = winter ? 0.08 : 0.2
  if (roll < snowChance) return 'snow'
  if (roll < snowChance + rainChance) return 'rain'
  return 'clear'
}
