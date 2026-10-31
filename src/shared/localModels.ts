// Models on this PC: search Hugging Face for GGUF models, see at a glance whether each size fits
// this computer, download one, and run it with llama.cpp (fetched from its official releases and
// started by Twilight in router mode, so every downloaded model is one server). LM Studio and
// Ollama stay as they are: providers that point at servers those apps run.

export interface Hardware {
  /** System memory in bytes. */
  memory: number
  /** The graphics card with the most memory, if it has enough to help. */
  gpu: { name: string; memory: number } | null
  cpus: number
}

/** How a model of a given size would run here. */
export type ModelFit = 'gpu' | 'experts' | 'split' | 'cpu' | 'no'

export const FIT_LABEL: Record<ModelFit, string> = {
  gpu: 'Fits on your graphics card',
  experts: 'Fits, its experts in memory: still quick',
  split: 'Fits, partly in memory: slower',
  cpu: 'Runs on the processor: slow',
  no: 'Too large for this PC'
}

/** A mixture-of-experts model's parameters, all and those at work on each word, when its name says (35B-A3B). */
export interface Moe {
  total: number | null
  active: number | null
}

/**
 * Whether a model is a mixture of experts, from its name or repository: most say so with the
 * parameters at work on each word (Qwen3.6-35B-A3B, gemma-4-26B-A4B), others by family.
 */
export function moeOf(name: string): Moe | null {
  const sized = /(\d+(?:\.\d+)?)B[-_]A(\d+(?:\.\d+)?)B(?![a-z])/i.exec(name)
  if (sized) return { total: Number(sized[1]) * 1e9, active: Number(sized[2]) * 1e9 }
  return /moe|mixtral|gpt-oss|deepseek-(?:v[2-9]|r1)|kimi-k/i.test(name) ? { total: null, active: null } : null
}

/**
 * The fit for a model file of `bytes`: its weights plus room for the context and the runtime
 * (about a sixth more, and half a gigabyte), against the graphics card first, then the card and
 * most of the system memory together. Close to LM Studio's guide; a model near a line may still
 * load with a shorter context, since llama.cpp fits what it can.
 *
 * A mixture of experts that doesn't fit the card runs another way: llama.cpp keeps the part every
 * word goes through on the card and the experts (most of the model, a few at work on each word)
 * in system memory, which stays quick. That part is guessed from the parameters at work.
 */
export function fitFor(bytes: number, hw: Hardware, moe: Moe | null = null): ModelFit {
  const need = bytes * 1.15 + 512 * 1024 * 1024
  const vram = hw.gpu?.memory ?? 0
  if (vram && need <= vram * 0.95) return 'gpu'
  if (moe && vram) {
    const share = moe.total && moe.active ? Math.min(0.5, Math.max(0.05, (0.6 * moe.active) / moe.total)) : 0.15
    const core = bytes * share * 1.15 + 1.5 * 1024 ** 3
    if (core <= vram * 0.95 && bytes * (1 - share) <= hw.memory * 0.7) return 'experts'
  }
  if (need <= vram + hw.memory * 0.7) return vram ? 'split' : 'cpu'
  return 'no'
}

/** A model repository on Hugging Face. */
export interface HubModel {
  id: string
  downloads: number
  likes: number
  /** Parameters, when the repository says. */
  params: number | null
  context: number | null
  architecture: string | null
  /** Needs a Hugging Face account and accepted terms to download. */
  gated: boolean
  vision: boolean
  updated: string | null
}

/** One size of a model: a quantization, as one file or several parts. */
export interface HubVariant {
  /** Like Q4_K_M. */
  name: string
  files: string[]
  size: number
  fit: ModelFit
}

/** How llama.cpp runs one model: its context, how much of it goes on the graphics card, and how its memory of the chat is kept. */
export interface LocalModelOptions {
  /** Tokens of context; null lets llama.cpp take the most that fits. */
  ctx: number | null
  /** 'experts': everything on the card but a mixture of experts' experts, which go in system memory. */
  gpu: 'auto' | 'all' | 'none' | 'experts'
  /** The chat's memory (the KV cache) as is, or compressed to half or a quarter, for longer chats in the same memory. */
  kv?: KvCache
}

export type KvCache = 'f16' | 'q8_0' | 'q4_0'

/** Whether a model's options differ from llama.cpp's own choices at all. */
export const hasOptions = (o: LocalModelOptions): boolean => !!o.ctx || o.gpu !== 'auto' || (!!o.kv && o.kv !== 'f16')

export const CONTEXT_CHOICES = [4096, 8192, 16384, 32768, 65536, 131072]

/** A model downloaded into the models folder. */
export interface LocalModel {
  /** The file (or folder, for a model in parts) inside the models folder. */
  name: string
  size: number
  repo: string | null
  fit: ModelFit
  /** Settings of its own; null runs it as llama.cpp chooses. */
  options: LocalModelOptions | null
  /** A mixture of experts, so its experts can go in system memory. */
  moe: boolean
}

