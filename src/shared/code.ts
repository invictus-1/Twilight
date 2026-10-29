// The Code tab: an agent that works in one folder you choose. Types shared by the main process
// (src/main/code/) and the interface, plus the line diff its approvals show and the check that
// flags commands able to delete or overwrite things.

/** How much the agent may do without asking: everything asks, edits go through, or nothing changes. */
export type CodeMode = 'ask' | 'edits' | 'read'

export interface CodeSessionSummary {
  id: string
  title: string
  folder: string
  updatedAt: number
  running: boolean
  /** Waiting on you: an approval or a question. */
  waiting: boolean
}

export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap'
  text: string
}

/** One thing that happened, as the transcript shows it. */
export type CodeEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      /** "Read src/app.ts", "Ran npm test", "Edited README.md". */
      title: string
      status: 'running' | 'done' | 'declined' | 'error' | 'undone'
      /** The command's output, a listing, or why it failed (shown folded). */
      output?: string
      diff?: DiffLine[]
      /** The snapshot taken before this change, for undo. */
      snapshot?: number
    }
  | { kind: 'question'; question: string; answer: string | null }
  | { kind: 'note'; text: string }

/** What the agent is waiting for you to decide. */
export interface CodePending {
  id: string
  kind: 'edit' | 'write' | 'delete' | 'command' | 'question'
  title: string
  path?: string
  diff?: DiffLine[]
  command?: string
  /** Why a command looks risky (it can delete or overwrite things); "always allow" is off then. */
  risk?: string
  question?: string
  options?: string[]
}

export interface CodeSessionView {
  id: string
  title: string
  folder: string
  providerId: string
  modelId: string
  mode: CodeMode
  entries: CodeEntry[]
  pending: CodePending | null
  running: boolean
  /** Snapshots that can still be undone, newest last. */
  undoable: { n: number; label: string }[]
  /** Commands you allowed for the rest of this session. */
  allowed: string[]
  error: string | null
  tokens: { input: number; output: number; cacheRead: number }
}

export type CodeEvent = { kind: 'view'; view: CodeSessionView } | { kind: 'text'; sessionId: string; delta: string } | { kind: 'list' }

/** Your answer to a pending approval or question. */
export interface CodeResponse {
  approve: boolean
  /** Approve every edit for the rest of the session ("edits" mode), or this exact command. */
  always?: boolean
  /** Your words: a question's answer, or why you declined. */
  text?: string
}

/**
 * Commands that can delete, overwrite or rewrite history. They always ask, with a warning, and
 * can't be allowed for the whole session.
 */
const RISKY: [RegExp, string][] = [
  [/\b(rm|rmdir|del|erase|rd)\b|remove-item|\bri\b/i, 'it deletes files'],
  [/\bformat(-volume)?\b|\bdiskpart\b|clear-disk/i, 'it can wipe a drive'],
  [/git\s+(reset\s+--hard|clean\b|push\b.*(--force|-f\b)|checkout\s+--\s|restore\b|stash\s+(drop|clear))/i, 'it can throw away git work'],
  [/move-item|\bmv\b|\bmove\b|rename-item|\bren\b/i, 'it moves or renames files'],
  [/>\s*[^&|]|out-file|set-content|\bsc\b/i, 'it writes to a file directly'],
  [/\b(shutdown|restart-computer|stop-computer|reg\s+delete|remove-itemproperty)\b/i, 'it changes the system'],
  [/curl\b.*\|\s*(sh|bash|iex)|iwr\b.*\|\s*iex|invoke-expression/i, 'it runs code from the internet']
]

export function commandRisk(command: string): string | null {
  for (const [re, why] of RISKY) if (re.test(command)) return why
  return null
}

const LINE_CAP = 4_000_000

/**
 * A line diff of two texts, with unchanged runs folded to three lines of context either side.
 * Above the cap (two very long files) it shows the old text removed and the new text added.
 */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const ops: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  if (midA.length * midB.length > LINE_CAP) {
    ops.push(...midA.map((text): DiffLine => ({ kind: 'del', text })), ...midB.map((text): DiffLine => ({ kind: 'add', text })))
  } else {
    // Longest common subsequence over the changed middle.
    const n = midA.length
    const m = midB.length
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ kind: 'same', text: midA[i] })
        i++
        j++
      } else if (i < n && (j >= m || table[i + 1][j] >= table[i][j + 1])) ops.push({ kind: 'del', text: midA[i++] })
      else ops.push({ kind: 'add', text: midB[j++] })
    }
  }
  ops.push(...a.slice(endA).map((text): DiffLine => ({ kind: 'same', text })))
  // Fold long unchanged runs down to their context.
  const out: DiffLine[] = []
  for (let k = 0; k < ops.length; ) {
    if (ops[k].kind !== 'same') {
      out.push(ops[k++])
      continue
    }
    let end = k
    while (end < ops.length && ops[end].kind === 'same') end++
    const run = ops.slice(k, end)
    const keepStart = k === 0 ? 0 : context
    const keepEnd = end === ops.length ? 0 : context
    if (run.length > keepStart + keepEnd + 1) {
      out.push(...run.slice(0, keepStart), { kind: 'gap', text: `${run.length - keepStart - keepEnd} unchanged lines` }, ...run.slice(run.length - keepEnd))
    } else out.push(...run)
    k = end
  }
  return out
}
