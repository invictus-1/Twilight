// Writer insights: what a manuscript says about the writing. analyzeText runs in a worker thread
// over every file in the writing folder; the main process keeps the results per file (so only
// changed files are read again) and a day-by-day history of words written. Nothing here leaves
// the computer; the AI pages (story analysis, focus, insights) are separate and on request.

export interface TrackedCharacter {
  name: string
  aliases: string[]
  color: string
}

export interface DocAnalysis {
  words: number
  paragraphs: number
  sentences: number
  /** Words across all sentences, for the average. */
  sentenceWords: number
  longestSentence: number
  dialogueWords: number
  adverbs: number
  /** Every word, lowercased, with its count. */
  vocab: Record<string, number>
  /** Capitalised words met mid-sentence: likely names. */
  names: Record<string, number>
  /** Tracked characters: mentions in this file. */
  mentions: Record<string, number>
  /** "A|B" (sorted) → paragraphs where both appear. */
  pairs: Record<string, number>
}

// Fenced code, HTML tags, front matter and markdown punctuation aren't prose.
function prose(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b ?? a)
    .replace(/^[#>\s]*[-*+]?\s*/gm, (m) => m.replace(/[#>*+-]/g, ' '))
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}\p{N}]+)*/gu
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const SENTENCE_END = /[.!?…]+["”’)\]]*(?=\s|$)/g

/** Words in a span; CJK runs count a word per character, as word counts for those scripts do. */
function countWords(text: string): number {
  let n = 0
  for (const m of text.matchAll(WORD)) n += CJK.test(m[0]) ? [...m[0]].filter((c) => CJK.test(c)).length : 1
  return n
}

// -ly words that aren't adverbs (or aren't the kind worth counting).
const NOT_ADVERBS = new Set(
  'only family early reply holy ugly belly lily rely supply apply fly july italy ally bully jelly silly friendly lovely lonely likely daily elderly costly lively deadly curly chilly jolly smelly wobbly sly comply assembly anomaly monopoly rally gully folly tally sally emily molly kelly holly polly billy willy dolly woolly hourly weekly monthly yearly nightly unlikely heavenly manly womanly kindly orderly'.split(' ')
)
// Capitalised words that are rarely names.
const NOT_NAMES = new Set(
  'I I’m I’d I’ll I’ve OK Mr Mrs Ms Dr Sir Lady Lord God Oh Ah Yes No Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December English Christmas TV'.split(
    ' '
  )
)

export function analyzeText(raw: string, characters: TrackedCharacter[] = []): DocAnalysis {
  const text = prose(raw.replace(/\r\n?/g, '\n'))
  const result: DocAnalysis = {
    words: 0, paragraphs: 0, sentences: 0, sentenceWords: 0, longestSentence: 0,
    dialogueWords: 0, adverbs: 0, vocab: {}, names: {}, mentions: {}, pairs: {}
  }
  const patterns = characters.map((c) => ({
    name: c.name,
    re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${[c.name, ...c.aliases].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  }))
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue
    const words = countWords(para)
    if (!words) continue
    result.paragraphs++
    result.words += words
    // Sentences: split at terminal punctuation; a paragraph without any is one sentence.
    let last = 0
    const spans: string[] = []
    for (const m of para.matchAll(SENTENCE_END)) {
      spans.push(para.slice(last, m.index! + m[0].length))
      last = m.index! + m[0].length
    }
    if (para.slice(last).trim()) spans.push(para.slice(last))
    for (const s of spans) {
      const n = countWords(s)
      if (!n) continue
      result.sentences++
      result.sentenceWords += n
      if (n > result.longestSentence) result.longestSentence = n
    }
    for (const q of para.matchAll(/“[^”]*”|"[^"\n]*"/g)) result.dialogueWords += countWords(q[0])
    // Vocabulary, adverbs and likely names, word by word.
    let sentenceStart = true
    for (const m of para.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}\p{N}]+)*|[.!?…]/gu)) {
      const w = m[0]
      if (/^[.!?…]$/.test(w)) {
        sentenceStart = true
        continue
      }
      const lower = w.toLowerCase()
      if (!/^\p{N}+$/u.test(w)) result.vocab[lower] = (result.vocab[lower] ?? 0) + 1
      if (lower.length > 4 && lower.endsWith('ly') && !NOT_ADVERBS.has(lower)) result.adverbs++
      if (!sentenceStart && /^\p{Lu}\p{Ll}+$/u.test(w) && !NOT_NAMES.has(w)) result.names[w] = (result.names[w] ?? 0) + 1
      sentenceStart = false
    }
    // Tracked characters: mentions, and who shares a paragraph with whom.
    if (patterns.length) {
      const here: string[] = []
      for (const p of patterns) {
        const n = para.match(p.re)?.length ?? 0
        if (n) {
          result.mentions[p.name] = (result.mentions[p.name] ?? 0) + n
          here.push(p.name)
        }
      }
      here.sort()
      for (let i = 0; i < here.length; i++)
        for (let j = i + 1; j < here.length; j++) {
          const key = `${here[i]}|${here[j]}`
          result.pairs[key] = (result.pairs[key] ?? 0) + 1
        }
    }
  }
  return result
}

/** Common words left out of "most used" lists. */
export const STOPWORDS = new Set(
  "the a an and or but if then so of to in on at by for with from up down out over under into onto about as is are was were be been being have has had do does did not no nor it its it's he she they them their his her hers him we us our you your i me my mine this that these those there here what which who whom whose when where why how all any both each few more most other some such than too very can will just would could should shall may might must said says say like one two also back again still even well get got go went come came now then into through after before while because i'm don't didn't she'd he'd they'd i'd you'd it'd that's there's she's he's let's what's can't won't wasn't weren't isn't aren't hadn't hasn't haven't couldn't wouldn't shouldn't i've you've we've they've i'll you'll we'll they'll she'll he'll it'll you're we're they're oh ah yes yeah okay just only own same off around away down toward towards against between onto upon".split(
    ' '
  )
)

