import { IMAGE_TOOL, type ImageConfig } from '@shared/mcp'
import { isOpenRouter } from '@shared/webTools'
import { kvGet, kvSet } from './db'
import { savePicture, savePictureFrom } from './generated'
import { getApiKey, getProvider } from './providers'

// Pictures a chat asks for. The chat's model calls the generate_image tool; the picture comes
// from the image model chosen in Settings → Tools (OpenAI's images endpoint and servers that copy
// it, or an OpenRouter model that answers with images). It's saved in Twilight's data folder and
// shown in the reply; the model is told it was made, not sent the picture back.

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
    return savePictureFrom(url, signal)
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
  if (first?.b64_json) return savePicture(Buffer.from(first.b64_json, 'base64'), 'image/png')
  if (first?.url) return savePictureFrom(first.url, signal)
  throw new Error(`${provider.name} answered without a picture.`)
}
