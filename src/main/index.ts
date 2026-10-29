import { app, clipboard, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
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
  UsageRange,
  WorkspacePatch,
  WritingRequest
} from '@shared/types'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
import * as judge from './judge'
import * as library from './library'
import * as logs from './logs'
import * as workspaces from './workspaces'
import type { JudgeInput, Rubric } from '@shared/judge'
import type { Persona, SavedPrompt } from '@shared/library'
import type { AiConfig, TrackedCharacter } from '@shared/insights'
import * as writing from './writing'
import * as providers from './providers'
import * as insights from './insights'
import * as insightsAi from './insightsAi'
import * as reports from './reports'
import * as updates from './updates'
import { usageStats } from './usage'
import { runE2E } from './e2e'
import { prepareSelfTest, runSelfTest, seedSelfTest } from './selftest'
import { runShowcase } from './showcase'
import { searchAll } from './search'
import * as code from './code/agent'
import type { CodeMode, CodeResponse } from '@shared/code'
import { backgroundVersion, chooseBackground, clearBackgroundFile, registerBackgroundScheme, serveBackground } from './background'
import { themeInfo, type Theme } from '@shared/themes'
import { setCustomPrices, type CustomPrice } from '@shared/pricing'
import { attachmentKind, IMAGE_EXTENSIONS, tooBig } from '@shared/attachments'

const devUrl = process.env.ELECTRON_RENDERER_URL
const selfTestDir = process.env.TWILIGHT_SELFTEST
const e2eDir = process.env.TWILIGHT_E2E
/** Releases-page screenshots from made-up demo data (see showcase.ts). */
const showcaseDir = process.env.TWILIGHT_SHOWCASE
const testDir = selfTestDir ?? e2eDir ?? showcaseDir
if (testDir) {
  // A test window is often covered by other windows. Chromium treats that as hidden and, after a
  // while, wakes its timers about once a minute; a run would crawl. Test runs opt out of that.
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling')
}
if (testDir) prepareSelfTest(testDir)

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

/** Window frame colours per theme: the title bar overlay sits outside the page, so it's set here. */
const frameFor = (theme: string | undefined): { night: string; symbol: string } => themeInfo(theme ?? 'twilight')

function createWindow(): BrowserWindow {
  const frame = db.kvGet<{ night: string; symbol: string }>('themeFrame') ?? frameFor(db.kvGet<string>('theme'))
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: frame.night,
    title: 'Twilight',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: frame.night, symbolColor: frame.symbol, height: 40 },
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
  // "#e2e" lets the end-to-end test (and the showcase) reach the editor; it does nothing otherwise.
  const hash = e2eDir || showcaseDir ? 'e2e' : undefined
  if (devUrl) void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return win
}

const folders = (): ChatFolder[] => workspaces.listWorkspaces()


