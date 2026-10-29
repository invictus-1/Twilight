import { create } from 'zustand'
import type { CodeMode, CodeResponse, CodeSessionSummary, CodeSessionView } from '@shared/code'
import { useStore } from './store'

const api = window.twilight

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface CodeState {
  sessions: CodeSessionSummary[]
  current: CodeSessionView | null
  init(): Promise<void>
  refresh(): Promise<void>
  open(id: string): Promise<void>
  create(): Promise<void>
  send(text: string): Promise<void>
  respond(response: CodeResponse): Promise<void>
  stop(): Promise<void>
  undo(all: boolean): Promise<void>
  setOptions(patch: { mode?: CodeMode; providerId?: string; modelId?: string }): Promise<void>
  remove(id: string): Promise<void>
}

const guard = async (fn: () => Promise<void>): Promise<void> => {
  try {
    await fn()
  } catch (err) {
    useStore.getState().setError(message(err))
  }
}

let listening = false

export const useCode = create<CodeState>((set, get) => ({
  sessions: [],
  current: null,

  async init() {
    if (!listening) {
      listening = true
      // The engine pushes the whole session after each step, and the reply's text as it streams.
      api.onCode((event) => {
        const current = get().current
        if (event.kind === 'list') void get().refresh()
        else if (event.kind === 'view' && current?.id === event.view.id) set({ current: event.view })
        else if (event.kind === 'text' && current?.id === event.sessionId) {
          const entries = [...current.entries]
          const last = entries.at(-1)
          if (last?.kind === 'assistant') entries[entries.length - 1] = { ...last, text: last.text + event.delta }
          else entries.push({ kind: 'assistant', text: event.delta })
          set({ current: { ...current, entries } })
        }
      })
    }
    await get().refresh()
    if (!get().current && get().sessions[0]) await get().open(get().sessions[0].id)
  },

  async refresh() {
    const sessions = await api.listCodeSessions()
    // A session deleted elsewhere (another window, a test) closes here too.
    const current = get().current
    set({ sessions, current: current && !sessions.some((x) => x.id === current.id) ? null : current })
  },

  open: (id) => guard(async () => set({ current: await api.openCodeSession(id) })),

  create: () =>
    guard(async () => {
      const view = await api.newCodeSession()
      if (view) set({ current: view })
      await get().refresh()
    }),

  send: (text) =>
    guard(async () => {
      const current = get().current
      if (current) set({ current: await api.sendCode(current.id, text) })
    }),

  respond: (response) =>
    guard(async () => {
      const current = get().current
      if (current?.pending) await api.respondCode(current.id, current.pending.id, response)
    }),

  stop: () =>
    guard(async () => {
      const current = get().current
      if (current) await api.stopCode(current.id)
    }),

  undo: (all) =>
    guard(async () => {
      const current = get().current
      if (current) set({ current: await api.undoCode(current.id, all) })
    }),

  setOptions: (patch) =>
    guard(async () => {
      const current = get().current
      if (current) set({ current: await api.setCodeOptions(current.id, patch) })
    }),

  remove: (id) =>
    guard(async () => {
      await api.deleteCodeSession(id)
      if (get().current?.id === id) set({ current: null })
      await get().refresh()
      const next = get().sessions[0]
      if (!get().current && next) await get().open(next.id)
    })
}))
