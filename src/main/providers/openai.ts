import type { ModelInfo, ProviderConfig } from '@shared/types'
import { textBlocks, type GenerateRequest, type GenerateResult, type Provider } from './types'

// OpenAI-compatible chat servers: Ollama, LM Studio, llama.cpp, vLLM and the like. Local servers
// reuse their KV cache for an unchanged prefix, so the same append-only history applies here.

function headers(apiKey?: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }
}

function base(config: ProviderConfig): string {
  return (config.baseUrl ?? '').replace(/\/+$/, '')
}

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(url)
}

export const openaiProvider: Provider = {
  async listModels(config: ProviderConfig, apiKey?: string): Promise<ModelInfo[]> {
    const res = await fetch(`${base(config)}/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error(`${config.name}: ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? [])
      .map((m) => ({ id: m.id, providerId: config.id, name: m.id, local: isLocal(base(config)) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const { settings } = req
    const started = Date.now()
    const messages: { role: string; content: string }[] = []
    if (req.system) messages.push({ role: 'system', content: req.system })
    for (const node of req.history) {
      if (node.role !== 'user' && node.role !== 'assistant') continue
      const text = textBlocks(node)
        .map((b) => b.text)
        .join('\n\n')
      if (!text) continue
      messages.push({ role: node.role, content: text })
    }

    const body: Record<string, unknown> = {
      model: settings.modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    }
    // No max_tokens: local servers cap output at their own context size, and a large value
    // can exceed a small context window and fail the request.
    if (settings.temperature != null) body.temperature = settings.temperature

    let text = ''
    let thinking = ''
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0 }
    try {
      const res = await fetch(`${base(req.config)}/chat/completions`, {
        method: 'POST',
        headers: headers(req.apiKey),
        body: JSON.stringify(body),
        signal: req.signal
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        throw new Error(`${req.config.name} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          const chunk = JSON.parse(data) as {
            choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
          }
          const delta = chunk.choices?.[0]?.delta
          const reasoning = delta?.reasoning_content ?? delta?.reasoning
          if (reasoning) {
            thinking += reasoning
            req.onThinking(reasoning)
          }
          if (delta?.content) {
            text += delta.content
            req.onText(delta.content)
          }
          if (chunk.usage) {
            const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
            usage.input = (chunk.usage.prompt_tokens ?? 0) - cached
            usage.cacheRead = cached
            usage.output = chunk.usage.completion_tokens ?? 0
          }
        }
      }
    } catch (err) {
      if (!req.signal.aborted) throw err
    }
    usage.ms = Date.now() - started
    return {
      text,
      thinking: thinking || undefined,
      content: [{ type: 'text', text }],
      usage,
      modelId: settings.modelId
    }
  }
}
