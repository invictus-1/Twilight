import type { ProviderConfig, WebActivity, WebSource, WebStep } from './types'

// Web search and web fetch, switched on per chat. Claude runs both on Anthropic's side (server
// tools); OpenRouter offers search through its web plugin. Local servers have neither, so the
// Tools menu shows them switched off with the reason.

export const isLocalUrl = (url: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(url)
export const isOpenRouter = (baseUrl: string | undefined): boolean => /openrouter\.ai/i.test(baseUrl ?? '')

export interface WebSupport {
  /** Null when the tool works with this provider, else why it doesn't. */
  search: string | null
  fetch: string | null
  via: 'claude' | 'openrouter' | null
}

export function webSupport(config: ProviderConfig | undefined): WebSupport {
  if (config?.kind === 'anthropic') return { search: null, fetch: null, via: 'claude' }
  if (isOpenRouter(config?.baseUrl)) return { search: null, fetch: 'Not through OpenRouter; needs Claude.', via: 'openrouter' }
  const why = config?.baseUrl && isLocalUrl(config.baseUrl) ? 'Not on local servers; needs Claude or OpenRouter.' : 'Not on this server; needs Claude or OpenRouter.'
  return { search: why, fetch: why, via: null }
}

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

type Block = { type: string; [key: string]: unknown }

/**
 * What a stored reply did on the web: Claude's server_tool_use blocks with their results and the
 * citations on its text, or the sources OpenRouter's plugin returned. Null when it did nothing.
 */
export function webActivityOf(blocks: Block[]): WebActivity | null {
  const steps: WebStep[] = []
  const byId = new Map<string, WebStep>()
  const cited: WebSource[] = []
  const cite = (s: WebSource): void => {
    if (s.url && !cited.some((c) => c.url === s.url)) cited.push(s)
  }
  for (const b of blocks) {
    if (b.type === 'server_tool_use' && (b.name === 'web_search' || b.name === 'web_fetch')) {
      const input = (b.input ?? {}) as { query?: string; url?: string }
      const step: WebStep = b.name === 'web_search' ? { kind: 'search', query: input.query ?? '', sources: [] } : { kind: 'fetch', query: input.url ?? '', sources: [] }
      steps.push(step)
      byId.set(String(b.id), step)
    } else if (b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result') {
      const step = byId.get(String(b.tool_use_id))
      if (!step) continue
      const content = b.content as { type?: string; error_code?: string; url?: string; content?: { title?: string | null } } | { url: string; title?: string }[]
      if (Array.isArray(content)) step.sources = content.map((r) => ({ url: r.url, title: r.title || domainOf(r.url) }))
      else if (content?.error_code) step.error = content.error_code
      else if (content?.type === 'web_fetch_result' && content.url) step.sources = [{ url: content.url, title: content.content?.title || domainOf(content.url) }]
    } else if (b.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations as { type: string; url?: string; title?: string | null }[]) {
        if (c.type === 'web_search_result_location' && c.url) cite({ url: c.url, title: c.title || domainOf(c.url) })
      }
    } else if (b.type === 'web_sources' && Array.isArray(b.sources)) {
      // OpenRouter's plugin searches with the message itself, so there are no terms to show.
      const sources = (b.sources as WebSource[]).map((s) => ({ url: s.url, title: s.title || domainOf(s.url) }))
      steps.push({ kind: 'search', query: '', sources })
      sources.forEach(cite)
    }
  }
  return steps.length || cited.length ? { steps, cited } : null
}
