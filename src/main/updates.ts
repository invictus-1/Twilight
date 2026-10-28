// Updates from the public releases repo (installers only; the source stays private). Twilight
// checks GitHub's release list at most once a day when automatic checks are on, or when asked.
// Nothing else reaches the network. Installing any listed version, newer or older, downloads
// its installer, checks it against the release's latest.yml hash, backs up the database, and
// hands over to the installer, which closes Twilight and starts the new version.

import { app, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ReleaseInfo, UpdateState } from '@shared/types'
import * as db from './db'

export const RELEASES_REPO = 'invictus-1/twilight-releases'
const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`
const DAY = 24 * 60 * 60 * 1000
const KEEP_INSTALLERS = 3
const KEEP_BACKUPS = 3

let apiBase = `https://api.github.com/repos/${RELEASES_REPO}`
let releases: ReleaseInfo[] = []
let checking = false
let error: string | null = null
let downloading: UpdateState['downloading'] = null
const listeners = new Set<WebContents>()
let testMode = false
let testInstalled: string | null = null

/** Tests point the updater at a mock of GitHub's API; installers then download but never run. */
export function setUpdateSource(base: string): void {
  apiBase = base
  testMode = true
}

/** In test mode, the installer that would have run. */
export const lastTestInstall = (): string | null => testInstalled

const updatesFolder = (): string => join(app.getPath('userData'), 'updates')
const backupsFolder = (): string => join(app.getPath('userData'), 'backups')
const installerPath = (version: string): string => join(updatesFolder(), `Twilight-Setup-${version}.exe`)

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
}

export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Each version this copy of Twilight has run as, oldest first, with when it first did. */
function history(): UpdateState['history'] {
  return db.kvGet<UpdateState['history']>('updates.history') ?? []
}

export function recordRunningVersion(): void {
  const list = history()
  const version = app.getVersion()
  if (list.at(-1)?.version !== version) db.kvSet('updates.history', [...list, { version, installedAt: Date.now() }].slice(-20))
}

export function state(): UpdateState {
  const current = app.getVersion()
  const newer = releases.filter((r) => compareVersions(r.version, current) > 0)
  return {
    current,
    history: history(),
    autoCheck: db.kvGet<boolean>('updates.autoCheck') ?? true,
    lastChecked: db.kvGet<number>('updates.lastChecked') ?? null,
    checking,
    error,
    releases,
    latest: newer[0]?.version ?? null,
    downloading,
    cached: releases.filter((r) => existsSync(installerPath(r.version))).map((r) => r.version),
    canInstall: app.isPackaged,
    releasesPage: RELEASES_PAGE
  }
}

function broadcast(): void {
  const s = state()
  for (const wc of listeners) {
    if (wc.isDestroyed()) listeners.delete(wc)
    else wc.send('twilight:update', s)
  }
}

export function subscribe(wc: WebContents): UpdateState {
  listeners.add(wc)
  return state()
}

export function setAutoCheck(on: boolean): UpdateState {
  db.kvSet('updates.autoCheck', on)
  broadcast()
  return state()
}

interface GithubRelease {
  tag_name: string
  name: string | null
  body: string | null
  draft: boolean
  prerelease: boolean
  published_at: string | null
  html_url: string
  assets: { name: string; size: number; browser_download_url: string }[]
}

async function github(path: string): Promise<Response> {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `Twilight/${app.getVersion()}` },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is rate limiting checks right now; try again in an hour.' : `GitHub answered ${res.status}.`)
  return res
}

export async function check(): Promise<UpdateState> {
  if (checking) return state()
  checking = true
  error = null
  broadcast()
  try {
    const list = (await (await github('/releases?per_page=20')).json()) as GithubRelease[]
    releases = list
      .filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+$/.test(r.tag_name))
      .map((r) => {
        const setup = r.assets.find((a) => /^Twilight-Setup-.*\.exe$/.test(a.name))
        const yml = r.assets.find((a) => a.name === 'latest.yml')
        return {
          version: r.tag_name.replace(/^v/, ''),
          name: r.name || r.tag_name,
          notes: r.body ?? '',
          publishedAt: r.published_at ? Date.parse(r.published_at) : 0,
          url: r.html_url,
          installer: setup ? { name: setup.name, size: setup.size, url: setup.browser_download_url } : null,
          checksumUrl: yml?.browser_download_url ?? null
        }
      })
      .sort((a, b) => compareVersions(b.version, a.version))
    db.kvSet('updates.lastChecked', Date.now())
  } catch (err) {
    error = err instanceof Error ? (err.name === 'TimeoutError' ? 'GitHub did not answer in time.' : err.message) : String(err)
  } finally {
    checking = false
    broadcast()
  }
  return state()
}

