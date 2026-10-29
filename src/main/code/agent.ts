import { BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { commandRisk, lineDiff, type CodeEntry, type CodeEvent, type CodeMode, type CodePending, type CodeResponse, type CodeSessionSummary, type CodeSessionView, type CodeTask } from '@shared/code'
import { kvDelete, kvGet, kvSet } from '../db'
import { getDefaults } from '../chat'
import { getApiKey, getProvider, modelOptions } from '../providers'
import { describeAnthropicError } from '../providers/anthropic'
import { step, type Block, type Msg, type ToolCall, type ToolDef } from './llm'
import * as ws from './workspace'

// The Code tab's engine. A session is a folder, a model and a transcript. The agent works in
// steps: it answers, may call tools, gets their results, and goes on until it has nothing left
// to call. Reading is free; anything that changes files or runs a command waits for your
// approval (edits can be let through for a session; commands that can delete or overwrite never
// can), and every change is snapshotted first so it can be undone.

const MAX_STEPS = 40

interface Stored {
  id: string
  title: string
  folder: string
  providerId: string
  modelId: string
  mode: CodeMode
  allowed: string[]
  system: string
  messages: Msg[]
  entries: CodeEntry[]
  snapshots: { n: number; label: string; undone: boolean }[]
  /** Things to tell the model with your next message (an undo, say). */
  notes: string[]
  tokens: { input: number; output: number; cacheRead: number }
  error: string | null
  createdAt: number
  updatedAt: number
  /** The agent's own task list (update_tasks). */
  tasks?: CodeTask[]
  /** The project's instructions file, as last sent to the model. */
  instructions?: { file: string; hash: string } | null
  /** Web search and fetch (Claude only). */
  web?: boolean
  /** The mode the last message went with, so a change is told to the model once. */
  lastMode?: CodeMode
  /** The last turn ended with a plan, in plan mode. */
  planFinished?: boolean
}

interface Live {
  controller: AbortController
  pending: { request: CodePending; resolve: (r: CodeResponse) => void } | null
}

const live = new Map<string, Live>()
const key = (id: string): string => `code.session.${id}`

const TOOLS: ToolDef[] = [
  {
    name: 'list_files',
    description: 'List the files and folders under a path in the project (folders first). Big generated folders like node_modules are shown but not opened.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Folder, relative to the project. Default ".".' }, depth: { type: 'integer', description: 'How many levels to open, 1–4. Default 2.' } } }
  },
  {
    name: 'read_file',
    description: 'Read a text file, with line numbers. Long files come in pages: use offset to read on.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'First line to read (1-based).' }, limit: { type: 'integer', description: 'How many lines. Default 2000.' } }, required: ['path'] }
  },
  {
    name: 'search_files',
    description: 'Search file contents with a regular expression (case-insensitive). Returns file:line: text, up to 200 matches.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Folder to search in. Default ".".' }, glob: { type: 'string', description: 'Only file names matching this, like "*.ts".' } }, required: ['pattern'] }
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in a file. old_text must appear exactly once (copy it from read_file, without the line numbers), unless replace_all is true. The user sees the diff and approves it.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_text', 'new_text'] }
  },
  {
    name: 'write_file',
    description: 'Create a file, or replace a whole file. Prefer edit_file for changes to an existing file. The user sees the diff and approves it.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
  },
  {
    name: 'delete_file',
    description: 'Move one file to the Recycle Bin. The user approves it, and it can be undone.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'run_command',
    description: 'Run one PowerShell command in the project folder (Windows) and get its exit code and output. The user approves each command. Use it for builds, tests and git; avoid commands that delete or overwrite files.',
    input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout_seconds: { type: 'integer', description: 'Default 120, at most 600.' } }, required: ['command'] }
  },
  {
    name: 'update_tasks',
    description:
      'Keep your task list for this request, shown to the user above the message box. Send the whole list each time: the steps you plan, with the one you are on as doing and finished ones as done. Use it for work of three steps or more.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'doing', 'done'] } }, required: ['title', 'status'] }
        }
      },
      required: ['tasks']
    }
  },
  {
    name: 'ask_user',
    description: "Ask the user a question and wait for the answer. Use it whenever you're unsure what they want, before doing something they might not expect.",
    input_schema: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, description: 'Up to 5 suggested answers.' } }, required: ['question'] }
  }
]

