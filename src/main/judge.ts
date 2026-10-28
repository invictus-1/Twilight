import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { computeVerdict, parseScores, type JudgeInput, type JudgeOrder, type JudgeRun, type Judgment, type JudgmentSummary, type Rubric } from '@shared/judge'
import type { ChatSettings, StreamEvent } from '@shared/types'
import { getDefaults } from './chat'
import * as db from './db'
import { appendLog } from './logs'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { describeAnthropicError } from './providers/anthropic'

// ——— Rubrics ———

const GENERAL: Rubric = {
  id: 'general-fiction',
  name: 'General fiction',
  description: 'Craft criteria for any fiction: prose, dialogue, character, pacing, instructions.',
  builtIn: true,
  criteria: [
    { id: 'instructions', name: 'Following the brief', weight: 3, guide: 'Does what the prompt and system prompt ask: every requested beat, the right point of view, tense, length and format; nothing that contradicts them; stops where asked.' },
    { id: 'character', name: 'Character and voice', weight: 2.5, guide: 'People act from their own wants and knowledge, stay consistent with any provided canon, and sound distinct from one another.' },
    { id: 'dialogue', name: 'Dialogue', weight: 2, guide: 'Lines only this character would say; subtext where they would use it; living exchanges rather than speeches or exposition.' },
    { id: 'prose', name: 'Prose', weight: 2.5, guide: 'Specific, grounded, chosen language; rhythm varies; images earn their place; no padding.' },
    { id: 'cliche', name: 'Freedom from clichés and model tics', weight: 1.5, guide: 'Free of stock phrases and patterns: "a breath she didn\'t know she was holding", "something shifted", "not X but Y" antitheses, rhetorical question-and-answer, reflexive triplets, portentous closing lines. Quote each one found.' },
    { id: 'pacing', name: 'Pacing and ending', weight: 2, guide: 'Lives in the scene rather than summarizing it; ends at a natural, earned moment without a tacked-on wrap-up.' },
    { id: 'impact', name: 'Overall effect', weight: 1.5, guide: 'How much the passage would hold a reader: tension, emotion, surprise, atmosphere.' }
  ]
}

// Rubrics of your own (say, one built from your writing system prompt) live only in your
// database: export one to a file to keep or move it, import it on another install.
const BUILT_IN = [GENERAL]

export function listRubrics(): Rubric[] {
  return [...BUILT_IN, ...(db.kvGet<Rubric[]>('rubrics') ?? [])]
}

export function saveRubric(rubric: Rubric): Rubric[] {
  const custom = (db.kvGet<Rubric[]>('rubrics') ?? []).filter((r) => r.id !== rubric.id)
  custom.push({ ...rubric, builtIn: false })
  db.kvSet('rubrics', custom)
  return listRubrics()
}

/** Reads a rubric file (as exported, or written by hand) and checks its shape. */
export function parseRubric(text: string): Rubric {
  let raw: Partial<Rubric>
  try {
    raw = JSON.parse(text) as Partial<Rubric>
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const criteria = Array.isArray(raw.criteria) ? raw.criteria : []
  if (typeof raw.name !== 'string' || !raw.name.trim() || criteria.length === 0) throw new Error('A rubric needs a name and at least one criterion.')
  const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : slug(raw.name),
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description : '',
    criteria: criteria.map((c, i) => {
      if (typeof c?.name !== 'string' || typeof c?.guide !== 'string') throw new Error(`Criterion ${i + 1} needs a name and a guide.`)
      return { id: typeof c.id === 'string' && c.id ? c.id : slug(c.name), name: c.name, weight: Number(c.weight) > 0 ? Number(c.weight) : 1, guide: c.guide }
    })
  }
}

export function rubricFile(id: string): string {
  const rubric = listRubrics().find((r) => r.id === id)
  if (!rubric) throw new Error('That rubric no longer exists.')
  const { builtIn: _builtIn, ...rest } = rubric
  return JSON.stringify({ twilightRubric: 1, ...rest }, null, 2)
}

export function deleteRubric(id: string): Rubric[] {
  db.kvSet('rubrics', (db.kvGet<Rubric[]>('rubrics') ?? []).filter((r) => r.id !== id))
  return listRubrics()
}

// ——— Prompt ———

