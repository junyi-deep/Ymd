import { useState, type ReactNode } from 'react'
import { ArrowLeft, HardDrive, Info, Keyboard, Palette, SlidersHorizontal } from 'lucide-react'
import { searchEngines, type Entry, type Preferences, type SearchEngine, type VersionStatus } from '../shared/contracts'

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

export function Settings({ preferences, platform, library, project, windowsAcrylic, initialPage, version, release, checking, onCheckUpdates, onOpenRelease, onOpenDirectory, onChange, onReturn, onProjectChange }: {
  preferences: Preferences
  platform: string
  library: Entry
  project: Entry | null
  initialPage: (typeof pages)[number]['label']
  windowsAcrylic: boolean
  version: string
  release?: VersionStatus
  checking: boolean
  onCheckUpdates: () => void
  onOpenRelease: (url: string) => void
  onOpenDirectory: (location: 'library' | 'project') => void
  onProjectChange: (reset?: boolean) => void
  onChange: (preferences: Partial<Preferences>) => void
  onReturn: () => void
}) {
  const [page, setPage] = useState(initialPage)
  const material = platform === 'darwin' || windowsAcrylic
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl'
  return <>
    <aside className="sidebar settings-nav"><div className="sidebar-scroll">
      <h2>设置</h2>
      {pages.map(({ label, icon: Icon }) => <button className="tree-row" key={label} data-selected={page === label}
        onClick={() => setPage(label)}><Icon size={18} /><span>{label}</span></button>)}
    </div><button className="tree-row sidebar-footer" onClick={onReturn}><ArrowLeft size={18} /><span>返回</span></button></aside>
    <div className="settings-main">
      <div className="settings-content">
        <h1>{page}</h1>
        <div className="settings-group">
          {page === '外观' && <>
            <Row label="外观"><Choices value={preferences.theme} choices={ [['system','跟随系统'], ['light','浅色'], ['dark','深色']] }
              onChange={theme => onChange({ theme })} /></Row>
            <Row label="不透明窗口背景" detail={material
              ? '关闭后，侧栏透出桌面的毛玻璃。开启后，整个窗口使用实色。'
              : '当前系统使用实色背景。'}>
              <button className="switch" role="switch" aria-label="不透明窗口背景" aria-checked={preferences.solidBackground}
                disabled={!material} onClick={() => onChange({ solidBackground: !preferences.solidBackground })} />
            </Row>
            <Row label="动画" detail="控制侧栏、菜单和设置控件的过渡效果。">
              <Choices value={preferences.animations ? 'full' : 'reduced'} choices={ [['reduced','克制'], ['full','丰富']] }
                onChange={choice => onChange({ animations: choice === 'full' })} />
            </Row>
            <Row label="界面字号"><Choices value={preferences.size} choices={ [['small','小'], ['normal','标准'], ['large','大']] }
              onChange={size => onChange({ size })} /></Row>
            <Row label="文档主题"><Choices value={preferences.documentTheme} choices={ [['classic','标准'], ['paper','纸张'], ['mono','等宽']] }
              onChange={documentTheme => onChange({ documentTheme })} /></Row>
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
            <Row label="快捷新建" detail={`${mod} + N 新建 Markdown，${mod} + Shift + N 新建绘图。`} />
          </>}
          {page === '文档库' && <>
            <Row label="项目空间" detail={project?.path ?? '文档目录不可用，请选择位置。'}>
              <div className="setting-actions">
                {project && <button className="tool-button" onClick={() => onOpenDirectory('project')}>显示文件夹</button>}
                {preferences.projectDirectory && <button className="tool-button" onClick={() => onProjectChange(true)}>恢复默认</button>}
                <button className="tool-button" onClick={() => onProjectChange()}>更改位置…</button>
              </div>
            </Row>
            <Row label="我的文档" detail={library.path}>
              <div className="setting-actions"><button className="tool-button" onClick={() => onOpenDirectory('library')}>显示文件夹</button></div>
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
          {page === '快捷键' && [
            ['新建', 'N'], ['打开文件', 'O'], ['新建绘图', 'Shift + N'], ['保存', 'S'], ['查找和替换', 'F'], ['搜索文档', 'J'], ['设置', ','],
          ].map(([label, key]) => <Row key={label} label={label}><kbd>{mod} + {key}</kbd></Row>)}
        </div>
      </div>
    </div>
  </>
}