// ——— Achievements ———

export interface AchievementDef {
  id: string
  family: string
  name: string
  /** What it takes, in the user's terms. */
  goal: string
  icon: string
  metric: keyof AchievementStats
  target: number
}

export interface AchievementStats {
  storyTotal: number
  written: number
  bestDay: number
  longestStreak: number
  activeDays: number
  characters: number
  vocabulary: number
  nightWords: number
  dawnWords: number
  dialoguePercent: number
  judgments: number
}

const fmt = (n: number): string => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n))
const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
const tiers = (family: string, icon: string, metric: keyof AchievementStats, targets: number[], goal: (t: number) => string): AchievementDef[] =>
  targets.map((target, i) => ({
    id: `${family.toLowerCase().replace(/\W+/g, '-')}-${i + 1}`,
    family,
    name: `${family} ${roman[i]}`,
    goal: goal(target),
    icon,
    metric,
    target
  }))

export const ACHIEVEMENTS: AchievementDef[] = [
  ...tiers('Magnum Opus', 'book', 'storyTotal', [50e3, 100e3, 250e3, 500e3, 1e6, 2.5e6, 5e6, 10e6, 25e6], (t) => `A manuscript of ${fmt(t)} words`),
  ...tiers('Ink Spilled', 'pen', 'written', [10e3, 50e3, 100e3, 250e3, 500e3, 1e6, 5e6, 10e6], (t) => `${fmt(t)} words written since tracking began`),
  ...tiers('Big Day', 'bolt', 'bestDay', [1e3, 2.5e3, 5e3, 10e3, 20e3], (t) => `${fmt(t)} words in one day`),
  ...tiers('Unbroken', 'flame', 'longestStreak', [3, 7, 14, 30, 60, 100, 365], (t) => `Write ${t} days in a row`),
  ...tiers('Regular', 'calendar', 'activeDays', [10, 30, 100, 250], (t) => `Write on ${t} different days`),
  ...tiers('Full Cast', 'people', 'characters', [5, 10, 25], (t) => `Track ${t} characters`),
  ...tiers('Wordsmith', 'feather', 'vocabulary', [10e3, 25e3, 50e3], (t) => `Use ${fmt(t)} different words`),
  { id: 'night-owl', family: 'Hours', name: 'Night Owl', goal: '1k words between midnight and 4 am', icon: 'moon', metric: 'nightWords', target: 1000 },
  { id: 'early-bird', family: 'Hours', name: 'Early Bird', goal: '1k words between 5 and 8 am', icon: 'sun', metric: 'dawnWords', target: 1000 },
  { id: 'chatterbox', family: 'Style', name: 'Chatterbox', goal: 'A manuscript that is 30% dialogue', icon: 'speech', metric: 'dialoguePercent', target: 30 },
  { id: 'second-opinion', family: 'Judge', name: 'Second Opinion', goal: 'Judge 10 pairs of passages', icon: 'scale', metric: 'judgments', target: 10 }
]

// ——— What the Insights pages show ———

export interface DayCount {
  day: string
  words: number
}

export interface InsightsSummary {
  scannedAt: number | null
  scanning: boolean
  folder: string
  trackingSince: string | null
  files: number
  storyTotal: number
  today: number
  week: number
  month: number
  year: number
  written: number
  activeDays: number
  streak: number
  longestStreak: number
  bestDay: DayCount | null
  last14: DayCount[]
  /** Words written by hour of day, 0–23. */
  hours: number[]
  /** Every day with words written, for the heatmap. */
  days: DayCount[]
  style: {
    avgSentence: number
    longestSentence: number
    dialoguePercent: number
    adverbsPer1k: number
    vocabulary: number
    richness: number
    paragraphs: number
    topWords: { word: string; count: number }[]
    topAdverbs: { word: string; count: number }[]
  }
  perFile: { path: string; words: number; avgSentence: number; dialoguePercent: number; topCharacter: string | null; topMentions: number }[]
  characters: { name: string; color: string; aliases: string[]; mentions: number; share: number }[]
  pairs: { a: string; b: string; scenes: number }[]
  suggestions: { name: string; count: number }[]
  achievements: { def: AchievementDef; value: number; unlockedAt: number | null }[]
}

// ——— The AI pages (run only when asked, with a model you choose) ———

export interface AiConfig {
  providerId: string
  modelId: string
  effort: string | null
}

export interface StoryAnalysis {
  mode: 'quick' | 'deep'
  /** '' for the whole writing folder, else one document's path. */
  scope: string
  model: string
  at: number
  words: number
  calls: number
  costUsd: number | null
  /** What the writing is made of, in percent (sums to about 100). */
  breakdown: { name: string; percent: number }[]
  /** How strongly each genre is present, 0–100. */
  genres: { name: string; percent: number }[]
  tags: { name: string; subtags: string[] }[]
  themes: { name: string; description: string }[]
  tone: string
  summary: string
}

export interface FocusResult {
  model: string
  at: number
  strength: string
  areas: { title: string; why: string; evidence: string[]; exercise: string }[]
}

export interface WritingNotes {
  model: string
  at: number
  observations: { title: string; text: string }[]
  nextStep: string
}

export interface AiState {
  config: AiConfig
  story: Record<string, StoryAnalysis>
  focus: FocusResult | null
  notes: WritingNotes | null
  running: { kind: 'story' | 'focus' | 'notes'; done: number; total: number; scope?: string } | null
  error: string | null
}

export interface StoryEstimate {
  calls: number
  cached: number
  words: number
  costUsd: number | null
}
