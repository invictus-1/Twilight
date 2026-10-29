// Types shared by the main process, the preload bridge and the renderer.

import type { AttachmentKind } from './attachments'
import type { Theme } from './themes'
import type { CodeEvent, CodeMode, CodeResponse, CodeSessionSummary, CodeSessionView } from './code'
import type { BackupInfo, BackupSettings, DataInfo } from './backups'
import type { LibraryHit, LibrarySettings, LibraryStatus } from './docLibrary'
import type { GeneratedImage, ImageConfig, McpServerInput, McpServerView, ToolApproval, ToolApprovalResponse, ToolStep } from './mcp'
import type { CustomPrice } from './pricing'
import type { ChoiceSet } from './choices'
import type { AiConfig, AiState, InsightsSummary, StoryEstimate, TrackedCharacter } from './insights'
import type { JudgeInput, Judgment, JudgmentSummary, Leaderboard, Rubric } from './judge'
import type { Library, Persona, SavedPrompt } from './library'

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
  /** The models you chose to show in the picker; anything else the provider lists starts hidden. */
  shownModels?: string[]
  /** Older setting (before models started hidden): models hidden from the picker. */
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
  /** The model answers with pictures (OpenRouter lists it); they're asked for and kept with the reply. */
  imageOutput?: boolean
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
  /** Each way of offering choices has its own switch, so only the ones you use are active. */
  /** Send the present_choices tool; the model calls it with the options as data. */
  choiceTool: boolean
  /** Read ```choices blocks written in the reply. */
  choiceFenced: boolean
  /** Read plain numbered options at the end of the reply (a title that asks, or "Something else"). */
  choicePlain: boolean
  /** Add Twilight's short how-to to the system prompt: for the tool if it's on, else for choices blocks. */
  choiceInstructions: boolean
  /** Let the model search the web (Claude's server tool, or OpenRouter's web plugin). */
  webSearch: boolean
  /** Let the model read a web page in full (Claude only). */
  webFetch: boolean
  /** Put the local date, time and time zone at the front of each new message. */
  dateTime: boolean
  /** MCP servers (by id) whose tools this chat offers. */
  mcpServers: string[]
  /** Offer the generate_image tool (pictures from the image model in Settings → Tools). */
  imageGen: boolean
  /** Add passages from the document library to each message (and let tool-using models search it). */
  library: boolean
  /**
   * Instructions to add from the next message on. They go into that message (not the system
   * prompt), so the cached conversation before it stays valid.
   */
  pendingInstruction: string
  /**
   * System prompts this chat (pane) used before, each with when it was replaced, oldest first, so
   * replies written under one can show it and it's never lost.
   */
  promptHistory?: { text: string; until: number }[]
}

/** A saved set of model settings. */
export interface SettingsPreset {
  name: string
  settings: Partial<ChatSettings>
}

/**
 * A file attached to a message. A text file's text goes into the message in full; an image or PDF
 * goes as the file itself (base64), for models that read them natively.
 */
export interface Attachment {
  name: string
  text: string
  kind?: AttachmentKind
  mediaType?: string
  data?: string
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
  /** How long the model thought before its first words, when it thought. */
  thinkMs?: number
  /** What the provider itself says the reply cost (OpenRouter), used before any price list. */
  costUsd?: number
  /** Web searches Claude ran for the reply, billed per search on top of tokens. */
  webSearches?: number
}

/** Settings → Usage: how far back the numbers go. */
export type UsageRange = '7d' | '30d' | '12m' | 'all'

export interface UsageTotals {
  requests: number
  /** Every prompt token, cache reads and writes included. */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** USD, over the requests with a known price. */
  cost: number
  /** Requests whose model has no price (they add tokens but nothing to cost). */
  unpriced: number
}

/** One bar of the chart: a day, or a month for 12 months and all time. */
export interface UsageBucket {
  /** "2026-10-28", or "2026-10" for a month. */
  key: string
  requests: number
  /** Input and output together. */
  tokens: number
  cost: number
}

export interface UsageStats {
  range: UsageRange
  unit: 'day' | 'month'
  /** Start of the range (local midnight or the first of a month); 0 for all time. */
  since: number
  /** Chats and the Judge together. */
  totals: UsageTotals
  series: UsageBucket[]
  /** Most spent first. */
  models: (UsageTotals & { providerId: string; modelId: string })[]
  /** The chats that spent most, trashed ones included and marked. */
  chats: (UsageTotals & { id: string; title: string; trashed: boolean })[]
  /** Judge runs, which belong to no chat. */
  judge: UsageTotals
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
  attachments?: { name: string; chars: number; kind?: AttachmentKind; bytes?: number }[]
  /** Choices the model offered with a present_choices tool call. */
  toolChoices?: ChoiceSet
  /** Instructions added mid-chat with this message. */
  instructionUpdate?: string
  /** The date and time sent along with this message, as the model read it. */
  dateTime?: string
  /** What the reply searched for and read on the web, and the sources it cited. */
  web?: WebActivity
  /** Tools Twilight ran during the reply (MCP servers, pictures). */
  tools?: ToolStep[]
  /** Pictures made during the reply. */
  images?: GeneratedImage[]
  /** Passages from the document library that went with a message of yours. */
  library?: { source: string; line: number }[]
}

