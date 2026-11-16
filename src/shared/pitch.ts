export const pitchThemes = {
  dark: { label: '深色', background: '#08090b', text: '#fafafa', muted: '#aeb1b8', accent: '#b8cdfc' },
  light: { label: '浅色', background: '#faf9f5', text: '#20211f', muted: '#5a5e56', accent: '#345d98' },
  blue: { label: '深海', background: '#142947', text: '#f2f6ff', muted: '#becde5', accent: '#a4c6ff' },
  lavender: { label: '薰衣草', background: '#eee8fa', text: '#2d2343', muted: '#675d77', accent: '#6642a4' },
  green: { label: '苔绿', background: '#deeee4', text: '#18382a', muted: '#476252', accent: '#23654f' },
} as const

export const pitchRatios = { auto: 0, '16:9': 16 / 9, '4:3': 4 / 3, '9:16': 9 / 16, '3:4': 3 / 4 } as const
export const pitchDeliveries = { drill: '逐项后深入', step: '逐项展开', all: '一次显示' } as const
export const pitchLayouts = { brace: '括号列表', list: '列表', bullets: '项目符号', lyrics: '滚动字幕' } as const
export const pitchCoverLayouts = { auto: '自动', title: '仅标题', image: '标题与图片' } as const
export const pitchPlacements = { auto: '自动', left: '左侧', right: '右侧', top: '上方', bottom: '下方' } as const
export const pitchVisibility = { auto: '自动', show: '显示', hide: '隐藏' } as const
export const pitchExtension = 'org.ymd.pitch'

export interface PitchOptions {
  theme: keyof typeof pitchThemes
  ratio: keyof typeof pitchRatios
  animation: boolean
  watermark: boolean
}

export interface PitchTopicOptions {
  visibility: keyof typeof pitchVisibility
  delivery: keyof typeof pitchDeliveries
  layout: keyof typeof pitchLayouts
  cover: keyof typeof pitchCoverLayouts
  image: keyof typeof pitchPlacements
}

export type PitchMode = 'fullscreen' | 'window' | 'presenter'
export interface PitchTopic {
  id: string
  title: string
  note?: string
  image?: string
  options: PitchTopicOptions
  children: PitchTopic[]
}

export interface PitchRequest {
  title: string
  root: PitchTopic
  options: PitchOptions
  mode: PitchMode
  start?: string
}

export interface PitchDesktop {
  load(): Promise<PitchRequest & { platform: string; fullscreen: boolean }>
  fullscreen(enabled: boolean): Promise<void>
  onFullscreen(callback: (enabled: boolean) => void): () => void
  close(): Promise<void>
  savePowerPoint(name: string, data: ArrayBuffer): Promise<boolean>
  savePdf(name: string, html: string): Promise<boolean>
}

export const defaultPitchOptions: PitchOptions = { theme: 'dark', ratio: 'auto', animation: true, watermark: false }
export const defaultPitchTopic: PitchTopicOptions = { visibility: 'auto', delivery: 'all', layout: 'brace', cover: 'auto', image: 'auto' }

function option<T extends Record<string, unknown>>(choices: T, value: unknown, fallback: keyof T): keyof T {
  return typeof value === 'string' && Object.hasOwn(choices, value) ? value as keyof T : fallback
}

export function readPitchOptions(value?: unknown): PitchOptions {
  const input = value && typeof value === 'object' ? value as Partial<PitchOptions> : undefined
  return {
    theme: option(pitchThemes, input?.theme, defaultPitchOptions.theme),
    ratio: option(pitchRatios, input?.ratio, defaultPitchOptions.ratio),
    animation: input?.animation !== false,
    watermark: input?.watermark === true,
  }
}

export function readPitchTopic(value: unknown): PitchTopicOptions {
  const input = value && typeof value === 'object' ? value as Partial<PitchTopicOptions> : undefined
  return {
    visibility: option(pitchVisibility, input?.visibility, defaultPitchTopic.visibility),
    delivery: option(pitchDeliveries, input?.delivery, defaultPitchTopic.delivery),
    layout: option(pitchLayouts, input?.layout, defaultPitchTopic.layout),
    cover: option(pitchCoverLayouts, input?.cover, defaultPitchTopic.cover),
    image: option(pitchPlacements, input?.image, defaultPitchTopic.image),
  }
}

export const pitchImage = (value: unknown): value is string => typeof value === 'string' &&
  /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(value)