/** The project's own instructions for agents, from the first of these at the top of the folder. */
const INSTRUCTION_FILES = ['TWILIGHT.md', 'AGENTS.md', 'CLAUDE.md']
const MAX_INSTRUCTIONS = 20_000

function readInstructions(folder: string): { file: string; text: string; hash: string } | null {
  for (const file of INSTRUCTION_FILES) {
    const full = join(folder, file)
    if (!existsSync(full)) continue
    try {
      const text = readFileSync(full, 'utf8').slice(0, MAX_INSTRUCTIONS)
      return { file, text, hash: createHash('sha256').update(text).digest('hex') }
    } catch {
      return null
    }
  }
  return null
}

function systemPrompt(folder: string, instructions: { file: string; text: string } | null = null): string {
  return [
    `You are a careful coding agent working in the user's project folder "${basename(folder)}" on Windows, inside Twilight. Paths are relative to that folder; you can't reach outside it.`,
    'Work in small, verifiable steps. Look before you change: list and read the relevant files first. Prefer edit_file with exact text over rewriting whole files. Keep changes focused on what was asked.',
    'Every edit, deletion and command is shown to the user to approve, and they can undo any change. If they decline, take their reason into account and adjust; don\'t retry the same thing.',
    'Ask with ask_user when a request is ambiguous or a step could surprise them. Never delete or overwrite work you were not asked to touch.',
    'When you finish, say briefly what you changed and how you checked it, and anything left to do.',
    'For work of three steps or more, keep a task list with update_tasks so the user can follow along.',
    ...(instructions ? [`The project's own instructions, from ${instructions.file} (follow them):\n<project_instructions>\n${instructions.text}\n</project_instructions>`] : [])
  ].join('\n\n')
}

// One object per session, shared by the running agent and everything you do meanwhile (changing
// the mode, answering), so neither saves over the other.
const sessions = new Map<string, Stored>()

function load(id: string): Stored {
  const cached = sessions.get(id)
  if (cached) return cached
  const s = kvGet<Stored>(key(id))
  if (!s) throw new Error('That code session no longer exists.')
  sessions.set(id, s)
  return s
}

function save(s: Stored): void {
  s.updatedAt = Date.now()
  kvSet(key(s.id), s)
  const list = (kvGet<string[]>('code.sessions') ?? []).filter((x) => x !== s.id)
  kvSet('code.sessions', [s.id, ...list])
}

function emit(event: CodeEvent): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('twilight:code', event)
}

export function view(s: Stored): CodeSessionView {
  const l = live.get(s.id)
  return {
    id: s.id,
    title: s.title,
    folder: s.folder,
    providerId: s.providerId,
    modelId: s.modelId,
    mode: s.mode,
    entries: s.entries,
    pending: l?.pending?.request ?? null,
    running: !!l,
    undoable: s.snapshots.filter((x) => !x.undone).map(({ n, label }) => ({ n, label })),
    allowed: s.allowed,
    error: s.error,
    tokens: s.tokens,
    tasks: s.tasks ?? [],
    instructions: s.instructions?.file ?? null,
    web: !!s.web,
    webAvailable: providerKind(s.providerId) === 'anthropic',
    planReady: !!s.planFinished && s.mode === 'plan' && !l
  }
}

const providerKind = (id: string): string | null => {
  try {
    return getProvider(id).kind
  } catch {
    return null
  }
}

const push = (s: Stored): void => {
  save(s)
  emit({ kind: 'view', view: view(s) })
}

export function listSessions(): CodeSessionSummary[] {
  return (kvGet<string[]>('code.sessions') ?? []).flatMap((id) => {
    const s = sessions.get(id) ?? kvGet<Stored>(key(id))
    if (!s) return []
    const l = live.get(id)
    return [{ id, title: s.title, folder: s.folder, updatedAt: s.updatedAt, running: !!l, waiting: !!l?.pending }]
  })
}

export function openSession(id: string): CodeSessionView {
  return view(load(id))
}

