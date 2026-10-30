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
export type ModelFit = 'gpu' | 'split' | 'cpu' | 'no'

export const FIT_LABEL: Record<ModelFit, string> = {
  gpu: 'Fits on your graphics card',
  split: 'Fits, partly in memory: slower',
  cpu: 'Runs on the processor: slow',
  no: 'Too large for this PC'
}

/**
 * The fit for a model file of `bytes`: its weights plus room for the context and the runtime
 * (about a sixth more, and half a gigabyte), against the graphics card first, then the card and
 * most of the system memory together. Close to LM Studio's guide; a model near a line may still
 * load with a shorter context, since llama.cpp fits what it can.
 */
export function fitFor(bytes: number, hw: Hardware): ModelFit {
  const need = bytes * 1.15 + 512 * 1024 * 1024
  const vram = hw.gpu?.memory ?? 0
  if (vram && need <= vram * 0.95) return 'gpu'
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

/** A model downloaded into the models folder. */
export interface LocalModel {
  /** The file (or folder, for a model in parts) inside the models folder. */
  name: string
  size: number
  repo: string | null
  fit: ModelFit
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
