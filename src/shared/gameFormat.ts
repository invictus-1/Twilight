// "Game Format": reflows a reply for pasting into a game engine's text (RPG Maker message
// boxes and the like). Within each chunk of prose, paragraphs are joined with single line breaks
// instead of blank lines. Chunks stay apart: by the --- divider (kept by default) or a blank
// line. Code blocks and HTML blocks (stat sheets, <details> status cards) are left exactly as written.

export interface GameFormatOptions {
  /** Drop --- / *** / ___ divider lines between chunks (a blank line still separates them). */
  removeDividers: boolean
  /** Remove markdown emphasis and heading marks (**bold**, *italic*, # Heading) from prose. */
  stripMarkdown: boolean
}

export const DEFAULT_GAME_FORMAT: GameFormatOptions = { removeDividers: false, stripMarkdown: false }

type Block = { kind: 'prose'; paragraphs: string[][] } | { kind: 'raw'; lines: string[] } | { kind: 'divider'; line: string }

const FENCE = /^\s*(`{3,}|~{3,})/
const DIVIDER = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const HTML_START = /^\s*<\/?([a-z][\w-]*)[\s/>]/i

function stripMarks(line: string): string {
  return line
    .replace(/^(\s*)#{1,6}\s+/, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, '$1$2')
}

export function gameFormat(text: string, options: GameFormatOptions = DEFAULT_GAME_FORMAT): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let prose: Block & { kind: 'prose' } = { kind: 'prose', paragraphs: [] }
  let paragraph: string[] = []

  const endParagraph = (): void => {
    if (paragraph.length) prose.paragraphs.push(paragraph)
    paragraph = []
  }
  const endProse = (): void => {
    endParagraph()
    if (prose.paragraphs.length) blocks.push(prose)
    prose = { kind: 'prose', paragraphs: [] }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      // A fenced code block: copied untouched, closing fence included.
      endProse()
      const raw = [line]
      const marker = fence[1][0].repeat(fence[1].length)
      while (++i < lines.length) {
        raw.push(lines[i])
        if (lines[i].trim().startsWith(marker)) break
      }
      blocks.push({ kind: 'raw', lines: raw })
      continue
    }
    const html = HTML_START.exec(line)
    if (html) {
      // An HTML block: <details> runs to its closing tag (it holds blank lines); others to a blank line.
      endProse()
      const raw = [line]
      if (html[1].toLowerCase() === 'details') {
        let depth = (line.match(/<details\b/gi) ?? []).length - (line.match(/<\/details>/gi) ?? []).length
        while (depth > 0 && ++i < lines.length) {
          raw.push(lines[i])
          depth += (lines[i].match(/<details\b/gi) ?? []).length - (lines[i].match(/<\/details>/gi) ?? []).length
        }
      } else {
        while (i + 1 < lines.length && lines[i + 1].trim() !== '') raw.push(lines[++i])
      }
      blocks.push({ kind: 'raw', lines: raw })
      continue
    }
    if (DIVIDER.test(line)) {
      endProse()
      blocks.push({ kind: 'divider', line: line.trim() })
      continue
    }
    if (line.trim() === '') endParagraph()
    else paragraph.push(options.stripMarkdown ? stripMarks(line) : line)
  }
  endProse()

  const out: string[] = []
  for (const block of blocks) {
    if (block.kind === 'divider') {
      if (!options.removeDividers) out.push(block.line)
      continue
    }
    out.push(block.kind === 'raw' ? block.lines.join('\n') : block.paragraphs.map((p) => p.join('\n')).join('\n'))
  }
  // Chunks, dividers and raw blocks are separated by one blank line; trailing space trimmed.
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}
