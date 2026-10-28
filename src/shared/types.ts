// Types shared by the main process, the preload bridge and the renderer.

export type ProviderKind = 'anthropic' | 'openai'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  name: string
  /** OpenAI-compatible servers only, e.g. http://localhost:11434/v1 */
  baseUrl?: string
  enabled: boolean
  /** True when an API key is stored (the key itself never leaves the main process). */
  hasKey?: boolean
}

export interface ModelInfo {
  id: string
  providerId: string
  name: string
  local: boolean
  contextWindow?: number
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CacheTtl = '5m' | '1h'

export interface ChatSettings {
  providerId: string
  modelId: string
  /** Frozen once the first message is sent, so the cached prefix never changes. */
  systemPrompt: string
  /** null = the model's default. */
  effort: Effort | null
  cacheTtl: CacheTtl
  showThinking: boolean
  /** OpenAI-compatible (local) models only; the Claude API no longer accepts sampling parameters. */
  temperature: number | null
  maxTokens: number
}

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  ms: number
  /** TTL the cache writes were billed at. */
  cacheTtl?: CacheTtl
}

export type NodeStatus = 'done' | 'streaming' | 'error' | 'stopped'

export interface NodeView {
  id: string
  parentId: string | null
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  modelId?: string
  providerId?: string
  usage?: Usage
  status: NodeStatus
  error?: string
  createdAt: number
  siblingIndex: number
  siblingCount: number
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  modelId: string
  folderId: string | null
  pinned: boolean
}

/** A sidebar folder of chats (Twilight's own; chat folders don't exist on disk). */
export interface ChatFolder {
  id: string
  name: string
  collapsed: boolean
}

/** Split compare: A is the conversation's main thread, B a second branch of the same tree. */
export type Pane = 'a' | 'b'
export type SendTarget = Pane | 'both'

export interface PaneView {
  settings: ChatSettings
  path: NodeView[]
}

export interface ConversationView {
  id: string
  title: string
  settings: ChatSettings
  /** True once the system prompt is frozen into the conversation. */
  started: boolean
  path: NodeView[]
  /** Pane B while split compare is open. */
  split: PaneView | null
}

export type StreamEvent =
  | { kind: 'text'; conversationId: string; nodeId: string; delta: string }
  | { kind: 'thinking'; conversationId: string; nodeId: string; delta: string }
  | { kind: 'done'; conversationId: string; nodeId: string; node: NodeView }

/** A markdown file in the writing folder. `path` is relative to the folder, with forward slashes. */
export interface DocEntry {
  path: string
  name: string
  mtime: number
  size: number
}

export interface DocContent {
  path: string
  text: string
  mtime: number
}

/** A writing-tool run on a selected passage. */
export interface WritingRequest {
  instruction: string
  passage: string
  before: string
  after: string
  title: string
}

export interface TwilightApi {
  listConversations(): Promise<ConversationSummary[]>
  createConversation(folderId?: string | null): Promise<ConversationView>
  listFolders(): Promise<ChatFolder[]>
  createFolder(name: string): Promise<ChatFolder[]>
  renameFolder(id: string, name: string): Promise<ChatFolder[]>
  setFolderCollapsed(id: string, collapsed: boolean): Promise<ChatFolder[]>
  /** Deletes the folder only; its chats move back to Recent. */
  deleteFolder(id: string): Promise<ChatFolder[]>
  moveConversation(id: string, folderId: string | null): Promise<void>
  pinConversation(id: string, pinned: boolean): Promise<void>
  openConversation(id: string): Promise<ConversationView>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  updateChatSettings(id: string, patch: Partial<ChatSettings>, pane?: Pane): Promise<ConversationView>
  send(id: string, text: string, target?: SendTarget): Promise<ConversationView>
  regenerate(id: string, assistantNodeId: string, pane?: Pane): Promise<ConversationView>
  switchBranch(id: string, nodeId: string, direction: -1 | 1, pane?: Pane): Promise<ConversationView>
  stop(id: string, target?: SendTarget): Promise<void>
  /** Opens split compare with pane B as a copy of pane A at `nodeId` (default: A's latest message). */
  cloneIntoSplit(id: string, nodeId?: string): Promise<ConversationView>
  /** Closes split compare, continuing on the kept pane's branch. */
  closeSplit(id: string, keep: Pane): Promise<ConversationView>
  onStream(listener: (event: StreamEvent) => void): () => void

  listProviders(): Promise<ProviderConfig[]>
  saveProvider(config: ProviderConfig, apiKey?: string): Promise<ProviderConfig[]>
  deleteProvider(id: string): Promise<ProviderConfig[]>
  listModels(refresh?: boolean): Promise<ModelInfo[]>
  getDefaults(): Promise<ChatSettings>
  setDefaults(patch: Partial<ChatSettings>): Promise<ChatSettings>

  getWritingFolder(): Promise<string>
  chooseWritingFolder(): Promise<string | null>
  listDocs(): Promise<DocEntry[]>
  /** Every subfolder of the writing folder (relative paths), empty ones included. */
  listDocFolders(): Promise<string[]>
  createDocFolder(path: string): Promise<string>
  /** Moves a document into `folder` ('' = the top level); never overwrites. Returns its new path. */
  moveDoc(path: string, folder: string): Promise<string>
  readDoc(path: string): Promise<DocContent>
  /** Saves atomically; returns the new modified time. */
  writeDoc(path: string, text: string): Promise<number>
  createDoc(name: string, folder?: string): Promise<DocEntry>
  /** Streams a rewrite of the passage as StreamEvents with conversationId "writing" and nodeId = requestId. */
  runWritingTool(requestId: string, request: WritingRequest): Promise<void>
  stopWritingTool(requestId: string): Promise<void>

  openExternal(url: string): Promise<void>
}
