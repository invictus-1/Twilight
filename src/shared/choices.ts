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
    const title = cleanLabel(para[0].replace(/^#+\s*/, ''))
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
 * card's own write-in box.
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
  if (groups.length === 0) return { body: text, choices: null }
  const body = [...lines.slice(0, cut), ...lines.slice(end + 1)].join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { body, choices: { groups } }
}

/**
 * Splits a reply into the text to show and its choice card. A fenced choices block still being
 * streamed (no closing fence yet) is hidden but yields no card until it's complete. With
 * `plain`, an ordinary numbered list of options at the end also becomes a card.
 */
export function extractChoices(text: string, plain = false): { body: string; choices: ChoiceSet | null } {
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
