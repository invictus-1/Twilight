import { app, BrowserWindow } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { cleanTranscript, VOICE_MODELS, type VoiceState } from '@shared/voice'
import { kvGet, kvSet } from './db'
import { fetchTo, findFile, getJson } from './localModels'

// Offline voice (see shared/voice.ts). Reading aloud uses the voices Windows already has, through
// System.Speech; dictation runs whisper.cpp on this PC. The only network use is fetching
// whisper.cpp and a model, when you ask.

let RELEASES = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10'
let HUB = 'https://huggingface.co'
// Test runs point these at a stand-in server and run a stand-in whisper.
let whisperOverride: { command: string; args: string[]; env: Record<string, string> } | null = null
export function useTestVoice(hub: string, releases: string, whisper: typeof whisperOverride): void {
  HUB = hub
  RELEASES = releases
  whisperOverride = whisper
}

interface Settings {
  voice: string | null
  rate: number
  whisper: { version: string; exe: string } | null
  model: string | null
  language: 'en' | 'auto'
}
const settings = (): Settings => ({ voice: null, rate: 0, whisper: null, model: null, language: 'en', ...kvGet<Partial<Settings>>('voice') })
const save = (patch: Partial<Settings>): void => kvSet('voice', { ...settings(), ...patch })
const voiceDir = (): string => join(app.getPath('userData'), 'voice')
const modelsDir = (): string => join(voiceDir(), 'models')

// ——— Reading aloud ———

