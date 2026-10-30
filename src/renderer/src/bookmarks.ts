import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from './store'

// The replies you starred, for the open chat only: loaded when it opens, changed with a click.
let chatId: string | null = null
let marks: string[] = []
const listeners = new Set<() => void>()
const subscribe = (cb: () => void): (() => void) => (listeners.add(cb), () => listeners.delete(cb))
const changed = (): void => listeners.forEach((l) => l())

/** The open chat's bookmarks, loading them when the chat changes. */
export function useBookmarks(): string[] {
  const id = useStore((s) => s.current?.id ?? null)
  useEffect(() => {
    if (id === chatId) return
    chatId = id
    marks = []
    changed()
    if (id) void window.twilight.listBookmarks(id).then((list) => chatId === id && ((marks = list), changed()))
  }, [id])
  return useSyncExternalStore(subscribe, () => marks)
}

export async function toggleBookmark(nodeId: string): Promise<void> {
  const id = useStore.getState().current?.id
  if (!id) return
  const list = await window.twilight.toggleBookmark(id, nodeId)
  if (chatId === id) {
    marks = list
    changed()
  }
}

let last = -1
/** Brings the next starred reply on this branch into view (lit up for a moment), round and round. */
export function nextBookmark(onPath: string[]): void {
  if (!onPath.length) return
  last = (last + 1) % onPath.length
  useStore.setState({ flash: onPath[last] })
}