/** A new session in a folder (chosen with a dialog when none is given); null if cancelled. */
export async function newSession(win: BrowserWindow | null, folder?: string): Promise<CodeSessionView | null> {
  let chosen = folder
  if (!chosen) {
    const options: Electron.OpenDialogOptions = { title: 'Choose the project folder', properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    chosen = result.filePaths[0]
  }
  if (!existsSync(chosen)) throw new Error("That folder doesn't exist.")
  const defaults = getDefaults()
  const instructions = readInstructions(chosen)
  const s: Stored = {
    id: randomUUID(),
    title: basename(chosen),
    folder: chosen,
    providerId: defaults.providerId,
    modelId: defaults.modelId,
    mode: 'ask',
    allowed: [],
    system: systemPrompt(chosen, instructions),
    instructions: instructions && { file: instructions.file, hash: instructions.hash },
    tasks: [],
    messages: [],
    entries: [],
    snapshots: [],
    notes: [],
    tokens: { input: 0, output: 0, cacheRead: 0 },
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  sessions.set(s.id, s)
  save(s)
  emit({ kind: 'list' })
  return view(s)
}

export function setOptions(id: string, patch: { mode?: CodeMode; providerId?: string; modelId?: string; web?: boolean }): CodeSessionView {
  const s = load(id)
  if (patch.mode) s.mode = patch.mode
  if (patch.web !== undefined) s.web = patch.web
  if (patch.providerId && patch.modelId) {
    s.providerId = patch.providerId
    s.modelId = patch.modelId
  }
  push(s)
  return view(s)
}

export async function deleteSession(id: string): Promise<void> {
  stop(id)
  kvDelete(key(id))
  sessions.delete(id)
  kvSet('code.sessions', (kvGet<string[]>('code.sessions') ?? []).filter((x) => x !== id))
  // Its snapshots are Twilight's own copies, not your files.
  await fs.rm(join(app.getPath('userData'), 'code-snapshots', id), { recursive: true, force: true })
  emit({ kind: 'list' })
}

export function stop(id: string): void {
  const l = live.get(id)
  if (!l) return
  l.controller.abort()
  ws.stopCommand(id)
  l.pending?.resolve({ approve: false, text: 'Stopped by the user.' })
}

export function respond(id: string, pendingId: string, response: CodeResponse): void {
  const p = live.get(id)?.pending
  if (p && p.request.id === pendingId) p.resolve(response)
}

/** Undoes the newest change (or every change) still in place. */
export async function undo(id: string, all: boolean): Promise<CodeSessionView> {
  const s = load(id)
  if (live.has(id)) throw new Error('Stop the agent before undoing.')
  const open = s.snapshots.filter((x) => !x.undone).reverse()
  for (const snap of all ? open : open.slice(0, 1)) {
    const files = await ws.restore(id, snap.n, s.folder)
    snap.undone = true
    for (const e of s.entries) if (e.kind === 'tool' && e.snapshot === snap.n) e.status = 'undone'
    s.entries.push({ kind: 'note', text: `Undid: ${snap.label}` })
    s.notes.push(`The user undid your change "${snap.label}"; ${files.join(', ')} ${files.length === 1 ? 'is' : 'are'} back as before it.`)
  }
  push(s)
  return view(s)
}

/**
 * Goes back to just before one of your messages: every file changed since is put back, and the
 * conversation is cut there (what came before stays, so it still reads from the cache). Returns
 * the message, for the message box.
 */
export async function rewind(id: string, entryIndex: number): Promise<{ view: CodeSessionView; text: string }> {
  const s = load(id)
  if (live.has(id)) throw new Error('Stop the agent before rewinding.')
  const entry = s.entries[entryIndex]
  if (entry?.kind !== 'user' || !entry.checkpoint) throw new Error("This message can't be rewound to.")
  const cp = entry.checkpoint
  const later = s.snapshots.slice(cp.snapshots)
  for (const snap of [...later].reverse()) if (!snap.undone) await ws.restore(id, snap.n, s.folder)
  for (const snap of later) await fs.rm(join(app.getPath('userData'), 'code-snapshots', id, String(snap.n)), { recursive: true, force: true })
  s.snapshots = s.snapshots.slice(0, cp.snapshots)
  s.messages = s.messages.slice(0, cp.messages)
  s.entries = s.entries.slice(0, cp.entries)
  s.notes = []
  s.error = null
  s.planFinished = false
  push(s)
  emit({ kind: 'list' })
  return { view: view(s), text: entry.text }
}

/** Your message; starts the agent if it isn't already working. */
export function send(id: string, text: string): CodeSessionView {
  const s = load(id)
  if (live.has(id)) throw new Error('The agent is still working. Stop it first, or wait.')
  if (!text.trim()) return view(s)
  // Anything to tell the model (an undo, a change of mode, new project instructions) goes with
  // this message, so the transcript only grows and the cache holds.
  const told = [...s.notes]
  const was = s.lastMode ?? 'ask'
  if (s.mode === 'plan' && was !== 'plan')
    told.push('Plan mode: look around as much as you need, then write a short numbered plan of the changes you would make and how you would check them. Change nothing and run no commands yet; the user approves the plan first.')
  if (was === 'plan' && s.mode !== 'plan') told.push(`The user approved the plan. Carry it out now${s.mode === 'read' ? ', though this session is read-only, so describe the changes instead of making them' : ''}.`)
  s.lastMode = s.mode
  const now = readInstructions(s.folder)
  if ((now?.hash ?? null) !== (s.instructions?.hash ?? null)) {
    told.push(now ? `The project's instructions changed. They now read, from ${now.file}:\n<project_instructions>\n${now.text}\n</project_instructions>` : "The project's instructions file was removed; go by the request alone.")
    s.instructions = now && { file: now.file, hash: now.hash }
  }
  const notes = told.length ? [{ type: 'text', text: `<note>\n${told.join('\n\n')}\n</note>` }] : []
  s.notes = []
  s.planFinished = false
  const checkpoint = { messages: s.messages.length, snapshots: s.snapshots.length, entries: s.entries.length }
  // After a stop, the transcript can end on tool results that were never sent; this message joins them.
  const last = s.messages.at(-1)
  if (last?.role === 'user') last.content.push(...notes, { type: 'text', text })
  else s.messages.push({ role: 'user', content: [...notes, { type: 'text', text }] })
  s.entries.push({ kind: 'user', text, checkpoint })
  if (s.entries.filter((e) => e.kind === 'user').length === 1) s.title = text.trim().split('\n')[0].slice(0, 60) || s.title
  s.error = null
  const controller = new AbortController()
  live.set(id, { controller, pending: null })
  push(s)
  emit({ kind: 'list' })
  void loop(s, controller.signal).finally(() => {
    live.delete(id)
    push(s)
    emit({ kind: 'list' })
  })
  return view(s)
}

async function loop(s: Stored, signal: AbortSignal): Promise<void> {
  try {
    for (let n = 0; n < MAX_STEPS; n++) {
      if (signal.aborted) return
      const config = getProvider(s.providerId)
      const entry: CodeEntry = { kind: 'assistant', text: '' }
      s.entries.push(entry)
      push(s)
      const result = await step({
        config,
        apiKey: getApiKey(config.id),
        modelId: s.modelId,
        options: modelOptions(s.providerId, s.modelId),
        system: s.system,
        messages: s.messages,
        tools: TOOLS,
        web: !!s.web && config.kind === 'anthropic',
        signal,
        onText: (delta) => {
          entry.text += delta
          emit({ kind: 'text', sessionId: s.id, delta })
        }
      })
      entry.text = result.text
      if (!entry.text) s.entries.splice(s.entries.indexOf(entry), 1)
      s.messages.push({ role: 'assistant', content: result.content })
      s.tokens.input += result.usage.input + result.usage.cacheWrite
      s.tokens.output += result.usage.output
      s.tokens.cacheRead += result.usage.cacheRead
      if (result.error) s.error = result.error
      // Searches and page reads Claude ran itself, shown in the transcript.
      for (const b of result.content.filter((x) => x.type === 'server_tool_use')) {
        const input = (b.input ?? {}) as { query?: string; url?: string }
        s.entries.push({ kind: 'tool', id: String(b.id), tool: String(b.name), title: b.name === 'web_fetch' ? `Read ${input.url ?? 'a page'}` : `Searched the web for "${input.query ?? ''}"`, status: 'done' })
      }
      if (!result.calls.length) {
        if (s.mode === 'plan') s.planFinished = true
        return
      }
      const results: Block[] = []
      for (const call of result.calls) {
        const out = signal.aborted ? { content: 'Stopped by the user before this ran.', error: true } : await runTool(s, call, signal)
        results.push({ type: 'tool_result', tool_use_id: call.id, content: out.content, ...(out.error ? { is_error: true } : {}) })
      }
      s.messages.push({ role: 'user', content: results })
      push(s)
      if (signal.aborted) return
    }
    s.entries.push({ kind: 'note', text: `Paused after ${MAX_STEPS} steps. Say "go on" to continue.` })
  } catch (err) {
    if (!signal.aborted) s.error = describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err))
  } finally {
    // A stop between a call and its result would leave the transcript unanswerable; close it.
    const last = s.messages.at(-1)
    if (last?.role === 'assistant') {
      const open = last.content.filter((b) => b.type === 'tool_use')
      if (open.length) s.messages.push({ role: 'user', content: open.map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: 'Stopped by the user.', is_error: true })) })
    }
  }
}

