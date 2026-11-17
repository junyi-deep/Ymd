import { createContext, useContext, useState, type ReactNode } from 'react'
import { ArrowLeft, HardDrive, Info, Keyboard, Palette, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { interfaceFontSizes, markdownPageWidths, recentFilesLimit, searchEngines, type StorageDirectory, type Entry, type Preferences, type SearchEngine, type UpdateProxy, type UpdateProxyInput, type VersionStatus } from '../shared/contracts'
import { UpdateProxySettings } from './UpdateProxySettings'
import { FontPicker } from './FontPicker'
import { ShortcutSettings } from './ShortcutSettings'
import { appShortcuts, shortcutLabel, shortcutValue } from '../shared/shortcuts'

const pages = [
  { label: '通用', icon: SlidersHorizontal },
  { label: '外观', icon: Palette },
  { label: '快捷键', icon: Keyboard },
  { label: '存储', icon: HardDrive },
  { label: '应用更新', icon: RefreshCw },
  { label: '关于', icon: Info },
] as const

export type SettingsPage = (typeof pages)[number]['label']
const SettingSearch = createContext({ query: '', page: '' })
const matches = (query: string, text: string) => query.split(/\s+/).every(word => text.toLocaleLowerCase().includes(word))

function Row({ label, detail, children }: { label: string; detail?: string; children?: ReactNode }) {
  const { query, page } = useContext(SettingSearch)
  if (query && !matches(query, [page, label, detail].filter(Boolean).join(' '))) return null
  return <div className="settings-row"><div><span>{label}</span>{detail && <p>{detail}</p>}</div>{children}</div>
}

function Choices<T extends string>({ value, choices, onChange }: {
  value: T
  choices: readonly (readonly [T, string])[]
  onChange: (value: T) => void
}) {
  return <div className="segments">{choices.map(([key, label]) =>
    <button key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>
}

export function Settings({ preferences, platform, library, windowsAcrylic, macReducesTransparency, initialPage, version, release, checking, updateProxy, onSaveUpdateProxy, onCheckUpdates, onDownloadUpdate, onInstallUpdate, onOpenRelease, onOpenDirectory, onChange, onReturn, onLibraryChange, defaultStickerDirectory, onStorageChange, onOpenStorage }: {
  preferences: Preferences
  platform: string
  library: Entry
  initialPage: SettingsPage
  windowsAcrylic: boolean
  macReducesTransparency: boolean
  version: string
  release?: VersionStatus
  checking: boolean
  updateProxy: UpdateProxy
  onSaveUpdateProxy: (input: UpdateProxyInput) => Promise<UpdateProxy>
  onCheckUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onOpenRelease: (url: string) => void
  onOpenDirectory: () => void
  onLibraryChange: (reset?: boolean) => void
  defaultStickerDirectory: string
  onStorageChange: (kind: StorageDirectory, reset?: boolean) => void
  onOpenStorage: (kind: StorageDirectory) => void
  onChange: (preferences: Partial<Preferences>) => void
  onReturn: () => void
}) {
  const [activePage, setActivePage] = useState(initialPage)
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const setPage = (page: SettingsPage) => { setActivePage(page); setSearch('') }
  const material = (platform === 'darwin' && !macReducesTransparency) || windowsAcrylic
  const updateProgress = release?.progress
  const downloading = updateProgress?.state === 'downloading'
  const installing = updateProgress?.state === 'installing'
  const transparent = material && preferences.windowTransparent
  const quickNew = (['new-file', 'new-drawing'] as const).flatMap(id => {
    const key = shortcutValue(preferences.shortcuts, id, platform)
    return key ? [appShortcuts[id].label + ' ' + shortcutLabel(key, platform)] : []
  }).join(' · ')
  return <>
    <aside className="sidebar settings-nav"><div className="sidebar-scroll">
      <h2>设置</h2>
      <div className="settings-search"><Search size={15} /><input type="search" aria-label="搜索设置" placeholder="搜索设置"
        value={search} onChange={event => setSearch(event.currentTarget.value)} />
        {search && <button type="button" className="icon-button" aria-label="清空设置搜索" onClick={() => setSearch('')}><X size={14} /></button>}
      </div>
      {pages.map(({ label, icon: Icon }) => <button className="tree-row" key={label} data-selected={!query && activePage === label}
        onClick={() => setPage(label)}><Icon size={18} /><span>{label}</span></button>)}
    </div><button className="tree-row sidebar-footer" onClick={onReturn}><ArrowLeft size={18} /><span>返回</span></button></aside>
    <div className="settings-main">
      <div className="settings-content" data-searching={!!query}>
        {query && <h1>搜索设置</h1>}
        {(query ? pages.map(item => item.label) : [activePage]).map(page => <SettingSearch.Provider key={page} value={{ query, page }}>
          <section className="settings-page">
        {page === '快捷键' ? (query ? <div className="settings-group"><Row label="快捷键设置" detail="搜索或录制应用、Markdown 与思维导图的快捷键。">
          <button className="tool-button" onClick={() => setPage('快捷键')}>打开快捷键</button>
        </Row></div> : <ShortcutSettings platform={platform} overrides={preferences.shortcuts}
          onChange={shortcuts => onChange({ shortcuts })} />) : <>
        <h1>{page}</h1>
        {page === '外观' ? <>
          <h2 className="settings-group-title">公共</h2>
          <div className="settings-group">
            <Row label="外观"><Choices value={preferences.theme} choices={ [['system','跟随系统'], ['light','浅色'], ['dark','深色']] }
              onChange={theme => onChange({ theme })} /></Row>
            <Row label="透明窗口背景" detail={macReducesTransparency ? '系统已开启降低透明度。'
              : material ? '调节侧栏与左侧标题栏的背景透明度。' : '当前系统版本使用实色背景。'}>
              <button className="switch" role="switch" aria-label="透明窗口背景" aria-checked={transparent}
                disabled={!material} onClick={() => onChange({ windowTransparent: !preferences.windowTransparent })} />
            </Row>
            <Row label="高斯模糊" detail="模糊侧栏后方的内容，可独立使用，也可与透明背景组合使用。">
              <button className="switch" role="switch" aria-label="高斯模糊" aria-checked={material && preferences.windowBlur}
                disabled={!material} onClick={() => onChange({ windowBlur: !preferences.windowBlur })} />
            </Row>
            {transparent && <Row label="背景透明度" detail="100% 移除侧栏底色。开启高斯模糊时继续显示模糊背景。">
              <div className="transparency-control">
                <input type="range" aria-label="背景透明度" aria-valuetext={preferences.windowTransparency + '%'}
                  min={0} max={100} step={1} value={preferences.windowTransparency}
                  onChange={event => onChange({ windowTransparency: event.currentTarget.valueAsNumber })} />
                <span aria-hidden="true">{preferences.windowTransparency}%</span>
              </div>
            </Row>}
            <Row label="动画" detail="控制侧栏、菜单和设置控件的过渡效果。">
              <Choices value={preferences.animations ? 'full' : 'reduced'} choices={ [['reduced','克制'], ['full','丰富']] }
                onChange={choice => onChange({ animations: choice === 'full' })} />
            </Row>
            <Row label="界面字号" detail="选择自定义可调整字号和界面字体。"><Choices value={preferences.size}
              choices={ [['small','小'], ['normal','标准'], ['large','大'], ['custom','自定义']] } onChange={size => onChange({ size })} /></Row>
            {preferences.size === 'custom' && <Row label="自定义字号与字体" detail="选择系统已安装的界面字体。">
              <div className="interface-type">
                <input className="setting-count" type="number" aria-label="自定义界面字号" min={interfaceFontSizes.min} max={interfaceFontSizes.max}
                  key={preferences.interfaceFontSize} defaultValue={preferences.interfaceFontSize} onBlur={event => {
                    const value = event.currentTarget.valueAsNumber
                    const size = Number.isFinite(value) ? Math.max(interfaceFontSizes.min, Math.min(interfaceFontSizes.max, Math.round(value))) : preferences.interfaceFontSize
                    event.currentTarget.value = String(size)
                    if (size !== preferences.interfaceFontSize) onChange({ interfaceFontSize: size })
                  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                <FontPicker label="界面字体" value={preferences.interfaceFont} inline change={interfaceFont => onChange({ interfaceFont })} />
              </div>
            </Row>}
          </div>
          <h2 className="settings-group-title">文档</h2>
          <div className="settings-group">
            <Row label="将文件名显示为标题" detail="在 Markdown 和大纲正文顶部显示文件名，双击可重命名。">
              <button className="switch" type="button" role="switch" aria-label="将文件名显示为标题" aria-checked={preferences.showFilenameTitle}
                onClick={() => onChange({ showFilenameTitle: !preferences.showFilenameTitle })} />
            </Row>
          </div>
          <h2 className="settings-group-title">Markdown</h2>
          <div className="settings-group">
            <Row label="文档主题"><Choices value={preferences.documentTheme} choices={ [['classic','标准'], ['paper','纸张'], ['mono','等宽']] }
              onChange={documentTheme => onChange({ documentTheme })} /></Row>
            <Row label="文档目录位置"><Choices value={preferences.markdownOutline.position} choices={ [['left','左侧'], ['right','右侧']] }
              onChange={position => onChange({ markdownOutline: { ...preferences.markdownOutline, position } })} /></Row>
            <Row label="代码块显示行号">
              <button className="switch" role="switch" aria-label="代码块显示行号" aria-checked={preferences.codeBlocks.lineNumbers}
                onClick={() => onChange({ codeBlocks: { ...preferences.codeBlocks, lineNumbers: !preferences.codeBlocks.lineNumbers } })} />
            </Row>
            <Row label="代码块自动换行">
              <button className="switch" role="switch" aria-label="代码块自动换行" aria-checked={preferences.codeBlocks.wrap}
                onClick={() => onChange({ codeBlocks: { ...preferences.codeBlocks, wrap: !preferences.codeBlocks.wrap } })} />
            </Row>
            <div className="theme-preview"><article className="theme-preview-paper"><h2>写作预览</h2><p>一段包含<strong>重点</strong>和 <code>Markdown</code> 的正文。</p><blockquote>文档保存在本机。</blockquote></article></div>
          </div>
          <h2 className="settings-group-title">大纲</h2>
          <div className="settings-group">
            <Row label="大纲页宽"><Choices value={preferences.outlinePageWidth} choices={markdownPageWidths}
              onChange={outlinePageWidth => onChange({ outlinePageWidth })} /></Row>
            <Row label="展开文档正文">
              <button className="switch" type="button" role="switch" aria-label="默认展开大纲正文" aria-checked={preferences.outlineRemainderVisible}
                onClick={() => onChange({ outlineRemainderVisible: !preferences.outlineRemainderVisible })} />
            </Row>
          </div>
          <h2 className="settings-group-title">思维导图</h2>
          <div className="settings-group">
            <Row label="小地图位置"><Choices value={preferences.mapOverview.position} choices={ [['left','左下角'], ['right','右下角']] }
              onChange={position => onChange({ mapOverview: { ...preferences.mapOverview, position } })} /></Row>
            <Row label="默认打开小地图">
              <button className="switch" type="button" role="switch" aria-label="默认打开小地图" aria-checked={preferences.mapOverview.visible}
                onClick={() => onChange({ mapOverview: { ...preferences.mapOverview, visible: !preferences.mapOverview.visible } })} />
            </Row>
          </div>
        </> : <div className="settings-group">
          {page === '通用' && <>
            <Row label="自动保存" detail="停止编辑后自动保存在本机。磁盘版本冲突时保留草稿。">
              <button className="switch" role="switch" aria-label="自动保存" aria-checked={preferences.autoSave}
                onClick={() => onChange({ autoSave: !preferences.autoSave })} />
            </Row>
            <Row label="自动下载网络图片" detail="关闭后按需加载 Markdown 中的网络图片。">
              <button className="switch" role="switch" aria-label="自动下载网络图片" aria-checked={preferences.remoteImages}
                onClick={() => onChange({ remoteImages: !preferences.remoteImages })} />
            </Row>
            <Row label="网页搜索" detail="在 Markdown 中选中文字，右键可在浏览器中搜索。">
              <select aria-label="网页搜索" value={preferences.searchEngine}
                onChange={event => onChange({ searchEngine: event.target.value as SearchEngine })}>
                {Object.entries(searchEngines).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}
              </select>
            </Row>
            <Row label="快捷新建" detail={quickNew || undefined}><button className="tool-button" onClick={() => setPage('快捷键')}>设置快捷键</button></Row>
          </>}
          {page === '存储' && <>
            <Row label="我的文档" detail={library.path}>
              <div className="setting-actions">
                <button className="tool-button" onClick={onOpenDirectory}>显示文件夹</button>
                {preferences.libraryDirectory && <button className="tool-button" onClick={() => onLibraryChange(true)}>恢复默认</button>}
                <button className="tool-button" onClick={() => onLibraryChange()}>更改位置…</button>
              </div>
            </Row>
            {([
              ['attachments', '附件目录', preferences.attachmentDirectory, '默认保存在各文档旁的 assets 文件夹。'],
              ['stickers', '思维导图贴纸目录', preferences.stickerDirectory, defaultStickerDirectory],
            ] as const).map(([kind, label, custom, fallback]) => <Row key={kind} label={label} detail={custom ?? fallback}>
              <div className="setting-actions">
                {(custom || kind === 'stickers') && <button className="tool-button" onClick={() => onOpenStorage(kind)}>显示文件夹</button>}
                {custom && <button className="tool-button" onClick={() => onStorageChange(kind, true)}>恢复默认</button>}
                <button className="tool-button" onClick={() => onStorageChange(kind)}>更改位置…</button>
              </div>
            </Row>)}
            <Row label="本机文件显示条数" detail="文件和文件夹合计，最多显示 500 条。">
              <input className="setting-count" type="number" min={1} max={recentFilesLimit} aria-label="本机文件显示条数"
                key={preferences.recentLimit} defaultValue={preferences.recentLimit}
                onBlur={event => {
                  const input = event.currentTarget
                  const value = input.valueAsNumber
                  if (!Number.isFinite(value)) { input.value = String(preferences.recentLimit); return }
                  const recentLimit = Math.min(recentFilesLimit, Math.max(1, Math.round(value)))
                  input.value = String(recentLimit)
                  if (recentLimit !== preferences.recentLimit) onChange({ recentLimit })
                }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
            </Row>
          </>}
          {page === '应用更新' && <>
            <Row label="软件更新" detail={updateProgress?.state === 'ready' ? release?.update?.version + ' 已下载'
              : installing ? '正在准备安装…' : release?.update ? '可下载 ' + release.update.version
              : release ? '已是当前发布渠道的最新版本。' : undefined}>
              <div className="setting-actions">
                <button className="tool-button" disabled={checking || downloading || installing} onClick={onCheckUpdates}>{checking ? '正在检查…' : '检查更新'}</button>
                {release?.update?.canDownload && !downloading && !installing &&
                  (updateProgress?.state === 'ready'
                    ? <button className="tool-button" onClick={onInstallUpdate}>重启并安装</button>
                    : <button className="tool-button" onClick={onDownloadUpdate}>{updateProgress?.state === 'error' ? '重新下载' : '下载更新'}</button>)}
                {release?.update && <button className="tool-button" onClick={() => onOpenRelease(release.update!.url)}>打开发布页</button>}
              </div>
            </Row>
            {updateProgress?.state === 'downloading' && <div className="update-progress">
              <progress aria-label="更新下载进度" max={updateProgress.total} value={updateProgress.received} />
              <span>{Math.floor(100 * updateProgress.received / updateProgress.total)}%</span>
            </div>}
            {updateProgress?.state === 'error' && <p className="update-progress" role="alert">{updateProgress.message}</p>}
            <Row label="自动检查更新" detail="启动时和运行期间检查 GitHub 发布版本。">
              <button className="switch" role="switch" aria-label="自动检查更新" aria-checked={preferences.autoCheckUpdates}
                onClick={() => onChange({ autoCheckUpdates: !preferences.autoCheckUpdates, ...(preferences.autoCheckUpdates ? { autoDownloadUpdates: false } : {}) })} />
            </Row>
            <Row label="自动下载更新" detail="发现新版本后在后台下载，保存文档后可重启安装。">
              <button className="switch" role="switch" aria-label="自动下载更新" aria-checked={preferences.autoDownloadUpdates}
                onClick={() => onChange({ autoDownloadUpdates: !preferences.autoDownloadUpdates,
                  ...(!preferences.autoDownloadUpdates ? { autoCheckUpdates: true } : {}) })} />
            </Row>
            {(!query || matches(query, '应用更新 更新代理 HTTP 网络 代理地址')) &&
              <UpdateProxySettings proxy={updateProxy} save={onSaveUpdateProxy} disabled={checking || downloading || installing} />}
          </>}
          {page === '关于' && <>
            <Row label="Ymd" detail={version ? '当前版本 ' + version : '本地 Markdown 与 Excalidraw 编辑器。'} />
            <Row label="源代码"><div className="setting-actions">
              <button className="tool-button" onClick={() => onOpenRelease('https://github.com/junyi-deep/Ymd')}>在 GitHub 查看</button>
            </div></Row>
          </>}
        </div>}</>}
          </section>
        </SettingSearch.Provider>)}
        {query && <p className="settings-search-empty" role="status">没有找到匹配的设置。</p>}
      </div>
    </div>
  </>
}
