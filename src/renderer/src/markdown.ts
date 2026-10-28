import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'

// CommonMark + GFM tables, strikethrough, autolinks, footnotes and task lists — the same
// markdown Obsidian writes — plus a safe subset of raw HTML, so a model's collapsible
// <details> blocks (a status card, a stat sheet) render as they would on GitHub. Every rendered
// message passes through an allowlist: unknown tags are unwrapped, dangerous ones dropped,
// attributes stripped to a known set. Rendered HTML is cached per message.

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false })
md.use(footnote)
md.use(taskLists, { enabled: false })

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim().split(/\s+/)[0] ?? ''
  return (
    `<div class="tw-codeblock"><div class="tw-codeblock-head"><span>${escapeHtml(lang || 'text')}</span>` +
    `<span class="tw-codeblock-tools"><button class="tw-codeblock-btn" data-collapse aria-label="Collapse">Collapse</button>` +
    `<button class="tw-codeblock-btn" data-copy>Copy</button></span></div>` +
    `<pre><code>${escapeHtml(token.content)}</code></pre></div>`
  )
}

// ——— Sanitizer ———

const REMOVE = new Set(['script', 'style', 'iframe', 'object', 'embed', 'frame', 'frameset', 'link', 'meta', 'base', 'form', 'textarea', 'select', 'option', 'template', 'svg', 'math', 'img', 'video', 'audio', 'source', 'picture', 'canvas', 'noscript', 'title', 'head'])
const ALLOWED: Record<string, string[]> = {
  details: ['open'], summary: [], div: ['class'], span: ['class'], p: [], br: [], hr: [],
  b: [], strong: [], i: [], em: [], u: [], s: [], del: [], ins: [], mark: [], sub: [], sup: [], small: [], kbd: [], abbr: ['title'],
  code: ['class'], pre: [], blockquote: [], ul: [], ol: ['start'], li: ['class', 'id'], dl: [], dt: [], dd: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], center: [],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['style', 'colspan', 'rowspan'], td: ['style', 'colspan', 'rowspan'],
  a: ['href', 'id', 'class'], input: ['type', 'checked', 'disabled', 'class'], section: ['class'], label: [],
  button: ['class', 'data-copy', 'data-collapse', 'aria-label']
}
const RAW_HTML = /<\/?[a-z][\w-]*[\s/>]/i

function clean(node: Element): void {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase()
    if (REMOVE.has(tag)) {
      child.remove()
      continue
    }
    const allowed = ALLOWED[tag]
    if (!allowed) {
      clean(child)
      child.replaceWith(...Array.from(child.childNodes)) // unknown tag: keep its contents
      continue
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase()
      let keep = allowed.includes(name)
      if (keep && name === 'href') keep = /^(https?:|#)/i.test(attr.value.trim())
      if (keep && name === 'style') keep = /^\s*text-align:\s*(left|right|center)\s*;?\s*$/i.test(attr.value)
      if (keep && tag === 'input' && name === 'type') keep = attr.value === 'checkbox'
      if (!keep) child.removeAttribute(attr.name)
    }
    if (tag === 'input') child.setAttribute('disabled', '')
    clean(child)
  }
}

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  clean(doc.body)
  return doc.body.innerHTML
}

/** Renders model or user markdown to safe HTML. Text without raw HTML skips the sanitizer's parse. */
function render(text: string): string {
  const html = md.render(text)
  return RAW_HTML.test(text) ? sanitize(html) : html
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

export function renderMarkdown(key: string, text: string): string {
  const cacheKey = `${key}:${text.length}`
  const hit = cache.get(cacheKey)
  if (hit !== undefined) return hit
  const html = render(text)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(cacheKey, html)
  return html
}

/** Uncached render for text that is still streaming. */
export function renderMarkdownLive(text: string): string {
  return render(text)
}
