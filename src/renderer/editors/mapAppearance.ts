import type MindMap from 'simple-mind-map'

export type MapData = ConstructorParameters<typeof MindMap>[0]['data']
type StyleData = Record<string, unknown>

export const mapLayouts = [
  ['mindMap', '思维导图'], ['logicalStructure', '逻辑图 · 向右'], ['logicalStructureLeft', '逻辑图 · 向左'],
  ['organizationStructure', '组织结构图'], ['catalogOrganization', '树形目录'], ['timeline', '时间轴'],
  ['verticalTimeline', '垂直时间轴'], ['fishbone', '鱼骨图'],
] as const
export type Structure = (typeof mapLayouts)[number][0]

export function branchStructure(value: unknown): Structure | undefined {
  return mapLayouts.find(([key]) => key === value)?.[0]
}

export const palettes = {
  ocean: { label: '海湾', root: '#23496f', colors: ['#5886d2', '#4e9d88', '#e39e52', '#8b76ce', '#d66b8d'] },
  coral: { label: '珊瑚', root: '#8d353b', colors: ['#e17771', '#e9a75a', '#6ca798', '#7a8dc5', '#b67cd0'] },
  night: { label: '夜色', root: '#484379', colors: ['#988be3', '#5d9cdd', '#68ad9e', '#d0ab5d', '#c279aa'] },
  graphite: { label: '石墨', root: '#393d45', colors: ['#758190', '#a69488', '#828f89', '#8f829b', '#a88d94'] },
}
export type Palette = keyof typeof palettes

export interface MapSettings {
  layout: string
  palette: Palette
  background?: string
  font: string
  lineWidth: number
  lineStyle?: 'curve' | 'straight' | 'direct'
  compact?: boolean
  colored: boolean
}

interface StoredStyle { address: string; text: string; data: StyleData }
export interface MapSheet {
  id: string
  title: string
  settings: MapSettings
  tree: MapData
}

export interface MapAppearance { settings: MapSettings; styles: StoredStyle[]; sheets?: MapSheet[]; floating?: MapData[] }

export const defaultMapSettings: MapSettings = { layout: 'mindMap', palette: 'ocean', font: 'system-ui', lineWidth: 2, colored: true }

export function loadMapAppearance(path: string): MapAppearance {
  try {
    const value = JSON.parse(localStorage.getItem('ymd.map:' + path) ?? 'null')
    if (value?.settings && Array.isArray(value.styles)) return value
  } catch {}
  return { settings: defaultMapSettings, styles: [] }
}

export function saveMapAppearance(path: string, settings: MapSettings, tree: MapData) {
  const styles: StoredStyle[] = []
  const floating: MapData[] = []
  function collect(node: MapData, address: string) {
    if (node.data.ymdFloating === true) {
      floating.push(node)
      return
    }
    const { text = '', uid: _uid, isActive: _active, richText: _rich, ...data } = node.data
    if (Object.keys(data).length) styles.push({ address, text, data: { ...data, uid: node.data.uid } })
    let childIndex = 0
    node.children?.forEach(child => {
      const floatingChild = child.data.ymdFloating === true
      collect(child, address + '.' + (floatingChild ? 'floating' : childIndex++))
    })
  }
  collect(tree, 'root')
  const { sheets } = loadMapAppearance(path)
  localStorage.setItem('ymd.map:' + path, JSON.stringify({ settings, styles, sheets, floating }))
}

export function restoreFloating(tree: MapData, floating: MapData[]) {
  if (!floating.length) return
  tree.children = [...(tree.children ?? []), ...structuredClone(floating)]
}

export function saveMapSheets(path: string, sheets: MapSheet[]) {
  const appearance = loadMapAppearance(path)
  localStorage.setItem('ymd.map:' + path, JSON.stringify({ ...appearance, sheets }))
}

export function restoreMapStyles(tree: MapData, styles: StoredStyle[]) {
  const exact = new Map(styles.map(item => [item.address, item]))
  const byText = new Map<string, StoredStyle | null>()
  for (const style of styles) byText.set(style.text, byText.has(style.text) ? null : style)
  const used = new Set<StoredStyle>()
  function apply(node: MapData, address: string) {
    const label = node.data.text ?? ''
    const at = exact.get(address)
    const style = at?.text === label ? at : byText.get(label)
    if (style && !used.has(style)) {
      used.add(style)
      node.data = { ...node.data, ...style.data }
    }
    node.children?.forEach((child, index) => apply(child, address + '.' + index))
  }
  apply(tree, 'root')
}

export function relocateMapAppearance(oldPath: string, newPath: string, title: string) {
  try {
    const key = 'ymd.map:' + oldPath
    const raw = localStorage.getItem(key)
    if (!raw) return
    const value = JSON.parse(raw) as MapAppearance
    const root = value.styles.find(style => style.address === 'root')
    if (root) root.text = title.replace(/\.md$/i, '')
    localStorage.setItem('ymd.map:' + newPath, JSON.stringify(value))
    localStorage.removeItem(key)
  } catch {}
}

export function mapTheme(settings: MapSettings, dark: boolean) {
  const palette = palettes[settings.palette]
  const background = settings.background ?? (dark ? '#252629' : '#fafbfc')
  const foreground = dark ? '#f0f2f4' : '#242830'
  return {
    backgroundColor: background,
    lineColor: dark ? '#8994a4' : '#8c9ab1',
    lineWidth: settings.lineWidth,
    lineStyle: settings.lineStyle ?? 'curve',
    root: { fillColor: palette.root, color: '#ffffff', fontFamily: settings.font, fontSize: 26, fontWeight: 'bold', borderWidth: 0, borderRadius: 11, paddingX: 24, paddingY: 14 },
    second: { fillColor: dark ? '#373b45' : '#eef2f8', color: foreground, fontFamily: settings.font, fontSize: 17, fontWeight: 'bold',
      borderRadius: 8, borderWidth: 0, paddingX: 13, paddingY: 8, marginX: settings.compact ? 48 : 100, marginY: settings.compact ? 19 : 40 },
    node: { fillColor: 'transparent', color: foreground, fontFamily: settings.font, fontSize: 15, borderWidth: 0, paddingX: 7, paddingY: 5,
      marginX: settings.compact ? 26 : 50, marginY: settings.compact ? 0 : 4 },
  }
}
