// The document library: folders of your own writing, searched for the passages that bear on a
// message. Word search runs locally over a full-text index; an embedding model (on a local server
// like Ollama, or any OpenAI-compatible provider) adds search by meaning. The passages found go
// into the message as a block, stored with it, so a regenerate sends the same ones.

export interface LibrarySettings {
  /** Folders whose .md and .txt files are searched. */
  folders: string[]
  /** An embedding model for search by meaning; none for word search alone. */
  embedProviderId: string | null
  embedModelId: string | null
  /** Passages added to each message. */
  passages: number
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
  /** The folder's name and the file's path inside it. */
  source: string
  line: number
  text: string
}

export const LIBRARY_OPEN = '<library_passages>'

/** The block a message carries: the passages, each with where it came from. */
export function libraryBlock(hits: LibraryHit[]): string {
  const body = hits.map((h) => `<passage source="${h.source.replace(/"/g, "'")}" line="${h.line}">\n${h.text.trim()}\n</passage>`).join('\n\n')
  return `${LIBRARY_OPEN}\nPassages from the user's document library that may bear on this message, most relevant first. Use them where they help, and say which file a detail comes from.\n\n${body}\n</library_passages>`
}

/** Where a block's passages came from, for showing on the message. */
export function librarySourcesOf(block: string): { source: string; line: number }[] {
  return [...block.matchAll(/<passage source="([^"]*)" line="(\d+)">/g)].map((m) => ({ source: m[1], line: Number(m[2]) }))
}