/** A page the model found or read. */
export interface WebSource {
  url: string
  title: string
}

/** One search or page read during a reply. */
export interface WebStep {
  kind: 'search' | 'fetch'
  /** The search terms, or the page's address. Empty for a search the provider ran by itself. */
  query: string
  sources: WebSource[]
  /** Set when the search or read failed (the API's error code). */
  error?: string
}

export interface WebActivity {
  steps: WebStep[]
  /** Cited sources, numbered in order of first citation. */
  cited: WebSource[]
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
  /** New chats start with choice cards on (for text-adventure workspaces). */
  choiceCards: boolean
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

/** A published version on the releases repo. */
export interface ReleaseInfo {
  version: string
  name: string
  /** Release notes, markdown. */
  notes: string
  publishedAt: number
  url: string
  installer: { name: string; size: number; url: string } | null
  /** electron-builder's latest.yml, which carries the installer's sha512. */
  checksumUrl: string | null
}

export interface UpdateState {
  current: string
  /** Versions this install has run as, oldest first, with when each started. */
  history: { version: string; installedAt: number }[]
  autoCheck: boolean
  lastChecked: number | null
  checking: boolean
  error: string | null
  /** Newest first. */
  releases: ReleaseInfo[]
  /** The newest version above the current one, if any. */
  latest: string | null
  downloading: { version: string; received: number; total: number } | null
  /** Versions whose installer is already on disk. */
  cached: string[]
  /** False in a dev build: installers download but don't run. */
  canInstall: boolean
  releasesPage: string
}

export type InsightsEvent =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'updated' }
  | { kind: 'unlocked'; names: string[] }
  | { kind: 'ai'; state: AiState }

export type StreamEvent =
  | { kind: 'text'; conversationId: string; nodeId: string; delta: string }
  | { kind: 'thinking'; conversationId: string; nodeId: string; delta: string }
  /** A search or page read started while the reply streams ("Searching: …"). */
  | { kind: 'activity'; conversationId: string; nodeId: string; label: string }
  /** The reply waits for your approval of a tool call (null once answered). */
  | { kind: 'approval'; conversationId: string; nodeId: string; approval: ToolApproval | null }
  /** A reply finished; `asked` is your message when something was added to it (library passages). */
  | { kind: 'done'; conversationId: string; nodeId: string; node: NodeView; asked?: NodeView }

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

/** A stretch of text around a search match, the match itself kept apart for highlighting. */
export interface Snippet {
  before: string
  match: string
  after: string
}

export type SearchHit =
  | { kind: 'chat'; conversationId: string; nodeId: string; title: string; role: 'user' | 'assistant'; at: number; snippet: Snippet }
  | { kind: 'doc'; path: string; count: number; line: number; snippet: Snippet }

export interface SearchResults {
  query: string
  chats: SearchHit[]
  docs: SearchHit[]
  /** Matches found, which can be more than the hits returned. */
  chatTotal: number
  docTotal: number
  ms: number
}

export interface TwilightApi {
  listRubrics(): Promise<Rubric[]>
  saveRubric(rubric: Rubric): Promise<Rubric[]>
  deleteRubric(id: string): Promise<Rubric[]>
  /** Picks a rubric file and saves it as one of yours; null if cancelled. */
  importRubric(): Promise<{ rubrics: Rubric[]; id: string } | null>
  /** Saves a rubric to a file you choose; false if cancelled. */
  exportRubric(id: string): Promise<boolean>
  listJudgments(): Promise<JudgmentSummary[]>
  getJudgment(id: string): Promise<Judgment>
  /** Starts judging; runs stream as StreamEvents with conversationId "judge" and nodeId "<judgment id>:<run index>". */
  runJudge(input: JudgeInput): Promise<Judgment>
  /** Three or more passages (A, B and input.morePassages): starts one judgment per pair, sharing a round id. */
  runJudgeRound(input: JudgeInput): Promise<{ roundId: string; judgments: Judgment[] }>
  /** The tally by passage label across every finished judgment, or just one round's. */
  getLeaderboard(roundId?: string | null): Promise<Leaderboard>
  stopJudge(id: string): Promise<void>
  deleteJudgment(id: string): Promise<void>

