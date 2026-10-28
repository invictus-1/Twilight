// Publishes the built installers to the public releases repo, where Twilight's updater finds
// them. Run `npm run dist` first. The release notes come from this version's section of
// CHANGELOG.md; the source repo gets a matching tag.
//
//   npm run release            publish release/ for the version in package.json
//   npm run release -- --dry   show what would be published

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const REPO = 'invictus-1/twilight-releases'
const root = join(__dirname, '..')
const dry = process.argv.includes('--dry')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `v${version}`

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
const fail = (msg) => {
  console.error(`release: ${msg}`)
  process.exit(1)
}

const files = [`Twilight-Setup-${version}.exe`, `Twilight-Setup-${version}.exe.blockmap`, 'latest.yml', `Twilight-${version}-x64.zip`].map((f) =>
  join(root, 'release', f)
)
for (const f of files) if (!existsSync(f)) fail(`missing ${f}; run npm run dist first.`)
const yml = readFileSync(join(root, 'release', 'latest.yml'), 'utf8')
if (!yml.includes(`version: ${version}`)) fail(`release/latest.yml is for another version; run npm run dist again.`)

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
