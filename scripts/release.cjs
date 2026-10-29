// Publishes the built installers as a GitHub release of this repository, where Twilight's
// updater finds them. Run `npm run dist` first. The release notes come from this version's
// section of CHANGELOG.md, and the release is tagged on the current commit.
//
//   npm run release            publish release/ for the version in package.json
//   npm run release -- --dry   show what would be published

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const { homedir, tmpdir } = require('node:os')

const REPO = 'invictus-1/twilight'
const root = join(__dirname, '..')
const dry = process.argv.includes('--dry')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `v${version}`

// Commands run with stdio 'inherit' print straight to the terminal and return nothing.
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }) ?? '').trim()
const fail = (msg) => {
  console.error(`release: ${msg}`)
  process.exit(1)
}

// The animated installer (installer/build.cjs) and the portable zip; latest.yml carries the installer's hash.
const files = [`Twilight-Setup-${version}.exe`, 'latest.yml', `Twilight-${version}-x64.zip`].map((f) =>
  join(root, 'release', f)
)
for (const f of files) if (!existsSync(f)) fail(`missing ${f}; run npm run dist first.`)
const yml = readFileSync(join(root, 'release', 'latest.yml'), 'utf8')
if (!yml.includes(`version: ${version}`)) fail(`release/latest.yml is for another version; run npm run dist again.`)

// The built app must not carry paths from this machine (a home folder holds the user's name).
const leaks = [homedir(), root].flatMap((p) => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\')])
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
for (const file of walk(join(root, 'out'))) {
  const text = readFileSync(file, 'utf8')
  if (leaks.some((p) => text.includes(p))) fail(`${file} contains a path from this machine; rebuild with npm run dist (the build scrubs them).`)
}

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const section = new RegExp(`^## ${version.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog)
if (!section) fail(`CHANGELOG.md has no "## ${version}" section.`)
const notes = section[1].trim()

if (run('git', ['status', '--porcelain'])) fail('commit your changes first, so the tag matches what was built.')
let published = false
try {
  run('gh', ['release', 'view', tag, '--repo', REPO])
  published = true
} catch {}
if (published) fail(`${tag} is already published. Bump the version in package.json for a new release.`)

console.log(`Publishing Twilight ${version} to ${REPO}:\n${files.map((f) => `  ${f}`).join('\n')}\n\n${notes}\n`)
if (dry) process.exit(0)

const notesFile = join(mkdtempSync(join(tmpdir(), 'twilight-release-')), 'notes.md')
writeFileSync(notesFile, notes)
if (!run('git', ['tag', '--list', tag])) run('git', ['tag', '-a', tag, '-m', `Twilight ${version}`])
run('git', ['push', 'origin', tag], { stdio: 'inherit' })
run('gh', ['release', 'create', tag, '--repo', REPO, '--title', `Twilight ${version}`, '--notes-file', notesFile, ...files], { stdio: 'inherit' })
console.log(`Done: https://github.com/${REPO}/releases/tag/${tag}`)
