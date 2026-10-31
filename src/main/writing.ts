import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ChatSettings, ContinuityIssue, ContinuityResult, StreamEvent, WritingRequest } from '@shared/types'
import { parseJson } from './insightsAi'
import { getDefaults } from './chat'
import type { NodeRow } from './db'
import { getDocContext, readDoc } from './docs'
import { appendLog } from './logs'
import { getApiKey, getProvider, implFor, modelOptions } from './providers'
import { describeAnthropicError } from './providers/anthropic'

// Writing tools (Ask, Rewrite, Tighten, Expand, Tone …) run on a selected passage and stream back
// a replacement, which the editor shows as a suggestion to accept or reject. Only the passage
// ever changes.
//
// The request is laid out for the prompt cache, most stable first: the fixed editor rules, the
// writer's instructions and reference documents (system prompt, cached), then the manuscript
// or the text around the passage, and last the passage and the instruction.

const RULES = `You are a line editor working inside a writer's manuscript.
You receive a passage marked <passage>, context around it, and an instruction.
Reply with only the replacement text for the passage: no preamble, no quotation marks, no commentary.
Keep the author's voice, tense, point of view and markdown formatting unless the instruction says otherwise.
Use the writer's instructions and reference documents for facts, names and continuity.`

const running = new Map<string, AbortController>()

export function stopWritingTool(requestId: string): void {
  running.get(requestId)?.abort()
}

const escapeAttr = (s: string): string => s.replace(/"/g, "'")

type Block = { type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl: string } }

async function buildPrompt(req: WritingRequest, ttl: string | null): Promise<{ system: string; blocks: Block[] }> {
  const context = getDocContext(req.docPath)
  let system = RULES
  if (context.instructions.trim()) system += `\n\n<writer_instructions>\n${context.instructions.trim()}\n</writer_instructions>`
  // References in a fixed order, so the cached system prompt stays byte-identical between runs.
  for (const path of [...context.references].sort()) {
    if (path === req.docPath) continue
    const ref = await readDoc(path).catch(() => null)
    if (ref) system += `\n\n<reference title="${escapeAttr(path.replace(/\.md$/i, ''))}">\n${ref.text}\n</reference>`
  }
  const title = escapeAttr(req.docPath.replace(/\.md$/i, ''))
  const blocks: Block[] = []
  if (context.wholeManuscript && req.manuscript !== undefined) {
    // Its own block with its own cache breakpoint, so an unchanged manuscript is read from
    // cache on the next run even though the passage after it differs. (Local servers ignore it.)
    blocks.push({
      type: 'text',
      text: `<manuscript title="${title}">\n${req.manuscript}\n</manuscript>`,
      ...(ttl ? { cache_control: { type: 'ephemeral' as const, ttl } } : {})
    })
    blocks.push({ type: 'text', text: `<passage>\n${req.passage}\n</passage>\n\nInstruction: ${req.instruction}` })
  } else {
    blocks.push({
      type: 'text',
      text:
        `<manuscript title="${title}">\n<before>\n${req.before}\n</before>\n<passage>\n${req.passage}\n</passage>\n` +
        `<after>\n${req.after}\n</after>\n</manuscript>\n\nInstruction: ${req.instruction}`
    })
  }
  return { system, blocks }
}

// ——— Continuity ———
// A passage checked against documents you choose (character profiles, lore, earlier chapters), or
// a question asked about it ("does this fit her profile?"), with the writing tools' model. The
// documents go into the system prompt in a fixed order, the same for checking and asking, so a
// check after an edit, or a question after a check, reads them from the cache.

const CONTINUITY_SYSTEM = `You help a fiction writer keep their story consistent. Their own reference documents (character profiles, world notes, earlier chapters) follow as <reference> blocks. Judge only by what they say, and quote them exactly when you rely on them.`