/** Checks once a day while automatic checks are on: shortly after launch, then hourly looks at the clock. */
export function startDailyCheck(): void {
  const due = (): void => {
    const s = state()
    if (s.autoCheck && !s.checking && Date.now() - (s.lastChecked ?? 0) > DAY) void check()
  }
  setTimeout(due, 15000)
  setInterval(due, 60 * 60 * 1000).unref()
}

async function download(release: ReleaseInfo): Promise<string> {
  const target = installerPath(release.version)
  if (existsSync(target)) return target
  if (!release.installer) throw new Error(`Release ${release.version} has no installer attached.`)
  const expected = release.checksumUrl ? /^sha512:\s*(\S+)\s*$/m.exec(await (await fetch(release.checksumUrl)).text())?.[1] : undefined
  await mkdir(updatesFolder(), { recursive: true })
  const res = await fetch(release.installer.url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || release.installer.size
  downloading = { version: release.version, received: 0, total }
  broadcast()
  const hash = createHash('sha512')
  const chunks: Buffer[] = []
  let lastSent = 0
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const buf = Buffer.from(chunk)
    hash.update(buf)
    chunks.push(buf)
    downloading.received += buf.length
    if (Date.now() - lastSent > 150) {
      lastSent = Date.now()
      broadcast()
    }
  }
  if (expected && hash.digest('base64') !== expected) throw new Error('The download does not match the release checksum, so it was discarded. Try again.')
  // Written whole, then renamed, so a half-finished download never looks like an installer.
  downloading = null
  await writeFile(`${target}.part`, Buffer.concat(chunks))
  await rename(`${target}.part`, target)
  await prune(join(updatesFolder()), /^Twilight-Setup-.*\.exe$/, KEEP_INSTALLERS, target)
  return target
}

async function prune(folder: string, pattern: RegExp, keep: number, protect?: string): Promise<void> {
  const files = await Promise.all(
    (await readdir(folder)).filter((f) => pattern.test(f)).map(async (f) => ({ path: join(folder, f), mtime: (await stat(join(folder, f))).mtimeMs }))
  )
  files.sort((a, b) => b.mtime - a.mtime)
  for (const f of files.slice(keep)) if (f.path !== protect) await rm(f.path, { force: true })
}

/** Installs a listed version, newer or older. Returns only if something went wrong. */
export async function install(version: string): Promise<UpdateState> {
  const release = releases.find((r) => r.version === version)
  if (!release) throw new Error('Check for updates first.')
  if (downloading) throw new Error('A download is already running.')
  error = null
  try {
    const file = await download(release)
    // A copy of everything from before the switch, in case the other version needs it.
    await mkdir(backupsFolder(), { recursive: true })
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    await db.backupDatabase(join(backupsFolder(), `twilight-${app.getVersion()}-${stamp}.db`))
    await prune(backupsFolder(), /^twilight-.*\.db$/, KEEP_BACKUPS)
    if (testMode) {
      testInstalled = file
      return state()
    }
    if (!app.isPackaged) throw new Error(`Downloaded to ${file}. Installing only works from the installed app.`)
    // An installed copy updates quietly and starts again by itself; a portable copy gets the
    // installer's usual pages.
    const installed = existsSync(join(dirname(app.getPath('exe')), 'Uninstall Twilight.exe'))
    spawn(file, installed ? ['/S', '--updated', '--force-run'] : [], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 300)
    return state()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    downloading = null
    broadcast()
  }
}

export async function openBackups(): Promise<string> {
  await mkdir(backupsFolder(), { recursive: true })
  return backupsFolder()
}
