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
