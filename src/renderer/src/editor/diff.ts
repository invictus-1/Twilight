// Word-level diff between a passage and its proposed rewrite, for showing a suggestion in place:
// unchanged words stay, removed words are struck through, added words are marked.

export type DiffOp =
  | { type: 'eq'; text: string; from: number }
  | { type: 'del'; text: string; from: number }
  | { type: 'ins'; text: string; at: number }

const tokenize = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? []

/** Above this many token pairs the diff is skipped and the whole passage shows as replaced. */
const MAX_CELLS = 4_000_000

/** Ops with offsets into `before`; `ins` ops say where in `before` the new text goes. */
export function wordDiff(before: string, after: string): DiffOp[] {
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length * b.length > MAX_CELLS) {
    return [
      { type: 'del', text: before, from: 0 },
      { type: 'ins', text: after, at: before.length }
    ]
  }
  // Longest common subsequence table, filled from the end.
  const w = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
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
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push({ type: 'eq', text: a[i], from: offset })
      offset += a[i++].length
      j++
    } else if (i < a.length && (j === b.length || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      // Removals first, so a replaced word reads "old new" rather than "new old".
      push({ type: 'del', text: a[i], from: offset })
      offset += a[i++].length
    } else {
      push({ type: 'ins', text: b[j++], at: offset })
    }
  }
  return ops
}
