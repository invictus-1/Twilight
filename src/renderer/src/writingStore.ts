import { create } from 'zustand'
import type { DocContent, DocEntry } from '@shared/types'

const api = window.twilight

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

interface WritingState {
  folder: string
  docs: DocEntry[]
  /** Subfolders of the writing folder, relative, empty ones included. */
  folders: string[]
  /** Folders the reader has collapsed in the sidebar (expanded by default). */
  collapsed: Set<string>
  open: DocContent | null
  status: SaveStatus
  words: number
  error: string | null

  init(): Promise<void>
  refresh(): Promise<void>
  openDoc(path: string): Promise<void>
  newDoc(folder?: string): Promise<void>
  newFolder(path: string): Promise<void>
  moveDoc(path: string, folder: string): Promise<void>
  toggleFolder(path: string): void
  chooseFolder(): Promise<void>
  setStatus(status: SaveStatus): void
  setWords(words: number): void
  markSaved(mtime: number, text: string): void
}

const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useWriting = create<WritingState>((set, get) => ({
  folder: '',
  docs: [],
  folders: [],
  collapsed: new Set(),
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
      const [docs, folders] = await Promise.all([api.listDocs(), api.listDocFolders()])
      set({ docs, folders, error: null })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async openDoc(path) {
    if (get().open?.path === path) return
    set({ open: await api.readDoc(path), status: 'saved' })
  },

  async newDoc(folder = '') {
    const entry = await api.createDoc('Untitled', folder)
    if (folder) get().collapsed.delete(folder)
    await get().refresh()
    await get().openDoc(entry.path)
  },

  async newFolder(path) {
    try {
      await api.createDocFolder(path)
      await get().refresh()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async moveDoc(path, folder) {
    const { open, status } = get()
    // The editor saves to the open path; moving mid-save could leave a copy behind.
    if (open?.path === path && status !== 'saved') {
      set({ error: 'Still saving this document. Try the move again in a moment.' })
      return
    }
    try {
      const moved = await api.moveDoc(path, folder)
      if (open?.path === path) set({ open: { ...open, path: moved } })
      await get().refresh()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  toggleFolder(path) {
    const collapsed = new Set(get().collapsed)
    if (collapsed.has(path)) collapsed.delete(path)
    else collapsed.add(path)
    set({ collapsed })
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
