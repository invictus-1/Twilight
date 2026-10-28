import { create } from 'zustand'
import type {
  Attachment,
  ChatFolder,
  ChatSettings,
  ModelOptions,
  WorkspacePatch,
  ConversationSummary,
  ConversationView,
  DeletionView,
  ModelInfo,
  NodeView,
  Pane,
  ProviderConfig,
  SendTarget,
  UpdateState
} from '@shared/types'
import { clearStream } from './stream'

export type Mode = 'chat' | 'write' | 'judge'

const api = window.twilight

interface State {
  conversations: ConversationSummary[]
  folders: ChatFolder[]
  trash: ConversationSummary[]
  current: ConversationView | null
  models: ModelInfo[]
  providers: ProviderConfig[]
  defaults: ChatSettings | null
  /** Where the composer sends while split compare is open. */
  target: SendTarget
  mode: Mode
  sidebarOpen: boolean
  settingsOpen: boolean
  /** The Settings section to open on. */
  settingsSection: string | null
  updates: UpdateState | null
  error: string | null
  /** The current chat's recently deleted messages, newest first. */
  deletions: DeletionView[]
  /** The last deletion, offered for undo in a toast until it times out. */
  undo: { deletionId: string; pane: Pane; label: string } | null

  init(): Promise<void>
  refreshList(): Promise<void>
  refreshModels(refresh?: boolean): Promise<void>
  open(id: string): Promise<void>
  newChat(folderId?: string | null): Promise<void>
  createFolder(name: string): Promise<void>
  renameFolder(id: string, name: string): Promise<void>
  toggleFolder(id: string): Promise<void>
  deleteFolder(id: string): Promise<void>
  moveChat(id: string, folderId: string | null): Promise<void>
  pinChat(id: string, pinned: boolean): Promise<void>
  /** Sends to the composer's target, or to `target` when given (a choice card sends to its own pane). */
  send(text: string, attachments?: Attachment[], target?: SendTarget): Promise<void>
  updateWorkspace(id: string, patch: WorkspacePatch): Promise<void>
  regenerate(nodeId: string, pane: Pane): Promise<void>
  switchBranch(nodeId: string, direction: -1 | 1, pane: Pane): Promise<void>
  deleteMessage(nodeId: string, kind: 'single' | 'below', pane: Pane): Promise<void>
  restoreDeletion(deletionId: string, pane?: Pane): Promise<void>
  refreshDeletions(): Promise<void>
  editMessage(nodeId: string, text: string, pane: Pane): Promise<void>
  dismissUndo(): void
  stop(target?: SendTarget): Promise<void>
  updateSettings(patch: Partial<ChatSettings>, pane?: Pane): Promise<void>
  cloneIntoSplit(nodeId?: string): Promise<void>
  closeSplit(keep: Pane): Promise<void>
  setTarget(target: SendTarget): void
  setMode(mode: Mode): void
  setDefaultModel(providerId: string, modelId: string): Promise<void>
  deleteChat(id: string): Promise<void>
  refreshTrash(): Promise<void>
  restoreChat(id: string): Promise<void>
  deleteForever(id: string): Promise<void>
  emptyTrash(): Promise<void>
  renameChat(id: string, title: string): Promise<void>
  applyDone(conversationId: string, node: NodeView): void
  setProviders(providers: ProviderConfig[]): void
  toggleSidebar(): void
  setSettingsOpen(open: boolean, section?: string): void
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

export const useStore = create<State>((set, get) => {
  /** Runs a conversation call and shows its result. */
  const withCurrent = async (fn: (id: string) => Promise<ConversationView>): Promise<void> => {
    const current = get().current
    if (!current) return
    const view = await guard(set, () => fn(current.id))
    if (view && get().current?.id === view.id) set({ current: view })
  }

  return {
    conversations: [],
    folders: [],
    trash: [],
    current: null,
    models: [],
    providers: [],
    defaults: null,
    target: 'both',
    mode: 'chat',
    sidebarOpen: true,
    settingsOpen: false,
    settingsSection: null,
    updates: null,
    error: null,
    deletions: [],
    undo: null,

    async init() {
      const [conversations, folders, providers, defaults] = await Promise.all([
        api.listConversations(),
        api.listFolders(),
        api.listProviders(),
        api.getDefaults()
      ])
      set({ conversations, folders, providers, defaults })
      window.twilight.onUpdate((updates) => set({ updates }))
      void api.getUpdateState().then((updates) => set({ updates }))
      void get().refreshTrash()
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
      if (view) {
        set({ current: view, undo: null })
        void get().refreshDeletions()
      }
    },

    async newChat(folderId = null) {
      const current = get().current
      // Reuse an untouched chat instead of piling up empty ones (moving it if needed).
      if (current && current.path.length === 0 && !current.split) {
        await api.moveConversation(current.id, folderId)
        await get().refreshList()
        return
      }
      const view = await guard(set, () => api.createConversation(folderId))
      if (!view) return
      set({ current: view, deletions: [], undo: null })
      await get().refreshList()
    },

    async createFolder(name) {
      set({ folders: await api.createFolder(name) })
    },
    async renameFolder(id, name) {
      set({ folders: await api.renameFolder(id, name) })
    },
    async toggleFolder(id) {
      const folder = get().folders.find((f) => f.id === id)
      if (folder) set({ folders: await api.setFolderCollapsed(id, !folder.collapsed) })
    },
    async deleteFolder(id) {
      set({ folders: await api.deleteFolder(id) })
      await get().refreshList()
    },
    async moveChat(id, folderId) {
      await api.moveConversation(id, folderId)
      await get().refreshList()
    },
    async pinChat(id, pinned) {
      await api.pinConversation(id, pinned)
      await get().refreshList()
    },

    async send(text, attachments = [], explicit) {
      if (!get().current) {
        await get().newChat()
        if (!get().current) return
      }
      const target = get().current!.split ? (explicit ?? get().target) : 'a'
      await withCurrent((id) => api.send(id, text, target, attachments))
      await get().refreshList()
    },

    async updateWorkspace(id, patch) {
      set({ folders: await api.updateWorkspace(id, patch) })
    },

    regenerate: (nodeId, pane) => withCurrent((id) => api.regenerate(id, nodeId, pane)),
    switchBranch: (nodeId, direction, pane) => withCurrent((id) => api.switchBranch(id, nodeId, direction, pane)),

    async deleteMessage(nodeId, kind, pane) {
      await withCurrent((id) => api.deleteMessage(id, nodeId, kind, pane))
      await get().refreshDeletions()
      const latest = get().deletions[0]
      if (latest) set({ undo: { deletionId: latest.id, pane, label: kind === 'below' ? `Deleted ${latest.count} messages` : 'Message deleted' } })
    },
    async restoreDeletion(deletionId, pane = 'a') {
      set({ undo: null })
      await withCurrent((id) => api.restoreDeletion(id, deletionId, pane))
      await get().refreshDeletions()
    },
    async refreshDeletions() {
      const current = get().current
      if (!current) return set({ deletions: [] })
      const deletions = await guard(set, () => api.listDeletions(current.id))
      if (deletions && get().current?.id === current.id) set({ deletions })
    },
    editMessage: (nodeId, text, pane) => withCurrent((id) => api.editMessage(id, nodeId, text, pane)),
    dismissUndo: () => set({ undo: null }),

    async stop(target = 'both') {
      const current = get().current
      if (current) await api.stop(current.id, target)
    },

    async updateSettings(patch, pane = 'a') {
      if (pane === 'a' && (patch.modelId || patch.providerId)) {
        const defaults = await api.setDefaults({
          ...(patch.modelId ? { modelId: patch.modelId } : {}),
          ...(patch.providerId ? { providerId: patch.providerId } : {})
        })
        set({ defaults })
      }
      await withCurrent((id) => api.updateChatSettings(id, patch, pane))
    },

    cloneIntoSplit: (nodeId) => withCurrent((id) => api.cloneIntoSplit(id, nodeId)),
    closeSplit: (keep) => withCurrent((id) => api.closeSplit(id, keep)),
    setTarget: (target) => set({ target }),
    setMode: (mode) => set({ mode }),
    async setDefaultModel(providerId, modelId) {
      set({ defaults: await api.setDefaults({ providerId, modelId }) })
    },

    async deleteChat(id) {
      await api.deleteConversation(id)
      const conversations = await api.listConversations()
      set({ conversations })
      await get().refreshTrash()
      if (get().current?.id === id) {
        set({ current: null, deletions: [], undo: null })
        if (conversations[0]) await get().open(conversations[0].id)
      }
    },

    async refreshTrash() {
      set({ trash: await api.listTrash() })
    },
    async restoreChat(id) {
      await api.restoreConversation(id)
      await Promise.all([get().refreshList(), get().refreshTrash()])
    },
    async deleteForever(id) {
      await api.deleteForever(id)
      await get().refreshTrash()
    },
    async emptyTrash() {
      await api.emptyTrash()
      await get().refreshTrash()
    },

    async renameChat(id, title) {
      await api.renameConversation(id, title)
      if (get().current?.id === id) set({ current: { ...get().current!, title } })
      await get().refreshList()
    },

    applyDone(conversationId, node) {
      const current = get().current
      if (current?.id === conversationId) {
        const swap = (path: NodeView[]): NodeView[] => path.map((n) => (n.id === node.id ? node : n))
        set({
          current: {
            ...current,
            path: swap(current.path),
            split: current.split ? { ...current.split, path: swap(current.split.path) } : null
          }
        })
      }
      clearStream(node.id)
      void get().refreshList()
    },

    setProviders: (providers) => set({ providers }),
    toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
    setSettingsOpen: (open, section) => set({ settingsOpen: open, settingsSection: section ?? null }),
    setError: (error) => set({ error })
  }
})

export function modelName(models: ModelInfo[], id: string | undefined): string {
  if (!id) return 'No model'
  const known = models.find((m) => m.id === id)?.name
  if (known) return known
  // Offline or before the model list loads: "claude-opus-5-5" reads as "Claude Opus 5.5".
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(id)
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id
}

/** What the selected model accepts; falls back to the provider's conventions before the list loads. */
export function optionsFor(models: ModelInfo[], providers: ProviderConfig[], providerId: string, modelId: string): ModelOptions {
  const known = models.find((m) => m.providerId === providerId && m.id === modelId)?.options
  if (known) return known
  const claude = providers.find((p) => p.id === providerId)?.kind === 'anthropic'
  return claude
    ? { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], effortParam: 'anthropic', effortsFromProvider: false, adaptiveThinking: true, temperature: false, caching: true }
    : { efforts: ['low', 'medium', 'high'], effortParam: 'reasoning_effort', effortsFromProvider: false, adaptiveThinking: false, temperature: true, caching: false }
}

/** The path and settings shown in a pane. */
export function paneOf(current: ConversationView, pane: Pane): { path: NodeView[]; settings: ChatSettings } {
  return pane === 'b' && current.split ? current.split : { path: current.path, settings: current.settings }
}
