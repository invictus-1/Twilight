import type { ChatSettings } from '@shared/types'
import type { LibraryHit, ScoutCase, ScoutCaseResult, ScoutResult } from '@shared/docLibrary'
import { gather, librarySettings, searchLibrary } from './docLibrary'
import { getDefaults } from './chat'
import { parseJson } from './insightsAi'
import { appendLog } from './logs'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'

// The context scout: before a reply, a small fast model reads the library's best candidates for
// your message and picks the ones the reply needs, asking for a few more searches when something
// is missing. What it picks comes as whole stretches of story in the order a reader meets them,
// within a budget, instead of the top few snippets by score. If the scout fails for any reason,
// plain search answers as before.

const FIRST = 24
const FROM_RECENT = 8
const MORE = 8
const SHOWN = 700
// Characters per word of English prose, near enough for a budget.
const CHARS_PER_WORD = 6

export const SCOUT_SYSTEM = `You are the context scout for a fiction writer's app. Another model is about to answer the writer's message, and it can only see the passages you choose from the writer's own documents (manuscript, notes, character profiles, world notes). Read the message and the numbered candidate passages, then choose the ones that model needs to answer well: the scenes, facts and character details the message touches, earlier events it builds on, anything it would otherwise get wrong. Leave out passages that merely share words with the message. Choose few and well; each choice is widened to its surrounding scene afterwards.

If something the reply clearly needs is missing from the candidates, you may ask for up to 3 more searches, each a few plain words.

Answer with JSON only, no other text:
{"pick": [candidate numbers, most needed first], "search": ["short query", ...]}`

const FINAL_NOTE = 'These are all the candidates there will be. Answer with {"pick": [...]} only; no more searches.'

/** The candidates as the scout reads them: number, where it sits, and the start of its text. */
function listing(hits: LibraryHit[]): string {
  return hits
    .map((h) => {
      const where = `${h.source}${h.section ? ` › ${h.section}` : ''}, line ${h.line}`
      const text = h.text.length > SHOWN ? `${h.text.slice(0, SHOWN)}…` : h.text
      return `[${h.id}] ${where}\n${text}`
    })
    .join('\n\n')
}

