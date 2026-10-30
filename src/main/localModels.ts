import { app, BrowserWindow, shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import { cpus, totalmem } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fitFor, quantOf, shardBase, THIS_PC, type Hardware, type HubModel, type HubVariant, type LocalDownload, type LocalModel, type LocalState } from '@shared/localModels'
import { kvGet, kvSet } from './db'
import { getProviders, saveProvider } from './providers'

// Models on this PC (see shared/localModels.ts). Everything that reaches the network is here, in
// the main process, and only when you ask: a search, a download, fetching llama.cpp.

let HUB = 'https://huggingface.co'
let RELEASES = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10'
// Test runs point these at a stand-in server, and run a stand-in engine.
let engineOverride: { command: string; args: string[]; env: Record<string, string> } | null = null
let hardwareOverride: Hardware | null = null
export function useTestEndpoints(hub: string, releases: string, engine: typeof engineOverride, hw: Hardware): void {
  HUB = hub
  RELEASES = releases
  engineOverride = engine
  hardwareOverride = hw
  hardwareCache = null
}

interface Settings {
  folder: string | null
  autoStart: boolean
  engine: { version: string; kind: string; exe: string } | null
  /** Which repository each downloaded model came from, by its name in the folder. */
  sources: Record<string, string>
}
const settings = (): Settings => ({ folder: null, autoStart: true, engine: null, sources: {}, ...kvGet<Partial<Settings>>('localModels') })
const save = (patch: Partial<Settings>): void => kvSet('localModels', { ...settings(), ...patch })
export const modelsFolder = (): string => settings().folder ?? join(app.getPath('userData'), 'models')

// ——— This PC ———

let hardwareCache: Promise<Hardware> | null = null

/** Memory, and the graphics card with the most memory (Windows keeps its true size in the registry). */
export function hardware(): Promise<Hardware> {
  if (hardwareOverride) return Promise.resolve(hardwareOverride)
  hardwareCache ??= new Promise((resolve) => {
    const base = { memory: totalmem(), cpus: cpus().length, gpu: null }
    if (process.platform !== 'win32') return resolve(base)
    const key = 'HKLM\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(base)
      const cards = new Map<string, { name?: string; memory?: number }>()
      let at = ''
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('HKEY_')) at = line.trim()
        const v = /^\s+(\S[^\t]*?)\s+REG_(\w+)\s+(.*)$/.exec(line)
        if (!v || !at) continue
        const card = cards.get(at) ?? {}
        if (v[1] === 'DriverDesc') card.name = v[3].trim()
        if (v[1] === 'HardwareInformation.qwMemorySize') card.memory = Number(BigInt(v[3].trim()))
        cards.set(at, card)
      }
      const best = [...cards.values()]
        .filter((c): c is { name: string; memory: number } => !!c.name && !!c.memory && !/basic display|virtual|remote|indirect/i.test(c.name))
        .sort((a, b) => b.memory - a.memory)[0]
      // A card with under 2 GB of its own (most built-in graphics) won't hold a useful model.
      resolve({ ...base, gpu: best && best.memory >= 2 * 1024 ** 3 ? best : null })
    })
  })
  return hardwareCache
}

