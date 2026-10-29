// Which files can be attached, and how. Text files go into the message as text; images and PDFs
// go as the files themselves, which Claude (and OpenAI-compatible servers that take them) read
// natively.

export type AttachmentKind = 'text' | 'image' | 'pdf'

const MEDIA: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf'
}

const REVERSE = Object.fromEntries(Object.values(MEDIA).map((m) => [m, true]))

/** The API limits: 5 MB per image, 32 MB per PDF request; text is capped to keep requests sane. */
export const LIMITS: Record<AttachmentKind, number> = { image: 5 * 1024 * 1024, pdf: 30 * 1024 * 1024, text: 20 * 1024 * 1024 }

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']

/** What a file is, from its name (or the type the browser reports). */
export function attachmentKind(name: string, type = ''): { kind: AttachmentKind; mediaType?: string } {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const mediaType = MEDIA[ext] ?? (type in REVERSE ? type : undefined)
  if (mediaType === 'application/pdf') return { kind: 'pdf', mediaType }
  if (mediaType?.startsWith('image/')) return { kind: 'image', mediaType }
  return { kind: 'text' }
}

export function tooBig(kind: AttachmentKind, bytes: number, name: string): string | null {
  if (bytes <= LIMITS[kind]) return null
  const mb = Math.round(LIMITS[kind] / 1024 / 1024)
  return kind === 'image' ? `${name} is over ${mb} MB, the limit for an image.` : `${name} is over ${mb} MB.`
}

/**
 * Text blocks that ride along with a message rather than being what was typed: attached documents
 * and mid-chat instruction updates. After a tool call they follow the tool result.
 */
export const INSTRUCTION_OPEN = '<instruction_update>'
export const CLOCK_OPEN = '<current_time>'
export const isContextText = (text: string): boolean =>
  text.startsWith('<document name=') || text.startsWith(INSTRUCTION_OPEN) || text.startsWith(CLOCK_OPEN)

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * The date, time and time zone when a message is sent. It goes into that message, never the
 * system prompt, so every earlier message (and the cache over them) stays exactly as it was.
 */
export function clockBlock(now: Date): string {
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const offset = -now.getTimezoneOffset()
  const utc = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `${CLOCK_OPEN}\nSent ${date}, ${pad(now.getHours())}:${pad(now.getMinutes())} local time (${zone ? `${zone}, ` : ''}${utc}).\n</current_time>`
}
/** The line inside a stored date and time block, for showing it. */
export const clockOf = (block: string): string => block.slice(CLOCK_OPEN.length + 1).replace(/\n<\/current_time>$/, '')
export const instructionBlock = (text: string): string => `${INSTRUCTION_OPEN}\nFrom this message on, also follow these instructions; where they conflict with earlier ones, these win.\n\n${text.trim()}\n</instruction_update>`
/** The instruction text inside a stored block, for showing it. */
export const instructionOf = (block: string): string =>
  block.slice(block.indexOf('\n\n') + 2).replace(/\n<\/instruction_update>$/, '')

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
