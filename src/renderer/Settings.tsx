import { useState, type ReactNode } from 'react'
import { ArrowLeft, HardDrive, Info, Keyboard, Palette, SlidersHorizontal } from 'lucide-react'
import { searchEngines, type Entry, type Preferences, type SearchEngine, type VersionStatus } from '../shared/contracts'
import { ShortcutSettings } from './ShortcutSettings'
import { appShortcuts, shortcutLabel, shortcutValue } from '../shared/shortcuts'

const pages = [
  { label: '通用', icon: SlidersHorizontal },
  { label: '外观', icon: Palette },
  { label: '快捷键', icon: Keyboard },
  { label: '文档库', icon: HardDrive },
  { label: '关于', icon: Info },
] as const

function Row({ label, detail, children }: { label: string; detail?: string; children?: ReactNode }) {
  return <div className="settings-row"><div>{label}{detail && <p>{detail}</p>}</div>{children}</div>
}

function Choices<T extends string>({ value, choices, onChange }: {
  value: T
  choices: readonly (readonly [T, string])[]
  onChange: (value: T) => void
}) {
  return <div className="segments">{choices.map(([key, label]) =>
    <button key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>
}

export function Settings({ preferences, platform, library, windowsAcrylic, macReducesTransparency, initialPage, version, release, checking, onCheckUpdates, onOpenRelease, onOpenDirectory, onChange, onReturn, onLibraryChange }: {
  preferences: Preferences
  platform: string
  library: Entry
  initialPage: (typeof pages)[number]['label']
  windowsAcrylic: boolean
  macReducesTransparency: boolean
  version: string
  release?: VersionStatus
  checking: boolean
  onCheckUpdates: () => void
  onOpenRelease: (url: string) => void
  onOpenDirectory: () => void
  onLibraryChange: (reset?: boolean) => void
  onChange: (preferences: Partial<Preferences>) => void
  onReturn: () => void
}) {
  const [page, setPage] = useState(initialPage)
  const material = (platform === 'darwin' && !macReducesTransparency) || windowsAcrylic
  const transparent = material && !preferences.solidBackground
  const quickNew = (['new-file', 'new-drawing'] as const).flatMap(id => {
    const key = shortcutValue(preferences.shortcuts, id, platform)
    return key ? [appShortcuts[id].label + ' ' + shortcutLabel(key, platform)] : []
  }).join(' · ')
  return <>
    <aside className="sidebar settings-nav"><div className="sidebar-scroll">
      <h2>设置</h2>
      {pages.map(({ label, icon: Icon }) => <button className="tree-row" key={label} data-selected={page === label}
        onClick={() => setPage(label)}><Icon size={18} /><span>{label}</span></button>)}
    </div><button className="tree-row sidebar-footer" onClick={onReturn}><ArrowLeft size={18} /><span>返回</span></button></aside>
    <div className="settings-main">
      <div className="settings-content">
        {page === '快捷键' ? <ShortcutSettings platform={platform} overrides={preferences.shortcuts}
          onChange={shortcuts => onChange({ shortcuts })} /> : <>
        <h1>{page}</h1>
        <div className="settings-group">
          {page === '外观' && <>
            <Row label="外观"><Choices value={preferences.theme} choices={ [['system','跟随系统'], ['light','浅色'], ['dark','深色']] }
              onChange={theme => onChange({ theme })} /></Row>
            <Row label="透明窗口背景" detail={macReducesTransparency
              ? 'macOS 已开启「降低透明度」。可在系统设置的「辅助功能 → 显示」中关闭。'
              : material
              ? (platform === 'darwin' ? '侧栏和左侧标题栏使用 macOS 毛玻璃。' : '侧栏和左侧标题栏使用 Windows Acrylic。')
              : '当前系统使用实色背景。Windows Acrylic 需要 Windows 11 22H2 或更新版本。'}>
              <button className="switch" role="switch" aria-label="透明窗口背景" aria-checked={transparent}
                disabled={!material} onClick={() => onChange({ solidBackground: transparent })} />
            </Row>
            {platform === 'darwin' && transparent && <Row label="毛玻璃透明度" detail="100% 时仅保留系统毛玻璃。">
              <div className="transparency-control">
                <input type="range" aria-label="毛玻璃透明度" aria-valuetext={preferences.windowTransparency + '%'}
                  min={0} max={100} step={5} value={preferences.windowTransparency}
                  onChange={event => onChange({ windowTransparency: event.currentTarget.valueAsNumber })} />
                <span aria-hidden="true">{preferences.windowTransparency}%</span>
              </div>
            </Row>}
            <Row label="动画" detail="控制侧栏、菜单和设置控件的过渡效果。">
              <Choices value={preferences.animations ? 'full' : 'reduced'} choices={ [['reduced','克制'], ['full','丰富']] }
                onChange={choice => onChange({ animations: choice === 'full' })} />
            </Row>
            <Row label="界面字号"><Choices value={preferences.size} choices={ [['small','小'], ['normal','标准'], ['large','大']] }
              onChange={size => onChange({ size })} /></Row>
            <Row label="文档主题"><Choices value={preferences.documentTheme} choices={ [['classic','标准'], ['paper','纸张'], ['mono','等宽']] }
              onChange={documentTheme => onChange({ documentTheme })} /></Row>
            <Row label="文档目录位置"><Choices value={preferences.markdownOutline.position} choices={ [['left','左侧'], ['right','右侧']] }
              onChange={position => onChange({ markdownOutline: { ...preferences.markdownOutline, position } })} /></Row>
            <div className="theme-preview"><article className="theme-preview-paper"><h2>写作预览</h2><p>一段包含<strong>重点</strong>和 <code>Markdown</code> 的正文。</p><blockquote>文档保存在本机。</blockquote></article></div>
          </>}
          {page === '通用' && <>
            <Row label="自动保存" detail="停止编辑后自动保存在本机。磁盘版本冲突时保留草稿。">
              <button className="switch" role="switch" aria-label="自动保存" aria-checked={preferences.autoSave}
                onClick={() => onChange({ autoSave: !preferences.autoSave })} />
            </Row>
            <Row label="自动下载网络图片" detail="关闭后按需加载 Markdown 中的网络图片。">
              <button className="switch" role="switch" aria-label="自动下载网络图片" aria-checked={preferences.remoteImages}
                onClick={() => onChange({ remoteImages: !preferences.remoteImages })} />
            </Row>
            <Row label="自动检查更新" detail="启动时读取 GitHub 版本信息。发现新版本后，可打开发布页下载。">
              <button className="switch" role="switch" aria-label="自动检查更新" aria-checked={preferences.autoCheckUpdates}
                onClick={() => onChange({ autoCheckUpdates: !preferences.autoCheckUpdates })} />
            </Row>
            <Row label="网页搜索" detail="在 Markdown 中选中文字，右键可在浏览器中搜索。">
              <select aria-label="网页搜索" value={preferences.searchEngine}
                onChange={event => onChange({ searchEngine: event.target.value as SearchEngine })}>
                {Object.entries(searchEngines).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}
              </select>
            </Row>
            <Row label="快捷新建" detail={quickNew || undefined}><button className="tool-button" onClick={() => setPage('快捷键')}>设置快捷键</button></Row>
          </>}
          {page === '文档库' && <>
            <Row label="我的文档" detail={library.path}>
              <div className="setting-actions">
                <button className="tool-button" onClick={onOpenDirectory}>显示文件夹</button>
                {preferences.libraryDirectory && <button className="tool-button" onClick={() => onLibraryChange(true)}>恢复默认</button>}
                <button className="tool-button" onClick={() => onLibraryChange()}>更改位置…</button>
              </div>
            </Row>
            <Row label="本机文件显示条数" detail="文件和文件夹合计，最多显示 100 条。">
              <input className="setting-count" type="number" min={1} max={100} aria-label="本机文件显示条数"
                key={preferences.recentLimit} defaultValue={preferences.recentLimit}
                onBlur={event => {
                  const input = event.currentTarget
                  const value = input.valueAsNumber
                  if (!Number.isFinite(value)) { input.value = String(preferences.recentLimit); return }
                  const recentLimit = Math.min(100, Math.max(1, Math.round(value)))
                  input.value = String(recentLimit)
                  if (recentLimit !== preferences.recentLimit) onChange({ recentLimit })
                }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
            </Row>
          </>}
          {page === '关于' && <>
            <Row label="Ymd" detail={version ? '当前版本 ' + version : '本地 Markdown 与 Excalidraw 编辑器。'} />
            <Row label="软件更新" detail={release?.update ? '可下载 ' + release.update.version : release ? '已是当前发布渠道的最新版本。' : undefined}>
              <div className="setting-actions">
                <button className="tool-button" disabled={checking} onClick={onCheckUpdates}>{checking ? '正在检查…' : '检查更新'}</button>
                {release?.update && <button className="tool-button" onClick={() => onOpenRelease(release.update!.url)}>打开发布页</button>}
              </div>
            </Row>
            <Row label="源代码"><div className="setting-actions">
              <button className="tool-button" onClick={() => onOpenRelease('https://github.com/junyi-deep/Ymd')}>在 GitHub 查看</button>
            </div></Row>
          </>}
        </div></>}
      </div>
    </div>
  </>
}
