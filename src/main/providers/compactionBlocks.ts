import type { NodeRow } from '../db'

// A compacted chat keeps a summary node in its tree: an assistant row whose content starts with a
// `compaction` block. With Claude it's the API's own block (sent back exactly as it came); for
// other models it's marked `local` and the summary is the node's text. A `kept` block says how
// many messages just before it stay word for word (the latest exchange), and a `carried` block
// holds the documents, pictures and instruction changes attached again after the summary.

type Block = { type: string; [key: string]: unknown }

export interface Compaction {
  block: Block
  /** The summary as text you can read. */
  text: string
  /** Written by the chat's own model (not Claude's compaction), so it goes back as plain text. */
  local: boolean
  carried: Block[]
  /** How many messages before the summary node are sent after it word for word. */
  kept: number
}

/** The compaction a node holds, or null for every other node (a cheap prefix check comes first). */
export function compactionOf(node: Pick<NodeRow, 'role' | 'content' | 'text'>): Compaction | null {
  if (node.role !== 'assistant' || !node.content?.startsWith('[{"type":"compaction"')) return null
  let blocks: Block[]
  try {
    blocks = JSON.parse(node.content) as Block[]
  } catch {
    return null
  }
  const block = blocks[0]
  const carried = (blocks.find((b) => b.type === 'carried')?.blocks as Block[] | undefined) ?? []
  const kept = Number(blocks.find((b) => b.type === 'kept')?.count ?? 0)
  return { block, text: node.text, local: block.local === true, carried, kept }
}

/** A kept reply without its thinking: thinking from before a summary can't be checked against it. */
function withoutThinking<T extends Pick<NodeRow, 'role' | 'content' | 'text'>>(node: T): T {
  if (node.role !== 'assistant' || !node.content?.includes('thinking')) return node
  try {
    const blocks = (JSON.parse(node.content) as Block[]).filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking')
    return { ...node, content: JSON.stringify(blocks) }
  } catch {
    return node
  }
}

/**
 * A request from the newest summary on: once a chat is compacted, what came before isn't sent.
 * The summary node sits after the exchange it kept, so it's moved in front of it: the summary,
 * then the kept messages word for word, then everything since.
 */
export function sinceCompaction<T extends Pick<NodeRow, 'role' | 'content' | 'text'>>(history: T[]): T[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const summary = compactionOf(history[i])
    if (!summary) continue
    const kept = history.slice(Math.max(0, i - summary.kept), i).map(withoutThinking)
    return [history[i], ...kept, ...history.slice(i + 1)]
  }
  return history
}

/** A summary written by the chat's own model, as it goes to the model. */
export const summaryText = (text: string): string =>
  `<conversation_summary>\nEverything earlier in this conversation, summarized:\n\n${text.trim()}\n</conversation_summary>`
