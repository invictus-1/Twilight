import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  Attachment,
  ChatFolder,
  ConversationSummary,
  DocContext,
  Pane,
  SendTarget,
  SettingsPreset,
  TwilightApi,
  WorkspacePatch,
  WritingRequest
} from '@shared/types'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
import * as judge from './judge'
import * as logs from './logs'
import * as workspaces from './workspaces'
import type { JudgeInput, Rubric } from '@shared/judge'
import * as writing from './writing'
import * as providers from './providers'
import { runE2E } from './e2e'
import { prepareSelfTest, runSelfTest, seedSelfTest } from './selftest'

const devUrl = process.env.ELECTRON_RENDERER_URL
const selfTestDir = process.env.TWILIGHT_SELFTEST
const e2eDir = process.env.TWILIGHT_E2E
if (selfTestDir || e2eDir) prepareSelfTest((selfTestDir ?? e2eDir)!)

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

// Fully local: the interface itself never reaches the network. Model calls run in this
// process, so the only outbound traffic is to providers the user configured.
function lockDownNetwork(): void {
  const devOrigin = devUrl ? new URL(devUrl).host : null
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const allowed = devOrigin !== null && new URL(details.url).host === devOrigin
      callback({ cancel: !allowed })
    }
  )
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0b0d1c',
    title: 'Twilight',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d1c', symbolColor: '#a6abd8', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // Electron's spellchecker downloads dictionaries from the web; off until we bundle them.
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  // "#e2e" lets the end-to-end test reach the editor; it does nothing otherwise.
  const hash = e2eDir ? 'e2e' : undefined
  if (devUrl) void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return win
}

const folders = (): ChatFolder[] => workspaces.listWorkspaces()

const ATTACH_LIMIT = 20 * 1024 * 1024

/** Reads text files picked by the user; binary files are refused rather than injected as noise. */
async function pickAttachments(win: BrowserWindow | null): Promise<Attachment[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Attach files',
    defaultPath: docs.writingFolder(),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Text and documents', extensions: ['md', 'txt', 'markdown', 'json', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'htm', 'log', 'ini', 'toml'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cs', 'cpp', 'c', 'h', 'css', 'sql', 'sh', 'ps1', 'lua', 'rb', 'php'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return []
  const out: Attachment[] = []
  for (const file of result.filePaths) {
    const info = await stat(file)
    if (info.size > ATTACH_LIMIT) throw new Error(`${basename(file)} is over 20 MB.`)
    const text = await readFile(file, 'utf8')
    if (text.includes('\u0000')) throw new Error(`${basename(file)} isn't a text file. PDFs and images aren't supported yet.`)
    out.push({ name: basename(file), text })
  }
  return out
}

const summary = (c: db.ConversationRow): ConversationSummary => ({
  id: c.id,
  title: c.title,
  updatedAt: c.updated_at,
  modelId: (JSON.parse(c.settings) as { modelId: string }).modelId,
  folderId: c.folder_id,
  pinned: !!c.pinned,
  deletedAt: c.deleted_at ?? undefined
})

type Handlers ={ [K in keyof TwilightApi]?: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown }

