// Choice cards for text adventures. With "Choices" on, the system prompt asks the model to end a
// reply with a fenced `choices` block whenever the reader should decide; Twilight hides the
// block and shows the options as a card to click, edit, or answer in your own words. A plain
// text convention rather than tool calling, so it works with every model, local ones included.
// Replies that offer options as an ordinary numbered list (from a system prompt of your own)
// are recognised too.

export const CHOICES_INSTRUCTION = `Interactive choices: when the story reaches a point where the reader decides what happens next, end your reply with a fenced block marked "choices" offering 2 to 6 options, one per line, numbered, each a short action or reply in the reader's voice (under 15 words). An optional first line can pose the question. For example:
\`\`\`choices
What do you do?
1. Light the lamp and step inside
2. Wait in the rain and watch the door
3. Call out to whoever is in there
4. Turn back toward the bridge
\`\`\`
Put nothing after the block. Offer choices only when the decision is genuinely the reader's; otherwise end the reply normally.`

// ——— Choices as a tool call ———
// The other way to offer choices: the model calls present_choices with the options as data, the
// card draws from that, and the reader's answer goes back as the tool's result (which is simply
// their next turn). Nothing to parse, so no format drift; it needs a model that does tool calling.

export const CHOICES_TOOL_NAME = 'present_choices'

export const CHOICES_TOOL = {
  name: CHOICES_TOOL_NAME,
  description:
    "Shows the reader a choice menu in the app, in place of writing the options as text. Call it at the end of a reply, after the story text, whenever the reader should decide what happens next. Put several decisions made at the same moment (an outfit and then an action, or one decision per character) in one call as separate groups. The app always adds a box for the reader's own answer, so don't include a \"something else\" option. The reader's picks come back as this tool's result, which is their next turn: one line per group, \"Group title: pick\", or just the pick when there is one group.",
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        minItems: 1,
        description: 'One entry per decision, in the order the reader should make them.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short heading for this decision, e.g. "What do you do?" or "Outfit · Day 3 dawn".' },
            context: { type: 'string', description: 'Optional context shown under the title (venue, weather, stakes), markdown.' },
            options: {
              type: 'array',
              minItems: 2,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'The option as the reader would say or do it, short.' },
                  details: { type: 'string', description: 'Optional detail shown under the option, markdown (bullets are fine).' }
                },
                required: ['label']
              }
            }
          },
          required: ['title', 'options']
        }
      }
    },
    required: ['groups']
  }
} as const

export const CHOICES_TOOL_INSTRUCTION = `Interactive choices: whenever the reader should decide what happens next, end your reply by calling the ${CHOICES_TOOL_NAME} tool instead of writing the options as text. Put every decision of that moment in the one call, as separate groups. Offer choices only when the decision is genuinely the reader's; otherwise end the reply normally.`

/** A present_choices call's input as a card; anything malformed is dropped rather than trusted. */
export function choicesFromTool(input: unknown): ChoiceSet | null {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const raw = (input as { groups?: unknown })?.groups
  if (!Array.isArray(raw)) return null
  const groups: ChoiceGroup[] = []
  for (const g of raw) {
    const options = (Array.isArray(g?.options) ? g.options : [])
      .map((o: unknown) => ({ label: str((o as { label?: unknown })?.label), details: str((o as { details?: unknown })?.details) }))
      .filter((o: ChoiceOption) => o.label && !SOMETHING_ELSE.test(o.label))
      .slice(0, 9)
    if (options.length) groups.push({ title: str(g?.title) || null, intro: str(g?.context), options })
  }
  return groups.length ? { groups } : null
}

export interface ChoiceOption {
  label: string
  /** Lines written under the option (bullets of detail), as markdown; often empty. */
  details: string
}

/** One decision: a reply can hold several (an outfit, then what to do; one per character). */
export interface ChoiceGroup {
  title: string | null
  /** Context written between the title and the options. */
  intro: string
  options: ChoiceOption[]
}

export interface ChoiceSet {
  groups: ChoiceGroup[]
}

