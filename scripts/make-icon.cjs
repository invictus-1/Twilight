// Renders the app icon (build/icon.png, 512×512) from the cover motif: three twilight bands
// with a sun on the horizon and rings cut through them. Run: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath></defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="#111430"/>
    <rect x="56" y="112" width="400" height="112" rx="22" fill="#9497ff"/>
    <rect x="56" y="240" width="400" height="76" rx="22" fill="#c4a0ff"/>
    <rect x="56" y="332" width="400" height="30" rx="15" fill="#ffb48a"/>
    <path d="M206 332 A50 50 0 0 1 306 332 Z" fill="#ffb48a"/>
    <g fill="none" stroke="#111430" stroke-width="11">
      <path d="M176 332 A80 80 0 0 1 336 332"/>
      <path d="M136 332 A120 120 0 0 1 376 332"/>
      <path d="M96 332 A160 160 0 0 1 416 332"/>
    </g>
  </g>
</svg>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const out = join(__dirname, '..', 'build')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'icon.png'), image.resize({ width: 512, height: 512 }).toPNG())
  console.log('build/icon.png written', image.getSize())
  app.quit()
})
