// Types shared by the main process, the preload bridge and the renderer.

import type { JudgeInput, Judgment, JudgmentSummary, Rubric } from './judge'

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
  /** Models hidden from the model picker (still listed on the Providers page). */
  hiddenModels?: string[]
  /** Your own names for models, by model id. */
  labels?: Record<string, string>
  /** Model ids added by hand (for servers that don't list everything). */
  customModels?: string[]
  /** The last time Twilight talked to this provider, and how it went. */
  status?: ProviderStatus
}

export interface ProviderStatus {
  ok: boolean
  /** "12 models" or the provider's own error message. */
  message: string
  at: number
}

/**
 * What a model accepts, fetched from the provider where it says (the Anthropic Models API reports
 * effort levels and thinking modes per model) and filled from known conventions where it doesn't.
 */
export interface ModelOptions {
  /** Effort / reasoning levels in the provider's own names, in order; empty if not supported. */
  efforts: string[]
  /** How the effort is sent: Anthropic output_config.effort, OpenAI reasoning_effort, OpenRouter reasoning.effort. */
  effortParam: 'anthropic' | 'reasoning_effort' | 'openrouter' | null
  /** The level used when none is chosen, when known. */
  defaultEffort?: string
  /** Whether effort levels came from the provider itself rather than a convention. */
  effortsFromProvider: boolean
  /** Adaptive thinking (Claude) with a summarized/omitted display choice. */
  adaptiveThinking: boolean
  temperature: boolean
  /** Largest output in tokens, when known. */
  maxOutput?: number
  caching: boolean
}

export interface ModelInfo {
  id: string
  providerId: string
  name: string
  local: boolean
  contextWindow?: number
  options?: ModelOptions
  /** Abilities the provider reports for this model (Vision, Thinking, Tools, PDF input…). */
  capabilities?: string[]
  /** Hidden from the model picker (Providers page setting). */
  hidden?: boolean
  /** The provider's own name for the model, when a custom label replaced it. */
  originalName?: string
  /** Added by hand rather than listed by the provider. */
  custom?: boolean
}

export type CacheTtl = '5m' | '1h'

export interface ChatSettings {
  providerId: string
  modelId: string
  /** Sent with every request. Editable any time; a change restarts the prompt cache. */
  systemPrompt: string
  /** The provider's own level name (e.g. "high"); null = the model's default. */
  effort: string | null
  /** Claude: return a readable summary of the thinking, or nothing. */
  thinkingDisplay: 'summarized' | 'omitted'
  caching: boolean
  cacheTtl: CacheTtl
  showThinking: boolean
  /** Only for models that accept it; the Claude API no longer takes sampling parameters. */
  temperature: number | null
  /** null = the largest the model allows (capped at 64k for Claude), or the server default. */
  maxTokens: number | null
  /** Send only the latest N messages; null = the whole conversation. */
  messageLimit: number | null
  /** JSON merged into the request body last, for anything the panel doesn't cover. */
  extraParams: string
  /** Text-adventure choice cards: the model offers numbered options to click (see shared/choices.ts). */
  choiceCards: boolean
}

/** A saved set of model settings. */
export interface SettingsPreset {
  name: string
  settings: Partial<ChatSettings>
}

/** A file attached to a message; its text is injected into that message in full. */
export interface Attachment {
  name: string
  text: string
}

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  ms: number
  /** TTL the cache writes were billed at. */
  cacheTtl?: CacheTtl
  /** Time to the first streamed token, for tokens-per-second. */
  ttftMs?: number
}

