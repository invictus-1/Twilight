import { randomUUID } from 'node:crypto'
import { byName, parseLibrary, toPersona, toPrompt, type Library, type Persona, type SavedPrompt } from '@shared/library'
import * as db from './db'

// Personas and prompts are kept in the kv table, each list sorted by name. Nothing ships in
// them: a fresh install starts with an empty library.

const personas = (): Persona[] => (db.kvGet<Persona[]>('personas') ?? []).map((p) => toPersona(p, randomUUID)).filter((p): p is Persona => !!p)
const prompts = (): SavedPrompt[] => (db.kvGet<SavedPrompt[]>('prompts') ?? []).map((p) => toPrompt(p, randomUUID)).filter((p): p is SavedPrompt => !!p)

export function getLibrary(): Library {
  return { personas: personas(), prompts: prompts() }
}

export function getPersona(id: string): Persona | undefined {
  return personas().find((p) => p.id === id)
}

/** Saves a persona (replacing one with the same id); a new one gets an id here. */
export function savePersona(persona: Persona): Library {
  const clean = toPersona({ ...persona, id: persona.id || randomUUID() }, randomUUID)
  if (!clean) throw new Error('A persona needs a name and a system prompt.')
  db.kvSet('personas', [...personas().filter((p) => p.id !== clean.id), clean].sort(byName))
  return getLibrary()
}

export function deletePersona(id: string): Library {
  db.kvSet('personas', personas().filter((p) => p.id !== id))
  return getLibrary()
}

export function savePrompt(prompt: SavedPrompt): Library {
  const clean = toPrompt({ ...prompt, id: prompt.id || randomUUID() }, randomUUID)
  if (!clean) throw new Error('A prompt needs a name and some text.')
  db.kvSet('prompts', [...prompts().filter((p) => p.id !== clean.id), clean].sort(byName))
  return getLibrary()
}

export function deletePrompt(id: string): Library {
  db.kvSet('prompts', prompts().filter((p) => p.id !== id))
  return getLibrary()
}

/** Adds what a library file holds; an item with the id of one you have replaces it. */
export function importLibrary(text: string): { library: Library; added: number } {
  const incoming = parseLibrary(text, randomUUID)
  const ids = (list: { id: string }[]): Set<string> => new Set(list.map((x) => x.id))
  const p = ids(incoming.personas)
  const q = ids(incoming.prompts)
  db.kvSet('personas', [...personas().filter((x) => !p.has(x.id)), ...incoming.personas].sort(byName))
  db.kvSet('prompts', [...prompts().filter((x) => !q.has(x.id)), ...incoming.prompts].sort(byName))
  return { library: getLibrary(), added: incoming.personas.length + incoming.prompts.length }
}

/** The library (or just the items with these ids) as a file to save. */
export function libraryFile(ids?: string[]): string {
  const keep = ids?.length ? new Set(ids) : null
  const pick = <T extends { id: string }>(list: T[]): T[] => (keep ? list.filter((x) => keep.has(x.id)) : list)
  return JSON.stringify({ twilightLibrary: 1, personas: pick(personas()), prompts: pick(prompts()) }, null, 2)
}
