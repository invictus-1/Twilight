// Compiles design/tokens.json (the Twilight design system's tokens) into CSS custom properties.
// Run `node scripts/tokens.mjs` after pulling new tokens from the design system.
import { readFileSync, writeFileSync } from 'node:fs'

const tokens = JSON.parse(readFileSync(new URL('../design/tokens.json', import.meta.url), 'utf8'))
const theme = tokens.color.themes[0].id
const value = (v) => (typeof v === 'string' ? v : v[theme])
const css = (v) => value(v).replace(/^\{(.+)\}$/, 'var(--$1)')

const lines = ['/* Twilight — generated from design/tokens.json by scripts/tokens.mjs. Do not edit. */', ':root {']
for (const t of tokens.color.tokens) lines.push(`  --${t.name}: ${css(t.value)};`)
for (const family of ['shadow', 'spacing', 'radius', 'size']) {
  for (const t of tokens[family]?.tokens ?? []) lines.push(`  --${t.name}: ${css(t.value)};`)
}
for (const [key, stack] of Object.entries(tokens.type.families)) lines.push(`  --font-${key}: ${stack};`)
lines.push('}', '')
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    const family = s.family ?? group.family
    lines.push(
      `.t-${s.name} { font-family: var(--font-${family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''} }`
    )
  }
}
writeFileSync(new URL('../src/renderer/src/styles/tokens.css', import.meta.url), lines.join('\n') + '\n')
console.log('tokens.css written')
