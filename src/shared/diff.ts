// Word-level diffs, used in two places: a writing suggestion against the passage it rewrites
// (removed words struck through, added words marked, in place), and split compare's two latest
// replies against each other (words only in A, words only in B).

export type DiffOp =
  | { type: 'eq'; text: string; from: number }
  | { type: 'del'; text: string; from: number }
  | { type: 'ins'; text: string; at: number }

/**
 * Above this many token pairs, once the shared start and end are set aside, the full comparison
 * is skipped: about 3,000 by 3,000 words, a few tens of milliseconds and 18 MB for the table.
 */
const MAX_CELLS = 9_000_000

const EQ = 0
const DEL = 1
const INS = 2
type Step = typeof EQ | typeof DEL | typeof INS

/**
 * The walk from `a` to `b` one token at a time along a longest common subsequence: kept (EQ),
 * only in `a` (DEL) or only in `b` (INS). Null when the part that differs is too long for it.
 */
function steps(a: readonly string[], b: readonly string[]): Step[] | null {
  // The shared start and end need no table; only the middle that differs does.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) return null
  const out: Step[] = new Array<Step>(start).fill(EQ)
  // Longest common subsequence table of the middle, filled from the end. Under the cap the
  // shorter side has at most 3,000 tokens, so every length fits 16 bits.
  const w = m + 1
  const lcs = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      out.push(EQ)
      i++
      j++
    } else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      // Removals first, so a replaced word reads "old new" rather than "new old".
      out.push(DEL)
      i++
    } else {
      out.push(INS)
      j++
    }
  }
  for (let k = endA; k < a.length; k++) out.push(EQ)
  return out
}

// ——— Suggestions in the editor ———

const tokenize = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? []

/** Ops with offsets into `before`; `ins` ops say where in `before` the new text goes. */
export function wordDiff(before: string, after: string): DiffOp[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const walk = steps(a, b)
  if (!walk) {
    // Too long to compare word by word: the whole passage shows as replaced.
    return [
      { type: 'del', text: before, from: 0 },
      { type: 'ins', text: after, at: before.length }
    ]
  }
  const ops: DiffOp[] = []
  const push = (op: DiffOp): void => {
    const last = ops[ops.length - 1]
    if (last && last.type === op.type) last.text += op.text
    else ops.push(op)
  }
  let i = 0
  let j = 0
  let offset = 0
  for (const step of walk) {
    if (step === EQ) {
      push({ type: 'eq', text: a[i], from: offset })
      offset += a[i++].length
      j++
    } else if (step === DEL) {
      push({ type: 'del', text: a[i], from: offset })
      offset += a[i++].length
    } else {
      push({ type: 'ins', text: b[j++], at: offset })
    }
  }
  return ops
}

// ——— Split compare ———

/** A stretch of one side's text; `changed` when it isn't in the other side. */
export interface DiffRun {
  text: string
  changed: boolean
}

export interface Comparison {
  /** "words" normally; "paragraphs" when the replies were too long to compare word by word. */
  by: 'words' | 'paragraphs'
  /** Each side as paragraphs of runs; line breaks inside a paragraph are kept as "\n". */
  a: DiffRun[][]
  b: DiffRun[][]
  /** Words only in A, and only in B. */
  onlyA: number
  onlyB: number
  /** Shared words over all words, from 0 to 1. */
  similarity: number
}

const BREAK = '\n\n'
const LINE = '\n'
const isWord = (t: string): boolean => t !== BREAK && t !== LINE
const countWords = (s: string): number => s.match(/\S+/g)?.length ?? 0

/** Paragraphs with their spacing tidied: one space between words, lines kept. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[ \t]*\n\s*/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
}

/** Words, with paragraph and line breaks as tokens of their own so the layout lines up too. */
function tokensOf(paragraphs: string[]): string[] {
  const out: string[] = []
  paragraphs.forEach((p, k) => {
    if (k) out.push(BREAK)
    p.split('\n').forEach((line, l) => {
      if (l) out.push(LINE)
      out.push(...line.split(' '))
    })
  })
  return out
}

