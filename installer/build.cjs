// Builds release/Twilight-Setup-<version>.exe: the animated installer (setup.cpp + ui/index.html)
// with electron-builder's NSIS installer appended, which it runs silently. `npm run dist` calls
// this after electron-builder. Needs Visual Studio's C++ tools (any edition with "Desktop
// development with C++"); the WebView2 SDK is fetched once from nuget.org into installer/.vendor.
// Without the C++ tools, the classic NSIS installer is published under the same name instead.

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync, openSync, writeSync, closeSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const root = join(__dirname, '..')
const release = join(root, 'release')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const core = join(release, `Twilight-Core-Setup-${version}.exe`)
const target = join(release, `Twilight-Setup-${version}.exe`)
const work = join(__dirname, '.build')

// The WebView2 SDK, pinned: headers and the static loader, so setup.exe stands alone.
const WEBVIEW2 = { version: '1.0.2903.40' }
const vendor = join(__dirname, '.vendor', `webview2-${WEBVIEW2.version}`)

const log = (msg) => console.log(`installer: ${msg}`)
const fail = (msg) => {
  console.error(`installer: ${msg}`)
  process.exit(1)
}

if (!existsSync(core)) fail(`missing ${core}; electron-builder runs first (npm run dist).`)
mkdirSync(work, { recursive: true })

function folderBytes(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? folderBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0)
}

