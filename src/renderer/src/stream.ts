import type { StreamEvent } from '@shared/types'

// Streaming text lives outside React state. Deltas are appended to a buffer and subscribers
// are notified at most once per animation frame, so a fast model never re-renders the thread
// more often than the screen refreshes, and only the streaming message re-renders at all.

interface Buffer {
  text: string
  thinking: string
  /** Searches and page reads so far ("Searching: …"), newest last. */
  activity: string[]
}

const EMPTY: Buffer = { text: '', thinking: '', activity: [] }

const buffers = new Map<string, Buffer>()
const listeners = new Map<string, Set<() => void>>()
const dirty = new Set<string>()
let frame = 0

function flush(): void {
  frame = 0
  for (const id of dirty) listeners.get(id)?.forEach((l) => l())
  dirty.clear()
}

export function handleStreamEvent(event: StreamEvent): void {
  if (event.kind === 'done') return
  const buf = buffers.get(event.nodeId) ?? { text: '', thinking: '', activity: [] }
  if (event.kind === 'text') buf.text += event.delta
  else if (event.kind === 'thinking') buf.thinking += event.delta
  // A new array, so a subscriber comparing snapshots sees the change.
  else buf.activity = [...buf.activity, event.label]
  buffers.set(event.nodeId, buf)
  dirty.add(event.nodeId)
  if (!frame) frame = requestAnimationFrame(flush)
}

export function readStream(nodeId: string): Buffer {
  return buffers.get(nodeId) ?? EMPTY
}

export function clearStream(nodeId: string): void {
  buffers.delete(nodeId)
}

export function subscribeStream(nodeId: string, listener: () => void): () => void {
  let set = listeners.get(nodeId)
  if (!set) listeners.set(nodeId, (set = new Set()))
  set.add(listener)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(nodeId)
  }
}