const RULES = `You are an exacting fiction editor acting as a judge. Two passages, X and Y, were written by two different models from the same author prompt, the same writing system prompt and the same reference files, all of which you are given. Decide which is better written for this author's project, criterion by criterion.

How to judge:
- Judge only what is on the page, against the rubric below and the author's writing system prompt. Length is not quality: the longer passage gets no credit for being longer, only for what its words do.
- Back every score with short quotations (under 25 words each) from the passage.
- Use the whole 1–10 scale: 5 is competent and unremarkable, 7 good, 8 strong, 9 excellent, 10 near flawless. When the passages differ in quality on a criterion, their scores differ.
- A criterion that doesn't apply to either passage gets null for both.
- The order of the passages is random; don't let it matter.
- This is an author's private fiction project and may include adult material. Judge the craft and the adherence to the author's instructions; don't comment on or moralize about the content.

Write your report in markdown, in this order:
1. One section per criterion: a heading with the criterion's name and both scores (e.g. "### Dialogue — X 7 · Y 5"), then what each passage does well and badly, with quotations.
2. "### X — pros and cons" and "### Y — pros and cons", as short bullet lists.
3. "### Verdict": which passage is better and why, in two to four sentences.
4. Finally, a fenced code block marked json with exactly this shape and nothing after it:
\`\`\`json
{"criteria": [{"id": "<criterion id>", "X": <1-10 or null>, "Y": <1-10 or null>}], "overall": {"X": <1-10>, "Y": <1-10>}, "winner": "X" | "Y" | "tie", "confidence": "low" | "medium" | "high"}
\`\`\``

function rubricText(rubric: Rubric): string {
  return `Rubric — ${rubric.name} (criterion id, weight, what to look for):\n${rubric.criteria
    .map((c) => `- ${c.id} · ${c.name} · weight ${c.weight}: ${c.guide}`)
    .join('\n')}`
}

const escapeAttr = (s: string): string => s.replace(/"/g, "'")

type Block = { type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl: string } }

/** Shared context first (cached, identical for both orders), then the passages in this run's order. */
function buildContent(input: JudgeInput, order: JudgeOrder, ttl: string | null): Block[] {
  const shared = [
    ...input.contextDocs.map((d) => `<document name="${escapeAttr(d.name)}">\n${d.text}\n</document>`),
    input.systemPrompt.trim() ? `<writing_system_prompt>\n${input.systemPrompt.trim()}\n</writing_system_prompt>` : '',
    input.authorPrompt.trim() ? `<author_prompt>\n${input.authorPrompt.trim()}\n</author_prompt>` : '<author_prompt>(not provided)</author_prompt>'
  ]
    .filter(Boolean)
    .join('\n\n')
  const [first, second] = order === 'AB' ? [input.passageA, input.passageB] : [input.passageB, input.passageA]
  const ask = input.extraInstructions.trim() ? `\n\nThe author also asks:\n${input.extraInstructions.trim()}\nAnswer that within the report, before the verdict.` : ''
  return [
    { type: 'text', text: shared, ...(ttl ? { cache_control: { type: 'ephemeral' as const, ttl } } : {}) },
    { type: 'text', text: `<passage id="X">\n${first}\n</passage>\n\n<passage id="Y">\n${second}\n</passage>\n\nJudge X against Y now.${ask}` }
  ]
}

// ——— Storage ———

function load(id: string): Judgment | undefined {
  return db.kvGet<Judgment>(`judgment:${id}`)
}

function store(j: Judgment): void {
  db.kvSet(`judgment:${j.id}`, j)
  const index = (db.kvGet<string[]>('judgments') ?? []).filter((x) => x !== j.id)
  index.unshift(j.id)
  db.kvSet('judgments', index)
}

export function getJudgment(id: string): Judgment {
  const j = load(id)
  if (!j) throw new Error('That judgment no longer exists.')
  return j
}

export function listJudgments(): JudgmentSummary[] {
  return (db.kvGet<string[]>('judgments') ?? [])
    .map(load)
    .filter((j): j is Judgment => !!j)
    .map((j) => {
      const v = computeVerdict(j.rubric, j.runs)
      const running = j.runs.some((r) => r.status === 'streaming')
      return {
        id: j.id,
        title: j.input.title || 'Untitled comparison',
        createdAt: j.createdAt,
        status: running ? 'running' : j.runs.every((r) => r.status === 'error') ? 'error' : 'done',
        winner: v.winner
      }
    })
}