/** Runs a one-line PowerShell script (sent on its standard input) and returns what it printed. */
function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split(/\r?\n/)[0] || `PowerShell stopped (${code}).`))))
    child.stdin.end(`${script}\n`)
  })
}

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`

let voicesCache: Promise<string[]> | null = null
export function voices(): Promise<string[]> {
  voicesCache ??= powershell(
    'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo.Name }'
  )
    .then((out) => out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
    .catch(() => [])
  return voicesCache
}

// One at a time: each writes the same file.
let speaking: Promise<unknown> = Promise.resolve()

/** The text spoken in your chosen voice and speed, as a WAV file's bytes. */
export function speak(text: string): Promise<Uint8Array> {
  const run = async (): Promise<Uint8Array> => {
    await fs.mkdir(voiceDir(), { recursive: true })
    const wav = join(voiceDir(), 'speech.wav')
    const textFile = join(voiceDir(), 'speech.txt')
    // The text goes through a file: nothing in it can reach the script.
    await fs.writeFile(textFile, text, 'utf8')
    const s = settings()
    await powershell(
      [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        s.voice ? `try { $s.SelectVoice(${quote(s.voice)}) } catch {}` : '',
        `$s.Rate = ${Math.max(-10, Math.min(10, Math.round(s.rate)))}`,
        `$s.SetOutputToWaveFile(${quote(wav)})`,
        `$s.Speak([IO.File]::ReadAllText(${quote(textFile)}, [Text.Encoding]::UTF8))`,
        '$s.Dispose()'
      ]
        .filter(Boolean)
        .join('; ')
    )
    return new Uint8Array(await fs.readFile(wav))
  }
  const next = speaking.then(run, run)
  speaking = next.catch(() => undefined)
  return next
}

// ——— Dictation ———

interface Release {
  tag_name: string
  assets: { name: string; size: number; browser_download_url: string }[]
}

/** The newest Windows build of whisper.cpp (the processor build: small, and quick enough for speech). */
export function pickWhisper(releases: Release[]): { tag: string; url: string; size: number } | null {
  for (const r of releases) {
    const asset = r.assets.find((a) => a.name === 'whisper-bin-x64.zip')
    if (asset) return { tag: r.tag_name, url: asset.browser_download_url, size: asset.size }
  }
  return null
}

let installing: { done: number; total: number } | null = null
let error: string | null = null
const downloads = new Map<string, { done: number; total: number; controller: AbortController }>()

/** Fetches whisper.cpp from its official GitHub releases and unpacks it beside Twilight's data. */
export async function installWhisper(): Promise<void> {
  if (installing) return
  error = null
  try {
    const pick = pickWhisper(await getJson<Release[]>(RELEASES))
    if (!pick) throw new Error('No Windows build of whisper.cpp was found in its latest releases.')
    installing = { done: 0, total: pick.size }
    announce()
    const dir = join(voiceDir(), 'whisper.cpp', pick.tag)
    await fs.mkdir(dir, { recursive: true })
    const zip = join(dir, 'whisper.zip')
    await fetchTo(pick.url, zip, new AbortController().signal, (n) => {
      if (installing) installing.done += n
      announceSoon()
    })
    // Windows' own tar unpacks zip files.
    await new Promise<void>((resolve, reject) => execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true }, (err) => (err ? reject(err) : resolve())))
    await fs.unlink(zip).catch(() => undefined)
    const exe = await findFile(dir, 'whisper-cli.exe')
    if (!exe) throw new Error("The whisper.cpp download didn't hold whisper-cli.exe.")
    save({ whisper: { version: pick.tag, exe } })
  } catch (err) {
    error = (err as Error).message
  } finally {
    installing = null
    announce()
  }
}

/** Downloads a whisper model; the first one downloaded becomes the one dictation uses. */
export async function downloadVoiceModel(file: string): Promise<void> {
  const model = VOICE_MODELS.find((m) => m.file === file)
  if (!model || downloads.has(file)) return
  error = null
  const job = { done: 0, total: model.size, controller: new AbortController() }
  downloads.set(file, job)
  announce()
  try {
    await fs.mkdir(modelsDir(), { recursive: true })
    await fetchTo(`${HUB}/ggerganov/whisper.cpp/resolve/main/${file}`, join(modelsDir(), file), job.controller.signal, (n) => {
      job.done += n
      announceSoon()
    })
    if (!settings().model) save({ model: file })
  } catch (err) {
    if (!job.controller.signal.aborted) error = (err as Error).message
  } finally {
    downloads.delete(file)
    announce()
  }
}

export function cancelVoiceModel(file: string): void {
  downloads.get(file)?.controller.abort()
}

export function setVoiceSettings(patch: Partial<Pick<Settings, 'voice' | 'rate' | 'model' | 'language'>>): Promise<VoiceState> {
  save(patch)
  announce()
  return voiceState()
}

const exists = (path: string): Promise<boolean> =>
  fs.stat(path).then(
    () => true,
    () => false
  )

export async function voiceState(): Promise<VoiceState> {
  const s = settings()
  const models = await Promise.all(
    VOICE_MODELS.map(async (m) => {
      const job = downloads.get(m.file)
      return { ...m, downloaded: await exists(join(modelsDir(), m.file)), downloading: job ? { done: job.done, total: job.total } : null }
    })
  )
  return {
    voices: await voices(),
    voice: s.voice,
    rate: s.rate,
    whisper: whisperOverride ? { version: 'test' } : s.whisper ? { version: s.whisper.version } : null,
    installing,
    models,
    model: s.model && models.some((m) => m.file === s.model && m.downloaded) ? s.model : null,
    language: s.language,
    error
  }
}

/** Speech recorded in the window (a 16 kHz WAV), as text, by whisper.cpp on this PC. */
export async function transcribe(wav: Uint8Array): Promise<string> {
  const s = settings()
  const exe = whisperOverride?.command ?? s.whisper?.exe
  if (!exe) throw new Error('Dictation needs whisper.cpp: get it in Settings → Voice.')
  const model = VOICE_MODELS.find((m) => m.file === s.model)
  const modelPath = model ? join(modelsDir(), model.file) : ''
  if (!model || !(await exists(modelPath))) throw new Error('Dictation needs a speech model: download one in Settings → Voice.')
  await fs.mkdir(voiceDir(), { recursive: true })
  const file = join(voiceDir(), 'dictation.wav')
  await fs.writeFile(file, wav)
  const language = model.multilingual ? s.language : 'en'
  const threads = String(Math.max(1, Math.min(8, cpus().length - 1)))
  const args = [...(whisperOverride?.args ?? []), '-m', modelPath, '-f', file, '-nt', '-np', '-l', language, '-t', threads]
  const out = await new Promise<string>((resolve, reject) =>
    execFile(exe, args, { windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...(whisperOverride?.env ?? {}) } }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr).trim().split(/\r?\n/).pop() || err.message)) : resolve(String(stdout))
    )
  )
  return cleanTranscript(out)
}

function announce(): void {
  void voiceState().then((state) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('twilight:voice', state)
  })
}

let soon: ReturnType<typeof setTimeout> | null = null
function announceSoon(): void {
  soon ??= setTimeout(() => {
    soon = null
    announce()
  }, 300)
}
