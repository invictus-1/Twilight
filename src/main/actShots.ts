import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// TWILIGHT_ACTS=<dir>: plays every visitor's act on an empty chat and saves frames of each at a few
// moments, for looking at them (the acts are drawn and timed in SkyActs and acts.css). A throwaway
// profile, like the other test runs; nothing touches real data.

const ACTS: [string, string, number][] = [
  ['platypus-trot', 'city', 16_000],
  ['ufo', 'city', 15_000],
  ['whale', 'city', 20_000],
  ['pumpkin', 'city', 17_000],
  ['platypus-trot', 'cyberpunk', 15_000],
  ['ufo', 'cyberpunk', 13_000],
  ['whale', 'cyberpunk', 18_000],
  ['pumpkin', 'cyberpunk', 19_000],
  ['platypus-trot', 'dunes', 14_000],
  ['ufo', 'dunes', 14_000],
  ['whale', 'dunes', 12_000],
  ['pumpkin', 'dunes', 17_000],
  ['platypus-trot', 'ocean', 14_000],
  ['ufo', 'ocean', 14_000],
  ['whale', 'ocean', 12_000],
  ['pumpkin', 'ocean', 17_000],
  ['pumpkin', 'grid', 15_000],
  ['pumpkin', 'mountains', 13_000]
]
// When each act is caught: early, the middle, late (or the fractions in TWILIGHT_ACTS_AT).
const MOMENTS = process.env.TWILIGHT_ACTS_AT ? process.env.TWILIGHT_ACTS_AT.split(",").map(Number) : [0.3, 0.5, 0.72]

export function runActShots(win: BrowserWindow, outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  win.setContentSize(1600, 900)
  const only = process.env.TWILIGHT_ACTS_ONLY?.split(',')
  win.webContents.once('did-finish-load', async () => {
    const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    for (const [egg, horizon, ms] of ACTS) {
      if (only && !only.includes(`${egg}:${horizon}`)) continue
      await js(`localStorage.setItem('twilight.extras', JSON.stringify({ ...JSON.parse(localStorage.getItem('twilight.extras') || '{}'), horizon: '${horizon}', easterEggs: true, sky: 'dusk' })); localStorage.setItem('twilight.e2eEgg', '${egg}')`)
      win.webContents.reload()
      await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)))
      // The visitor comes after the quiet spell (1.2 s in test runs); then each moment in turn.
      await js(`(async () => { for (let end = Date.now() + 8000; Date.now() < end && !document.querySelector('.act'); ) await new Promise((r) => setTimeout(r, 25)) })()`)
      const began = Date.now()
      for (const at of MOMENTS) {
        await wait(Math.max(0, ms * at - (Date.now() - began)))
        try {
          writeFileSync(join(outDir, `${egg}-${horizon}-${Math.round(at * 100)}.png`), (await win.webContents.capturePage()).toPNG())
        } catch {
          // A refused capture is skipped.
        }
      }
    }
    app.quit()
  })
}