/** Reads text files picked by the user; binary files are refused rather than injected as noise. */
async function pickAttachments(win: BrowserWindow | null): Promise<Attachment[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Attach files',
    defaultPath: docs.writingFolder(),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Everything Twilight can attach', extensions: ['md', 'txt', 'markdown', 'json', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'htm', 'log', 'ini', 'toml', 'pdf', ...IMAGE_EXTENSIONS] },
      { name: 'Images and PDFs', extensions: ['pdf', ...IMAGE_EXTENSIONS] },
      { name: 'Text and documents', extensions: ['md', 'txt', 'markdown', 'json', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'htm', 'log', 'ini', 'toml'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cs', 'cpp', 'c', 'h', 'css', 'sql', 'sh', 'ps1', 'lua', 'rb', 'php'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return []
  const out: Attachment[] = []
  for (const file of result.filePaths) {
    const name = basename(file)
    const { kind, mediaType } = attachmentKind(name)
    const info = await stat(file)
    const big = tooBig(kind, info.size, name)
    if (big) throw new Error(big)
    if (kind !== 'text') {
      out.push({ name, text: '', kind, mediaType, data: (await readFile(file)).toString('base64') })
      continue
    }
    const text = await readFile(file, 'utf8')
    if (text.includes('\u0000')) throw new Error(`${name} isn't a text file. Text, images (PNG, JPEG, GIF, WebP) and PDFs can be attached.`)
    out.push({ name, text })
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
    createConversation: (_e, folderId?: string | null, personaId?: string | null, reuseId?: string | null) =>
      chat.create(folderId ?? null, personaId ?? null, reuseId ?? null),
    listFolders: () => folders(),
    createFolder: (_e, name: string) => (db.createFolder(name.trim() || 'New folder'), folders()),
    renameFolder: (_e, id: string, name: string) => (name.trim() && db.updateFolder(id, { name: name.trim() }), folders()),
    updateWorkspace: (_e, id: string, patch: WorkspacePatch) => (workspaces.updateWorkspace(id, patch), folders()),
    pickAttachments: (e) => pickAttachments(BrowserWindow.fromWebContents(e.sender)),
    importRubric: async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const options: Electron.OpenDialogOptions = { title: 'Import a rubric', properties: ['openFile'], filters: [{ name: 'Rubric', extensions: ['json'] }] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return null
      const rubric = judge.parseRubric(await readFile(result.filePaths[0], 'utf8'))
      return { rubrics: judge.saveRubric(rubric), id: rubric.id }
    },
    exportRubric: async (e, id: string) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const text = judge.rubricFile(id)
      const options: Electron.SaveDialogOptions = { title: 'Export rubric', defaultPath: `${id}.rubric.json`, filters: [{ name: 'Rubric', extensions: ['json'] }] }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, text)
      return true
    },
    getLibrary: () => library.getLibrary(),
    savePersona: (_e, persona: Persona) => library.savePersona(persona),
    deletePersona: (_e, id: string) => library.deletePersona(id),
    savePrompt: (_e, prompt: SavedPrompt) => library.savePrompt(prompt),
    deletePrompt: (_e, id: string) => library.deletePrompt(id),
    importLibrary: async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const options: Electron.OpenDialogOptions = { title: 'Import personas and prompts', properties: ['openFile'], filters: [{ name: 'Twilight library', extensions: ['json'] }] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return null
      return library.importLibrary(await readFile(result.filePaths[0], 'utf8'))
    },
    exportLibrary: async (e, ids?: string[]) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const text = library.libraryFile(ids)
      const options: Electron.SaveDialogOptions = { title: 'Export personas and prompts', defaultPath: 'twilight-library.json', filters: [{ name: 'Twilight library', extensions: ['json'] }] }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, text)
      return true
    },
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
    branchToNewChat: (_e, id: string, nodeId: string, pane?: Pane) => chat.branchToNewChat(id, nodeId, pane),
    searchAll: (_e, query: string) => searchAll(query),
    listCodeSessions: () => code.listSessions(),
    newCodeSession: (e) => code.newSession(BrowserWindow.fromWebContents(e.sender)),
    openCodeSession: (_e, id: string) => code.openSession(id),
    sendCode: (_e, id: string, text: string) => code.send(id, text),
    respondCode: (_e, id: string, pendingId: string, response: CodeResponse) => code.respond(id, pendingId, response),
    stopCode: (_e, id: string) => code.stop(id),
    undoCode: (_e, id: string, all: boolean) => code.undo(id, all),
    setCodeOptions: (_e, id: string, patch: { mode?: CodeMode; providerId?: string; modelId?: string }) => code.setOptions(id, patch),
    deleteCodeSession: (_e, id: string) => code.deleteSession(id),
    getPrices: () => db.kvGet<CustomPrice[]>('prices') ?? [],
    setPrices: (_e, list: CustomPrice[]) => {
      db.kvSet('prices', list)
      setCustomPrices(list)
      return list
    },
    usageStats: (_e, range: UsageRange) => usageStats(range),
    copyText: (_e, text: string) => clipboard.writeText(String(text)),
    renameDoc: (_e, path: string, name: string) => docs.renameDoc(path, name),
    renameDocFolder: (_e, path: string, name: string) => docs.renameDocFolder(path, name),
    trashDocPath: (_e, path: string, kind: 'doc' | 'folder') => docs.trashDocPath(path, kind),
    revealMessage: (_e, id: string, nodeId: string) => chat.revealMessage(id, nodeId),
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
    runJudgeRound: (e, input: JudgeInput) => judge.runRound(e.sender, input),
    getLeaderboard: (_e, roundId?: string | null) => judge.getLeaderboard(roundId),
    stopJudge: (_e, id: string) => judge.stopJudge(id),
    deleteJudgment: (_e, id: string) => judge.deleteJudgment(id),
    getWritingFolder: () => docs.writingFolder(),
    chooseWritingFolder: async (e) => {
      const folder = await docs.chooseWritingFolder(BrowserWindow.fromWebContents(e.sender))
      if (folder) {
        insights.watchFolder()
        void insights.scan()
      }
      return folder
    },
    getInsights: (e) => insights.subscribe(e.sender),
    rescanInsights: async () => {
      await insights.scan()
      return insights.summary()
    },
    setCharacters: (_e, list: TrackedCharacter[]) => insights.setCharacters(list),
    getAiState: () => insightsAi.state(),
    setAiConfig: (_e, config: AiConfig) => insightsAi.setConfig(config),
    estimateStory: (_e, mode: 'quick' | 'deep', scope: string) => insightsAi.estimate(mode, scope),
    runStory: (_e, mode: 'quick' | 'deep', scope: string) => insightsAi.runStory(mode, scope),
    runFocus: () => insightsAi.runFocus(),
    runNotes: () => insightsAi.runNotes(),
    stopAi: () => insightsAi.stop(),
    forgetAiResult: (_e, kind: 'story' | 'focus' | 'notes', at: number) => insightsAi.forget(kind, at),
    exportReport: async (_e, kind: reports.ReportKind, includeAi: boolean, open: boolean) => {
      const file = await reports.exportReport(kind, includeAi)
      if (open) await reports.openReport(file)
      return file
    },
    openReportsFolder: async () => {
      await mkdir(reports.reportsFolder(), { recursive: true })
      await shell.openPath(reports.reportsFolder())
    },
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
    getBackground: () => backgroundVersion(),
    chooseBackground: (e) => chooseBackground(BrowserWindow.fromWebContents(e.sender)),
    clearBackground: () => clearBackgroundFile(),
    openExternal: async (_e, url: string) => {
      if (isWebUrl(url)) await shell.openExternal(url)
    },
    setWindowTheme: (e, theme: Theme | 'custom', custom?: { night: string; symbol: string }) => {
      db.kvSet('theme', theme)
      db.kvSet('themeFrame', theme === 'custom' && custom ? custom : null)
      const frame = theme === 'custom' && custom ? custom : frameFor(theme)
      const win = BrowserWindow.fromWebContents(e.sender)
      win?.setBackgroundColor(frame.night)
      win?.setTitleBarOverlay({ color: frame.night, symbolColor: frame.symbol, height: 40 })
    },
    getWelcomed: () => db.kvGet<boolean>('welcomed') ?? false,
    setWelcomed: () => db.kvSet('welcomed', true),
    getUpdateState: (e) => updates.subscribe(e.sender),
    checkForUpdates: () => updates.check(),
    setAutoUpdateCheck: (_e, on: boolean) => updates.setAutoCheck(on),
    installVersion: (_e, version: string) => updates.install(version),
    openBackupsFolder: async () => {
      await shell.openPath(await updates.openBackups())
    }
  }
  for (const [name, handler] of Object.entries(handlers)) {
    const run = handler as (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    if (!e2eDir) {
      ipcMain.handle(`twilight:${name}`, run)
      continue
    }
    // In test runs, slow calls are logged, so a slowdown shows where it is.
    ipcMain.handle(`twilight:${name}`, async (event, ...args) => {
      const t0 = Date.now()
      try {
        return await run(event, ...args)
      } finally {
        const ms = Date.now() - t0
        if (ms > 300) appendFileSync(join(e2eDir, 'timings.log'), `ipc ${name} took ${ms} ms\n`)
      }
    })
  }
}

registerBackgroundScheme()

app.whenReady().then(() => {
  db.openDatabase(join(app.getPath('userData'), 'twilight.db'))
  setCustomPrices(db.kvGet<CustomPrice[]>('prices') ?? [])
  serveBackground()
  // Tests keep their documents in the throwaway profile, never in the real Documents folder.
  if (testDir) {
    db.kvSet('writingFolder', join(app.getPath('userData'), 'vault'))
    // Tests drive the app directly; the e2e opens the welcome itself when it checks it.
    db.kvSet('welcomed', true)
  }
  if (!devUrl) Menu.setApplicationMenu(null)
  lockDownNetwork()
  registerIpc()
  updates.recordRunningVersion()
  providers.migrateToShownModels(chat.getDefaults())
  // Tests never reach GitHub; the e2e run checks against its own mock.
  if (!testDir) {
    updates.startDailyCheck()
    insights.start()
  }
  if (selfTestDir) seedSelfTest()
  const win = createWindow()
  if (selfTestDir) runSelfTest(win, selfTestDir)
  if (e2eDir) runE2E(win, e2eDir)
  if (showcaseDir) runShowcase(win, showcaseDir)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
