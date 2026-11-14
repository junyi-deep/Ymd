import { GitBranch, LayoutGrid, Palette as PaletteIcon, SlidersHorizontal, X } from 'lucide-react'
import type MindMap from 'simple-mind-map'
import { mapLayouts, palettes, type MapSettings, type Palette } from './mapAppearance'

type MapNode = NonNullable<MindMap['renderer']['root']>
const topics = [
  ['rectangle', '矩形'], ['roundedRectangle', '圆角矩形'], ['diamond', '菱形'],
  ['ellipse', '椭圆'], ['circle', '圆形'], ['parallelogram', '平行四边形'],
  ['octagonalRectangle', '八边形'], ['outerTriangularRectangle', '外三角矩形'], ['innerTriangularRectangle', '内三角矩形'],
]
const colorValue = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

export function MindMapFormat({ tab, settings, node, version, change, onTab, close, style }: {
  tab: 'map' | 'topic'
  settings: MapSettings
  node?: MapNode
  version: number
  change: (patch: Partial<MapSettings>) => void
  onTab: (tab: 'map' | 'topic') => void
  close: () => void
  style: (key: string, value: unknown) => void
}) {
  const data = node?.getData() ?? {}
  return <aside className="map-format" aria-label="思维导图格式" data-version={version}>
    <header><strong>格式</strong><button className="icon-button" aria-label="收起格式面板" onClick={close}><X size={16} /></button></header>
    <div className="segments map-format-tabs">
      <button type="button" aria-pressed={tab === 'map'} onClick={() => onTab('map')}><LayoutGrid size={14} />导图</button>
      <button type="button" aria-pressed={tab === 'topic'} onClick={() => onTab('topic')}><SlidersHorizontal size={14} />主题</button>
    </div>
    {tab === 'map' ? <>
      <section><h3><LayoutGrid size={15} />结构</h3>
        <div className="map-layouts">{mapLayouts.map(([value, label]) => <button key={value} type="button"
          aria-pressed={settings.layout === value} title={label} onClick={() => change({ layout: value })}>
          <GitBranch size={16} /><span>{label}</span></button>)}</div>
      </section>
      <section><h3><PaletteIcon size={15} />配色</h3>
        <div className="map-palettes">{Object.entries(palettes).map(([value, palette]) => <button key={value} title={palette.label}
          aria-label={palette.label} aria-pressed={settings.palette === value} onClick={() => change({ palette: value as Palette })}>
          {palette.colors.map(color => <i key={color} style={{ backgroundColor: color }} />)}
        </button>)}</div>
        <label>彩色分支<input type="checkbox" checked={settings.colored} onChange={event => change({ colored: event.target.checked })} /></label>
        <label>画布背景<input type="color" value={colorValue(settings.background, '#fafbfc')} onChange={event => change({ background: event.target.value })} /></label>
        {settings.background && <button className="tool-button" onClick={() => change({ background: undefined })}>恢复跟随外观</button>}
      </section>
      <section><h3><SlidersHorizontal size={15} />样式</h3>
        <label>全局字体<select value={settings.font} onChange={event => change({ font: event.target.value })}><option value="system-ui">系统字体</option><option value="serif">衬线</option><option value="monospace">等宽</option></select></label>
        <label>分支线宽<input type="range" min="1" max="8" value={settings.lineWidth} onChange={event => change({ lineWidth: Number(event.target.value) })} /></label>
      </section>
    </> : node ? <>
      <section><h3><LayoutGrid size={15} />形状</h3>
        <label>主题形状<select value={typeof data.shape === 'string' ? data.shape : 'rectangle'} onChange={event => style('shape', event.target.value)}>
          {topics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>填充<input type="color" value={colorValue(data.fillColor, '#eef2f8')} onChange={event => style('fillColor', event.target.value)} /></label>
        <label>边框颜色<input type="color" value={colorValue(data.borderColor, '#758190')} onChange={event => style('borderColor', event.target.value)} /></label>
        <label>边框宽度<input type="range" min="0" max="8" value={Number(data.borderWidth ?? 0)} onChange={event => style('borderWidth', Number(event.target.value))} /></label>
      </section>
      <section><h3><SlidersHorizontal size={15} />文字</h3>
        <label>字号<input type="number" min="10" max="72" value={Number(data.fontSize ?? (node.isRoot ? 26 : 16))}
          onChange={event => { const size = event.target.valueAsNumber; if (size >= 10 && size <= 72) style('fontSize', size) }} /></label>
        <label>文字颜色<input type="color" value={colorValue(data.color, node.isRoot ? '#ffffff' : '#242830')} onChange={event => style('color', event.target.value)} /></label>
        <label>加粗<input type="checkbox" checked={data.fontWeight === 'bold'} onChange={event => style('fontWeight', event.target.checked ? 'bold' : 'normal')} /></label>
        <label>斜体<input type="checkbox" checked={data.fontStyle === 'italic'} onChange={event => style('fontStyle', event.target.checked ? 'italic' : 'normal')} /></label>
        <label>对齐<select value={String(data.textAlign ?? 'left')} onChange={event => style('textAlign', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
      </section>
      <section><h3><GitBranch size={15} />分支</h3>
        <label>线条颜色<input type="color" value={colorValue(data.lineColor, '#8c9ab1')} onChange={event => style('lineColor', event.target.value)} /></label>
        <label>线条宽度<input type="range" min="1" max="8" value={Number(data.lineWidth ?? settings.lineWidth)} onChange={event => style('lineWidth', Number(event.target.value))} /></label>
        <button className="tool-button" onClick={() => style('reset', null)}>恢复主题样式</button>
      </section>
    </> : <p className="map-format-empty">选择一个主题来调整样式。</p>}
  </aside>
}
