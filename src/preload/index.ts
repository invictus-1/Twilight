import { contextBridge, ipcRenderer } from 'electron'
import type { InsightsEvent, StreamEvent, TwilightApi, UpdateState } from '@shared/types'
import type { CodeEvent } from '@shared/code'
import type { McpServerView } from '@shared/mcp'

const invoke =
  (name: keyof TwilightApi) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`twilight:${name}`, ...args)

const methods: Exclude<keyof TwilightApi, 'onStream' | 'onUpdate' | 'onInsights' | 'onCode' | 'onMcp'>[] = [
  'listRubrics',
  'saveRubric',
  'deleteRubric',
  'importRubric',
  'exportRubric',
  'listJudgments',
  'getJudgment',
  'runJudge',
  'runJudgeRound',
  'getLeaderboard',
  'stopJudge',
  'deleteJudgment',
  'listConversations',
  'createConversation',
  'listFolders',
  'createFolder',
  'renameFolder',
  'updateWorkspace',
  'pickAttachments',
  'getLibrary',
  'savePersona',
  'deletePersona',
  'savePrompt',
  'deletePrompt',
  'importLibrary',
  'exportLibrary',
  'listPresets',
  'savePreset',
  'deletePreset',
  'setFolderCollapsed',
  'deleteFolder',
  'moveConversation',
  'pinConversation',
  'listDocFolders',
  'createDocFolder',
  'moveDoc',
  'openConversation',
  'renameConversation',
  'deleteConversation',
  'listTrash',
  'restoreConversation',
  'deleteForever',
  'emptyTrash',
  'getRequestLogs',
  'setRequestLogs',
  'openLogsFolder',
  'updateChatSettings',
  'send',
  'regenerate',
  'deleteMessage',
  'listDeletions',
  'viewDeletion',
  'restoreDeletion',
  'editMessage',
  'switchBranch',
  'stop',
  'cloneIntoSplit',
  'closeSplit',
  'branchToNewChat',
  'getPrices',
  'setPrices',
  'usageStats',
  'copyText',
  'listCodeSessions',
  'listMcpServers',
  'getSpellcheck',
  'setSpellcheck',
  'getDataInfo',
  'listBackups',
  'backupNow',
  'setBackupSettings',
  'chooseBackupFolder',
  'openBackupFolder',
  'removeBackup',
  'restoreBackup',
  'moveData',
  'moveDataBack',
  'saveMcpServer',
  'deleteMcpServer',
  'testMcpServer',
  'respondToolApproval',
  'getImageConfig',
  'setImageConfig',
  'newCodeSession',
  'openCodeSession',
  'sendCode',
  'respondCode',
  'stopCode',
  'undoCode',
  'setCodeOptions',
  'deleteCodeSession',
  'getBackground',
  'chooseBackground',
  'clearBackground',
  'renameDoc',
  'renameDocFolder',
  'trashDocPath',
  'searchAll',
  'revealMessage',
  'listProviders',
  'saveProvider',
  'deleteProvider',
  'listModels',
  'testProvider',
  'getDefaults',
  'setDefaults',
  'getWritingFolder',
  'chooseWritingFolder',
  'listDocs',
  'readDoc',
  'writeDoc',
  'createDoc',
  'getDocContext',
  'setDocContext',
  'runWritingTool',
  'stopWritingTool',
  'getAppInfo',
  'openDataFolder',
  'openExternal',
  'setWindowTheme',
  'getWelcomed',
  'setWelcomed',
  'getUpdateState',
  'checkForUpdates',
  'setAutoUpdateCheck',
  'installVersion',
  'openBackupsFolder',
  'getInsights',
  'rescanInsights',
  'setCharacters',
  'getAiState',
  'setAiConfig',
  'estimateStory',
  'runStory',
  'runFocus',
  'runNotes',
  'stopAi',
  'forgetAiResult',
  'exportReport',
  'openReportsFolder'
]

const api = Object.fromEntries(methods.map((m) => [m, invoke(m)])) as unknown as TwilightApi
api.onStream = (listener: (event: StreamEvent) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, event: StreamEvent): void => listener(event)
  ipcRenderer.on('twilight:stream', handler)
  return () => ipcRenderer.off('twilight:stream', handler)
}

api.onUpdate = (listener: (state: UpdateState) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, state: UpdateState): void => listener(state)
  ipcRenderer.on('twilight:update', handler)
  return () => ipcRenderer.off('twilight:update', handler)
}

api.onMcp = (listener: (servers: McpServerView[]) => void) => {
  const handler = (_e: unknown, servers: McpServerView[]): void => listener(servers)
  ipcRenderer.on('twilight:mcp', handler)
  return () => ipcRenderer.removeListener('twilight:mcp', handler)
}

api.onCode = (listener: (event: CodeEvent) => void) => {
  const handler = (_e: unknown, event: CodeEvent): void => listener(event)
  ipcRenderer.on('twilight:code', handler)
  return () => ipcRenderer.removeListener('twilight:code', handler)
}

api.onInsights = (listener: (event: InsightsEvent) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, event: InsightsEvent): void => listener(event)
  ipcRenderer.on('twilight:insights', handler)
  return () => ipcRenderer.off('twilight:insights', handler)
}

contextBridge.exposeInMainWorld('twilight', api)
