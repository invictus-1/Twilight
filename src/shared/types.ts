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
}

export interface ConversationView {
  id: string
  title: string
  settings: ChatSettings
  /** True once the system prompt is frozen into the conversation. */
  started: boolean
  path: NodeView[]
}

export type StreamEvent =
  | { kind: 'text'; conversationId: string; nodeId: string; delta: string }
  | { kind: 'thinking'; conversationId: string; nodeId: string; delta: string }
  | { kind: 'done'; conversationId: string; nodeId: string; node: NodeView }

export interface TwilightApi {
  listConversations(): Promise<ConversationSummary[]>
  createConversation(): Promise<ConversationView>
  openConversation(id: string): Promise<ConversationView>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  updateChatSettings(id: string, patch: Partial<ChatSettings>): Promise<ConversationView>
  send(id: string, text: string): Promise<ConversationView>
  regenerate(id: string, assistantNodeId: string): Promise<ConversationView>
  switchBranch(id: string, nodeId: string, direction: -1 | 1): Promise<ConversationView>
  stop(id: string): Promise<void>
  onStream(listener: (event: StreamEvent) => void): () => void

  listProviders(): Promise<ProviderConfig[]>
  saveProvider(config: ProviderConfig, apiKey?: string): Promise<ProviderConfig[]>
  deleteProvider(id: string): Promise<ProviderConfig[]>
  listModels(refresh?: boolean): Promise<ModelInfo[]>
  getDefaults(): Promise<ChatSettings>
  setDefaults(patch: Partial<ChatSettings>): Promise<ChatSettings>

  openExternal(url: string): Promise<void>
}
