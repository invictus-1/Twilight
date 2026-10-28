import { create } from 'zustand'
import type { DocContent, DocEntry } from '@shared/types'

const api = window.twilight

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

interface WritingState {
  folder: string
  docs: DocEntry[]
  open: DocContent | null
  status: SaveStatus
  words: number
  error: string | null

  init(): Promise<void>
  refresh(): Promise<void>
  openDoc(path: string): Promise<void>
  newDoc(): Promise<void>
  chooseFolder(): Promise<void>
  setStatus(status: SaveStatus): void
  setWords(words: number): void
  markSaved(mtime: number, text: string): void
}

export const useWriting = create<WritingState>((set, get) => ({
  folder: '',
  docs: [],
  open: null,
  status: 'saved',
  words: 0,
  error: null,

  async init() {
    set({ folder: await api.getWritingFolder() })
    await get().refresh()
  },

  async refresh() {
    try {
      set({ docs: await api.listDocs(), error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  async openDoc(path) {
    if (get().open?.path === path) return
    set({ open: await api.readDoc(path), status: 'saved' })
  },

  async newDoc() {
    const entry = await api.createDoc('Untitled')
    await get().refresh()
    await get().openDoc(entry.path)
  },

  async chooseFolder() {
    const folder = await api.chooseWritingFolder()
    if (!folder) return
    set({ folder, open: null })
    await get().refresh()
  },

  setStatus: (status) => set({ status }),
  setWords: (words) => set({ words }),
  markSaved(mtime, text) {
    const open = get().open
    if (open) set({ open: { ...open, mtime, text }, status: 'saved' })
  }
}))
