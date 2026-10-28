import { useCallback, useState, type PointerEvent } from 'react'

// Drag-to-resize for the sidebar edge and the split divider. The pointer is captured on the
// handle, so a fast drag never "falls off" it; sizes persist per machine in local storage.

export function usePersistentNumber(key: string, fallback: number): [number, (n: number) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key))
      return Number.isFinite(stored) && stored > 0 ? stored : fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (n: number) => {
      setValue(n)
      try {
        localStorage.setItem(key, String(n))
      } catch {
        /* storage unavailable: the size just isn't remembered */
      }
    },
    [key]
  )
  return [value, set]
}

/** Pointer handlers for a resize handle. `onMove` gets the pointer's x in the window. */
export function useDragResize({ onMove, onReset }: { onMove: (clientX: number) => void; onReset: () => void }) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.classList.add('resizing')
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(e.clientX)
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId)
      document.body.classList.remove('resizing')
    },
    onDoubleClick: onReset
  }
}
