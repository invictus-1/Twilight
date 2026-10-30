// The document library: folders of your own writing, searched for the passages that bear on a
// message. Word search runs locally over a full-text index; an embedding model (on a local server
// like Ollama, or any OpenAI-compatible provider) adds search by meaning. The passages found go
// into the message as a block, stored with it, so a regenerate sends the same ones. With a scout
// model chosen, a small fast model reads the best candidates first and picks what the reply needs,
// which comes as whole stretches of story in the order a reader meets them.

export interface LibrarySettings {
  /** Folders whose .md and .txt files are searched. */
  folders: string[]
  /** An embedding model for search by meaning; none for word search alone. */
  embedProviderId: string | null
  embedModelId: string | null
  /** Passages added to each message. */
  passages: number
  /** The scout: a small fast model that picks passages for each message; none for plain search. */
  scoutProviderId: string | null
  scoutModelId: string | null
  /** About how many words of story the scout may bring to one message. */
  scoutWords: number
}

/** What the scout did for one message, for the test and for showing on the message. */
export interface ScoutResult {
  hits: LibraryHit[]
  /** Searches the scout asked for after reading the first candidates. */
  searches: string[]
  /** How many candidates it read, and how many it picked. */
  read: number
  picked: number
  ms: number
}

/** One question of a scout test file: a message, and words the right passages contain. */
export interface ScoutCase {
  ask: string
  /** The end of the reply before the message, if it matters. */
  recent?: string
  expect: string[]
}

export interface ScoutCaseResult {
  ask: string
  plain: { found: number; chars: number }
  scout: { found: number; chars: number; ms: number; searches: string[] } | { error: string }
  expect: number
}

export interface LibraryStatus {
  files: number
  passages: number
  /** Passages with an embedding for the chosen model. */
  embedded: number
  indexing: boolean
  progress: { phase: 'reading' | 'embedding'; done: number; total: number } | null
  lastIndexed: number | null
  error: string | null
}

export interface LibraryHit {
  /** The passage in the index (absent on blocks stored before it was kept). */
  id?: number
  /** The folder's name and the file's path inside it. */
  source: string
  line: number
  /** The headings it sits under, like "Part one › The storm". */
  section?: string
  text: string
}

export const LIBRARY_OPEN = '<library_passages>'

const attr = (v: string): string => v.replace(/"/g, "'")

/** The block a message carries: the passages, each with where it came from. `scouted` passages are chosen and in story order. */
export function libraryBlock(hits: LibraryHit[], scouted = false): string {
  const body = hits.map((h) => `<passage source="${attr(h.source)}" line="${h.line}"${h.section ? ` section="${attr(h.section)}"` : ''}>\n${h.text.trim()}\n</passage>`).join('\n\n')
  const about = scouted
    ? "Passages from the user's document library, chosen for this message and given in story order (the order a reader meets them), each a whole stretch rather than a snippet. Use them where they help, and say which file a detail comes from."
    : "Passages from the user's document library that may bear on this message, most relevant first. Use them where they help, and say which file a detail comes from."
  return `${LIBRARY_OPEN}\n${about}\n\n${body}\n</library_passages>`
}

/** Where a block's passages came from, for showing on the message. */
export function librarySourcesOf(block: string): { source: string; line: number }[] {
  return [...block.matchAll(/<passage source="([^"]*)" line="(\d+)"[^>]*>/g)].map((m) => ({ source: m[1], line: Number(m[2]) }))
}
