import { contextBridge, ipcRenderer } from 'electron'
import type { StreamEvent, TwilightApi } from '@shared/types'

const invoke =
  (name: keyof TwilightApi) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`twilight:${name}`, ...args)

const methods: Exclude<keyof TwilightApi, 'onStream'>[] = [
  'listConversations',
  'createConversation',
  'listFolders',
  'createFolder',
  'renameFolder',
  'updateWorkspace',
  'pickAttachments',
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
  'switchBranch',
  'stop',
  'cloneIntoSplit',
  'closeSplit',
  'listProviders',
  'saveProvider',
  'deleteProvider',
  'listModels',
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
  'openExternal'
]

const api = Object.fromEntries(methods.map((m) => [m, invoke(m)])) as unknown as TwilightApi
api.onStream = (listener: (event: StreamEvent) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, event: StreamEvent): void => listener(event)
  ipcRenderer.on('twilight:stream', handler)
  return () => ipcRenderer.off('twilight:stream', handler)
}

contextBridge.exposeInMainWorld('twilight', api)
