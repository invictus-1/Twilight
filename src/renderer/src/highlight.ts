// A small syntax highlighter for code blocks in chat. One pass of one regular expression per
// block, so it costs about as much as escaping the text and keeps up with streaming. It knows
// comments, strings, numbers, keywords, types and calls for the languages models write most;
// anything else is shown plain.

interface Lang {
  /** Line comment starters, e.g. "//" or "#". */
  line: string[]
  /** Block comment [open, close] pairs. */
  block: [string, string][]
  /** Quote characters; a triple of the quote is a multi-line string where `triple` is set. */
  quotes: string
  triple?: boolean
  keywords: string
  /** Constants such as true, false, null. */
  literals?: string
  /** Built-in type names. */
  types?: string
  /** Capitalized words are types (classes in C-like languages). */
  capsTypes?: boolean
  caseInsensitive?: boolean
  /** Words may contain hyphens (CSS properties, shell flags, PowerShell cmdlets). */
  dash?: boolean
}

const C_LITERALS = 'true false null undefined NaN Infinity nil None True False this self super'
const JS =
  'break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static switch throw try typeof var void while with yield async await as interface type enum implements declare readonly private protected public abstract namespace keyof satisfies'

const LANGS: Record<string, Lang> = {
  js: { line: ['//'], block: [['/*', '*/']], quotes: '"\'`', keywords: JS, literals: C_LITERALS, types: 'string number boolean any unknown never void object bigint symbol', capsTypes: true },
  python: {
    line: ['#'],
    block: [],
    quotes: '"\'',
    triple: true,
    keywords: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case print',
    literals: 'True False None self cls',
    types: 'int float str bool list dict set tuple bytes object type',
    capsTypes: true
  },
  c: {
    line: ['//'],
    block: [['/*', '*/']],
    quotes: '"\'',
    keywords:
      'auto break case catch class const constexpr continue default delete do else enum explicit extern for friend goto if inline namespace new operator override private protected public return sizeof static struct switch template this throw try typedef typename union using virtual volatile while final abstract extends implements import package interface instanceof synchronized throws var val fun when object is in out record sealed permits yield async await foreach lock readonly ref get set where',
    literals: 'true false null nullptr NULL this super',
    types: 'int long short char float double bool void unsigned signed size_t string String byte boolean decimal uint ulong',
    capsTypes: true
  },
  go: {
    line: ['//'],
    block: [['/*', '*/']],
    quotes: '"\'`',
    keywords: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    literals: 'true false nil iota',
    types: 'int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string bool byte rune error any',
    capsTypes: true
  },
  rust: {
    line: ['//'],
    block: [['/*', '*/']],
    quotes: '"',
    keywords: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
    literals: 'true false None Some Ok Err',
    types: 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box',
    capsTypes: true
  },
  shell: {
    line: ['#'],
    block: [],
    quotes: '"\'',
    dash: true,
    keywords: 'if then else elif fi for while until do done case esac in function return local export source alias echo cd exit set unset read shift sudo',
    literals: 'true false'
  },
  powershell: {
    line: ['#'],
    block: [['<#', '#>']],
    quotes: '"\'',
    dash: true,
    keywords: 'if else elseif foreach for while do until switch function return param begin process end try catch finally throw break continue',
    literals: '$true $false $null',
    caseInsensitive: true
  },
  sql: {
    line: ['--'],
    block: [['/*', '*/']],
    quotes: '\'"',
    keywords:
      'select from where and or not insert into values update set delete create table index view drop alter add column primary key foreign references join left right inner outer full on as group by order having limit offset distinct union all case when then else end exists in is like between with returning default unique check if begin commit rollback transaction',
    literals: 'null true false',
    types: 'int integer text varchar char real float double boolean date timestamp blob numeric bigint serial',
    caseInsensitive: true
  },
  css: { dash: true, line: [], block: [['/*', '*/']], quotes: '"\'', keywords: '@media @import @keyframes @font-face @supports @layer !important', literals: 'inherit initial unset none auto' },
  yaml: { dash: true, line: ['#'], block: [], quotes: '"\'', keywords: '', literals: 'true false null yes no on off ~' },
  lua: {
    line: ['--'],
    block: [['--[[', ']]']],
    quotes: '"\'',
    keywords: 'and break do else elseif end for function goto if in local not or repeat return then until while',
    literals: 'true false nil self'
  },
  ruby: {
    line: ['#'],
    block: [],
    quotes: '"\'',
    keywords: 'alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_accessor puts',
    literals: 'true false nil',
    capsTypes: true
  }
}

