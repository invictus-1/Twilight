// Benchmarks the packaged app (run `npm run dist` first) and keeps the numbers in bench/, so a
// change can be measured against them. Each run starts the app on the same lived-in profile
// (seeded on a first, discarded run) and times startup and opening things; then the scroll
// self-test runs on its 450-turn chat. Medians of the runs are kept.
//
//   node scripts/bench.cjs <label> [--runs 5]     e.g. baseline-1.0, after-1.0
//
// The numbers depend on the machine; compare runs from the same one.

const { execFileSync } = require('node:child_process')
const { cpus, totalmem, tmpdir } = require('node:os')
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const label = process.argv[2]
if (!label || label.startsWith('--')) {
  console.error('usage: node scripts/bench.cjs <label> [--runs 5]')
  process.exit(1)
}
const at = process.argv.indexOf('--runs')
const runs = at > 0 ? Number(process.argv[at + 1]) : 5
const exe = join(root, 'release', 'win-unpacked', 'Twilight.exe')
if (!existsSync(exe)) {
  console.error('No packaged app; run npm run dist first.')
  process.exit(1)
}
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const work = join(tmpdir(), 'twilight-bench')
mkdirSync(work, { recursive: true })

function launch(env, dir) {
  mkdirSync(dir, { recursive: true })
  execFileSync(exe, [], { env: { ...process.env, ...env }, stdio: 'ignore', timeout: 180000 })
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}

// A first run seeds the profile (kept in the temp folder between labels) and is set aside.
const profile = join(work, 'startup')
console.log('warming up (seeds the profile on a first run)…')
launch({ TWILIGHT_BENCH: profile }, profile)
const results = []
for (let i = 0; i < runs; i++) {
  launch({ TWILIGHT_BENCH: profile }, profile)
  const r = JSON.parse(readFileSync(join(profile, 'bench.json'), 'utf8'))
  if (r.error) throw new Error(r.error)
  results.push(r)
  console.log(`run ${i + 1}/${runs}: ui ready at ${r.startup.uiReady} ms`)
}
console.log('scroll self-test…')
const scrollDir = join(work, `scroll-${Date.now()}`)
launch({ TWILIGHT_SELFTEST: scrollDir }, scrollDir)
const scroll = JSON.parse(readFileSync(join(scrollDir, 'selftest.json'), 'utf8'))

const pick = (group) => Object.fromEntries(Object.keys(results[0][group]).map((k) => [k, median(results.map((r) => r[group][k]))]))
const summary = {
  label,
  version,
  date: new Date().toISOString().slice(0, 10),
  machine: { cpu: cpus()[0]?.model?.trim(), cores: cpus().length, memoryGB: Math.round(totalmem() / 1073741824), displayHz: scroll.displayHz },
  runs,
  startup: pick('startup'),
  navigation: pick('navigation'),
  memory: pick('memory'),
  scroll: {
    openToFirstMessageMs: scroll.openToFirstMessageMs,
    warmupDoneMs: scroll.warmupDoneMs,
    flingP50: scroll.coldFling?.p50,
    flingP99: scroll.coldFling?.p99,
    flickP50: scroll.fastFlick?.p50,
    flickP95: scroll.fastFlick?.p95,
    flickP99: scroll.fastFlick?.p99,
    heapMB: scroll.heapMB
  }
}
mkdirSync(join(root, 'bench'), { recursive: true })
writeFileSync(join(root, 'bench', `${label}.json`), `${JSON.stringify(summary, null, 2)}\n`)

// Compared with every other label kept, so before and after sit side by side.
const others = readdirSync(join(root, 'bench')).filter((f) => f.endsWith('.json') && f !== `${label}.json`)
for (const f of others) {
  const before = JSON.parse(readFileSync(join(root, 'bench', f), 'utf8'))
  console.log(`\n${before.label} → ${label}`)
  for (const group of ['startup', 'navigation', 'memory', 'scroll']) {
    for (const [k, v] of Object.entries(summary[group])) {
      const b = before[group]?.[k]
      if (typeof v !== 'number' || typeof b !== 'number') continue
      const change = b ? Math.round(((v - b) / b) * 100) : 0
      console.log(`  ${`${group}.${k}`.padEnd(34)} ${String(b).padStart(8)} → ${String(v).padStart(8)}  ${change > 0 ? '+' : ''}${change}%`)
    }
  }
}
console.log(`\n${JSON.stringify(summary, null, 2)}`)
