import type { ModelInfo, ModelOptions, ProviderConfig, ProviderStatus } from '@shared/types'
import { kvGet, kvSet } from '../db'
import { deleteSecret, getSecret, hasSecret, setSecret } from '../secrets'
import { anthropicProvider, describeAnthropicError } from './anthropic'
import { openaiProvider } from './openai'
import type { Provider } from './types'

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'anthropic', kind: 'anthropic', name: 'Anthropic', enabled: true },
  { id: 'ollama', kind: 'openai', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', enabled: true },
  { id: 'lmstudio', kind: 'openai', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', enabled: true }
]

let modelCache: ModelInfo[] | null = null
/** How the last conversation with each provider went (kept in memory; shown on the Providers page). */
const statuses = new Map<string, ProviderStatus>()

export function implFor(config: ProviderConfig): Provider {
  return config.kind === 'anthropic' ? anthropicProvider : openaiProvider
}

type Stored = Omit<ProviderConfig, 'hasKey' | 'status'>
const strip = ({ hasKey: _h, status: _s, ...p }: ProviderConfig): Stored => p

export function getProviders(): ProviderConfig[] {
  const stored = kvGet<ProviderConfig[]>('providers') ?? DEFAULT_PROVIDERS
  return stored.map((p) => ({ ...p, hasKey: hasSecret(`provider:${p.id}`), status: statuses.get(p.id) }))
}

export function getProvider(id: string): ProviderConfig {
  const p = getProviders().find((x) => x.id === id)
  if (!p) throw new Error(`Provider "${id}" isn't set up. Pick another model.`)
  return p
}

export function getApiKey(id: string): string | undefined {
  return getSecret(`provider:${id}`)
}

export function saveProvider(config: ProviderConfig, apiKey?: string): ProviderConfig[] {
  const list = getProviders().filter((p) => p.id !== config.id).map(strip)
  list.push(strip(config))
  kvSet('providers', list)
  if (apiKey !== undefined) {
    if (apiKey.trim()) setSecret(`provider:${config.id}`, apiKey.trim())
    else deleteSecret(`provider:${config.id}`)
    statuses.delete(config.id)
  }
  modelCache = null
  return getProviders()
}

export function deleteProvider(id: string): ProviderConfig[] {
  kvSet('providers', getProviders().filter((p) => p.id !== id).map(strip))
  deleteSecret(`provider:${id}`)
  statuses.delete(id)
  modelCache = null
  return getProviders()
}

/** A model's options from the last fetched list (kept on disk, so it works offline). */
export function modelOptions(providerId: string, modelId: string): ModelOptions | undefined {
  const list = modelCache ?? kvGet<ModelInfo[]>(`models:${providerId}`) ?? []
  return list.find((m) => m.providerId === providerId && m.id === modelId)?.options
}

/** Applies the user's per-model settings (labels, hidden, hand-added ids) to a provider's list. */
function personalize(p: ProviderConfig, listed: ModelInfo[]): ModelInfo[] {
  const ids = new Set(listed.map((m) => m.id))
  const custom: ModelInfo[] = (p.customModels ?? [])
    .filter((id) => !ids.has(id))
    .map((id) => ({ id, providerId: p.id, name: id, local: false, custom: true }))
  return [...listed, ...custom].map((m) => {
    const label = p.labels?.[m.id]
    return { ...m, name: label || m.name, originalName: label ? m.name : undefined, hidden: p.hiddenModels?.includes(m.id) ?? false }
  })
}

function errorText(err: unknown): string {
  return describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err))
}

async function fetchProvider(p: ProviderConfig): Promise<ModelInfo[]> {
  if (p.kind === 'anthropic' && !hasSecret(`provider:${p.id}`)) {
    statuses.set(p.id, { ok: false, message: 'No API key yet.', at: Date.now() })
    return []
  }
  try {
    const models = await implFor(p).listModels(p, getApiKey(p.id))
    kvSet(`models:${p.id}`, models)
    statuses.set(p.id, { ok: true, message: `${models.length} model${models.length === 1 ? '' : 's'} available`, at: Date.now() })
    return models
  } catch (err) {
    statuses.set(p.id, { ok: false, message: errorText(err), at: Date.now() })
    return kvGet<ModelInfo[]>(`models:${p.id}`) ?? []
  }
}

/** Every enabled provider's models. A provider that can't be reached falls back to its last known list. */
export async function listModels(refresh = false): Promise<ModelInfo[]> {
  if (modelCache && !refresh) return modelCache
  const providers = getProviders().filter((p) => p.enabled)
  const results = await Promise.all(providers.map(async (p) => personalize(p, await fetchProvider(p))))
  modelCache = results.flat()
  return modelCache
}

export async function testProvider(id: string): Promise<ProviderStatus> {
  await fetchProvider(getProvider(id))
  modelCache = null
  return statuses.get(id)!
}