/** One side's tokens back into paragraphs, joining neighbouring words that share a state. */
function runsOf(tokens: string[], changed: boolean[]): DiffRun[][] {
  const paras: DiffRun[][] = [[]]
  let gap = false
  tokens.forEach((t, k) => {
    const par = paras[paras.length - 1]
    const last = par[par.length - 1]
    if (t === BREAK) {
      paras.push([])
      gap = false
      return
    }
    if (t === LINE) {
      if (last && !last.changed) last.text += LINE
      else par.push({ text: LINE, changed: false })
      gap = false
      return
    }
    const c = changed[k]
    // The space before a word stays unmarked unless the words on both sides of it are marked.
    if (last && last.changed === c) last.text += (gap ? ' ' : '') + t
    else if (gap && last && !last.changed) {
      last.text += ' '
      par.push({ text: t, changed: c })
    } else par.push({ text: (gap ? ' ' : '') + t, changed: c })
    gap = true
  })
  return paras.filter((p) => p.length > 0)
}

const similarity = (same: number, onlyA: number, onlyB: number): number => (same + onlyA + onlyB === 0 ? 1 : (2 * same) / (2 * same + onlyA + onlyB))

/**
 * Two texts compared word by word, or paragraph by paragraph when the part that differs is too
 * long for a word comparison (then a paragraph is either the same in both or marked as a whole).
 */
export function compareTexts(a: string, b: string): Comparison {
  const pa = paragraphsOf(a)
  const pb = paragraphsOf(b)
  const ta = tokensOf(pa)
  const tb = tokensOf(pb)
  const walk = steps(ta, tb)
  if (!walk) return compareParagraphs(pa, pb)
  const changedA = new Array<boolean>(ta.length).fill(false)
  const changedB = new Array<boolean>(tb.length).fill(false)
  let i = 0
  let j = 0
  let same = 0
  let onlyA = 0
  let onlyB = 0
  for (const step of walk) {
    if (step === EQ) {
      if (isWord(ta[i])) same++
      i++
      j++
    } else if (step === DEL) {
      if (isWord(ta[i])) onlyA++
      changedA[i++] = true
    } else {
      if (isWord(tb[j])) onlyB++
      changedB[j++] = true
    }
  }
  return { by: 'words', a: runsOf(ta, changedA), b: runsOf(tb, changedB), onlyA, onlyB, similarity: similarity(same, onlyA, onlyB) }
}

function compareParagraphs(pa: string[], pb: string[]): Comparison {
  // Thousands of paragraphs a side is past any reply; then every paragraph counts as changed.
  const walk = steps(pa, pb) ?? [...new Array<Step>(pa.length).fill(DEL), ...new Array<Step>(pb.length).fill(INS)]
  const changedA = new Array<boolean>(pa.length).fill(false)
  const changedB = new Array<boolean>(pb.length).fill(false)
  let i = 0
  let j = 0
  let same = 0
  let onlyA = 0
  let onlyB = 0
  for (const step of walk) {
    if (step === EQ) {
      same += countWords(pa[i++])
      j++
    } else if (step === DEL) {
      onlyA += countWords(pa[i])
      changedA[i++] = true
    } else {
      onlyB += countWords(pb[j])
      changedB[j++] = true
    }
  }
  return {
    by: 'paragraphs',
    a: pa.map((text, k) => [{ text, changed: changedA[k] }]),
    b: pb.map((text, k) => [{ text, changed: changedB[k] }]),
    onlyA,
    onlyB,
    similarity: similarity(same, onlyA, onlyB)
  }
}

/**
 * A reply's markdown as the words a reader sees: heading, list and quote markers, emphasis,
 * links and HTML tags dropped; code kept as it is; paragraphs and lines kept.
 */
export function plainProse(markdown: string): string {
  const lines: string[] = []
  let fence = false
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) {
      lines.push(raw)
      continue
    }
    // A rule, or a table's divider row, has no words of its own.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      lines.push('')
      continue
    }
    if (raw.includes('|') && /^[\s|:-]+$/.test(raw)) continue
    lines.push(
      raw
        .replace(/^\s*\|(.*)\|\s*$/, (_, row: string) => row.split('|').map((c) => c.trim()).join('  '))
        .replace(/^\s*(>\s?)+/, '')
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/(\*{1,3}|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
        .replace(/(^|\W)(_{1,3})(?=\S)(.+?)(?<=\S)\2(?!\w)/g, '$1$3')
        .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')
    )
  }
  return lines.join('\n')
}