// ——— Hugging Face ———

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`)
  return (await res.json()) as T
}

/** GGUF models on Hugging Face matching a search, most downloaded first. */
export async function searchHub(query: string): Promise<HubModel[]> {
  const params = new URLSearchParams({ search: query.trim(), filter: 'gguf', sort: 'downloads', direction: '-1', limit: '30' })
  for (const e of ['gguf', 'downloads', 'likes', 'pipeline_tag', 'gated', 'lastModified']) params.append('expand[]', e)
  type Row = { id: string; downloads?: number; likes?: number; gated?: boolean | string; pipeline_tag?: string; lastModified?: string; gguf?: { total?: number; context_length?: number; architecture?: string } }
  const rows = await getJson<Row[]>(`${HUB}/api/models?${params}`)
  return rows.map((r) => ({
    id: r.id,
    downloads: r.downloads ?? 0,
    likes: r.likes ?? 0,
    params: r.gguf?.total ?? null,
    context: r.gguf?.context_length ?? null,
    architecture: r.gguf?.architecture ?? null,
    gated: !!r.gated,
    vision: r.pipeline_tag === 'image-text-to-text',
    updated: r.lastModified ?? null
  }))
}

/** A repository's GGUF sizes, smallest first, each with how it would run here. Vision add-ons (mmproj) are left out. */
export async function hubVariants(repo: string): Promise<HubVariant[]> {
  const tree = await getJson<{ type: string; path: string; size: number; lfs?: { size: number } }[]>(`${HUB}/api/models/${repo}/tree/main?recursive=true`)
  const groups = new Map<string, { files: string[]; size: number }>()
  for (const f of tree) {
    if (f.type !== 'file' || !/\.gguf$/i.test(f.path) || /^mmproj/i.test(basename(f.path))) continue
    const key = shardBase(f.path)
    const g = groups.get(key) ?? { files: [], size: 0 }
    g.files.push(f.path)
    g.size += f.lfs?.size ?? f.size
    groups.set(key, g)
  }
  const hw = await hardware()
  return [...groups.entries()]
    .map(([key, g]) => ({ name: quantOf(key), files: g.files.sort(), size: g.size, fit: fitFor(g.size, hw) }))
    .sort((a, b) => a.size - b.size)
}

// ——— The models folder ———

/** What's in the models folder: single files, and folders holding a model in parts. */
export async function localModels(): Promise<LocalModel[]> {
  const folder = modelsFolder()
  const hw = await hardware()
  const { sources } = settings()
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
  const out: LocalModel[] = []
  for (const e of entries) {
    const full = join(folder, e.name)
    if (e.isFile() && /\.gguf$/i.test(e.name) && !/^mmproj/i.test(e.name)) {
      const size = (await fs.stat(full)).size
      out.push({ name: e.name, size, repo: sources[e.name] ?? null, fit: fitFor(size, hw) })
    } else if (e.isDirectory()) {
      const parts = (await fs.readdir(full).catch(() => [])).filter((f) => /\.gguf$/i.test(f) && !/^mmproj/i.test(f))
      if (!parts.length) continue
      let size = 0
      for (const p of parts) size += (await fs.stat(join(full, p))).size
      out.push({ name: e.name, size, repo: sources[e.name] ?? null, fit: fitFor(size, hw) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const downloads = new Map<string, LocalDownload & { controller: AbortController }>()

/**
 * Downloads one size of a model into the models folder: a single file as it is, a model in parts
 * into a folder of its own (as llama.cpp expects). Each file arrives as .part and is renamed when
 * whole; a stopped download picks up where it left off.
 */
export async function downloadModel(repo: string, variant: HubVariant): Promise<void> {
  const key = `${repo}::${variant.name}`
  if (downloads.has(key)) return
  const controller = new AbortController()
  const job = { key, repo, variant: variant.name, done: 0, total: variant.size, error: null as string | null, controller }
  downloads.set(key, job)
  announce()
  const folder = modelsFolder()
  const name = variant.files.length > 1 ? basename(shardBase(variant.files[0])).replace(/\.gguf$/i, '') : basename(variant.files[0])
  const target = variant.files.length > 1 ? join(folder, name) : folder
  try {
    await fs.mkdir(target, { recursive: true })
    for (const file of variant.files) {
      const dest = join(target, basename(file))
      if (await fs.stat(dest).catch(() => null)) {
        job.done += (await fs.stat(dest)).size
        continue
      }
      await fetchTo(`${HUB}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`, dest, controller.signal, (n) => {
        job.done += n
        announceSoon()
      })
    }
    save({ sources: { ...settings().sources, [name]: repo } })
    downloads.delete(key)
    // The server reads the folder when it starts.
    if (engine) await restartEngine()
    await showModel(name)
  } catch (err) {
    if (controller.signal.aborted) downloads.delete(key)
    else job.error = (err as Error).message
  }
  announce()
}

export function cancelDownload(key: string): void {
  const job = downloads.get(key)
  job?.controller.abort()
  downloads.delete(key)
  announce()
}

/** A file from the web, written as `dest`.part (resumed if it's there) and renamed when whole. */
async function fetchTo(url: string, dest: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
  const part = `${dest}.part`
  const have = (await fs.stat(part).catch(() => null))?.size ?? 0
  if (have) progress(have)
  const res = await fetch(url, { signal, headers: have ? { range: `bytes=${have}-` } : {} })
  if (!res.ok || !res.body) throw new Error(res.status === 401 || res.status === 403 ? 'This model needs a Hugging Face account and accepted terms; download it on huggingface.co instead.' : `The download failed: ${res.status}.`)
  const resumed = res.status === 206
  if (have && !resumed) progress(-have)
  const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
      progress(chunk.byteLength)
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  await fs.rename(part, dest)
}

/** Sends a model to the Recycle Bin (a model in parts goes as its folder). */
export async function removeModel(name: string): Promise<void> {
  const full = join(modelsFolder(), name)
  if (relative(modelsFolder(), full).startsWith('..')) throw new Error('That model is not in the models folder.')
  await shell.trashItem(full)
  if (engine) await restartEngine()
  announce()
}

export async function setModelsFolder(folder: string): Promise<void> {
  save({ folder })
  if (engine) await restartEngine()
  announce()
}

// ——— llama.cpp ———

interface Release {
  tag_name: string
  assets: { name: string; size: number; browser_download_url: string }[]
}

/** The newest Windows build of llama.cpp for this PC: Vulkan (any recent graphics card) when there's a card, else the plain one. */
export function pickEngine(releases: Release[], gpu: boolean): { tag: string; kind: string; url: string; size: number } | null {
  for (const kind of gpu ? ['vulkan', 'cpu'] : ['cpu']) {
    for (const r of releases) {
      const asset = r.assets.find((a) => new RegExp(`-bin-win-${kind}-x64\\.zip$`).test(a.name))
      if (asset) return { tag: r.tag_name, kind, url: asset.browser_download_url, size: asset.size }
    }
  }
  return null
}

let installing: { done: number; total: number } | null = null
let engineError: string | null = null

/** Fetches llama.cpp's server from its official GitHub releases and unpacks it beside Twilight's data. */
export async function installEngine(): Promise<void> {
  if (installing) return
  engineError = null
  try {
    const hw = await hardware()
    const pick = pickEngine(await getJson<Release[]>(RELEASES), !!hw.gpu)
    if (!pick) throw new Error("No Windows build of llama.cpp was found in its latest releases.")
    installing = { done: 0, total: pick.size }
    announce()
    const dir = join(app.getPath('userData'), 'llama.cpp', `${pick.tag}-${pick.kind}`)
    await fs.mkdir(dir, { recursive: true })
    const zip = join(dir, 'llama.zip')
    await fetchTo(pick.url, zip, new AbortController().signal, (n) => {
      if (installing) installing.done += n
      announceSoon()
    })
    // Windows' own tar unpacks zip files.
    await new Promise<void>((resolve, reject) => execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true }, (err) => (err ? reject(err) : resolve())))
    await fs.unlink(zip).catch(() => undefined)
    const exe = await findFile(dir, 'llama-server.exe')
    if (!exe) throw new Error("The llama.cpp download didn't hold llama-server.exe.")
    const wasRunning = !!engine
    stopEngine()
    save({ engine: { version: pick.tag, kind: pick.kind, exe } })
    if (wasRunning || settings().autoStart) await startEngine()
  } catch (err) {
    engineError = (err as Error).message
  } finally {
    installing = null
    announce()
  }
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isFile() && e.name.toLowerCase() === name) return full
    if (e.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    }
  }
  return null
}

let engine: ChildProcess | null = null
let port: number | null = null
let starting = false
let lastOutput = ''

const freePort = (want: number): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => {
      const any = createServer()
      any.listen(0, '127.0.0.1', () => {
        const p = (any.address() as { port: number }).port
        any.close(() => resolve(p))
      })
    })
    probe.listen(want, '127.0.0.1', () => probe.close(() => resolve(want)))
  })

/**
 * Starts llama.cpp's server in router mode over the models folder: one server for every model
 * there, loading the one a chat asks for (one at a time, fitted to the graphics card). It becomes
 * the This PC provider.
 */
export async function startEngine(): Promise<void> {
  const s = settings()
  if (engine || starting || (!s.engine && !engineOverride)) return
  starting = true
  engineError = null
  announce()
  try {
    await fs.mkdir(modelsFolder(), { recursive: true })
    port = await freePort(39281)
    const args = ['--models-dir', modelsFolder(), '--host', '127.0.0.1', '--port', String(port), '--models-max', '1']
    const command = engineOverride?.command ?? s.engine?.exe ?? ''
    lastOutput = ''
    const child = spawn(command, [...(engineOverride?.args ?? []), ...args], { windowsHide: true, cwd: dirname(command), env: { ...process.env, ...engineOverride?.env } })
    engine = child
    const keep = (d: Buffer): void => void (lastOutput = (lastOutput + d.toString()).slice(-4000))
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('exit', (code) => {
      if (engine !== child) return
      engine = null
      port = null
      if (code) engineError = `llama.cpp stopped (code ${code}). ${lastOutput.trim().split(/\r?\n/).slice(-2).join(' ')}`.trim()
      announce()
    })
    // Up when it answers its health check (within half a minute).
    const base = `http://127.0.0.1:${port}`
    for (let end = Date.now() + 30_000; ; ) {
      if (!engine) throw new Error(engineError ?? 'llama.cpp stopped as it started.')
      const ok = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false)
      if (ok) break
      if (Date.now() > end) throw new Error("llama.cpp didn't start within 30 seconds.")
      await new Promise((r) => setTimeout(r, 250))
    }
    const had = getProviders().find((p) => p.id === THIS_PC)
    saveProvider({ id: THIS_PC, kind: 'openai', name: 'This PC', baseUrl: `${base}/v1`, enabled: true, shownModels: had?.shownModels ?? [] })
  } catch (err) {
    engineError = (err as Error).message
    stopEngine()
  } finally {
    starting = false
    announce()
  }
}

