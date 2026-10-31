import { create } from 'zustand'
import type { BibleState } from '@shared/bible'

// The Bible section's state: the bible as the main process last sent it, and which page is open
// (the overview with sources and proposals, or one entry).

interface BibleStore {
  state: BibleState | null
  /** An entry's id, or null for the overview. */
  page: string | null
  query: string
  init(): Promise<void>
  open(page: string | null): void
  setQuery(query: string): void
  set(state: BibleState): void
}

let listening = false

export const useBible = create<BibleStore>((set) => ({
  state: null,
  page: null,
  query: '',
  async init() {
    if (!listening) {
      listening = true
      window.twilight.onBible((state) => set({ state }))
    }
    set({ state: await window.twilight.bibleState() })
  },
  open: (page) => set({ page }),
  setQuery: (query) => set({ query }),
  set: (state) => set({ state })
}))