const CHECK_TASK = `Check the passage below against the references.
A contradiction is where the passage states or shows something that can't be true if a reference holds (how someone looks, who is related to whom, where someone is, who is alive, what someone owns, how the world works). New details the references don't cover are not contradictions, and neither is style. If the references show something changing over the story, judge the passage by where it sits.
Report only clear contradictions; most passages have none. Quote the passage's words exactly, and the reference's words exactly.
Also sum up in two to four plain sentences what in the passage you could check against the references and how it holds up, naming the details (a character's eyes, a place, an event), and say plainly what the references don't cover.
Answer with JSON only, no other text:
{"summary": "…", "issues": [{"quote": "exact words from the passage", "reference": "the reference's title", "evidence": "exact words from the reference", "why": "one short sentence"}]}`

const ASK_TASK = `Answer the writer's question about the passage below, using the references. Be direct: start with the answer (yes, no, partly), then say why in a few sentences, quoting the passage and the references where it helps and naming which reference each quote is from. If the references don't say, tell them so rather than guessing. Plain prose, no headings.`

/** Finds `quote` in `text` with spacing and case aside, giving back the text's own words. */
function locate(text: string, quote: string): string | null {
  const words = quote.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i').exec(text)?.[0] ?? null
}

/** The chosen documents read, in a fixed order, and the model call both continuity tools make. */
async function continuityRun(docPath: string, references: string[], user: string, kind: string): Promise<{ text: string; titled: { path: string; title: string; text: string }[] }> {
  if (!references.length) throw new Error('Choose at least one document to check against.')
  const defaults = getDefaults()
  const config = getProvider(defaults.providerId)
  const settings: ChatSettings = { ...defaults, maxTokens: 4000, messageLimit: null, webSearch: false, webFetch: false }
  const titled: { path: string; title: string; text: string }[] = []
  for (const path of [...references].sort()) {
    if (path === docPath) continue
    const doc = await readDoc(path).catch(() => null)
    if (doc) titled.push({ path, title: path.replace(/\.md$/i, ''), text: doc.text })
  }
  if (!titled.length) throw new Error("The chosen documents couldn't be read.")
  const system = `${CONTINUITY_SYSTEM}\n\n${titled.map((d) => `<reference title="${escapeAttr(d.title)}">\n${d.text}\n</reference>`).join('\n\n')}`
  const result = await implFor(config).generate({
    config,
    apiKey: getApiKey(config.id),
    system,
    history: [
      {
        id: 'continuity', conversation_id: 'writing', parent_id: null, role: 'user', text: user,
        content: JSON.stringify([{ type: 'text', text: user }]), thinking: null, model: null, provider_id: null, usage: null, status: 'done',
        error: null, active_child_id: null, created_at: Date.now()
      }
    ],
    settings,
    options: modelOptions(defaults.providerId, defaults.modelId),
    signal: new AbortController().signal,
    onText: () => undefined,
    onThinking: () => undefined
  })
  if (result.error) throw new Error(result.error)
  appendLog({ kind, doc: docPath, references: titled.map((d) => d.path), model: result.modelId, request: user, response: result.text })
  return { text: result.text, titled }
}

const passageBlock = (docPath: string, passage: string): string => `<passage title="${escapeAttr(docPath.replace(/\.md$/i, ''))}">\n${passage}\n</passage>`

