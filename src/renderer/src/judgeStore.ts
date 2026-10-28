import { create } from 'zustand'
import type { JudgeInput, Judgment, JudgmentSummary, Rubric } from '@shared/judge'
import { useStore } from './store'

const api = window.twilight

interface JudgeState {
  list: JudgmentSummary[]
  rubrics: Rubric[]
  /** The judgment on screen. */
  current: Judgment | null
  /** A comparison being set up (shown instead of `current`). */
  draft: JudgeInput | null
  error: string | null

  init(): Promise<void>
  refresh(): Promise<void>
  open(id: string): Promise<void>
  newDraft(prefill?: Partial<JudgeInput>): void
  updateDraft(patch: Partial<JudgeInput>): void
  run(): Promise<void>
  stop(): Promise<void>
  remove(id: string): Promise<void>
  /** Reloads the judgment on screen (after a run finishes). */
  reload(id: string): Promise<void>
  setRubrics(rubrics: Rubric[]): void
}

const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The rubric used last, so a rubric of your own stays the default once you've picked it. */
function lastRubric(): string {
  try {
    return localStorage.getItem('twilight.judgeRubric') ?? 'general-fiction'
  } catch {
    return 'general-fiction'
  }
}

function emptyInput(): JudgeInput {
  const defaults = useStore.getState().defaults
  return {
    title: '',
    passageA: '',
    passageB: '',
    labelA: '',
    labelB: '',
    authorPrompt: '',
    systemPrompt: '',
    contextDocs: [],
    extraInstructions: '',
    judgeProviderId: defaults?.providerId ?? 'anthropic',
    judgeModelId: defaults?.modelId ?? 'claude-opus-5-5',
    effort: null,
    rubricId: lastRubric(),
    bothOrders: true
  }
}

export const useJudge = create<JudgeState>((set, get) => ({
  list: [],
  rubrics: [],
  current: null,
  draft: null,
  error: null,

  async init() {
    const [list, rubrics] = await Promise.all([api.listJudgments(), api.listRubrics()])
    set({ list, rubrics })
  },

  async refresh() {
    set({ list: await api.listJudgments() })
  },

  async open(id) {
    try {
      set({ current: await api.getJudgment(id), draft: null })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  newDraft(prefill = {}) {
    set({ draft: { ...emptyInput(), ...prefill }, current: null })
  },

  updateDraft(patch) {
    const draft = get().draft
    if (draft) set({ draft: { ...draft, ...patch } })
    if (patch.rubricId) {
      try {
        localStorage.setItem('twilight.judgeRubric', patch.rubricId)
      } catch {
        // Storage unavailable: the default just isn't remembered.
      }
    }
  },

  async run() {
    const draft = get().draft
    if (!draft) return
    try {
      const judgment = await api.runJudge(draft)
      set({ current: judgment, draft: null, error: null })
      await get().refresh()
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async stop() {
    const current = get().current
    if (current) await api.stopJudge(current.id)
  },

  async remove(id) {
    await api.deleteJudgment(id)
    if (get().current?.id === id) set({ current: null })
    await get().refresh()
  },

  async reload(id) {
    if (get().current?.id === id) set({ current: await api.getJudgment(id) })
    await get().refresh()
  },

  setRubrics: (rubrics) => set({ rubrics })
}))
