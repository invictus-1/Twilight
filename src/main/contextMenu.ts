import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { kvGet, kvSet } from './db'

// The right-click menu: spelling suggestions for a misspelled word (from Windows' own spellchecker,
// which works offline with the languages Windows has, so nothing is downloaded), then the usual
// cut, copy and paste.

export function spellcheckOn(): boolean {
  return kvGet<boolean>('spellcheck') ?? true
}

export function setSpellcheck(win: BrowserWindow | null, on: boolean): boolean {
  kvSet('spellcheck', on)
  win?.webContents.session.setSpellCheckerEnabled(on)
  return on
}

/** The menu for a right-click, as menu items (built separately so the e2e can look at it). */
export function contextMenuItems(contents: WebContents, p: ContextMenuParams): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (p.misspelledWord) {
    for (const word of p.dictionarySuggestions.slice(0, 5)) items.push({ label: word, click: () => contents.replaceMisspelling(word) })
    if (!p.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false })
    items.push({ label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
    items.push({ type: 'separator' })
  }
  const f = p.editFlags
  if (p.isEditable) {
    items.push(
      { label: 'Cut', role: 'cut', enabled: f.canCut },
      { label: 'Copy', role: 'copy', enabled: f.canCopy },
      { label: 'Paste', role: 'paste', enabled: f.canPaste },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll }
    )
  } else if (p.selectionText.trim()) items.push({ label: 'Copy', role: 'copy', enabled: f.canCopy })
  return items
}

/** Test runs look at the menu instead of opening it (a native menu would wait for a click). */
let popUp = true
export const showContextMenus = (on: boolean): void => void (popUp = on)

export function attachContextMenu(win: BrowserWindow): void {
  win.webContents.session.setSpellCheckerEnabled(spellcheckOn())
  win.webContents.on('context-menu', (_e, p) => {
    const items = contextMenuItems(win.webContents, p)
    if (items.length && popUp) Menu.buildFromTemplate(items).popup({ window: win })
  })
}
