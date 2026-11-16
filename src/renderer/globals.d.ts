import type { Desktop } from '../shared/contracts'
import type { PitchDesktop } from '../shared/pitch'

declare global {
  interface Window {
    desktop: Desktop
    pitch: PitchDesktop
    EXCALIDRAW_ASSET_PATH?: string
  }
}

export {}