  listConversations(): Promise<ConversationSummary[]>
  /**
   * A new chat from the defaults, its workspace's and then the persona's (when given). `reuseId` names
   * an untouched chat to set up instead of making another.
   */
  createConversation(folderId?: string | null, personaId?: string | null, reuseId?: string | null): Promise<ConversationView>
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
  /** Your personas and prompts (Settings → Library). */
  getLibrary(): Promise<Library>
  savePersona(persona: Persona): Promise<Library>
  deletePersona(id: string): Promise<Library>
  savePrompt(prompt: SavedPrompt): Promise<Library>
  deletePrompt(id: string): Promise<Library>
  /** Picks a library file and adds what it holds; null if cancelled. */
  importLibrary(): Promise<{ library: Library; added: number } | null>
  /** Saves the library (or only the items with these ids) to a file you choose; false if cancelled. */
  exportLibrary(ids?: string[]): Promise<boolean>
  listPresets(): Promise<SettingsPreset[]>
  savePreset(preset: SettingsPreset): Promise<SettingsPreset[]>
  deletePreset(name: string): Promise<SettingsPreset[]>
  /** Each model's own defaults (see shared/modelDefaults.ts). */
  listModelDefaults(): Promise<Record<string, Partial<ChatSettings>>>
  /** Saves a model's defaults, or clears them with null. */
  setModelDefaults(providerId: string, modelId: string, settings: Partial<ChatSettings> | null): Promise<Record<string, Partial<ChatSettings>>>
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
  /** A new chat with this conversation up to `nodeId` (the pane's settings, same workspace); returns it. */
  branchToNewChat(id: string, nodeId: string, pane?: Pane): Promise<ConversationView>
  onStream(listener: (event: StreamEvent) => void): () => void
  /** Every chat message and document containing the text (case-insensitive, two letters or more). */
  searchAll(query: string): Promise<SearchResults>
  /** Makes a message part of the chat's shown thread (switching versions above it as needed). */
  revealMessage(id: string, nodeId: string): Promise<ConversationView>

  listProviders(): Promise<ProviderConfig[]>
  saveProvider(config: ProviderConfig, apiKey?: string): Promise<ProviderConfig[]>
  deleteProvider(id: string): Promise<ProviderConfig[]>
  listModels(refresh?: boolean): Promise<ModelInfo[]>
  /** Asks the provider for its models right now; returns the outcome (and remembers it). */
  testProvider(id: string): Promise<ProviderStatus>
  // ——— Tools: MCP servers and pictures ———
  listMcpServers(): Promise<McpServerView[]>
  saveMcpServer(server: McpServerInput): Promise<McpServerView[]>
  deleteMcpServer(id: string): Promise<McpServerView[]>
  /** Connects to the server and lists its tools; the outcome is in its status. */
  testMcpServer(id: string): Promise<McpServerView[]>
  /** Your answer to a tool call a reply is waiting on. */
  respondToolApproval(id: string, response: ToolApprovalResponse): Promise<void>
  getImageConfig(): Promise<ImageConfig | null>
  setImageConfig(config: ImageConfig | null): Promise<ImageConfig | null>
  onMcp(listener: (servers: McpServerView[]) => void): () => void
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
  /** Renames a document in its folder; never overwrites. Returns its new path. */
  renameDoc(path: string, name: string): Promise<string>
  /** Renames a document folder; never overwrites. Returns its new path. */
  renameDocFolder(path: string, name: string): Promise<string>
  /** Sends a document or a folder (and everything in it) to the Recycle Bin. */
  trashDocPath(path: string, kind: 'doc' | 'folder'): Promise<void>
  readDoc(path: string): Promise<DocContent>
  /** Saves atomically; returns the new modified time. */
  writeDoc(path: string, text: string): Promise<number>
  createDoc(name: string, folder?: string): Promise<DocEntry>
  getDocContext(path: string): Promise<DocContext>
  setDocContext(path: string, context: DocContext): Promise<void>
  /** Streams a rewrite of the passage as StreamEvents with conversationId "writing" and nodeId = requestId. */
  runWritingTool(requestId: string, request: WritingRequest): Promise<void>
  stopWritingTool(requestId: string): Promise<void>

