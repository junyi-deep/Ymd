import type { MapData } from './mapAppearance'

export const calloutShapes = [
  ['roundedRectangle', '圆角气泡'], ['ellipse', '椭圆气泡'], ['rectangle', '矩形气泡'],
] as const
export const calloutFonts = [
  ['system-ui', '系统字体'], ['sans-serif', '无衬线'], ['serif', '衬线'], ['monospace', '等宽'],
] as const
export const calloutDefaults = {
  shape: 'roundedRectangle', fillColor: '#fff0bd', color: '#392c16', fontFamily: 'system-ui',
  fontSize: 15, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', calloutWidth: 172,
}

export type Callout = MapData & { data: MapData['data'] & { uid: string; text: string } }
export interface CalloutTarget { owner: string; id: string }
export const calloutTopicId = (owner: string, id: string) => 'callout:' + encodeURIComponent(owner) + ':' + id

export function readCallouts(data: unknown): Callout[] {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is Callout =>
    !!item?.data && typeof item.data.uid === 'string' && typeof item.data.text === 'string')
}

export function calloutById(tree: MapData, id: string): CalloutTarget | undefined {
  const owner = tree.data.uid
  if (owner) {
    const note = readCallouts(tree.data.ymdCallouts).find(item => calloutTopicId(owner, item.data.uid) === id)
    if (note) return { owner, id: note.data.uid }
  }
  for (const child of tree.children ?? []) {
    const target = calloutById(child, id)
    if (target) return target
  }
}

export function calloutColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d ,.\/%]+\)|[a-z]{1,25})$/i.test(value) &&
    CSS.supports('color', value) ? value : fallback
}

export function calloutNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(value, maximum)) : fallback
}

export function calloutStyle(data: MapData['data']) {
  return {
    width: calloutNumber(data.calloutWidth, calloutDefaults.calloutWidth, 72, 640),
    shape: calloutShapes.find(([value]) => value === data.shape)?.[0] ?? calloutDefaults.shape,
    fill: calloutColor(data.fillColor, calloutDefaults.fillColor),
    color: calloutColor(data.color, calloutDefaults.color),
    font: typeof data.fontFamily === 'string' && /^[\p{L}\p{N}, _"'-]{1,120}$/u.test(data.fontFamily) ? data.fontFamily : calloutDefaults.fontFamily,
    size: calloutNumber(data.fontSize, calloutDefaults.fontSize, 9, 60),
    weight: data.fontWeight === 'bold' || Number(data.fontWeight) >= 600 ? 'bold' : 'normal',
    italic: data.fontStyle === 'italic',
    align: data.textAlign === 'center' || data.textAlign === 'right' ? data.textAlign : 'left',
  }
}