export function stopEngine(): void {
  const child = engine
  engine = null
  port = null
  child?.kill()
  announce()
}

async function restartEngine(): Promise<void> {
  stopEngine()
  await new Promise((r) => setTimeout(r, 300))
  await startEngine()
}

/** A newly downloaded model appears in the model picker straight away. */
async function showModel(name: string): Promise<void> {
  const provider = getProviders().find((p) => p.id === THIS_PC)
  if (!provider?.baseUrl || !engine) return
  const listed = await getJson<{ data?: { id: string }[] }>(`${provider.baseUrl}/models`).catch(() => ({ data: [] }))
  const stem = name.replace(/\.gguf$/i, '')
  const id = listed.data?.find((m) => m.id === stem || m.id === name || m.id.includes(stem))?.id
  if (id && !provider.shownModels?.includes(id)) saveProvider({ ...provider, shownModels: [...(provider.shownModels ?? []), id] })
}

export function setAutoStart(on: boolean): void {
  save({ autoStart: on })
  announce()
}

/** On launch: the server starts in the background if it's installed and set to. */
export function initLocalModels(): void {
  const s = settings()
  if (s.engine && s.autoStart) void startEngine()
  app.on('will-quit', () => engine?.kill())
}

// ——— State for the window ———

export async function localState(): Promise<LocalState> {
  const s = settings()
  return {
    hardware: await hardware(),
    folder: modelsFolder(),
    models: await localModels(),
    downloads: [...downloads.values()].map(({ controller: _, ...d }) => d),
    engine: { version: s.engine?.version ?? null, kind: s.engine?.kind ?? null, installing, running: !!engine && !starting, starting, port, error: engineError },
    autoStart: s.autoStart
  }
}

function announce(): void {
  void localState().then((state) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('twilight:localModels', state)
  })
}

// Progress is sent at most a few times a second.
let soon: ReturnType<typeof setTimeout> | null = null
function announceSoon(): void {
  soon ??= setTimeout(() => {
    soon = null
    announce()
  }, 300)
}