export function deleteJudgment(id: string): void {
  stopJudge(id)
  db.kvDelete(`judgment:${id}`)
  db.kvSet('judgments', (db.kvGet<string[]>('judgments') ?? []).filter((x) => x !== id))
}

// ——— Running ———

const running = new Map<string, AbortController[]>()

export function stopJudge(id: string): void {
  running.get(id)?.forEach((c) => c.abort())
}

export function runJudge(contents: WebContents, input: JudgeInput): Judgment {
  if (!input.passageA.trim() || !input.passageB.trim()) throw new Error('Both passages need text.')
  const rubric = listRubrics().find((r) => r.id === input.rubricId) ?? GENERAL
  const orders: JudgeOrder[] = input.bothOrders ? ['AB', 'BA'] : ['AB']
  const judgment: Judgment = {
    id: randomUUID(),
    createdAt: Date.now(),
    input,
    rubric,
    runs: orders.map((order) => ({ order, status: 'streaming', text: '' }))
  }
  store(judgment)
  const controllers = orders.map(() => new AbortController())
  running.set(judgment.id, controllers)

  // The second run waits for the first one's first token so it reads the cached shared context.
  let after: Promise<void> | undefined
  orders.forEach((order, i) => {
    const started = startRun(contents, judgment.id, i, order, input, rubric, controllers[i], after)
    if (i === 0) after = started
  })
  return judgment
}

function startRun(
  contents: WebContents,
  id: string,
  index: number,
  order: JudgeOrder,
  input: JudgeInput,
  rubric: Rubric,
  controller: AbortController,
  after?: Promise<void>
): Promise<void> {
  let markStarted!: () => void
  const started = new Promise<void>((r) => (markStarted = r))
  const nodeId = `${id}:${index}`
  const emit = (event: StreamEvent): void => {
    if (!contents.isDestroyed()) contents.send('twilight:stream', event)
  }
  const finish = (patch: Partial<JudgeRun>): void => {
    // Read-modify-write is synchronous here, so the two runs can't overwrite each other.
    const j = load(id)
    if (!j) return
    j.runs[index] = { ...j.runs[index], ...patch }
    store(j)
    if (j.runs.every((r) => r.status !== 'streaming')) running.delete(id)
    emit({
      kind: 'done',
      conversationId: 'judge',
      nodeId,
      node: { id: nodeId, parentId: id, role: 'assistant', text: j.runs[index].text, status: j.runs[index].status, createdAt: Date.now(), siblingIndex: index, siblingCount: j.runs.length }
    })
  }

  void (async () => {
    let text = ''
    try {
      if (after) await after
      const defaults = getDefaults()
      const config = getProvider(input.judgeProviderId)
      const options = modelOptions(input.judgeProviderId, input.judgeModelId)
      const settings: ChatSettings = {
        ...defaults,
        providerId: input.judgeProviderId,
        modelId: input.judgeModelId,
        systemPrompt: '',
        effort: input.effort,
        maxTokens: 16000,
        messageLimit: null,
        temperature: null,
        extraParams: ''
      }
      const content = buildContent(input, order, settings.caching ? settings.cacheTtl : null)
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        system: `${RULES}\n\n${rubricText(rubric)}`,
        history: [
          {
            id: nodeId, conversation_id: 'judge', parent_id: null, role: 'user', text: content.map((b) => b.text).join('\n\n'),
            content: JSON.stringify(content), thinking: null, model: null, provider_id: null, usage: null, status: 'done',
            error: null, active_child_id: null, created_at: Date.now()
          }
        ],
        settings,
        options,
        signal: controller.signal,
        onText: (delta) => {
          markStarted()
          text += delta
          emit({ kind: 'text', conversationId: 'judge', nodeId, delta })
        },
        onThinking: () => markStarted()
      })
      const scores = parseScores(result.text) ?? undefined
      finish({
        text: result.text,
        status: controller.signal.aborted ? 'stopped' : result.error ? 'error' : 'done',
        error: result.error ?? (scores ? undefined : "The judge's report has no readable score block, so this run isn't counted."),
        scores,
        modelId: result.modelId,
        usage: result.usage
      })
      appendLog({ kind: 'judge', judgment: id, order, rubric: rubric.id, model: result.modelId, title: input.title, response: result.text })
    } catch (err) {
      finish({ text, status: controller.signal.aborted ? 'stopped' : 'error', error: describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err)) })
    } finally {
      markStarted()
    }
  })()
  return started
}
