import type { ModelInfo, ProviderConfig } from '@shared/types'
import { kvGet, kvSet } from '../db'
import { deleteSecret, getSecret, hasSecret, setSecret } from '../secrets'
import { anthropicProvider } from './anthropic'
import { openaiProvider } from './openai'
import type { Provider } from './types'

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'anthropic', kind: 'anthropic', name: 'Anthropic', enabled: true },
  { id: 'ollama', kind: 'openai', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', enabled: true },
  { id: 'lmstudio', kind: 'openai', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', enabled: true }
]

let modelCache: ModelInfo[] | null = null

export function implFor(config: ProviderConfig): Provider {
  return config.kind === 'anthropic' ? anthropicProvider : openaiProvider
}

export function getProviders(): ProviderConfig[] {
  const stored = kvGet<ProviderConfig[]>('providers') ?? DEFAULT_PROVIDERS
  return stored.map((p) => ({ ...p, hasKey: hasSecret(`provider:${p.id}`) }))
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
  const list = getProviders().filter((p) => p.id !== config.id)
  const { hasKey: _ignored, ...clean } = config
  list.push(clean)
  kvSet('providers', list.map(({ hasKey: _h, ...p }) => p))
  if (apiKey !== undefined) {
    if (apiKey.trim()) setSecret(`provider:${config.id}`, apiKey.trim())
    else deleteSecret(`provider:${config.id}`)
  }
  modelCache = null
  return getProviders()
}

export function deleteProvider(id: string): ProviderConfig[] {
  kvSet(
    'providers',
    getProviders()
      .filter((p) => p.id !== id)
      .map(({ hasKey: _h, ...p }) => p)
  )
  deleteSecret(`provider:${id}`)
  modelCache = null
  return getProviders()
}

/** Every enabled provider's models. A provider that can't be reached falls back to its last known list. */
export async function listModels(refresh = false): Promise<ModelInfo[]> {
  if (modelCache && !refresh) return modelCache
  const providers = getProviders().filter((p) => p.enabled)
  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        const models = await implFor(p).listModels(p, getApiKey(p.id))
        kvSet(`models:${p.id}`, models)
        return models
      } catch {
        return kvGet<ModelInfo[]>(`models:${p.id}`) ?? []
      }
    })
  )
  modelCache = results.flat()
  return modelCache
}