/** Waits for your decision on an approval or a question. */
function ask(s: Stored, request: Omit<CodePending, 'id'>): Promise<CodeResponse> {
  const l = live.get(s.id)!
  return new Promise((resolve) => {
    l.pending = {
      request: { ...request, id: randomUUID() },
      resolve: (r) => {
        l.pending = null
        resolve(r)
      }
    }
    push(s)
    emit({ kind: 'list' })
  })
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const PLAN_ONLY = 'Plan mode: nothing is changed or run yet. Put this step in the plan; the user approves the plan before anything happens.'
const declined = (r: CodeResponse): string => `The user declined.${r.text ? ` They said: ${r.text}` : ''}`

async function runTool(s: Stored, call: ToolCall, signal: AbortSignal): Promise<{ content: string; error?: boolean }> {
  const i = call.input
  const path = str(i.path) || '.'
  const entry: Extract<CodeEntry, { kind: 'tool' }> = { kind: 'tool', id: call.id, tool: call.name, title: call.name, status: 'running' }
  const finish = (status: typeof entry.status, content: string, error = false): { content: string; error?: boolean } => {
    entry.status = status
    push(s)
    return { content, error }
  }
  try {
    if ('__unreadable' in i) throw new Error("The tool call's arguments weren't valid JSON. Send them again.")
    switch (call.name) {
      case 'list_files': {
        entry.title = `Listed ${path}`
        s.entries.push(entry)
        const out = await ws.listFiles(s.folder, path, Math.min(4, Math.max(1, Number(i.depth) || 2)))
        entry.output = out
        return finish('done', out)
      }
      case 'read_file': {
        entry.title = `Read ${path}`
        s.entries.push(entry)
        const out = await ws.readFile(s.folder, path, Number(i.offset) || 1, Number(i.limit) || 2000)
        return finish('done', out)
      }
      case 'search_files': {
        entry.title = `Searched for "${str(i.pattern)}"${i.glob ? ` in ${str(i.glob)}` : ''}`
        s.entries.push(entry)
        const out = await ws.searchFiles(s.folder, str(i.pattern), str(i.path) || '.', str(i.glob) || undefined)
        entry.output = out
        return finish('done', out)
      }
      case 'update_tasks': {
        const tasks = (Array.isArray(i.tasks) ? (i.tasks as Record<string, unknown>[]) : []).slice(0, 30).map((t) => ({
          title: str(t.title).slice(0, 200),
          status: (['pending', 'doing', 'done'].includes(str(t.status)) ? str(t.status) : 'pending') as CodeTask['status']
        }))
        s.tasks = tasks.filter((t) => t.title)
        push(s)
        return { content: `Task list updated (${s.tasks.filter((t) => t.status === 'done').length} of ${s.tasks.length} done).` }
      }
      case 'edit_file':
      case 'write_file': {
        const before = await ws.currentText(s.folder, path)
        const after =
          call.name === 'write_file' ? str(i.content) : ws.applyEdit(before ?? (() => { throw new Error(`${path} doesn't exist. Use write_file to create it.`) })(), str(i.old_text), str(i.new_text), i.replace_all === true)
        const diff = lineDiff(before ?? '', after)
        const verb = before === null ? 'Created' : 'Edited'
        // Named for what it will do until it's done.
        entry.title = `${before === null ? 'Create' : 'Edit'} ${path}`
        entry.diff = diff
        s.entries.push(entry)
        if (s.mode === 'read') return finish('declined', 'This session is read-only: describe the change instead of making it.', true)
        if (s.mode === 'plan') return finish('declined', PLAN_ONLY, true)
        if (s.mode === 'ask') {
          const r = await ask(s, { kind: before === null ? 'write' : 'edit', title: `${verb === 'Created' ? 'Create' : 'Edit'} ${path}`, path, diff })
          if (!r.approve) return finish('declined', declined(r))
          if (r.always) s.mode = 'edits'
        }
        const n = s.snapshots.length + 1
        await ws.snapshot(s.id, n, s.folder, [path])
        await ws.writeText(s.folder, path, after)
        entry.title = `${verb} ${path}`
        s.snapshots.push({ n, label: `${verb.toLowerCase()} ${path}`, undone: false })
        entry.snapshot = n
        const added = diff.filter((d) => d.kind === 'add').length
        const removed = diff.filter((d) => d.kind === 'del').length
        return finish('done', `${verb} ${path} (+${added} −${removed} lines).`)
      }
      case 'delete_file': {
        entry.title = `Moved ${path} to the Recycle Bin`
        s.entries.push(entry)
        if (s.mode === 'read') return finish('declined', 'This session is read-only.', true)
        if (s.mode === 'plan') return finish('declined', PLAN_ONLY, true)
        if ((await ws.currentText(s.folder, path)) === null) throw new Error(`${path} doesn't exist.`)
        // Deleting always asks, whatever the mode.
        const r = await ask(s, { kind: 'delete', title: `Move ${path} to the Recycle Bin`, path })
        if (!r.approve) return finish('declined', declined(r))
        const n = s.snapshots.length + 1
        await ws.snapshot(s.id, n, s.folder, [path])
        await ws.removeFile(s.folder, path)
        s.snapshots.push({ n, label: `delete ${path}`, undone: false })
        entry.snapshot = n
        return finish('done', `Moved ${path} to the Recycle Bin.`)
      }
      case 'run_command': {
        const command = str(i.command).trim()
        entry.title = `Ran ${command}`
        s.entries.push(entry)
        if (s.mode === 'read') return finish('declined', 'This session is read-only: suggest the command instead.', true)
        if (s.mode === 'plan') return finish('declined', PLAN_ONLY, true)
        const risk = commandRisk(command)
        if (risk || !s.allowed.includes(command)) {
          const r = await ask(s, { kind: 'command', title: 'Run a command', command, risk: risk ?? undefined })
          if (!r.approve) return finish('declined', declined(r))
          if (r.always && !risk && !s.allowed.includes(command)) s.allowed.push(command)
        }
        entry.status = 'running'
        push(s)
        const res = await ws.runCommand(s.id, s.folder, command, Number(i.timeout_seconds) || 120)
        if (signal.aborted) return finish('error', 'Stopped by the user while it ran.', true)
        entry.output = res.output || '(no output)'
        const head = res.timedOut ? 'Timed out and was stopped.' : `Exit code ${res.code}.`
        return finish(res.code === 0 ? 'done' : 'error', `${head}\n${res.output}`.trim(), res.code !== 0)
      }
      case 'ask_user': {
        const question = str(i.question)
        const options = Array.isArray(i.options) ? i.options.map(String).slice(0, 5) : []
        const q: CodeEntry = { kind: 'question', question, answer: null }
        s.entries.push(q)
        const r = await ask(s, { kind: 'question', title: 'A question', question, options })
        if (signal.aborted) {
          q.answer = 'Stopped before answering'
          return { content: 'Stopped by the user before answering.', error: true }
        }
        q.answer = r.text ?? (r.approve ? 'Yes' : 'No answer')
        push(s)
        return { content: r.text ? `The user answered: ${r.text}` : 'The user gave no answer.' }
      }
      default:
        throw new Error(`There's no tool called ${call.name}.`)
    }
  } catch (err) {
    if (!s.entries.includes(entry)) s.entries.push(entry)
    entry.output = err instanceof Error ? err.message : String(err)
    return finish('error', entry.output, true)
  }
}
