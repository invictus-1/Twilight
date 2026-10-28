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

export interface ChoiceSet {
  question: string | null
  options: string[]
}

const OPEN = /```choices[ \t]*\n/g
const OPTION = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(.+?)\s*$/

// "1. Go left", "2) Go right", "**3.** Wait", "**4. Run**"
const NUMBERED = /^\s*(?:\*\*)?(\d{1,2})[.)](?:\*\*)?\s+(.+?)\s*$/
const unbold = (s: string): string =>
  s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/^[*_]+|[*_]+$/g, '').trim()

/**
 * Plain-text choices, for models (or system prompts) that write options as an ordinary numbered
 * list: the last list of 2–9 short options numbered from 1, near the end of the reply, with an
 * optional question just above it. Only code blocks, <details> blocks, dividers and blank lines
 * may follow it (a stat block or status card, say); those stay in the reply.
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
    if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      i--
      continue
    }
    break
  }
  const end = i
  const items: string[] = []
  while (i >= 0) {
    const m = NUMBERED.exec(lines[i])
    if (m) {
      items.unshift(m[2])
      i--
    } else if (lines[i].trim() === '' && i > 0 && NUMBERED.test(lines[i - 1])) i--
    else break
  }
  const start = i + 1
  // Numbered 1..n in order, short enough to be options rather than paragraphs.
  const numbers = lines.slice(start, end + 1).map((l) => NUMBERED.exec(l)?.[1]).filter(Boolean).map(Number)
  if (items.length < 2 || items.length > 9 || numbers.some((n, k) => n !== k + 1) || items.some((t) => t.length > 200)) {
    return { body: text, choices: null }
  }
  let q = start - 1
  while (q >= 0 && lines[q].trim() === '') q--
  const questionLine = q >= 0 ? lines[q].trim() : ''
  const hasQuestion = /[?:]\**$/.test(questionLine) && questionLine.length <= 200 && !NUMBERED.test(questionLine)
  const cut = hasQuestion ? q : start
  const body = [...lines.slice(0, cut), ...lines.slice(end + 1)].join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { body, choices: { question: hasQuestion ? unbold(questionLine).replace(/^#+\s*/, '') : null, options: items.map(unbold) } }
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
  return { body: rest ? `${body}\n\n${rest}` : body, choices: options.length >= 2 ? { question, options: options.slice(0, 9) } : null }
}
