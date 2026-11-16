import { Clock, Contrast, Keyboard, PanelRight, Sticker } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { shortcutLabel, shortcutValue, type ShortcutOverrides } from '../../shared/shortcuts'
import { MarkdownMenu } from './MarkdownMenu'

export type ZenTool = 'shortcuts' | 'time' | 'appearance'
export const zenAppearances = {
  light: { label: '浅色', background: '#fafbfc' },
  dark: { label: '深色', background: '#252629' },
  'ultra-light': { label: '极浅', background: '#ffffff' },
  'ultra-dark': { label: '极暗', background: '#151619' },
} as const
export type ZenAppearance = keyof typeof zenAppearances
const usageKey = 'ymd.map.zen-time'

function today(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function readTime(day: number) {
  try {
    const saved = JSON.parse(localStorage.getItem(usageKey) ?? '{}')
    if (saved.day === day && Number.isFinite(saved.elapsed)) return Math.max(0, saved.elapsed)
  } catch {}
  return 0
}

function useZenTime() {
  const [elapsed, setElapsed] = useState(() => readTime(today()))
  useEffect(() => {
    let started = Date.now()
    let day = today()
    let total = readTime(day)
    let visible = document.visibilityState === 'visible'
    const advance = () => {
      const now = Date.now()
      const currentDay = today(new Date(now))
      if (currentDay !== day) { day = currentDay; total = readTime(day) }
      if (visible) total += Math.max(0, now - Math.max(started, day))
      started = now
      visible = document.visibilityState === 'visible'
    }
    const save = () => {
      advance()
      try { localStorage.setItem(usageKey, JSON.stringify({ day, elapsed: total })) } catch {}
    }
    let seconds = 0
    const tick = () => {
      if (++seconds % 15 === 0) save()
      else advance()
      setElapsed(total)
    }
    const interval = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', save)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', save)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [])
  const seconds = Math.floor(elapsed / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
}

export function MindMapZenTools({ platform, overrides, tool, onTool, appearance, onAppearance, artOpen, formatOpen, onArt, onFormat, exit }: {
  platform: string
  overrides: ShortcutOverrides
  tool: ZenTool | undefined
  onTool: (tool?: ZenTool) => void
  appearance: ZenAppearance
  onAppearance: (appearance: ZenAppearance) => void
  artOpen: boolean
  formatOpen: boolean
  onArt: () => void
  onFormat: () => void
  exit: () => void
}) {
  const elapsed = useZenTime()
  const appearanceButton = useRef<HTMLButtonElement>(null)
  const keys = [
    ['添加同级主题', 'Enter'], ['添加子主题', 'Tab'], ['折叠或展开分支', '/'],
    ['撤销', 'Mod-z'], ['查找主题', shortcutValue(overrides, 'find', platform)],
    ['编辑主题链接', shortcutValue(overrides, 'map-link', platform)],
    ['仅显示分支／显示全部内容', shortcutValue(overrides, 'map-branch', platform)],
    ['导图截图', shortcutValue(overrides, 'map-shot', platform)], ['退出专注', 'Escape'],
  ]
  return <div className="map-zen-tools" role="group" aria-label="专注工具">
    <div className="map-zen-group">
      <button type="button" className="tool-button" onClick={exit}>退出专注</button>
      <button type="button" className="icon-button" aria-label="专注快捷键" title="快捷键" aria-expanded={tool === 'shortcuts'}
        onClick={() => onTool(tool === 'shortcuts' ? undefined : 'shortcuts')}><Keyboard size={16} /></button>
      <button type="button" className="icon-button" aria-label="今日专注" title="今日专注" aria-expanded={tool === 'time'}
        onClick={() => onTool(tool === 'time' ? undefined : 'time')}><Clock size={16} /></button>
      <div className="menu-anchor">
        <button type="button" ref={appearanceButton} className="icon-button" aria-label="专注外观" title="专注外观" aria-haspopup="menu"
          aria-expanded={tool === 'appearance'} onClick={() => onTool(tool === 'appearance' ? undefined : 'appearance')}><Contrast size={16} /></button>
        {tool === 'appearance' && <MarkdownMenu anchor={appearanceButton.current ?? undefined} close={() => onTool()}
          items={(Object.keys(zenAppearances) as ZenAppearance[]).map(value => ({
            label: zenAppearances[value].label, selected: value === appearance, run: () => onAppearance(value),
          }))} />}
      </div>
    </div>
    <div className="map-zen-group">
      <button type="button" className="icon-button" aria-label="贴纸与插图" title="贴纸与插图" aria-pressed={artOpen}
        onClick={onArt}><Sticker size={16} /></button>
      <button type="button" className="icon-button" aria-label="格式" title="格式" aria-pressed={formatOpen}
        onClick={onFormat}><PanelRight size={16} /></button>
    </div>
    {tool === 'time' && <div className="map-zen-card" role="region" aria-label="今日专注">
      <h2>今日专注</h2><time>{elapsed}</time>
    </div>}
    {tool === 'shortcuts' && <div className="map-zen-card" role="region" aria-label="专注快捷键">
      <h2>快捷键</h2>
      <dl>{keys.filter(([, value]) => value).map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd><kbd>{shortcutLabel(value, platform)}</kbd></dd></div>)}</dl>
    </div>}
  </div>
}
