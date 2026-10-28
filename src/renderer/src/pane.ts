import { createContext, useContext } from 'react'
import type { Pane } from '@shared/types'

/** Which split-compare pane a component renders in ('a' outside split compare). */
export const PaneContext = createContext<Pane>('a')
export const usePane = (): Pane => useContext(PaneContext)
