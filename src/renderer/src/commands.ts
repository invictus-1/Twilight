import { useSyncExternalStore } from 'react'
import { useInsights } from './insightsStore'
import { useJudge } from './judgeStore'
import { useLibrary } from './libraryStore'
import { useStore, type Mode } from './store'
import { THEMES } from '@shared/themes'
import { setTheme } from './theme'
import { chatInGameFormat } from './gameCopy'
import { useWriting } from './writingStore'

// Every action the command menu (Ctrl+K) offers, with its keyboard shortcut. Shortcuts can be
// rebound in Settings → Keyboard shortcuts; bindings are kept per install in localStorage.

export interface Command {
  id: string
  title: string
  group: 'Go to' | 'Chat' | 'Writing' | 'App' | 'Theme'
  /** The shortcut it ships with, e.g. "Ctrl+Shift+S"; none for menu-only commands. */
  keys?: string
  /** Extra words the menu matches on. */
  hint?: string
  /** Hidden from the menu (and its shortcut idle) when this says no. */
  when?: () => boolean
  run(): void
}

const s = (): ReturnType<typeof useStore.getState> => useStore.getState()

/** Opens a section, refreshing what it lists. */
export function openMode(mode: Mode): void {
  s().setMode(mode)
  if (mode === 'write') void useWriting.getState().refresh()
  else if (mode === 'judge') void useJudge.getState().refresh()
  else if (mode === 'insights') void useInsights.getState().init()
}
const go = openMode
const settings = (section?: string): void => s().setSettingsOpen(true, section)
const split = (): boolean => !!s().current?.split

export const COMMANDS: Command[] = [
  { id: 'menu', title: 'Command menu', group: 'App', keys: 'Ctrl+K', run: () => s().setOverlay('commands') },
  { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'App', keys: 'Ctrl+/', hint: 'keys help cheat sheet', run: () => s().setOverlay('shortcuts') },
  { id: 'search', title: 'Search everything', group: 'App', keys: 'Ctrl+Shift+F', hint: 'find chats documents', run: () => s().setOverlay('search') },
  { id: 'new-chat', title: 'New chat', group: 'Chat', keys: 'Ctrl+N', run: () => (go('chat'), void s().newChat()) },
  { id: 'new-persona-chat', title: 'New chat from a persona…', group: 'Chat', hint: 'persona character system prompt library', run: () => s().setOverlay('personas') },
  { id: 'insert-prompt', title: 'Insert a prompt', group: 'Chat', hint: 'saved prompts library snippet composer', run: () => (go('chat'), useLibrary.getState().setPromptsOpen(true)) },
  { id: 'new-doc', title: 'New document', group: 'Writing', keys: 'Ctrl+Shift+N', run: () => (go('write'), void useWriting.getState().newDoc()) },
  { id: 'sidebar', title: 'Toggle sidebar', group: 'App', keys: 'Ctrl+B', run: () => s().toggleSidebar() },
  {
    id: 'split',
    title: 'Clone into split / close split',
    group: 'Chat',
    keys: 'Ctrl+Shift+S',
    hint: 'compare',
    when: () => s().mode === 'chat' && !s().settingsOpen && !!s().current?.path.length,
    run: () => void (split() ? s().closeSplit('a') : s().cloneIntoSplit())
  },
  { id: 'target-a', title: 'Send to pane A', group: 'Chat', keys: 'Alt+1', when: split, run: () => s().setTarget('a') },
  { id: 'target-b', title: 'Send to pane B', group: 'Chat', keys: 'Alt+2', when: split, run: () => s().setTarget('b') },
  { id: 'target-both', title: 'Send to both panes', group: 'Chat', keys: 'Alt+3', when: split, run: () => s().setTarget('both') },
  {
    id: 'model-settings',
    title: 'Model settings',
    group: 'Chat',
    hint: 'system prompt effort temperature',
    when: () => !!s().current,
    run: () => (go('chat'), window.dispatchEvent(new Event('twilight-model-settings')))
  },
  {
    id: 'game-chat',
    title: 'Copy the chat for a game (Game Format)',
    group: 'Chat',
    hint: 'rpg maker export story replies',
    when: () => !!s().current?.path.some((n) => n.role === 'assistant'),
    run: () => void window.twilight.copyText(chatInGameFormat())
  },
  { id: 'go-chat', title: 'Chats', group: 'Go to', keys: 'Ctrl+1', run: () => go('chat') },
  { id: 'go-write', title: 'Writing', group: 'Go to', keys: 'Ctrl+2', run: () => go('write') },
  { id: 'go-judge', title: 'Judge', group: 'Go to', keys: 'Ctrl+3', run: () => go('judge') },
  { id: 'go-insights', title: 'Writer insights', group: 'Go to', keys: 'Ctrl+4', run: () => go('insights') },
  { id: 'settings', title: 'Settings', group: 'Go to', keys: 'Ctrl+,', run: () => settings() },
  { id: 'go-providers', title: 'Model providers', group: 'Go to', hint: 'api key settings', run: () => settings('providers') },
  { id: 'go-library', title: 'Library', group: 'Go to', hint: 'personas prompts settings', run: () => settings('library') },
  { id: 'go-prices', title: 'Prices', group: 'Go to', hint: 'cost price list settings', run: () => settings('prices') },
  { id: 'go-updates', title: 'Updates', group: 'Go to', hint: 'version settings', run: () => settings('updates') },
  { id: 'go-roadmap', title: 'Roadmap', group: 'Go to', run: () => settings('roadmap') },
  { id: 'go-keys', title: 'Rebind keys', group: 'Go to', hint: 'shortcuts settings', run: () => settings('shortcuts') },
  ...THEMES.map((t): Command => ({ id: `theme-${t.id}`, title: t.name, group: 'Theme', hint: `theme colors ${t.note}`, run: () => setTheme(t.id) })),
  { id: 'welcome', title: 'Replay the welcome', group: 'App', hint: 'intro tour', run: () => s().setWelcomeOpen(true) },
  { id: 'data-folder', title: 'Open the data folder', group: 'App', run: () => void window.twilight.openDataFolder() }
]

