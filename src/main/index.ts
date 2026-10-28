import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import type { Pane, SendTarget, TwilightApi, WritingRequest } from '@shared/types'
import * as chat from './chat'
import * as db from './db'
import * as docs from './docs'
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

type Handlers = { [K in keyof TwilightApi]?: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown }

function registerIpc(): void {
  const handlers: Handlers = {
    listConversations: () =>
      db.listConversations().map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updated_at,
        modelId: (JSON.parse(c.settings) as { modelId: string }).modelId
      })),
    createConversation: () => chat.create(),
    openConversation: (_e, id: string) => chat.view(id),
    renameConversation: (_e, id: string, title: string) => db.updateConversation(id, { title }),
    deleteConversation: (_e, id: string) => {
      chat.stop(id, 'both')
      db.deleteConversation(id)
    },
    updateChatSettings: (_e, id: string, patch, pane?: Pane) => chat.updateSettings(id, patch, pane),
    send: (e, id: string, text: string, target?: SendTarget) => chat.send(e.sender, id, text, target),
    regenerate: (e, id: string, nodeId: string, pane?: Pane) => chat.regenerate(e.sender, id, nodeId, pane),
    switchBranch: (_e, id: string, nodeId: string, direction: -1 | 1, pane?: Pane) =>
      chat.switchBranch(id, nodeId, direction, pane),
    stop: (_e, id: string, target?: SendTarget) => chat.stop(id, target),
    cloneIntoSplit: (_e, id: string, nodeId?: string) => chat.cloneIntoSplit(id, nodeId),
    closeSplit: (_e, id: string, keep: Pane) => chat.closeSplit(id, keep),
    listProviders: () => providers.getProviders(),
    saveProvider: (_e, config, apiKey?: string) => providers.saveProvider(config, apiKey),
    deleteProvider: (_e, id: string) => providers.deleteProvider(id),
    listModels: (_e, refresh?: boolean) => providers.listModels(refresh),
    getDefaults: () => chat.getDefaults(),
    setDefaults: (_e, patch) => chat.setDefaults(patch),
    getWritingFolder: () => docs.writingFolder(),
    chooseWritingFolder: (e) => docs.chooseWritingFolder(BrowserWindow.fromWebContents(e.sender)),
    listDocs: () => docs.listDocs(),
    readDoc: (_e, path: string) => docs.readDoc(path),
    writeDoc: (_e, path: string, text: string) => docs.writeDoc(path, text),
    createDoc: (_e, name: string) => docs.createDoc(name),
    runWritingTool: (e, requestId: string, request: WritingRequest) => writing.runWritingTool(e.sender, requestId, request),
    stopWritingTool: (_e, requestId: string) => writing.stopWritingTool(requestId),
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