function registerIpc(): void {
  const handlers: Handlers = {
    listConversations: () => db.listConversations().map(summary),
    listTrash: () => db.listTrash().map(summary),
    restoreConversation: (_e, id: string) => db.restoreConversation(id),
    deleteForever: (_e, id: string) => db.deleteConversationForever(id),
    emptyTrash: () => db.listTrash().forEach((c) => db.deleteConversationForever(c.id)),
    getRequestLogs: () => ({ enabled: logs.loggingEnabled(), folder: logs.logsFolder() }),
    setRequestLogs: (_e, enabled: boolean) => db.kvSet('requestLogs', enabled),
    openLogsFolder: async () => {
      await mkdir(logs.logsFolder(), { recursive: true })
      await shell.openPath(logs.logsFolder())
    },
    createConversation: (_e, folderId?: string | null) => chat.create(folderId ?? null),
    listFolders: () => folders(),
    createFolder: (_e, name: string) => (db.createFolder(name.trim() || 'New folder'), folders()),
    renameFolder: (_e, id: string, name: string) => (name.trim() && db.updateFolder(id, { name: name.trim() }), folders()),
    updateWorkspace: (_e, id: string, patch: WorkspacePatch) => (workspaces.updateWorkspace(id, patch), folders()),
    pickAttachments: (e) => pickAttachments(BrowserWindow.fromWebContents(e.sender)),
    listPresets: () => db.kvGet<SettingsPreset[]>('presets') ?? [],
    savePreset: (_e, preset: SettingsPreset) => {
      const list = (db.kvGet<SettingsPreset[]>('presets') ?? []).filter((p) => p.name !== preset.name)
      list.push(preset)
      list.sort((a, b) => a.name.localeCompare(b.name))
      db.kvSet('presets', list)
      return list
    },
    deletePreset: (_e, name: string) => {
      const list = (db.kvGet<SettingsPreset[]>('presets') ?? []).filter((p) => p.name !== name)
      db.kvSet('presets', list)
      return list
    },
    setFolderCollapsed: (_e, id: string, collapsed: boolean) => (db.updateFolder(id, { collapsed: collapsed ? 1 : 0 }), folders()),
    deleteFolder: (_e, id: string) => (db.deleteFolder(id), folders()),
    moveConversation: (_e, id: string, folderId: string | null) => db.fileConversation(id, { folder_id: folderId }),
    pinConversation: (_e, id: string, pinned: boolean) => db.fileConversation(id, { pinned: pinned ? 1 : 0 }),
    openConversation: (_e, id: string) => chat.view(id),
    renameConversation: (_e, id: string, title: string) => db.updateConversation(id, { title }),
    deleteConversation: (_e, id: string) => {
      chat.stop(id, 'both')
      db.trashConversation(id)
    },
    updateChatSettings: (_e, id: string, patch, pane?: Pane) => chat.updateSettings(id, patch, pane),
    send: (e, id: string, text: string, target?: SendTarget, attachments?: Attachment[]) =>
      chat.send(e.sender, id, text, target, attachments),
    regenerate: (e, id: string, nodeId: string, pane?: Pane) => chat.regenerate(e.sender, id, nodeId, pane),
    deleteMessage: (_e, id: string, nodeId: string, kind: 'single' | 'below', pane?: Pane) => chat.deleteMessage(id, nodeId, kind, pane),
    listDeletions: (_e, id: string) => chat.listDeletions(id),
    viewDeletion: (_e, id: string, deletionId: string) => chat.viewDeletion(id, deletionId),
    restoreDeletion: (_e, id: string, deletionId: string, pane?: Pane) => chat.restoreDeletion(id, deletionId, pane),
    editMessage: (e, id: string, nodeId: string, text: string, pane?: Pane) => chat.editMessage(e.sender, id, nodeId, text, pane),
    switchBranch: (_e, id: string, nodeId: string, direction: -1 | 1, pane?: Pane) =>
      chat.switchBranch(id, nodeId, direction, pane),
    stop: (_e, id: string, target?: SendTarget) => chat.stop(id, target),
    cloneIntoSplit: (_e, id: string, nodeId?: string) => chat.cloneIntoSplit(id, nodeId),
    closeSplit: (_e, id: string, keep: Pane) => chat.closeSplit(id, keep),
    listProviders: () => providers.getProviders(),
    saveProvider: (_e, config, apiKey?: string) => providers.saveProvider(config, apiKey),
    deleteProvider: (_e, id: string) => providers.deleteProvider(id),
    listModels: (_e, refresh?: boolean) => providers.listModels(refresh),
    testProvider: (_e, id: string) => providers.testProvider(id),
    getDefaults: () => chat.getDefaults(),
    setDefaults: (_e, patch) => chat.setDefaults(patch),
    listRubrics: () => judge.listRubrics(),
    saveRubric: (_e, rubric: Rubric) => judge.saveRubric(rubric),
    deleteRubric: (_e, id: string) => judge.deleteRubric(id),
    listJudgments: () => judge.listJudgments(),
    getJudgment: (_e, id: string) => judge.getJudgment(id),
    runJudge: (e, input: JudgeInput) => judge.runJudge(e.sender, input),
    stopJudge: (_e, id: string) => judge.stopJudge(id),
    deleteJudgment: (_e, id: string) => judge.deleteJudgment(id),
    getWritingFolder: () => docs.writingFolder(),
    chooseWritingFolder: (e) => docs.chooseWritingFolder(BrowserWindow.fromWebContents(e.sender)),
    listDocs: () => docs.listDocs(),
    listDocFolders: () => docs.listDocFolders(),
    createDocFolder: (_e, path: string) => docs.createDocFolder(path),
    moveDoc: (_e, path: string, folder: string) => docs.moveDoc(path, folder),
    readDoc: (_e, path: string) => docs.readDoc(path),
    writeDoc: (_e, path: string, text: string) => docs.writeDoc(path, text),
    createDoc: (_e, name: string, folder?: string) => docs.createDoc(name, folder),
    getDocContext: (_e, path: string) => docs.getDocContext(path),
    setDocContext: (_e, path: string, context: DocContext) => docs.setDocContext(path, context),
    runWritingTool: (e, requestId: string, request: WritingRequest) => writing.runWritingTool(e.sender, requestId, request),
    stopWritingTool: (_e, requestId: string) => writing.stopWritingTool(requestId),
    getAppInfo: () => ({ version: app.getVersion(), dataFolder: app.getPath('userData'), electron: process.versions.electron }),
    openDataFolder: async () => {
      await shell.openPath(app.getPath('userData'))
    },
    openExternal: async (_e, url: string) => {
      if (isWebUrl(url)) await shell.openExternal(url)
    }
  }
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`twilight:${name}`, handler as (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown)
  }
}

app.whenReady().then(() => {
  db.openDatabase(join(app.getPath('userData'), 'twilight.db'))
  // Tests keep their documents in the throwaway profile, never in the real Documents folder.
  if (selfTestDir || e2eDir) db.kvSet('writingFolder', join(app.getPath('userData'), 'vault'))
  if (!devUrl) Menu.setApplicationMenu(null)
  lockDownNetwork()
  registerIpc()
  if (selfTestDir) seedSelfTest()
  const win = createWindow()
  if (selfTestDir) runSelfTest(win, selfTestDir)
  if (e2eDir) runE2E(win, e2eDir)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
