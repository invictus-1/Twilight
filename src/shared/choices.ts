// Choice cards for text adventures. With "Choices" on, the system prompt asks the model to end a
// reply with a fenced `choices` block whenever the reader should decide; Twilight hides the
// block and shows the options as a card to click, edit, or answer in your own words. A plain
// text convention rather than tool calling, so it works with every model, local ones included.

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

/**
 * Splits a reply into the text to show and its choice card. A block still being streamed (no
 * closing fence yet) is hidden from the text but yields no card until it's complete.
 */
export function extractChoices(text: string): { body: string; choices: ChoiceSet | null } {
  const opens = [...text.matchAll(OPEN)]
  const last = opens.at(-1)
  if (!last || last.index === undefined) return { body: text, choices: null }
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
