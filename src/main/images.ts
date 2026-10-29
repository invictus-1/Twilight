import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { IMAGE_TOOL, type ImageConfig } from '@shared/mcp'
import { isOpenRouter } from '@shared/webTools'
import { kvGet, kvSet } from './db'
import { getApiKey, getProvider } from './providers'

// Pictures a chat asks for. The chat's model calls the generate_image tool; the picture comes
// from the image model chosen in Settings → Tools (OpenAI's images endpoint and servers that copy
// it, or an OpenRouter model that answers with images). It's saved in Twilight's data folder and
// shown in the reply; the model is told it was made, not sent the picture back.

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }

export const generatedFolder = (): string => join(app.getPath('userData'), 'generated')

/** The tool a chat's model calls for a picture. */
export const IMAGE_TOOL_DEF = {
  name: IMAGE_TOOL,
  description:
    "Make a picture and show it to the user under your reply. Use it when they ask for an image, or when a picture would clearly help. Describe it fully in prompt: subject, setting, style, composition, colours and mood; the image model sees only this.",
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'A full description of the picture.' },
      size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'], description: 'Square, landscape or portrait. Default square.' }
    },
    required: ['prompt']
  }
}

export function imageConfig(): ImageConfig | null {
  return kvGet<ImageConfig>('images.config') ?? null
}

export function setImageConfig(config: ImageConfig | null): ImageConfig | null {
  kvSet('images.config', config)
  return imageConfig()
}

/** A generated picture's bytes, by file name only (nothing outside the folder can be asked for). */
export async function readGenerated(file: string): Promise<{ data: Buffer; type: string } | null> {
  const name = basename(file)
  const type = TYPES[extname(name).toLowerCase()]
  if (!type) return null
  try {
    return { data: await readFile(join(generatedFolder(), name)), type }
  } catch {
    return null
  }
}

async function save(data: Buffer, type: string): Promise<string> {
  await mkdir(generatedFolder(), { recursive: true })
  const file = `${randomUUID()}${EXT[type] ?? '.png'}`
  await writeFile(join(generatedFolder(), file), data)
  return file
}

/** A data: URL or an address the server gave, as bytes and a type. */
async function fetchPicture(url: string, signal: AbortSignal): Promise<{ data: Buffer; type: string }> {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (m) return { data: Buffer.from(m[2], 'base64'), type: m[1] }
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Couldn't download the picture (${res.status}).`)
  return { data: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type')?.split(';')[0] ?? 'image/png' }
}

/** Makes one picture; returns its file name in the generated folder. */
export async function generateImage(prompt: string, size: string | undefined, signal: AbortSignal): Promise<string> {
  const config = imageConfig()
  if (!config?.providerId || !config.modelId) throw new Error('No image model is chosen. Pick one in Settings → Tools.')
  const provider = getProvider(config.providerId)
  if (provider.kind === 'anthropic') throw new Error("Claude doesn't make pictures. Choose an image model from another provider in Settings → Tools.")
  const base = (provider.baseUrl ?? '').replace(/\/+$/, '')
  const key = getApiKey(provider.id)
  const headers = { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }
  const wanted = size || config.size || '1024x1024'
  if (isOpenRouter(base)) {
    // OpenRouter's image models answer a chat request with the picture attached.
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.modelId, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'] }),
      signal
    })
    if (!res.ok) throw new Error(`${provider.name} returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    const json = (await res.json()) as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] }
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url
    if (!url) throw new Error(`${config.modelId} answered without a picture. Is it an image model?`)
    const pic = await fetchPicture(url, signal)
    return save(pic.data, pic.type)
  }
  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: config.modelId, prompt, n: 1, size: wanted }),
    signal
  })
  if (!res.ok) throw new Error(`${provider.name} returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
  const first = json.data?.[0]
  if (first?.b64_json) return save(Buffer.from(first.b64_json, 'base64'), 'image/png')
  if (first?.url) {
    const pic = await fetchPicture(first.url, signal)
    return save(pic.data, pic.type)
  }
  throw new Error(`${provider.name} answered without a picture.`)
}
