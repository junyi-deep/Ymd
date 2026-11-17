import idea from './stickers/idea.webp?inline'
import done from './stickers/done.webp?inline'
import flag from './stickers/flag.webp?inline'
import warning from './stickers/warning.webp?inline'
import target from './stickers/target.webp?inline'
import calendar from './stickers/calendar.webp?inline'
import book from './stickers/book.webp?inline'
import team from './stickers/team.webp?inline'

export const artTransferType = 'application/x-ymd-map-sticker'

export interface MapArt { label: string; source: string }

const builtIn = new Map<string, MapArt>([
  ['builtin:idea', { label: '灵感', source: idea }],
  ['builtin:done', { label: '完成', source: done }],
  ['builtin:flag', { label: '旗帜', source: flag }],
  ['builtin:warning', { label: '提醒', source: warning }],
  ['builtin:target', { label: '目标', source: target }],
  ['builtin:calendar', { label: '日历', source: calendar }],
  ['builtin:book', { label: '书本', source: book }],
  ['builtin:team', { label: '团队', source: team }],
])

export const builtInStickers = [...builtIn.keys()]
export const stickerLabel = (name: string) => builtIn.get(name)?.label ?? name.replace(/\.[^.]+$/, '')

export async function loadMapSticker(name: string): Promise<MapArt | undefined> {
  const preset = builtIn.get(name)
  if (preset) return preset
  const source = await window.desktop.readMapSticker(name)
  if (source) return { label: stickerLabel(name), source }
}