const OPEN = /```choices[ \t]*\n/g
const OPTION = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(.+?)\s*$/

// "1. Go left", "2) Go right", "**3.** Wait", "**4. Run**", "1 · EXPOSED:", "2 - Hide"
const NUMBERED = /^\s*(?:\*\*)?(\d{1,2})(?:\*\*)?\s*(?:[.)]|\s[·•–—-]|:)(?:\*\*)?\s+(.+?)\s*$/
// Lines that belong to the option above them: bullets, indented text, blank lines.
const CONTINUES = /^(\s*[*\-+•]\s+|\s{2,}\S|\s*$)/
const DIVIDER = /^\s*([-*_])(\s*\1){2,}\s*$/
const SOMETHING_ELSE = /^something else\b/i
// A title that asks or names a decision. Without one (or a "Something else" option), a numbered
// list is just a list.
const ASKS = /\?\**$|\b(choices?|options?|choose|pick|decide|decision|what (do|will|should) you)\b/i
const unbold = (s: string): string =>
  s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/^[*_]+|[*_]+$/g, '').trim()
const cleanLabel = (s: string): string => unbold(s).replace(/[\s:]+$/, '')

/** A short line standing on its own above the options reads as their title ("What do you do?", "OUTFIT · Day 3"). */
function isTitle(line: string): boolean {
  const t = line.trim()
  return t.length > 0 && t.length <= 100 && !NUMBERED.test(t) && !CONTINUES.test(line) && (/[?:]\**$/.test(t) || !/[.!…"”']\**$/.test(t))
}

/**
 * Reads one group of options upward from line `end`: numbered 1..n in order, each option
 * followed by any detail lines, with an optional title (and intro lines) just above.
 */
function groupAbove(lines: string[], end: number): { group: ChoiceGroup; start: number; asks: boolean } | null {
  const found: { num: number; label: string; details: string[] }[] = []
  let pending: string[] = []
  let i = end
  for (; i >= 0; i--) {
    const m = NUMBERED.exec(lines[i])
    if (m) {
      found.unshift({ num: Number(m[1]), label: m[2], details: pending })
      pending = []
      if (m[1] === '1') break
    } else if (CONTINUES.test(lines[i])) pending.unshift(lines[i])
    else return null
  }
  if (found[0]?.num !== 1 || found.some((o, k) => o.num !== k + 1) || found.length < 2) return null
  if (found.some((o) => o.label.length > 200)) return null
  const all = found.map((o) => ({ label: cleanLabel(o.label), details: o.details.map((l) => l.replace(/^\s{2,}/, '')).join('\n').trim() }))
  const options = all.filter((o) => !SOMETHING_ELSE.test(o.label))
  const writeIn = options.length < all.length
  if (options.length === 0) return null
  // A title paragraph right above option 1: its first line is the title, the rest is context.
  let p = i - 1
  while (p >= 0 && lines[p].trim() === '') p--
  let top = p
  while (top > 0 && lines[top - 1].trim() !== '') top--
  const para = p >= 0 ? lines.slice(top, p + 1) : []
  if (para.length > 0 && para.length <= 8 && isTitle(para[0])) {
    // Rules drawn around a title ("—— CHOICES ——") aren't part of it.
    const title = cleanLabel(para[0].replace(/^#+\s*/, '')).replace(/^[—–-]+\s*|\s*[—–-]+$/g, '')
    return { group: { title, intro: para.slice(1).join('\n').trim(), options }, start: top, asks: writeIn || ASKS.test(title) }
  }
  return { group: { title: null, intro: '', options }, start: i, asks: writeIn }
}

/**
 * Plain-text choices, for models (or system prompts) that write options as an ordinary numbered
 * list: one or more groups at the end of the reply, each numbered from 1, each optionally under a
 * title line. A group counts only with a sign that it's a decision: a "Something else" option, or
 * a title that asks ("What do you do?", "Choices (Night)"); any other numbered list stays a list.
 * Only code blocks, <details> blocks, dividers and blank lines may follow them (a
 * stat block or status card, say); those stay in the reply. "Something else" options become the
 * card's own write-in box. With none at the end, the last group that plainly is a decision (a
 * title that asks, or a "Something else") is read wherever it sits, for prompts that put the
 * choices before other sections; the text after it stays in the reply.
 */
function plainChoices(text: string): { body: string; choices: ChoiceSet | null } {
  const lines = text.split('\n')
  let i = lines.length - 1
  // Walk back over the trailing blocks that may follow the options.
  for (;;) {
    while (i >= 0 && lines[i].trim() === '') i--
    if (i < 0) return { body: text, choices: null }
    const line = lines[i].trim()
    if (/^(`{3,}|~{3,})/.test(line)) {
      const fence = line.slice(0, 3)
      i--
      while (i >= 0 && !lines[i].trim().startsWith(fence)) i--
      i--
      continue
    }
    if (/<\/details>/i.test(line)) {
      while (i >= 0 && !/<details\b/i.test(lines[i])) i--
      i--
      continue
    }
    if (DIVIDER.test(line)) {
      i--
      continue
    }
    break
  }
  const end = i
  const groups: ChoiceGroup[] = []
  let cut = end + 1
  for (let cursor = end; cursor >= 0; ) {
    const found = groupAbove(lines, cursor)
    if (!found?.asks) break
    groups.unshift(found.group)
    cut = found.start
    // Without a title there's no telling where the group ends, so nothing above it is read.
    if (!found.group.title) break
    cursor = found.start - 1
    while (cursor >= 0 && (lines[cursor].trim() === '' || DIVIDER.test(lines[cursor]))) cursor--
  }
  if (groups.length === 0) return midReplyChoices(lines) ?? { body: text, choices: null }
  const body = [...lines.slice(0, cut), ...lines.slice(end + 1)].join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { body, choices: { groups } }
}

