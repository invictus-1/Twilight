import { extractChoices } from '@shared/choices'
import { gameFormat } from '@shared/gameFormat'
import { readGameFormat } from './gameFormatSettings'
import { useStore } from './store'

/**
 * The whole chat's story for a game: every reply on the shown thread, choice cards left out,
 * each reflowed by Game Format and set one after another.
 */
export function chatInGameFormat(): string {
  const current = useStore.getState().current
  if (!current) return ''
  const { choicePlain, choiceFenced, choiceCards } = current.settings
  const options = readGameFormat()
  return current.path
    .filter((n) => n.role === 'assistant' && n.text.trim())
    .map((n) => gameFormat(extractChoices(n.text, choiceCards && choicePlain, choiceFenced).body.trim(), options))
    .join('\n')
}

/** The editor's selection, or the whole document when nothing is selected (set by Editor). */
export const editorText: { get: (() => string) | null } = { get: null }