/** A model llama.cpp has loaded (or is loading), with the memory it took in bytes. */
export interface LoadedModel {
  id: string
  state: 'loading' | 'loaded' | 'sleeping'
  ctx: number | null
  gpu: number
  ram: number
}

export interface LocalDownload {
  key: string
  repo: string
  variant: string
  done: number
  total: number
  error: string | null
}

export interface LocalState {
  hardware: Hardware
  folder: string
  models: LocalModel[]
  downloads: LocalDownload[]
  engine: {
    /** The llama.cpp build installed, like b12015, and which kind (vulkan, cpu). */
    version: string | null
    kind: string | null
    installing: { done: number; total: number } | null
    running: boolean
    starting: boolean
    port: number | null
    error: string | null
    loaded: LoadedModel[]
  }
  autoStart: boolean
}

/** The id Twilight's own llama.cpp server has as a provider. */
export const THIS_PC = 'thispc'

/** Bytes as Windows counts them (a 24 GB card reads 24 GB): 4.9 GB, 812 MB. */
export function sizeLabel(bytes: number): string {
  const [gb, mb] = [1024 ** 3, 1024 ** 2]
  if (bytes >= gb) return `${Number((bytes / gb).toFixed(bytes >= 10 * gb ? 0 : 1))} GB`
  if (bytes >= mb) return `${Math.round(bytes / mb)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Parameters as model names give them: 8B, 1.5B, 270M. */
export function paramsLabel(n: number | null): string {
  if (!n) return ''
  if (n >= 1e9) return `${n >= 1e10 ? Math.round(n / 1e9) : Math.round(n / 1e8) / 10}B`
  return `${Math.round(n / 1e6)}M`
}

/** The quantization in a GGUF file's path, like Q4_K_M or UD-IQ2_XXS. */
export function quantOf(path: string): string {
  const m = [...path.matchAll(/(?:^|[-_./])((?:UD-)?(?:I?Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))(?=[-_./]|$)/gi)].at(-1)
  return m ? m[1].toUpperCase() : path.replace(/\.gguf$/i, '').split('/').pop() ?? path
}

/** A file's path without the "-00001-of-00003" that marks parts of one model. */
export const shardBase = (path: string): string => path.replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, '')

/** Files beside a model that aren't a model of their own: vision add-ons and draft heads. */
export const isSidecar = (path: string): boolean => /^(mmproj|mtp|dflash|eagle|dspark)/i.test(path.split('/').pop() ?? path)

/** A model's name as llama.cpp's router lists it: the file without .gguf, or its folder. */
export const serverId = (name: string): string => name.replace(/\.gguf$/i, '')

/** A model to start with, at the size most people pick. */
export interface StarterModel {
  repo: string
  quant: string
  label: string
  note: string
  size: number
}

const gib = (n: number): number => Math.round(n * 1024 ** 3)

/** Good first models, smallest first; the page offers the ones this PC can run. */
export const STARTERS: StarterModel[] = [
  { repo: 'unsloth/Qwen3.5-4B-GGUF', quant: 'Q4_K_M', label: 'Qwen3.5 4B', note: 'Small and quick; runs on most laptops.', size: gib(2.55) },
  { repo: 'unsloth/Qwen3.5-9B-GGUF', quant: 'Q4_K_M', label: 'Qwen3.5 9B', note: 'A capable all-rounder for an 8 GB graphics card.', size: gib(5.29) },
  { repo: 'unsloth/gemma-4-12b-it-GGUF', quant: 'Q4_K_M', label: 'Gemma 4 12B', note: "Google's mid-size model, for a 12 GB graphics card.", size: gib(6.63) },
  { repo: 'unsloth/Qwen3.8-27B-GGUF', quant: 'UD-Q4_K_M', label: 'Qwen3.8 27B', note: 'The most downloaded model of its size, for a 24 GB graphics card.', size: gib(15.33) },
  { repo: 'unsloth/gemma-4-26B-A4B-it-GGUF', quant: 'UD-Q4_K_M', label: 'Gemma 4 26B A4B', note: 'Large but quick: only a small part of it works on each word.', size: gib(15.78) },
  { repo: 'unsloth/Qwen3.6-35B-A3B-GGUF', quant: 'UD-Q4_K_M', label: 'Qwen3.6 35B A3B', note: 'Larger still, and quick for its size even partly in system memory.', size: gib(20.61) }
]

/** The starter to suggest: the largest that fits the graphics card, or without one, the largest that stays quick on the processor. (A larger mixture of experts that would run with its experts in memory is marked so in the list, not pushed.) */
export function bestStarter(hw: Hardware): StarterModel | null {
  const fits = STARTERS.filter((s) => (hw.gpu ? fitFor(s.size, hw) === 'gpu' : fitFor(s.size, hw) !== 'no' && s.size < gib(6)))
  return fits.sort((a, b) => b.size - a.size)[0] ?? null
}