/** A deleted message (or message and everything below it), restorable from "Recently deleted". */
export interface DeletionView {
  id: string
  kind: 'single' | 'below'
  createdAt: number
  role: 'user' | 'assistant'
  preview: string
  /** How many messages it took out. */
  count: number
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
  /** Files attached to a user message (their text is part of the message sent). */
  attachments?: { name: string; chars: number }[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  modelId: string
  folderId: string | null
  pinned: boolean
  /** Set for chats in the trash. */
  deletedAt?: number
}

/**
 * A workspace: a sidebar group of chats with its own defaults. New chats started in it take its
 * system prompt and model. (Twilight's own; nothing on disk.)
 */
export interface ChatFolder {
  id: string
  name: string
  collapsed: boolean
  description: string
  /** A design-system accent token name, e.g. "iris", or "" for none. */
  color: string
  systemPrompt: string
  providerId: string | null
  modelId: string | null
  /** Put the workspace name and description at the top of new chats' system prompt. */
  includeContext: boolean
}

export type WorkspacePatch = Partial<Omit<ChatFolder, 'id'>>

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
  /** True once the first message has been sent. */
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

/** What the writing tools know about a document, beyond the passage itself. */
export interface DocContext {
  /** The writer's standing instructions for this document (voice, rules, style). */
  instructions: string
  /** Other documents sent in full as reference: a character bible, an outline. */
  references: string[]
  /** Send the whole manuscript instead of the text around the passage. */
  wholeManuscript: boolean
}

/** A writing-tool run on a selected passage. */
export interface WritingRequest {
  docPath: string
  instruction: string
  passage: string
  before: string
  after: string
  /** The full current text, sent only when the document's context asks for the whole manuscript. */
  manuscript?: string
}

export interface TwilightApi {
  listRubrics(): Promise<Rubric[]>
  saveRubric(rubric: Rubric): Promise<Rubric[]>
  deleteRubric(id: string): Promise<Rubric[]>
  listJudgments(): Promise<JudgmentSummary[]>
  getJudgment(id: string): Promise<Judgment>
  /** Starts judging; runs stream as StreamEvents with conversationId "judge" and nodeId "<judgment id>:<run index>". */
  runJudge(input: JudgeInput): Promise<Judgment>
  stopJudge(id: string): Promise<void>
  deleteJudgment(id: string): Promise<void>

  listConversations(): Promise<ConversationSummary[]>
  createConversation(folderId?: string | null): Promise<ConversationView>
  listFolders(): Promise<ChatFolder[]>
  createFolder(name: string): Promise<ChatFolder[]>
  renameFolder(id: string, name: string): Promise<ChatFolder[]>
  updateWorkspace(id: string, patch: WorkspacePatch): Promise<ChatFolder[]>
  setFolderCollapsed(id: string, collapsed: boolean): Promise<ChatFolder[]>
  /** Deletes the folder only; its chats move back to Recent. */
  deleteFolder(id: string): Promise<ChatFolder[]>
  moveConversation(id: string, folderId: string | null): Promise<void>
  pinConversation(id: string, pinned: boolean): Promise<void>
  openConversation(id: string): Promise<ConversationView>
  renameConversation(id: string, title: string): Promise<void>
  /** Moves the chat to the trash. */
  deleteConversation(id: string): Promise<void>
  listTrash(): Promise<ConversationSummary[]>
  restoreConversation(id: string): Promise<void>
  /** Permanent: only for chats already in the trash. */
  deleteForever(id: string): Promise<void>
  emptyTrash(): Promise<void>
  getRequestLogs(): Promise<{ enabled: boolean; folder: string }>
  setRequestLogs(enabled: boolean): Promise<void>
  openLogsFolder(): Promise<void>
  updateChatSettings(id: string, patch: Partial<ChatSettings>, pane?: Pane): Promise<ConversationView>
  send(id: string, text: string, target?: SendTarget, attachments?: Attachment[]): Promise<ConversationView>
  /** Opens a file picker; returns the chosen text files' contents. */
  pickAttachments(): Promise<Attachment[]>
  listPresets(): Promise<SettingsPreset[]>
  savePreset(preset: SettingsPreset): Promise<SettingsPreset[]>
  deletePreset(name: string): Promise<SettingsPreset[]>
  regenerate(id: string, assistantNodeId: string, pane?: Pane): Promise<ConversationView>
  /** Deletes a message ("single": its replies move up to take its place) or it and everything below. */
  deleteMessage(id: string, nodeId: string, kind: 'single' | 'below', pane?: Pane): Promise<ConversationView>
  listDeletions(id: string): Promise<DeletionView[]>
  /** The messages a deletion took out, read-only. */
  viewDeletion(id: string, deletionId: string): Promise<NodeView[]>
  restoreDeletion(id: string, deletionId: string, pane?: Pane): Promise<ConversationView>
  /** Edits a message as a new version: a user message gets a fresh reply; a reply is saved as written. */
  editMessage(id: string, nodeId: string, text: string, pane?: Pane): Promise<ConversationView>
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
  /** Asks the provider for its models right now; returns the outcome (and remembers it). */
  testProvider(id: string): Promise<ProviderStatus>
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
  getDocContext(path: string): Promise<DocContext>
  setDocContext(path: string, context: DocContext): Promise<void>
  /** Streams a rewrite of the passage as StreamEvents with conversationId "writing" and nodeId = requestId. */
  runWritingTool(requestId: string, request: WritingRequest): Promise<void>
  stopWritingTool(requestId: string): Promise<void>

  getAppInfo(): Promise<{ version: string; dataFolder: string; electron: string }>
  openDataFolder(): Promise<void>
  openExternal(url: string): Promise<void>
}
