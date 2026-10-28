// Reads ROADMAP.md into the Roadmap page's shape. The file stays the one place the roadmap lives;
// the page is a view of it. Lines look like
//   - [x] **Title** · Area — what it does      (shipped; [~] in progress, [ ] planned)
//   - **Title** · Area — what it does          (an idea)
// under "## Shipped" (with "### 0.2.0 · October 2026" per release), "## Next", "## Later" and
// "## Ideas".

export type RoadmapStatus = 'shipped' | 'doing' | 'planned' | 'idea'

export interface RoadmapItem {
  title: string
  area: string
  text: string
  status: RoadmapStatus
}

export interface RoadmapRelease {
  version: string
  date: string
  items: RoadmapItem[]
}

export interface Roadmap {
  shipped: RoadmapRelease[]
  next: RoadmapItem[]
  later: RoadmapItem[]
  ideas: RoadmapItem[]
}

const ITEM = /^-\s+(?:\[([ x~])\]\s+)?\*\*(.+?)\*\*\s*(?:·\s*([^—]+?))?\s*(?:—\s*(.*))?$/

export function parseRoadmap(markdown: string): Roadmap {
  const roadmap: Roadmap = { shipped: [], next: [], later: [], ideas: [] }
  let section = ''
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      section = line.slice(3).toLowerCase()
      continue
    }
    if (line.startsWith('### ') && section === 'shipped') {
      const [version, date = ''] = line.slice(4).split('·').map((s) => s.trim())
      roadmap.shipped.push({ version, date, items: [] })
      continue
    }
    const m = ITEM.exec(line)
    if (!m) continue
    const status: RoadmapStatus = m[1] === 'x' ? 'shipped' : m[1] === '~' ? 'doing' : m[1] === ' ' ? 'planned' : 'idea'
    const item = { title: m[2].trim(), area: (m[3] ?? 'Core').trim(), text: (m[4] ?? '').trim(), status }
    if (section === 'shipped') roadmap.shipped.at(-1)?.items.push(item)
    else if (section === 'next') roadmap.next.push(item)
    else if (section === 'later') roadmap.later.push(item)
    else if (section === 'ideas') roadmap.ideas.push(item)
  }
  return roadmap
}