/** Visual Studio's vcvars64.bat, found with vswhere; null when the C++ tools aren't installed. */
function vcvars() {
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return null
  const path = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
  const bat = path && join(path, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  return bat && existsSync(bat) ? bat : null
}

async function fetchWebView2() {
  if (existsSync(join(vendor, 'build', 'native', 'include', 'WebView2.h'))) return
  log(`fetching the WebView2 SDK ${WEBVIEW2.version} from nuget.org`)
  const res = await fetch(`https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2.version}`)
  if (!res.ok) fail(`couldn't download the WebView2 SDK (${res.status}).`)
  const bytes = Buffer.from(await res.arrayBuffer())
  log(`WebView2 SDK sha256 ${createHash('sha256').update(bytes).digest('hex')}`)
  mkdirSync(vendor, { recursive: true })
  const pkg = join(vendor, 'package.zip')
  writeFileSync(pkg, bytes)
  execFileSync('tar', ['-xf', pkg, '-C', vendor])
}

/** The page with Twilight's own fonts inlined, so it looks exactly like the app's welcome. */
function page() {
  const font = (file) => readFileSync(join(root, 'node_modules', '@fontsource-variable', file)).toString('base64')
  const faces = [
    `@font-face { font-family: "Geist Variable"; font-weight: 100 900; font-display: block; src: url(data:font/woff2;base64,${font('geist/files/geist-latin-wght-normal.woff2')}) format("woff2"); }`,
    `@font-face { font-family: "Literata Variable"; font-weight: 200 900; font-display: block; src: url(data:font/woff2;base64,${font('literata/files/literata-latin-opsz-normal.woff2')}) format("woff2"); }`
  ].join('\n')
  const html = readFileSync(join(__dirname, 'ui', 'index.html'), 'utf8').replace('/*FONTS*/', faces)
  if (Buffer.byteLength(html) > 1.9 * 1024 * 1024) fail('the installer page is over WebView2\'s 2 MB limit for inline pages.')
  return html
}

function resourceScript() {
  const [major, minor, patch] = version.split('.').map(Number)
  const icon = [join(release, '.icon-ico', 'icon.ico'), join(root, 'build', 'icon.ico')].find(existsSync)
  return [
    '#include <winver.h>',
    icon ? `1 ICON "${icon.replace(/\\/g, '\\\\')}"` : '',
    '2 RCDATA "page.html"',
    `1 24 "${join(__dirname, 'setup.manifest').replace(/\\/g, '\\\\')}"`,
    '1 VERSIONINFO',
    `FILEVERSION ${major},${minor},${patch},0`,
    `PRODUCTVERSION ${major},${minor},${patch},0`,
    'FILEOS VOS_NT_WINDOWS32',
    'FILETYPE VFT_APP',
    'BEGIN',
    '  BLOCK "StringFileInfo"',
    '  BEGIN',
    '    BLOCK "040904B0"',
    '    BEGIN',
    '      VALUE "FileDescription", "Twilight Setup"',
    `      VALUE "FileVersion", "${version}"`,
    '      VALUE "ProductName", "Twilight"',
    `      VALUE "ProductVersion", "${version}"`,
    '      VALUE "OriginalFilename", "Twilight-Setup.exe"',
    '    END',
    '  END',
    '  BLOCK "VarFileInfo"',
    '  BEGIN',
    '    VALUE "Translation", 0x409, 1200',
    '  END',
    'END',
    ''
  ].join('\r\n')
}

function compile(bat) {
  writeFileSync(join(work, 'page.html'), page())
  writeFileSync(join(work, 'setup.rc'), resourceScript())
  const include = join(vendor, 'build', 'native', 'include')
  const lib = join(vendor, 'build', 'native', 'x64')
  // vcvars looks for vswhere on PATH; without it, it prints a harmless complaint.
  const vswhereDir = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer')
  const steps = [
    `set "PATH=${vswhereDir};%PATH%"`,
    `"${bat}" >nul`,
    'rc /nologo /fo setup.res setup.rc',
    `cl /nologo /utf-8 /O1 /GL /EHsc /std:c++17 /MT /W3 /DUNICODE /D_UNICODE /I "${include}" "${join(__dirname, 'setup.cpp')}" setup.res /Fe:setup.exe /link /LTCG /LIBPATH:"${lib}" /SUBSYSTEM:WINDOWS /OPT:REF /OPT:ICF`
  ].join(' && ')
  execFileSync('cmd.exe', ['/d', '/s', '/c', `"${steps}"`], { cwd: work, stdio: ['ignore', 'inherit', 'inherit'], windowsVerbatimArguments: true })
  const stub = readFileSync(join(work, 'setup.exe'))
  // The program must not carry paths from this machine, like the app itself.
  for (const p of [homedir(), root]) if (stub.includes(Buffer.from(p)) || stub.includes(Buffer.from(p, 'utf16le'))) fail(`setup.exe contains a path from this machine (${p}).`)
  return stub
}

/** setup.exe, then the NSIS installer, then metadata, then the trailer that points at both. */
function assemble(stub) {
  const meta = Buffer.from(JSON.stringify({ version, installedBytes: folderBytes(join(release, 'win-unpacked')) }))
  const payloadSize = statSync(core).size
  const trailer = Buffer.alloc(48)
  trailer.write('TWILIGHT-SETUP-1', 0, 'latin1')
  trailer.writeBigUInt64LE(BigInt(stub.length), 16)
  trailer.writeBigUInt64LE(BigInt(payloadSize), 24)
  trailer.writeBigUInt64LE(BigInt(stub.length + payloadSize), 32)
  trailer.writeBigUInt64LE(BigInt(meta.length), 40)
  const out = openSync(target, 'w')
  writeSync(out, stub)
  writeSync(out, readFileSync(core))
  writeSync(out, meta)
  writeSync(out, trailer)
  closeSync(out)
}

/** latest.yml describes the file the updater downloads; its sha512 must be this one's. */
function writeLatest(file) {
  const bytes = readFileSync(file)
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  const name = `Twilight-Setup-${version}.exe`
  writeFileSync(
    join(release, 'latest.yml'),
    `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`
  )
}

;(async () => {
  const bat = vcvars()
  if (!bat) {
    log('Visual Studio C++ tools not found; publishing the classic installer as Twilight-Setup.')
    copyFileSync(core, target)
  } else {
    await fetchWebView2()
    assemble(compile(bat))
    log(`built ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MB)`)
  }
  writeLatest(target)
})()
