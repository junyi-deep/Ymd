export const artTransferType = 'application/x-ymd-map-sticker'

export interface MapArt { label: string; source: string }

export async function loadMapSticker(name: string): Promise<MapArt | undefined> {
  const source = await window.desktop.readMapSticker(name)
  if (source) return { label: name.replace(/\.[^.]+$/, ''), source }
}
