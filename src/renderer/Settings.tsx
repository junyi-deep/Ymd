import { useState, type ReactNode } from 'react'
import { ArrowLeft, HardDrive, Info, Keyboard, Palette, SlidersHorizontal } from 'lucide-react'
import type { Entry, Preferences } from '../shared/contracts'

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

export function Settings({ preferences, platform, library, onChange, onReturn }: {
  preferences: Preferences
  platform: string
  library: Entry
  onChange: (preferences: Partial<Preferences>) => void
  onReturn: () => void
}) {
  const [page, setPage] = useState<(typeof pages)[number]['label']>('外观')
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
            <Row label="不透明窗口背景" detail={platform === 'darwin' ? '让侧栏使用实色背景。' : 'Windows 窗口使用实色背景。'}>
              <button className="switch" role="switch" aria-label="不透明窗口背景" aria-checked={preferences.solidBackground}
                disabled={platform !== 'darwin'} onClick={() => onChange({ solidBackground: !preferences.solidBackground })} />
            </Row>
            <Row label="界面字号"><Choices value={preferences.size} choices={ [['small','小'], ['normal','标准'], ['large','大']] }
              onChange={size => onChange({ size })} /></Row>
            <div className="theme-preview"><article><h2>写作预览</h2><p>一段包含<strong>重点</strong>和 <code>Markdown</code> 的正文。</p><blockquote>文档保存在本机。</blockquote></article></div>
          </>}
          {page === '通用' && <Row label="文件类型" detail="Markdown 与 Excalidraw。" />}
          {page === '文档库' && <Row label="我的文档" detail={library.path} />}
          {page === '关于' && <Row label="Ymd" detail="本地 Markdown 与 Excalidraw 编辑器。" />}
          {page === '快捷键' && [
            ['新建', 'N'], ['打开文件', 'O'], ['打开目录', 'Shift + O'], ['保存', 'S'], ['查找', 'F'],
          ].map(([label, key]) => <Row key={label} label={label}><kbd>{mod} + {key}</kbd></Row>)}
        </div>
      </div>
    </div>
  </>
}
