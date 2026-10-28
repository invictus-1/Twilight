import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'

// CommonMark + GFM tables, strikethrough, autolinks, footnotes and task lists — the same
// markdown Obsidian writes. Raw HTML stays escaped (html: false), so model output can't inject
// markup. Rendered HTML is cached per message, so a finished message is parsed exactly once.

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })
md.use(footnote)
md.use(taskLists, { enabled: false })

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim().split(/\s+/)[0] ?? ''
  return (
    `<div class="tw-codeblock"><div class="tw-codeblock-head"><span>${escapeHtml(lang || 'text')}</span>` +
    `<button class="tw-codeblock-copy" data-copy>Copy</button></div>` +
    `<pre><code>${escapeHtml(token.content)}</code></pre></div>`
  )
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

export function renderMarkdown(key: string, text: string): string {
  const cacheKey = `${key}:${text.length}`
  const hit = cache.get(cacheKey)
  if (hit !== undefined) return hit
  const html = md.render(text)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(cacheKey, html)
  return html
}

/** Uncached render for text that is still streaming. */
export function renderMarkdownLive(text: string): string {
  return md.render(text)
}
