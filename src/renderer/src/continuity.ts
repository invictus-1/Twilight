import { useSyncExternalStore } from 'react'

// Which replies the continuity watcher is reading right now, kept outside React state like the
// streaming text: only the reply being checked redraws when its check starts or ends.

const checking = new Set<string>()
const listeners = new Map<string, Set<() => void>>()

export function setChecking(nodeId: string, on: boolean): void {
  if (on === checking.has(nodeId)) return
  if (on) checking.add(nodeId)
  else checking.delete(nodeId)
  listeners.get(nodeId)?.forEach((l) => l())
}

export function useChecking(nodeId: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(nodeId)
      if (!set) listeners.set(nodeId, (set = new Set()))
      set.add(cb)
      return () => {
        set.delete(cb)
        if (!set.size) listeners.delete(nodeId)
      }
    },
    () => checking.has(nodeId)
  )
}