const ALIASES: Record<string, string> = {
  javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', cjs: 'js', json: 'js', jsonc: 'js', json5: 'js',
  py: 'python', python3: 'python',
  cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cs: 'c', csharp: 'c', java: 'c', kotlin: 'c', kt: 'c', swift: 'c', dart: 'c', scala: 'c', php: 'c', glsl: 'c', hlsl: 'c', zig: 'c',
  golang: 'go', rs: 'rust',
  sh: 'shell', bash: 'shell', zsh: 'shell', console: 'shell', fish: 'shell',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  scss: 'css', less: 'css',
  yml: 'yaml', toml: 'yaml', ini: 'yaml', dotenv: 'yaml',
  rb: 'ruby'
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface Compiled {
  re: RegExp
  keywords: Set<string>
  literals: Set<string>
  types: Set<string>
  lang: Lang
}

const compiled = new Map<string, Compiled>()

function compile(name: string): Compiled | null {
  const hit = compiled.get(name)
  if (hit) return hit
  const lang = LANGS[name]
  if (!lang) return null
  const parts: string[] = []
  // Group 1: comments.
  const comments = [
    ...lang.block.map(([a, b]) => `${escapeRe(a)}[\\s\\S]*?(?:${escapeRe(b)}|$)`),
    ...lang.line.map((l) => `${escapeRe(l)}[^\\n]*`)
  ]
  parts.push(comments.length ? `(${comments.join('|')})` : '(\\b\\B)')
  // Group 2: strings (triple-quoted first, then single-line with escapes).
  const strings = [
    ...(lang.triple ? [...lang.quotes].map((q) => `${q}${q}${q}[\\s\\S]*?(?:${q}${q}${q}|$)`) : []),
    ...[...lang.quotes].map((q) => (q === '`' ? '`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$)' : `${escapeRe(q)}(?:\\\\.|[^${escapeRe(q)}\\\\\\n])*(?:${escapeRe(q)}|$)`))
  ]
  parts.push(`(${strings.join('|')})`)
  // Group 3: numbers.
  parts.push('(\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b)')
  // Group 4: words (with $ and @ for shells, PowerShell and CSS); group 5: an opening parenthesis after it.
  parts.push(`(${lang.dash ? '[$@]?[A-Za-z_][\\w-]*(?<!-)' : '[$@]?[A-Za-z_]\\w*'}|!important)(\\s*\\()?`)
  const set = (s?: string): Set<string> => new Set((s ?? '').split(/\s+/).filter(Boolean).map((w) => (lang.caseInsensitive ? w.toLowerCase() : w)))
  const c: Compiled = { re: new RegExp(parts.join('|'), 'g'), keywords: set(lang.keywords), literals: set(lang.literals), types: set(lang.types), lang }
  compiled.set(name, c)
  return c
}

/** Above this a block is shown plain: highlighting a log dump helps nobody. */
const MAX_CHARS = 200_000

const markupTag = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([A-Za-z][\w:-]*)|([\w:-]+)(=)("[^"]*"|'[^']*')|(\/?>)/g

/** HTML and XML: comments, tag names and attributes. */
function highlightMarkup(code: string): string {
  let out = ''
  let last = 0
  for (const m of code.matchAll(markupTag)) {
    out += escapeHtml(code.slice(last, m.index))
    last = m.index! + m[0].length
    if (m[1]) out += `<span class="hl-c">${escapeHtml(m[1])}</span>`
    else if (m[3]) out += `${escapeHtml(m[2])}<span class="hl-k">${escapeHtml(m[3])}</span>`
    else if (m[4]) out += `<span class="hl-a">${escapeHtml(m[4])}</span>${m[5]}<span class="hl-s">${escapeHtml(m[6])}</span>`
    else out += escapeHtml(m[0])
  }
  return out + escapeHtml(code.slice(last))
}

/** Escaped HTML for a code block, with hl-* spans where the language is known. */
export function highlight(code: string, langName: string): string {
  const name = langName.toLowerCase()
  if (code.length > MAX_CHARS) return escapeHtml(code)
  if (['html', 'xml', 'svg', 'xhtml', 'vue', 'svelte'].includes(name)) return highlightMarkup(code)
  const c = compile(ALIASES[name] ?? name)
  if (!c) return escapeHtml(code)
  let out = ''
  let last = 0
  c.re.lastIndex = 0
  for (const m of code.matchAll(c.re)) {
    if (!m[0]) continue
    out += escapeHtml(code.slice(last, m.index))
    last = m.index! + m[0].length
    if (m[1]) out += `<span class="hl-c">${escapeHtml(m[1])}</span>`
    else if (m[2]) out += `<span class="hl-s">${escapeHtml(m[2])}</span>`
    else if (m[3]) out += `<span class="hl-n">${escapeHtml(m[3])}</span>`
    else if (m[4]) {
      const word = m[4]
      const key = c.lang.caseInsensitive ? word.toLowerCase() : word
      const cls = c.keywords.has(key)
        ? 'hl-k'
        : c.literals.has(key)
          ? 'hl-l'
          : c.types.has(key) || (c.lang.capsTypes && /^[A-Z][a-z0-9]/.test(word))
            ? 'hl-t'
            : m[5] || (c.lang.dash && /^[A-Z][a-z]+-[A-Z]/.test(word))
              ? 'hl-f'
              : word.startsWith('$') || word.startsWith('@')
                ? 'hl-v'
                : ''
      out += cls ? `<span class="${cls}">${escapeHtml(word)}</span>` : escapeHtml(word)
      if (m[5]) out += escapeHtml(m[5])
    } else out += escapeHtml(m[0])
  }
  return out + escapeHtml(code.slice(last))
}
