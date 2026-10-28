// Renders the installer's artwork as 24-bit BMPs (the only format NSIS takes): the welcome/finish
// side panel (164×314) and the page header (150×57), both from the cover motif.
// Run: npx electron scripts/make-installer-art.cjs
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const NIGHT = '#0b0d1c'
const SURFACE = '#111430'

const sidebar = `
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="${NIGHT}"/>
  <rect x="16" y="128" width="164" height="54" rx="8" fill="#9497ff"/>
  <rect x="16" y="190" width="164" height="38" rx="8" fill="#c4a0ff"/>
  <rect x="16" y="236" width="164" height="14" rx="7" fill="#ffb48a"/>
  <path d="M74 236 A24 24 0 0 1 122 236 Z" fill="#ffb48a"/>
  <g fill="none" stroke="${NIGHT}" stroke-width="5">
    <path d="M58 236 A40 40 0 0 1 138 236"/>
    <path d="M38 236 A60 60 0 0 1 158 236"/>
    <path d="M18 236 A80 80 0 0 1 178 236"/>
  </g>
  <text x="16" y="282" font-family="Segoe UI Semibold, Segoe UI, sans-serif" font-weight="600" font-size="27" fill="#eceefe" letter-spacing="-0.5">Twilight</text>
  <text x="17" y="300" font-family="Segoe UI, sans-serif" font-size="10.5" fill="#a6abd8">Models, agents and writing.</text>
</svg>`

const header = `
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="${SURFACE}"/>
  <rect x="62" y="10" width="100" height="16" rx="5" fill="#9497ff"/>
  <rect x="62" y="30" width="100" height="10" rx="5" fill="#c4a0ff"/>
  <rect x="62" y="44" width="100" height="5" rx="2.5" fill="#ffb48a"/>
  <path d="M96 44 A11 11 0 0 1 118 44 Z" fill="#ffb48a"/>
  <g fill="none" stroke="${SURFACE}" stroke-width="2.5">
    <path d="M89 44 A18 18 0 0 1 125 44"/>
    <path d="M81 44 A26 26 0 0 1 133 44"/>
  </g>
  <text x="10" y="34" font-family="Segoe UI Semibold, Segoe UI, sans-serif" font-weight="600" font-size="15" fill="#eceefe">Twilight</text>
</svg>`

/** A 24-bit, bottom-up BMP from a captured image (Electron gives BGRA bytes). */
function toBmp(image) {
  const { width, height } = image.getSize()
  const bgra = image.toBitmap()
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const data = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = (height - 1 - y) * rowSize + x * 3
      data[dst] = bgra[src]
      data[dst + 1] = bgra[src + 1]
      data[dst + 2] = bgra[src + 2]
    }
  }
  const head = Buffer.alloc(54)
  head.write('BM', 0)
  head.writeUInt32LE(54 + data.length, 2)
  head.writeUInt32LE(54, 10)
  head.writeUInt32LE(40, 14)
  head.writeInt32LE(width, 18)
  head.writeInt32LE(height, 22)
  head.writeUInt16LE(1, 26)
  head.writeUInt16LE(24, 28)
  head.writeUInt32LE(data.length, 34)
  head.writeInt32LE(2835, 38)
  head.writeInt32LE(2835, 42)
  return Buffer.concat([head, data])
}

// Both images render on one page and are captured by region: a second offscreen window fails to
// load in some setups.
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const out = join(__dirname, '..', 'build')
    mkdirSync(out, { recursive: true })
    const win = new BrowserWindow({ width: 360, height: 340, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
    const html =
      `<html><body style="margin:0;overflow:hidden;background:${NIGHT}">` +
      `<div style="position:absolute;left:0;top:0">${sidebar}</div>` +
      `<div style="position:absolute;left:180px;top:0">${header}</div></body></html>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((r) => setTimeout(r, 400))
    const side = (await win.webContents.capturePage({ x: 0, y: 0, width: 164, height: 314 })).resize({ width: 164, height: 314 })
    const head = (await win.webContents.capturePage({ x: 180, y: 0, width: 150, height: 57 })).resize({ width: 150, height: 57 })
    writeFileSync(join(out, 'installerSidebar.bmp'), toBmp(side))
    writeFileSync(join(out, 'installerSidebar.preview.png'), side.toPNG())
    writeFileSync(join(out, 'installerHeader.bmp'), toBmp(head))
    writeFileSync(join(out, 'installerHeader.preview.png'), head.toPNG())
    console.log('installer art written', side.getSize(), head.getSize())
  } catch (err) {
    console.error('FAILED', err)
  }
  app.quit()
})
