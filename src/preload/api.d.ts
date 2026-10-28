import type { TwilightApi } from '../shared/types'

declare global {
  interface Window {
    twilight: TwilightApi
  }
}

export {}