function ask(message: string, recent: string, candidates: LibraryHit[], final: boolean): string {
  return [
    recent ? `The end of the reply before the writer's message:\n<recent>\n${recent}\n</recent>` : '',
    `The writer's message:\n<message>\n${message}\n</message>`,
    `Candidate passages:\n<candidates>\n${listing(candidates)}\n</candidates>`,
    final ? FINAL_NOTE : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * One question to the scout model (also the story bible's reader and the continuity watcher):
 * its text answer. Quick, not deep: no effort, no tools, a modest output allowance.
 */
export async function askSmall(system: string, user: string, signal: AbortSignal, maxTokens = 2000, kind = 'scout'): Promise<string> {
  const { scoutProviderId, scoutModelId } = librarySettings()
  if (!scoutProviderId || !scoutModelId) throw new Error('No scout model is chosen.')
  const provider = getProvider(scoutProviderId)
  const settings: ChatSettings = {
    ...getDefaults(),
    providerId: scoutProviderId,
    modelId: scoutModelId,
    systemPrompt: '',
    // Quick, not deep: the scout picks, it doesn't write.
    effort: null,
    maxTokens,
    messageLimit: null,
    temperature: null,
    extraParams: '',
    webSearch: false,
    webFetch: false,
    choiceCards: false
  }
  const result = await implFor(provider).generate({
    config: provider,
    apiKey: getApiKey(provider.id),
    system,
    history: [
      {
        id: 'scout', conversation_id: 'scout', parent_id: null, role: 'user', text: user,
        content: JSON.stringify([{ type: 'text', text: user }]), thinking: null, model: null, provider_id: null,
        usage: null, status: 'done', error: null, active_child_id: null, created_at: Date.now()
      }
    ],
    settings,
    options: modelOptions(scoutProviderId, scoutModelId),
    signal,
    onText: () => undefined,
    onThinking: () => undefined
  })
  if (result.error) throw new Error(result.error)
  appendLog({ kind, model: result.modelId, response: result.text })
  return result.text
}

const call = async (user: string, signal: AbortSignal): Promise<{ pick?: unknown; search?: unknown }> =>
  parseJson(await askSmall(SCOUT_SYSTEM, user, signal)) as { pick?: unknown; search?: unknown }

const unique = (hits: LibraryHit[]): LibraryHit[] => [...new Map(hits.filter((h) => h.id !== undefined).map((h) => [h.id, h])).values()]

/**
 * The scout's choice for a message: candidates from your message (and the end of the reply before
 * it), one round of picks with up to three more searches, a final pick if it searched, then the
 * picks widened into whole stretches of story within the word budget.
 */
export async function scout(message: string, recent: string, signal: AbortSignal = new AbortController().signal): Promise<ScoutResult> {
  const began = Date.now()
  const tail = recent.slice(-1500)
  let candidates = unique([...(await searchLibrary(message, FIRST)), ...(tail ? await searchLibrary(tail, FROM_RECENT) : [])])
  if (!candidates.length) return { hits: [], searches: [], read: 0, picked: 0, ms: Date.now() - began }
  let answer = await call(ask(message, tail, candidates, false), signal)
  const searches = (Array.isArray(answer.search) ? answer.search : [])
    .filter((q): q is string => typeof q === 'string' && !!q.trim())
    .slice(0, 3)
    .map((q) => q.trim())
  if (searches.length) {
    const more = (await Promise.all(searches.map((q) => searchLibrary(q, MORE)))).flat()
    const fresh = unique([...candidates, ...more])
    if (fresh.length > candidates.length) {
      candidates = fresh
      answer = await call(ask(message, tail, candidates, true), signal)
    }
  }
  // Only numbers it was shown count; anything else is ignored.
  const known = new Set(candidates.map((c) => c.id))
  const picks = [...new Set((Array.isArray(answer.pick) ? answer.pick : []).map(Number).filter((id) => known.has(id)))]
  const hits = gather(picks, librarySettings().scoutWords * CHARS_PER_WORD)
  return { hits, searches, read: candidates.length, picked: picks.length, ms: Date.now() - began }
}

/** Whether a scout model is chosen. */
export const scoutOn = (): boolean => {
  const s = librarySettings()
  return !!s.scoutProviderId && !!s.scoutModelId
}

/** How many of the expected words a set of passages holds (case and spacing aside). */
function found(hits: LibraryHit[], expect: string[]): number {
  const text = hits.map((h) => h.text).join('\n').toLowerCase().replace(/\s+/g, ' ')
  return expect.filter((e) => text.includes(e.toLowerCase().replace(/\s+/g, ' ').trim())).length
}

/**
 * The scout test: each question run through plain search and through the scout, counting how
 * many of the words the right passages contain each one brought, and at what size.
 */
export async function testScout(cases: ScoutCase[], signal: AbortSignal, progress: (done: number) => void): Promise<ScoutCaseResult[]> {
  const out: ScoutCaseResult[] = []
  for (const c of cases) {
    if (signal.aborted) break
    const plain = await searchLibrary(c.ask)
    let scouted: ScoutCaseResult['scout']
    try {
      const r = await scout(c.ask, c.recent ?? '', signal)
      scouted = { found: found(r.hits, c.expect), chars: r.hits.reduce((n, h) => n + h.text.length, 0), ms: r.ms, searches: r.searches }
    } catch (err) {
      scouted = { error: (err as Error).message }
    }
    out.push({ ask: c.ask, expect: c.expect.length, plain: { found: found(plain, c.expect), chars: plain.reduce((n, h) => n + h.text.length, 0) }, scout: scouted })
    progress(out.length)
  }
  return out
}

/** Reads a scout test file: a JSON list of {ask, expect, recent?}. */
export function parseScoutCases(raw: string): ScoutCase[] {
  const data = JSON.parse(raw) as unknown
  const list = Array.isArray(data) ? data : (data as { cases?: unknown })?.cases
  if (!Array.isArray(list)) throw new Error('A scout test file is a JSON list of questions, each {"ask": "…", "expect": ["…"]}.')
  return list
    .filter((c): c is ScoutCase => !!c && typeof c.ask === 'string' && Array.isArray(c.expect))
    .map((c) => ({ ask: c.ask, expect: c.expect.map(String).filter(Boolean), ...(typeof c.recent === 'string' ? { recent: c.recent } : {}) }))
}
