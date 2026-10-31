// The story bible (2.0): the characters, places, things, groups and lore of a story, each with
// short facts, read by a model from the library documents you choose and kept only once you
// accept them. Chats find the entries a message names, and the continuity watcher checks new
// writing against them.

export type BibleKind = 'character' | 'place' | 'thing' | 'group' | 'lore'
export const BIBLE_KINDS: { kind: BibleKind; label: string; plural: string }[] = [
  { kind: 'character', label: 'Character', plural: 'Characters' },
  { kind: 'place', label: 'Place', plural: 'Places' },
  { kind: 'thing', label: 'Thing', plural: 'Things' },
  { kind: 'group', label: 'Group', plural: 'Groups' },
  { kind: 'lore', label: 'Lore', plural: 'Lore' }
]
export const isKind = (k: unknown): k is BibleKind => BIBLE_KINDS.some((x) => x.kind === k)

/** Proposed: waiting for you. Accepted: counts. Removed: turned down, and not proposed again. */
export type BibleStatus = 'proposed' | 'accepted' | 'removed'

export interface BibleFact {
  id: string
  entryId: string
  text: string
  /** Where it was read: a library file ("Notes/Profiles.md"), or "you" or a chat's title. */
  source: string
  line: number | null
  /** The headings it sat under, which say where in the story it holds ("Part one › Chapter 4"). */
  section: string
  status: BibleStatus
  createdAt: number
}

export interface BibleEntry {
  id: string
  kind: BibleKind
  name: string
  aliases: string[]
  /** Your own notes, never read from documents. */
  notes: string
  status: BibleStatus
  createdAt: number
  updatedAt: number
  facts: BibleFact[]
}

export interface BibleSettings {
  /** The whole feature: off, nothing reads, nothing goes into chats, nothing is checked. */
  on: boolean
  /** Library files (their full paths) the bible reads. */
  sources: string[]
}

export interface BibleSource {
  path: string
  /** As the library shows it: the folder's name and the path inside it. */
  source: string
  chosen: boolean
  /** Read since it last changed. */
  current: boolean
}

export interface BibleState {
  settings: BibleSettings
  entries: BibleEntry[]
  sources: BibleSource[]
  /** Reading in progress: passages so far and in all, and the file. */
  reading: { done: number; total: number; file: string } | null
  lastRead: number | null
  error: string | null
  /** Whether a model is chosen to read and check with (the scout's). */
  model: boolean
}

/** One place new writing disagrees with the bible. */
export interface ContinuityIssue {
  id: string
  /** The words in the new text, exactly. */
  quote: string
  /** What the new text claims, as a fact. */
  says: string
  why: string
  factId: string
  factText: string
  entryId: string
  entryName: string
}

export const BIBLE_OPEN = '<story_bible>'

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The names an entry goes by, longest first so "Old Wren" wins over "Wren". */
export const namesOf = (e: Pick<BibleEntry, 'name' | 'aliases'>): string[] =>
  [e.name, ...e.aliases].map((n) => n.trim()).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length)

/** Entries the text names, by name or alias as whole words (case aside), in the order given. */
export function mentioned<T extends Pick<BibleEntry, 'name' | 'aliases'>>(text: string, entries: T[]): T[] {
  return entries.filter((e) => {
    const names = namesOf(e)
    return names.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])(${names.map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text)
  })
}

const factLine = (f: BibleFact): string => `- ${f.text}${f.section ? ` (as of ${f.section})` : ''}`

/** The block a message carries: the accepted entries it names, with their facts. */
export function bibleBlock(entries: BibleEntry[]): string {
  const body = entries
    .map((e) => {
      const head = `## ${e.name} (${BIBLE_KINDS.find((k) => k.kind === e.kind)?.label.toLowerCase() ?? e.kind}${e.aliases.length ? `; also ${e.aliases.join(', ')}` : ''})`
      return [head, ...e.facts.filter((f) => f.status === 'accepted').map(factLine), e.notes.trim() ? `Notes: ${e.notes.trim()}` : ''].filter(Boolean).join('\n')
    })
    .join('\n\n')
  return `${BIBLE_OPEN}\nFrom the writer's story bible: established facts about who and what this message names. Keep to them.\n\n${body}\n</story_bible>`
}

/** Text for comparing facts: case, spacing and end punctuation aside. */
export const sameFact = (a: string, b: string): boolean => {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!;,\s]+$/, '').trim()
  return norm(a) === norm(b)
}

/** Names compared the same way: case and spacing aside. */
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')
