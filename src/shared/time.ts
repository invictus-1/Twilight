// How long ago something happened, the way a chat says it.

const time = (d: Date): string => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** "just now", "5 min ago", "2 hours ago", "Yesterday at 9:14 PM", "Monday at 9:14 PM", "Oct 28". */
export function sentLabel(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  const then = new Date(at)
  const today = new Date(now)
  if (s < 6 * 3600 || then.toDateString() === today.toDateString()) {
    const h = Math.max(1, Math.round(s / 3600))
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  }
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return `Yesterday at ${time(then)}`
  if (s < 6 * 86400) return `${then.toLocaleDateString(undefined, { weekday: 'long' })} at ${time(then)}`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: then.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