/** Keys that aren't rebindable, for the shortcut sheet. */
export const FIXED_KEYS: [string, string, string][] = [
  ['Enter / Shift+Enter', 'Send / new line', 'Chat'],
  ['Esc', 'Stop generating; close a menu or Settings', 'Chat'],
  ['1–9', 'Pick a choice (Alt+1–9 while typing)', 'Chat'],
  ['Ctrl+J', 'Ask about the selection', 'Writing'],
  ['Ctrl+B / Ctrl+I / Ctrl+E', 'Bold / italic / code', 'Writing'],
  ['Alt+Enter / Alt+Backspace', 'Accept / reject a suggestion', 'Writing'],
  ['Alt+↑ / Alt+↓', 'Move a paragraph', 'Writing'],
  ['Ctrl+F', 'Find in document', 'Writing']
]

// ——— Bindings ———

const STORE_KEY = 'twilight.keys'
let overrides: Record<string, string> = read()
const listeners = new Set<() => void>()

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function write(next: Record<string, string>): void {
  overrides = next
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable: the binding holds until Twilight closes.
  }
  listeners.forEach((l) => l())
}

/** A command's current shortcut ("" when it has none). */
export function keysFor(id: string): string {
  return overrides[id] ?? COMMANDS.find((c) => c.id === id)?.keys ?? ''
}

/** Binds `keys` to a command; any other command holding them gives them up. "" clears it. */
export function bind(id: string, keys: string): void {
  const next = { ...overrides, [id]: keys }
  if (keys) for (const c of COMMANDS) if (c.id !== id && keysFor(c.id) === keys) next[c.id] = ''
  write(next)
}

export function resetBindings(): void {
  write({})
}

export function isCustom(id: string): boolean {
  return id in overrides && overrides[id] !== COMMANDS.find((c) => c.id === id)?.keys
}

/** Re-renders when a binding changes. */
export function useBindings(): Record<string, string> {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => overrides
  )
}

const CODE_KEYS: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', Space: 'Space'
}

/** The pressed combination as "Ctrl+Alt+Shift+Key", by physical key, so Shift doesn't change the name. */
export function comboOf(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const code = e.code
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^(Digit|Numpad)\d$/.test(code)
      ? code.slice(-1)
      : CODE_KEYS[code] ?? (/^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}

/** The command bound to this key press, if any is available right now. */
export function commandFor(e: KeyboardEvent): Command | null {
  const combo = comboOf(e)
  if (!combo) return null
  // Plain keys and Shift+key are typing, never commands.
  if (!/^(Ctrl|Alt)\+/.test(combo) && !/^F\d/.test(combo)) return null
  return COMMANDS.find((c) => keysFor(c.id) === combo && (!c.when || c.when())) ?? null
}

/** How well `query` matches `text`: every letter in order, scored for runs and word starts; -1 if not. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '')
  const t = text.toLowerCase()
  if (!q) return 0
  if (t.includes(query.toLowerCase().trim())) return 1000 - t.indexOf(query.toLowerCase().trim())
  let score = 0
  let at = -1
  let run = 0
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1)
    if (next < 0) return -1
    run = next === at + 1 ? run + 1 : 0
    score += 1 + run * 3 + (next === 0 || /[\s/·-]/.test(t[next - 1]) ? 5 : 0)
    at = next
  }
  return score
}
