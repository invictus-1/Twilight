import { create } from 'zustand'
import type { AiState, InsightsSummary, TrackedCharacter } from '@shared/insights'

export type InsightsPage = 'dashboard' | 'heatmap' | 'words' | 'characters' | 'story' | 'focus' | 'insights' | 'achievements' | 'reports'

interface InsightsState {
  summary: InsightsSummary | null
  page: InsightsPage
  progress: { done: number; total: number } | null
  /** Achievements unlocked since the last look, for one quiet notice. */
  unlocked: string[]
  /** The AI pages: chosen model, saved results, and a run in progress. */
  ai: AiState | null
  init(): Promise<void>
  setPage(page: InsightsPage): void
  rescan(): Promise<void>
  setCharacters(list: TrackedCharacter[]): Promise<void>
  dismissUnlocked(): void
}

const api = window.twilight
let started = false

export const useInsights = create<InsightsState>((set, get) => ({
  summary: null,
  page: 'dashboard',
  progress: null,
  unlocked: [],
  ai: null,

  async init() {
    if (started) return
    started = true
    api.onInsights((event) => {
      if (event.kind === 'progress') set({ progress: event.done < event.total ? { done: event.done, total: event.total } : null })
      else if (event.kind === 'unlocked') set({ unlocked: [...get().unlocked, ...event.names] })
      else if (event.kind === 'ai') set({ ai: event.state })
      else void api.getInsights().then((summary) => set({ summary, progress: summary.scanning ? get().progress : null }))
    })
    const [summary, ai] = await Promise.all([api.getInsights(), api.getAiState()])
    set({ summary, ai })
  },

  setPage: (page) => set({ page }),

  async rescan() {
    const current = get().summary
    if (current) set({ summary: { ...current, scanning: true } })
    set({ summary: await api.rescanInsights(), progress: null })
  },

  async setCharacters(list) {
    set({ summary: await api.setCharacters(list) })
  },

  dismissUnlocked: () => set({ unlocked: [] })
}))