export async function checkContinuity(docPath: string, passage: string, references: string[]): Promise<ContinuityResult> {
  const { text, titled } = await continuityRun(docPath, references, `${CHECK_TASK}\n\n${passageBlock(docPath, passage)}`, 'continuity')
  const answer = parseJson(text) as { summary?: unknown; issues?: unknown }
  const issues: ContinuityIssue[] = []
  for (const raw of (Array.isArray(answer.issues) ? answer.issues : []) as { quote?: unknown; reference?: unknown; evidence?: unknown; why?: unknown }[]) {
    // Only what's really there: the passage's words, and a reference it was given.
    const quote = typeof raw?.quote === 'string' ? locate(passage, raw.quote) : null
    const ref = titled.find((d) => typeof raw?.reference === 'string' && (d.title.toLowerCase() === raw.reference.trim().toLowerCase() || d.title.toLowerCase().endsWith(raw.reference.trim().toLowerCase())))
    if (!quote || !ref) continue
    const evidence = typeof raw.evidence === 'string' ? (locate(ref.text, raw.evidence) ?? raw.evidence.trim()) : ''
    issues.push({ id: randomUUID(), quote, reference: ref.path, evidence, why: typeof raw.why === 'string' ? raw.why.trim() : '' })
  }
  return { summary: typeof answer.summary === 'string' ? answer.summary.trim() : '', issues }
}

/** A question about the passage, answered from the chosen documents. */
export async function askContinuity(docPath: string, passage: string, references: string[], question: string): Promise<string> {
  if (!question.trim()) throw new Error('Ask a question first.')
  const { text } = await continuityRun(docPath, references, `${ASK_TASK}\n\n${passageBlock(docPath, passage)}\n\nQuestion: ${question.trim()}`, 'continuity-ask')
  return text.trim()
}

export function runWritingTool(contents: WebContents, requestId: string, req: WritingRequest): void {
  const defaults = getDefaults()
  const config = getProvider(defaults.providerId)
  // Quick edits favour speed: low effort and short output. The cache lifetime follows the
  // chat default (1 hour), since writers pause between edits.
  const options = modelOptions(defaults.providerId, defaults.modelId)
  const settings: ChatSettings = {
    ...defaults,
    effort: options?.efforts.includes('low') && config.kind === 'anthropic' ? 'low' : defaults.effort,
    maxTokens: 8000,
    messageLimit: null,
    // Editor tools work on the passage alone, whatever the chat defaults switch on.
    webSearch: false,
    webFetch: false
  }
  const controller = new AbortController()
  running.set(requestId, controller)
  const emit = (event: StreamEvent): void => {
    if (!contents.isDestroyed()) contents.send('twilight:stream', event)
  }
  const finish = (text: string, status: 'done' | 'error' | 'stopped', error?: string, modelId?: string): void => {
    appendLog({
      kind: 'writing',
      doc: req.docPath,
      provider: config.id,
      model: modelId ?? settings.modelId,
      instruction: req.instruction,
      passage: req.passage,
      response: text.trim(),
      wholeManuscript: req.manuscript !== undefined,
      status,
      error
    })
    emit({
      kind: 'done',
      conversationId: 'writing',
      nodeId: requestId,
      node: {
        id: requestId, parentId: null, role: 'assistant', text: text.trim(), status, error,
        modelId, createdAt: Date.now(), siblingIndex: 0, siblingCount: 1
      }
    })
  }

  void (async () => {
    let text = ''
    try {
      const { system, blocks } = await buildPrompt(req, settings.caching ? settings.cacheTtl : null)
      const history: NodeRow[] = [
        {
          id: requestId, conversation_id: 'writing', parent_id: null, role: 'user', text: blocks.map((b) => b.text).join('\n\n'),
          content: JSON.stringify(blocks), thinking: null, model: null, provider_id: null, usage: null, status: 'done',
          error: null, active_child_id: null, created_at: Date.now()
        }
      ]
      const result = await implFor(config).generate({
        config,
        apiKey: getApiKey(config.id),
        system,
        history,
        settings,
        options,
        signal: controller.signal,
        onText: (delta) => {
          text += delta
          emit({ kind: 'text', conversationId: 'writing', nodeId: requestId, delta })
        },
        onThinking: () => {}
      })
      finish(result.text, controller.signal.aborted ? 'stopped' : result.error ? 'error' : 'done', result.error, result.modelId)
    } catch (err) {
      finish(text, 'error', describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err)))
    } finally {
      running.delete(requestId)
    }
  })()
}