/** The last group in the reply that reads as a decision, wherever it is; null if there's none. */
function midReplyChoices(lines: string[]): { body: string; choices: ChoiceSet } | null {
  // Lines inside code blocks are never read: a choices block left as written stays as written.
  const fenced = new Set<number>()
  for (let i = 0, open: string | null = null; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[i])
    if (open || fence) fenced.add(i)
    if (fence && !open) open = fence[1].slice(0, 3)
    else if (open && lines[i].trim().startsWith(open)) open = null
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (fenced.has(i) || !NUMBERED.test(lines[i])) continue
    // Take in the detail lines under the last option (a blank line ends it).
    let end = i
    while (end + 1 < lines.length && lines[end + 1].trim() !== '' && CONTINUES.test(lines[end + 1])) end++
    const found = groupAbove(lines, end)
    if (found?.asks) {
      const body = [...lines.slice(0, found.start), ...lines.slice(end + 1)].join('\n').replace(/\n{3,}/g, '\n\n').trim()
      return { body, choices: { groups: [found.group] } }
    }
    // Not a decision: skip the rest of this list.
    while (i > 0 && lines[i - 1].trim() !== '' && (NUMBERED.test(lines[i - 1]) || CONTINUES.test(lines[i - 1]))) i--
  }
  return null
}

/**
 * Splits a reply into the text to show and its choice card. A fenced choices block still being
 * streamed (no closing fence yet) is hidden but yields no card until it's complete. With
 * `plain`, numbered options at the end that read as a decision also become a card; with
 * `fenced` off, choices blocks are left as written.
 */
export function extractChoices(text: string, plain = false, fenced = true): { body: string; choices: ChoiceSet | null } {
  if (!fenced) return plain ? plainChoices(text) : { body: text, choices: null }
  const opens = [...text.matchAll(OPEN)]
  const last = opens.at(-1)
  if (!last || last.index === undefined) return plain ? plainChoices(text) : { body: text, choices: null }
  const start = last.index
  const inner = text.slice(start + last[0].length)
  const close = inner.indexOf('```')
  const body = text.slice(0, start).trimEnd()
  if (close === -1) return { body, choices: null }
  const lines = inner.slice(0, close).split('\n').map((l) => l.trim()).filter(Boolean)
  let question: string | null = null
  const options: string[] = []
  for (const line of lines) {
    const m = OPTION.exec(line)
    if (m) options.push(m[1])
    else if (!options.length && !question) question = line
  }
  const rest = inner.slice(close + 3).trim()
  const group: ChoiceGroup = { title: question, intro: '', options: options.slice(0, 9).map((label) => ({ label, details: '' })) }
  return { body: rest ? `${body}\n\n${rest}` : body, choices: options.length >= 2 ? { groups: [group] } : null }
}
