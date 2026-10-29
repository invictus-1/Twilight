import { create } from 'zustand'
import type { Library, Persona, SavedPrompt } from '@shared/library'
import { useStore } from './store'

const api = window.twilight

const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface LibraryState extends Library {
  /** The composer's Prompts popover (the command menu opens it too). */
  promptsOpen: boolean
  setPromptsOpen(open: boolean): void
  refresh(): Promise<void>
  savePersona(persona: Persona): Promise<boolean>
  /** Deletes it, with an undo. */
  deletePersona(id: string): Promise<void>
  savePrompt(prompt: SavedPrompt): Promise<boolean>
  deletePrompt(id: string): Promise<void>
  importFile(): Promise<void>
  exportFile(ids?: string[]): Promise<void>
}

/** Personas and prompts, shared by the Library page, the model settings panel and the composer. */
export const useLibrary = create<LibraryState>((set, get) => {
  /** Runs a library call; a failure shows as the app's error toast. */
  const guard = async (fn: () => Promise<Library>): Promise<boolean> => {
    try {
      set(await fn())
      return true
    } catch (err) {
      useStore.getState().setError(message(err))
      return false
    }
  }
  return {
    personas: [],
    prompts: [],
    promptsOpen: false,
    setPromptsOpen: (open) => set({ promptsOpen: open }),
    refresh: async () => void (await guard(() => api.getLibrary())),
    savePersona: (persona) => guard(() => api.savePersona(persona)),
    async deletePersona(id) {
      const gone = get().personas.find((p) => p.id === id)
      if (!(await guard(() => api.deletePersona(id))) || !gone) return
      useStore.getState().offerUndo(`Persona “${gone.name}” deleted`, async () => void (await guard(() => api.savePersona(gone))))
    },
    savePrompt: (prompt) => guard(() => api.savePrompt(prompt)),
    async deletePrompt(id) {
      const gone = get().prompts.find((p) => p.id === id)
      if (!(await guard(() => api.deletePrompt(id))) || !gone) return
      useStore.getState().offerUndo(`Prompt “${gone.name}” deleted`, async () => void (await guard(() => api.savePrompt(gone))))
    },
    async importFile() {
      try {
        const result = await api.importLibrary()
        if (result) set(result.library)
      } catch (err) {
        useStore.getState().setError(message(err))
      }
    },
    async exportFile(ids) {
      try {
        await api.exportLibrary(ids)
      } catch (err) {
        useStore.getState().setError(message(err))
      }
    }
  }
})
