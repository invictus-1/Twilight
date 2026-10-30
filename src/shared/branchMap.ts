// The branch map: a chat's whole tree of messages, drawn small. A long chat is mostly one straight
// line, so only the messages that matter for finding your way are drawn (the first, every fork,
// the first message down each branch, and every branch's end); a straight run between them folds
// into its edge with a count. Laid out here so the main process sends only what's drawn.

export interface TreeRow {
  id: string
  parentId: string | null
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  modelId?: string
}

export interface MapNode {
  id: string
  /** The drawn node above this one (null for the first message). */
  parentId: string | null
  role: 'user' | 'assistant'
  preview: string
  createdAt: number
  modelId?: string
  /** Messages folded into the edge above this node. */
  folded: number
  /** Column and row on the map. */
  x: number
  y: number
  /** On the thread the chat shows now. */
  onPath: boolean
  /** The end of a branch. */
  leaf: boolean
}

export interface BranchMap {
  nodes: MapNode[]
  columns: number
  rows: number
  /** Messages in the tree, folded ones included. */
  total: number
  /** Branch ends: 1 for a chat that never forked. */
  branches: number
  /** The end of the thread shown now. */
  current: string | null
}

const PREVIEW = 140

/** Lays out `rows` (every live message, root left out) with `path` the ids of the thread shown now. */
export function layoutBranchMap(rows: TreeRow[], path: string[]): BranchMap {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const children = new Map<string | null, TreeRow[]>()
  for (const r of rows) {
    // A message whose parent isn't in the list hangs off the top (the root).
    const parent = r.parentId && byId.has(r.parentId) ? r.parentId : null
    const list = children.get(parent)
    if (list) list.push(r)
    else children.set(parent, [r])
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt)
  const onPath = new Set(path)
  const kids = (id: string | null): TreeRow[] => children.get(id) ?? []

  const nodes: MapNode[] = []
  let column = 0
  let rowsUsed = 0
  let branches = 0
  // Walks down from `start` (drawn under `parent` at row `y`), folding straight runs. Iterative
  // over the run so a 450-message line doesn't recurse 450 deep.
  const place = (start: TreeRow, parent: string | null, y: number, forked: boolean): number => {
    let node = start
    let folded = 0
    // Fold while this message is a plain step: one child, not a fork, not the first down a branch.
    if (!forked) {
      while (kids(node.id).length === 1) {
        folded++
        node = kids(node.id)[0]
      }
    }
    const below = kids(node.id)
    const drawn: MapNode = {
      id: node.id,
      parentId: parent,
      role: node.role,
      preview: node.text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW),
      createdAt: node.createdAt,
      modelId: node.modelId,
      folded,
      x: 0,
      y,
      onPath: onPath.has(node.id),
      leaf: below.length === 0
    }
    nodes.push(drawn)
    rowsUsed = Math.max(rowsUsed, y + 1)
    if (!below.length) {
      branches++
      drawn.x = column++
      return drawn.x
    }
    const xs = below.map((child) => place(child, node.id, y + 1, below.length > 1))
    drawn.x = (xs[0] + xs[xs.length - 1]) / 2
    return drawn.x
  }
  for (const first of kids(null)) place(first, null, 0, true)
  const current = path.length ? path[path.length - 1] : null
  return { nodes, columns: column, rows: rowsUsed, total: rows.length, branches, current }
}
