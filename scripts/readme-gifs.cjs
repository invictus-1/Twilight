// Turns a showcase run's frames into the README's GIFs (needs ffmpeg on PATH, or its path in FFMPEG):
//   TWILIGHT_SHOWCASE=<dir> npx electron .   then   node scripts/readme-gifs.cjs <dir>
// sky.gif: the empty chat at dawn, day, dusk and night. evening.gif: the empty chat moving.
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/readme-gifs.cjs <showcase folder>')
  process.exit(1)
}
const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const out = join(__dirname, '..', 'docs', 'screenshots')
// One palette per GIF, made from its own frames, so the sky's gradients keep their colours.
const palette = '[0:v]scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a'
const run = (args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

// Each time of day held for a second and a half (the last frame is listed twice so it holds too).
const list = join(dir, 'sky.txt')
const frame = (t) => `file '${join(dir, `sky-${t}.png`).split('\\').join('/')}'`
writeFileSync(list, [...['dawn', 'day', 'dusk', 'night'].map((t) => `${frame(t)}\nduration 1.5`), frame('night')].join('\n'))
run(['-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', palette, '-loop', '0', join(out, 'sky.gif')])
// The empty chat, about 14 frames a second.
run(['-framerate', '14', '-i', join(dir, 'empty-%02d.png'), '-filter_complex', palette, '-loop', '0', join(out, 'evening.gif')])
console.log('wrote docs/screenshots/sky.gif and docs/screenshots/evening.gif')
