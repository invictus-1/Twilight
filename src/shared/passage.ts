/**
 * Where a passage selected in a reply's rendered text sits in the reply's markdown source, or
 * null. The rendered text has lost the marks (**, _, `, #, quote marks and list markers at the
 * start of lines) and collapses runs of space, so the two are compared without them; the answer
 * is the source's own span, marks and all.
 */
export function locatePassage(source: string, selected: string): { start: number; end: number } | null {
  const plain = selected.trim()
  if (!plain) return null
  const exact = source.indexOf(plain)
  if (exact >= 0) return { start: exact, end: exact + plain.length }
  // Markers at the start of a line (list numbers, bullets, quotes, headings) never show as text.
  const skip = new Set<number>()
  for (const m of source.matchAll(/^[ \t]*(?:\d+[.)]|[-*+>]|#{1,6})[ \t]+/gm)) for (let i = m.index; i < m.index + m[0].length; i++) skip.add(i)
  let flat = ''
  const at: number[] = []
  let space = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (skip.has(i) || c === '*' || c === '_' || c === '`') continue
    if (/\s/.test(c)) {
      if (!space && flat) {
        flat += ' '
        at.push(i)
      }
      space = true
      continue
    }
    space = false
    flat += c
    at.push(i)
  }
  const want = plain.replace(/[*_`]/g, '').replace(/\s+/g, ' ')
  const k = flat.indexOf(want)
  if (k < 0) return null
  return { start: at[k], end: at[k + want.length - 1] + 1 }
}
