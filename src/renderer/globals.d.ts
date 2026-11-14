import type { Desktop } from '../shared/contracts'

declare global {
  interface Window {
    desktop: Desktop
    EXCALIDRAW_ASSET_PATH?: string
  }
}

export {}
