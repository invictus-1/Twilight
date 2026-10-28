import { create } from 'zustand'
import type { ChatSettings, ConversationSummary, ConversationView, ModelInfo, NodeView, ProviderConfig } from '@shared/types'
import { clearStream } from './stream'

const api = window.twilight

interface State {
  conversations: ConversationSummary[]
  current: ConversationView | null
  models: ModelInfo[]
  providers: ProviderConfig[]
  defaults: ChatSettings | null
  sidebarOpen: boolean
  settingsOpen: boolean
  error: string | null

  init(): Promise<void>
  refreshList(): Promise<void>
  refreshModels(refresh?: boolean): Promise<void>
  open(id: string): Promise<void>
  newChat(): Promise<void>
  send(text: string): Promise<void>
  regenerate(nodeId: string): Promise<void>
  switchBranch(nodeId: string, direction: -1 | 1): Promise<void>
  stop(): Promise<void>
  updateSettings(patch: Partial<ChatSettings>): Promise<void>
  deleteChat(id: string): Promise<void>
  renameChat(id: string, title: string): Promise<void>
  applyDone(conversationId: string, node: NodeView): void
  setProviders(providers: ProviderConfig[]): void
  toggleSidebar(): void
  setSettingsOpen(open: boolean): void
  setError(error: string | null): void
}

async function guard<T>(set: (s: Partial<State>) => void, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    set({ error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) })
    return undefined
  }
}

export const useStore = create<State>((set, get) => ({
  conversations: [],
  current: null,
  models: [],
  providers: [],
  defaults: null,
  sidebarOpen: true,
  settingsOpen: false,
  error: null,

  async init() {
    const [conversations, providers, defaults] = await Promise.all([
      api.listConversations(),
      api.listProviders(),
      api.getDefaults()
    ])
    set({ conversations, providers, defaults })
    if (conversations[0]) await get().open(conversations[0].id)
    void get().refreshModels()
  },

  async refreshList() {
    set({ conversations: await api.listConversations() })
  },

  async refreshModels(refresh = false) {
    set({ models: await api.listModels(refresh) })
  },

  async open(id) {
    const view = await guard(set, () => api.openConversation(id))
    if (view) set({ current: view })
  },

  async newChat() {
    const current = get().current
    // Reuse an untouched chat instead of piling up empty ones.
    if (current && current.path.length === 0) return
    const view = await guard(set, () => api.createConversation())
    if (!view) return
    set({ current: view })
    await get().refreshList()
  },

  async send(text) {
    let current = get().current
    if (!current) {
      await get().newChat()
      current = get().current
      if (!current) return
    }
    const view = await guard(set, () => api.send(current.id, text))
    if (view) set({ current: view })
    await get().refreshList()
  },

  async regenerate(nodeId) {
    const current = get().current
    if (!current) return
    const view = await guard(set, () => api.regenerate(current.id, nodeId))
    if (view) set({ current: view })
  },

  async switchBranch(nodeId, direction) {
    const current = get().current
    if (!current) return
    const view = await guard(set, () => api.switchBranch(current.id, nodeId, direction))
    if (view) set({ current: view })
  },

  async stop() {
    const current = get().current
    if (current) await api.stop(current.id)
  },

  async updateSettings(patch) {
    const current = get().current
    if (patch.modelId || patch.providerId) {
      const defaults = await api.setDefaults({
        ...(patch.modelId ? { modelId: patch.modelId } : {}),
        ...(patch.providerId ? { providerId: patch.providerId } : {})
      })
      set({ defaults })
    }
    if (!current) return
    const view = await guard(set, () => api.updateChatSettings(current.id, patch))
    if (view) set({ current: view })
  },

  async deleteChat(id) {
    await api.deleteConversation(id)
    const conversations = await api.listConversations()
    set({ conversations })
    if (get().current?.id === id) {
      set({ current: null })
      if (conversations[0]) await get().open(conversations[0].id)
    }
  },

  async renameChat(id, title) {
    await api.renameConversation(id, title)
    if (get().current?.id === id) set({ current: { ...get().current!, title } })
    await get().refreshList()
  },

  applyDone(conversationId, node) {
    const current = get().current
    if (current?.id === conversationId) {
      set({ current: { ...current, path: current.path.map((n) => (n.id === node.id ? node : n)) } })
    }
    clearStream(node.id)
    void get().refreshList()
  },

  setProviders(providers) {
    set({ providers })
  },
  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen })
  },
  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },
  setError(error) {
    set({ error })
  }
}))

export function modelName(models: ModelInfo[], id: string | undefined): string {
  if (!id) return 'No model'
  const known = models.find((m) => m.id === id)?.name
  if (known) return known
  // Offline or before the model list loads: "claude-opus-5-5" reads as "Claude Opus 5.5".
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(id)
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id
}
