// The library: personas (a saved system prompt with a name, and optionally a model and choice
// cards) and prompts (saved messages to insert in the composer). Both live in Twilight's own
// database; a library file moves them between installs.

export interface Persona {
  id: string
  name: string
  /** One line saying what it's for, shown in the choosers. */
  description: string
  systemPrompt: string
  /** The model chats started from it use; null for the chat default. */
  providerId: string | null
  modelId: string | null
  /** Chats started from it begin with choice cards on. */
  choiceCards: boolean
}

export interface SavedPrompt {
  id: string
  name: string
  /** May hold {{input}}, filled in when it's inserted. */
  text: string
}

export interface Library {
  personas: Persona[]
  prompts: SavedPrompt[]
}

/** The one placeholder a prompt can have. */
export const INPUT_PLACEHOLDER = '{{input}}'

export const hasInput = (text: string): boolean => text.includes(INPUT_PLACEHOLDER)

/** The prompt's text with every {{input}} replaced by the value. */
export const fillInput = (text: string, value: string): string => text.split(INPUT_PLACEHOLDER).join(value)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A persona from anything shaped roughly like one (a file, an older save); null when it has no name or prompt. */
export function toPersona(raw: unknown, newId: () => string): Persona | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = str(r.name).trim()
  const systemPrompt = str(r.systemPrompt)
  if (!name || !systemPrompt.trim()) return null
  const model = str(r.modelId).trim()
  const provider = str(r.providerId).trim()
  return {
    id: str(r.id).trim() || newId(),
    name,
    description: str(r.description).trim().split('\n')[0],
    systemPrompt,
    providerId: model && provider ? provider : null,
    modelId: model && provider ? model : null,
    choiceCards: r.choiceCards === true
  }
}

export function toPrompt(raw: unknown, newId: () => string): SavedPrompt | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = str(r.name).trim()
  const text = str(r.text)
  if (!name || !text.trim()) return null
  return { id: str(r.id).trim() || newId(), name, text }
}

/**
 * Reads a library file: as exported ({ personas, prompts }), or a single persona or prompt
 * written by hand. Throws a readable message when there's nothing to take from it.
 */
export function parseLibrary(text: string, newId: () => string): Library {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const r = (raw ?? {}) as Record<string, unknown>
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const single = !Array.isArray(r.personas) && !Array.isArray(r.prompts)
  const personas = (single && 'systemPrompt' in r ? [r] : list(r.personas)).map((p) => toPersona(p, newId)).filter((p): p is Persona => !!p)
  const prompts = (single && 'text' in r ? [r] : list(r.prompts)).map((p) => toPrompt(p, newId)).filter((p): p is SavedPrompt => !!p)
  if (!personas.length && !prompts.length) throw new Error('No personas or prompts in that file. Each needs a name, and a system prompt or text.')
  return { personas, prompts }
}

export const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)