  /** Your own prices, per million tokens (see shared/pricing.ts). */
  getPrices(): Promise<CustomPrice[]>
  setPrices(list: CustomPrice[]): Promise<CustomPrice[]>
  /** Tokens and spend over a range: totals, a series, and splits by model and by chat. */
  usageStats(range: UsageRange): Promise<UsageStats>
  getAppInfo(): Promise<{ version: string; dataFolder: string; electron: string }>
  // ——— Document library ———
  getDocLibrary(): Promise<{ settings: LibrarySettings; status: LibraryStatus }>
  setDocLibrarySettings(patch: Partial<LibrarySettings>): Promise<LibrarySettings>
  /** Asks for a folder to add; null if cancelled. */
  addDocLibraryFolder(): Promise<LibrarySettings | null>
  removeDocLibraryFolder(path: string): Promise<LibrarySettings>
  reindexDocLibrary(): Promise<LibraryStatus>
  searchDocLibrary(query: string): Promise<LibraryHit[]>
  onDocLibrary(listener: (status: LibraryStatus) => void): () => void
  /** Spelling checked as you type (Windows' own spellchecker; right-click a word for suggestions). */
  getSpellcheck(): Promise<boolean>
  setSpellcheck(on: boolean): Promise<boolean>
  // ——— Data: backups and where it lives ———
  getDataInfo(): Promise<DataInfo>
  listBackups(): Promise<BackupInfo[]>
  backupNow(): Promise<BackupInfo>
  setBackupSettings(patch: Partial<BackupSettings>): Promise<DataInfo>
  chooseBackupFolder(): Promise<DataInfo>
  openBackupFolder(): Promise<void>
  /** Sends a backup to the Recycle Bin. */
  removeBackup(path: string): Promise<BackupInfo[]>
  /** Backs up what's there, then restarts into the backup. */
  restoreBackup(path: string): Promise<void>
  /** Asks for a folder and restarts to move the data there; returns why not, or null if cancelled. */
  moveData(): Promise<string | null>
  moveDataBack(): Promise<string | null>
  openDataFolder(): Promise<void>
  openExternal(url: string): Promise<void>
  /** Your background picture's version stamp (served as twilight-bg://image), or null. */
  getBackground(): Promise<string | null>
  /** Picks a picture and copies it in as the background; returns its stamp, or null if cancelled. */
  chooseBackground(): Promise<string | null>
  clearBackground(): Promise<void>
  // ——— Code ———
  listCodeSessions(): Promise<CodeSessionSummary[]>
  /** Asks for a project folder and starts a session in it; null if cancelled. */
  newCodeSession(): Promise<CodeSessionView | null>
  openCodeSession(id: string): Promise<CodeSessionView>
  sendCode(id: string, text: string): Promise<CodeSessionView>
  /** Your answer to the approval or question the agent is waiting on. */
  respondCode(id: string, pendingId: string, response: CodeResponse): Promise<void>
  stopCode(id: string): Promise<void>
  /** Undoes the newest change still in place, or every one. */
  undoCode(id: string, all: boolean): Promise<CodeSessionView>
  setCodeOptions(id: string, patch: { mode?: CodeMode; providerId?: string; modelId?: string; web?: boolean }): Promise<CodeSessionView>
  /** Goes back to just before one of your messages (files put back, conversation cut); returns that message. */
  rewindCode(id: string, entryIndex: number): Promise<{ view: CodeSessionView; text: string }>
  deleteCodeSession(id: string): Promise<void>
  onCode(listener: (event: CodeEvent) => void): () => void
  /** Puts text on the clipboard from the main process (works whether or not the window has focus). */
  copyText(text: string): Promise<void>
  /** Matches the window frame and title bar to a theme. */
  setWindowTheme(theme: Theme | 'custom', frame?: { night: string; symbol: string }): Promise<void>
  /** Whether the first-run welcome has been seen (or skipped). */
  getWelcomed(): Promise<boolean>
  setWelcomed(): Promise<void>

  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  setAutoUpdateCheck(on: boolean): Promise<UpdateState>
  /** Installs any listed version, newer or older; Twilight closes and the installer takes over. */
  installVersion(version: string): Promise<UpdateState>
  openBackupsFolder(): Promise<void>

  getInsights(): Promise<InsightsSummary>
  rescanInsights(): Promise<InsightsSummary>
  setCharacters(list: TrackedCharacter[]): Promise<InsightsSummary>
  onInsights(listener: (event: InsightsEvent) => void): () => void
  getAiState(): Promise<AiState>
  setAiConfig(config: AiConfig): Promise<AiState>
  estimateStory(mode: 'quick' | 'deep', scope: string): Promise<StoryEstimate>
  runStory(mode: 'quick' | 'deep', scope: string): Promise<AiState>
  runFocus(): Promise<AiState>
  runNotes(): Promise<AiState>
  stopAi(): Promise<void>
  /** Removes one earlier AI result from the history. */
  forgetAiResult(kind: 'story' | 'focus' | 'notes', at: number): Promise<AiState>
  /** Saves a recap as an HTML file (and opens it when asked); returns its path. */
  exportReport(kind: 'week' | 'month' | 'year' | 'all', includeAi: boolean, open: boolean): Promise<string>
  openReportsFolder(): Promise<void>
  onUpdate(listener: (state: UpdateState) => void): () => void
}
