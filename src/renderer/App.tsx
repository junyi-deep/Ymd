import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronRight, CircleAlert, FilePlus2, FileText, FolderInput, Home, ListTree, Network, PanelLeft, LocateFixed, Pin, Plus, Save, Search, Settings2, Shapes, Star, X } from 'lucide-react'
import { defaultPreferences, type Command, type EditorMode, type Entry, type FileKind, type Preferences, type Scope, type SearchHit, type VersionStatus } from '../shared/contracts'
import { DocumentIcon, FilesTree } from './FilesTree'
import { SearchDialog } from './SearchDialog'
import { Settings } from './Settings'
import { useFileMarks } from './useFileMarks'
import { useDocuments, type Session } from './documents'
import { MarkdownEditor } from './editors/Markdown'
import { OutlineEditor } from './editors/Outline'
import { discardInterruptedMapImports, loadMapAppearance, relocateMapAppearance, saveImportedMap } from './editors/mapAppearance'
import { forgetAudio, storeAudio } from './editors/mapAudio'

const MindMapEditor = lazy(() => import('./editors/MindMap'))
const DrawingEditor = lazy(() => import('./editors/Drawing'))
const modes = [
  { value: 'markdown', label: 'Markdown', icon: FileText },
  { value: 'outline', label: '大纲', icon: ListTree },
  { value: 'map', label: '思维导图', icon: Network },
] as const

function IconButton({ label, children, click, disabled }: { label: string; children: ReactNode; click: () => void; disabled?: boolean }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={click} disabled={disabled}>{children}</button>
}

type Prompt =
  | { type: 'close'; path?: string }
  | { type: 'reload' | 'trash'; session: Session }

export function App() {
  const sessions = useDocuments()
  const marks = useFileMarks()
  const active = sessions.active
  const [library, setLibrary] = useState<Entry>()
  const [project, setProject] = useState<Entry | null>(null)
  const [windowsAcrylic, setWindowsAcrylic] = useState(false)
  const [platform, setPlatform] = useState('')
  const [preferences, setPreferences] = useState(defaultPreferences)
  const lastPreferences = useRef(preferences)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [sidebar, setSidebar] = useState(true)
  const [settings, setSettings] = useState(false)
  const [version, setVersion] = useState('')
  const [release, setRelease] = useState<VersionStatus>()
  const [checking, setChecking] = useState(false)
  const releaseCheckInFlight = useRef(false)
  const checkedAtStartup = useRef(false)
  const [settingsPage, setSettingsPage] = useState<'外观' | '文档库' | '快捷键' | '关于'>('外观')
  const [searchOpen, setSearchOpen] = useState(false)
  const [jump, setJump] = useState<{ path: string; line: number; id: number }>()
  const [revision, setRevision] = useState(0)
  const [find, setFind] = useState(0)
  const [prompt, setPrompt] = useState<Prompt>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const importPending = useRef(false)
  const [rename, setRename] = useState<{ session: Session; name: string }>()
  const flushEditor = useRef<(() => void) | undefined>(undefined)
  const registerFlush = useCallback((flush?: () => void) => { flushEditor.current = flush }, [])
  const modal = useRef<HTMLDialogElement>(null)
  const commandRef = useRef<(command: Command) => void>(() => {})
  const openIntent = useRef(0)
  const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && systemDark)

  const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
  function run(action: () => Promise<unknown>) {
    setNotice('')
    void action().catch(error => setNotice(message(error)))
  }

  async function checkForUpdates(manual = true) {
    if (releaseCheckInFlight.current) return
    releaseCheckInFlight.current = true
    setChecking(true)
    try {
      setRelease(await window.desktop.checkForUpdates())
    } catch (error) {
      if (manual) setNotice(message(error))
    } finally {
      releaseCheckInFlight.current = false
      setChecking(false)
    }
  }

  useEffect(() => {
    run(async () => {
      discardInterruptedMapImports()
      const result = await window.desktop.initialize()
      setLibrary(result.library)
      setProject(result.project)
      setWindowsAcrylic(result.windowsAcrylic)
      setPlatform(result.platform)
      setVersion(result.version)
      setPreferences(result.preferences)
      lastPreferences.current = result.preferences
    })
    const query = matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => setSystemDark(query.matches)
    const onFocus = () => setRevision(value => value + 1)
    query.addEventListener('change', onTheme)
    window.addEventListener('focus', onFocus)
    const unsubscribe = window.desktop.onCommand(command => commandRef.current(command))
    return () => {
      unsubscribe()
      query.removeEventListener('change', onTheme)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (!version || !preferences.autoCheckUpdates || checkedAtStartup.current) return
    checkedAtStartup.current = true
    void checkForUpdates(false)
  }, [version, preferences.autoCheckUpdates])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.size = preferences.size
    document.documentElement.dataset.vibrant = String((platform === 'darwin' || windowsAcrylic) && !preferences.solidBackground)
    document.documentElement.dataset.animation = preferences.animations ? 'full' : 'reduced'
    document.documentElement.dataset.documentTheme = preferences.documentTheme
  }, [dark, platform, preferences, windowsAcrylic])

  useEffect(() => {
    if (!settings || prompt || searchOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) setSettings(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [settings, prompt, searchOpen])

  useEffect(() => {
    if (prompt && modal.current && !modal.current.open) modal.current.showModal()
    if (!prompt && modal.current?.open) modal.current.close()
  }, [prompt])

  useEffect(() => {
    if (!preferences.autoSave || !active || active.conflict || active.text === active.saved) return
    const timer = window.setTimeout(() => run(() => sessions.save(active.path)), 900)
    return () => window.clearTimeout(timer)
  }, [preferences.autoSave, active?.path, active?.version, active?.text, active?.conflict])

  function scopeOf(path: string): Scope {
    const inside = (directory: Entry) => path.startsWith(directory.path.replace(/[\\/]$/, '') + (platform === 'win32' ? '\\' : '/'))
    if (library && inside(library)) return 'library'
    return project && inside(project) ? 'project' : 'local'
  }

  function showFile(file: Parameters<typeof sessions.open>[0], scope = scopeOf(file.path)) {
    if (active?.path !== file.path) flushEditor.current?.()
    const openMap = file.kind === 'markdown' && !sessions.latest.current.some(document => document.path === file.path) &&
      !!loadMapAppearance(file.path).imported
    sessions.open(file, scope)
    if (openMap) sessions.patch(file.path, { mode: 'map' })
    setSettings(false)
  }

  function openFile() {
    const intent = ++openIntent.current
    run(async () => {
      const file = await window.desktop.chooseFile()
      if (file && intent === openIntent.current) showFile(file)
    })
  }

  function importWorkbook() {
    const directory = active && scopeOf(active.path) === 'project' ? project ?? library : library
    if (!directory || importPending.current) return
    importPending.current = true
    const intent = ++openIntent.current
    setImporting(true)
    run(async () => {
      const reservation = 'ymd.import:' + crypto.randomUUID() + directory.path + '_'.repeat(120)
      const recordings: string[] = []
      let saved = false
      try {
        const source = await window.desktop.chooseXmind()
        if (!source || intent !== openIntent.current) return
        const { importXmind } = await import('./editors/importXmind')
        const { text, appearance, audios, unconverted } = await importXmind(source.data)
        if (intent !== openIntent.current) return
        const settings = JSON.stringify(appearance)
        // Reserve space for the appearance before writing a new Markdown file.
        try { localStorage.setItem(reservation, settings) }
        catch { throw new Error('导图样式和附件超过当前可用的本机存储空间。') }
        for (const { id, blob } of audios) {
          await storeAudio(id, blob)
          recordings.push(id)
        }
        if (intent !== openIntent.current) return
        const file = await window.desktop.createImportedMarkdown(directory.path, source.name, text)
        localStorage.removeItem(reservation)
        saveImportedMap(file.path, settings)
        saved = true
        setRevision(value => value + 1)
        if (intent !== openIntent.current) return
        showFile(file)
        if (unconverted.length) setNotice('已导入工作簿。以下内容无法转换：' + unconverted.join('、') + '。')
      } finally {
        localStorage.removeItem(reservation)
        if (!saved) await Promise.allSettled(recordings.map(forgetAudio))
        importPending.current = false
        setImporting(false)
      }
    })
  }

  function changeProject(reset = false) {
    run(async () => {
      const entry = await (reset ? window.desktop.resetProjectDirectory() : window.desktop.chooseProjectDirectory())
      if (!entry) return
      lastPreferences.current = { ...lastPreferences.current, projectDirectory: reset ? undefined : entry.path }
      setPreferences(lastPreferences.current)
      setProject(entry)
      setSidebar(true)
      setRevision(value => value + 1)
    })
  }

  function openFromSearch(hit: SearchHit) {
    setSearchOpen(false)
    const intent = ++openIntent.current
    run(async () => {
      const file = sessions.latest.current.find(document => document.path === hit.path) ?? await window.desktop.read(hit.path)
      if (intent !== openIntent.current) return
      showFile(file)
      if (hit.line && file.kind === 'markdown') {
        sessions.patch(file.path, { mode: 'markdown' })
        setJump({ path: file.path, line: hit.line, id: Date.now() })
      }
    })
  }

  function finishClose(path?: string) {
    if (path) sessions.close(path)
    else run(() => window.desktop.finishClose())
    setPrompt(undefined)
  }

  function requestClose(path?: string) {
    flushEditor.current?.()
    if (sessions.hasPending(path)) {
      run(async () => { await sessions.waitForPending(path); requestClose(path) })
      return
    }
    if (sessions.latest.current.some(document => (!path || document.path === path) && document.saved !== document.text)) {
      setPrompt({ type: 'close', path })
    } else finishClose(path)
  }

  function saveAndClose(path?: string) {
    run(async () => {
      setBusy(true)
      try {
        for (const document of sessions.latest.current) {
          if ((!path || path === document.path) && !await sessions.save(document.path)) {
            setPrompt(undefined)
            sessions.open(document, document.scope)
            setSettings(false)
            return
          }
        }
        finishClose(path)
      } finally {
        setBusy(false)
      }
    })
  }

  commandRef.current = command => {
    if (command === 'close') requestClose()
    if (prompt) return
    if (command === 'search') setSearchOpen(value => !value)
    if (searchOpen) return
    if (command === 'open-file') openFile()
    if (command === 'import-xmind') importWorkbook()
    if (command === 'new-file' || command === 'new-drawing') create(command === 'new-drawing' ? 'drawing' : 'markdown')
    if (command === 'preferences') { flushEditor.current?.(); setSettingsPage('外观'); setSettings(value => !value) }
    if (command === 'save' && active) { flushEditor.current?.(); run(() => sessions.save(active.path)) }
    if (command === 'find') {
      if (!settings && active?.kind === 'markdown' && active.mode === 'markdown') setFind(value => value + 1)
      else setSearchOpen(true)
    }
  }

  function create(kind: FileKind = 'markdown', directory = active && scopeOf(active.path) === 'project' ? project ?? library : library) {
    if (!directory) return
    const intent = ++openIntent.current
    flushEditor.current?.()
    run(async () => {
      const file = await window.desktop.create(directory.path, kind)
      setRevision(value => value + 1)
      if (intent === openIntent.current) showFile(file)
    })
  }

  function openPath(path: string, scope?: Scope) {
    const intent = ++openIntent.current
    run(async () => {
      const existing = sessions.latest.current.find(session => session.path === path)
      const document = existing ?? await window.desktop.read(path)
      if (intent === openIntent.current) showFile(document, scope)
    })
  }

  function markedSection(title: string, paths: string[], Icon: typeof Pin) {
    if (!paths.length) return null
    return <section><div className="section-heading"><h2>{title}</h2></div>
      {paths.map(path => <button className="tree-row" key={path} title={path} onClick={() => openPath(path)}
        data-selected={active?.path === path}><Icon size={15} /><span>{path.split(/[\\/]/).at(-1)}</span></button>)}
    </section>
  }

  function moveFile(session: Session) {
    relocateFile(session, saved => window.desktop.move(saved.path, saved.version))
  }

  function relocateFile(session: Session, operation: (saved: Session) => Promise<Parameters<typeof sessions.open>[0] | null>) {
    flushEditor.current?.()
    run(async () => {
      if (!await sessions.save(session.path)) return
      const saved = sessions.latest.current.find(document => document.path === session.path)
      if (!saved) return
      const file = await operation(saved)
      if (!file || file.path === saved.path) return
      marks.relocate(saved.path, file.path)
      relocateMapAppearance(saved.path, file.path, file.name)
      sessions.close(saved.path)
      showFile(file)
      setRevision(value => value + 1)
    })
  }

  function renameActive() {
    if (!rename) return
    setRename(undefined)
    relocateFile(rename.session, saved => window.desktop.rename(saved.path, rename.name, saved.version))
  }

  function tree(entry: Entry, scope: Scope, expanded: boolean) {
    return <FilesTree key={entry.path} directory={entry} active={settings ? undefined : active?.path} {...{ revision, expanded }}
      onOpen={file => openPath(file.path, scope)}
      onCreate={directory => create('markdown', directory)} />
  }

  if (!library) return <div className="startup">{notice || '正在打开文档库…'}</div>

  const dirty = active && active.saved !== active.text
  const edit = (text: string) => { if (active) sessions.patch(active.path, { text }) }
  const local = sessions.documents.filter(document => scopeOf(document.path) === 'local')
  const activeScope = active && scopeOf(active.path)
  const home = () => { flushEditor.current?.(); ++openIntent.current; setSettings(false); sessions.showHome() }
  return <div className="window" data-platform={platform} data-sidebar={sidebar || settings}>
    <header className="titlebar flex items-center">
      <div className="window-controls flex items-center gap-1">
        <IconButton label="切换侧栏" click={() => { if (settings) setSettings(false); else setSidebar(!sidebar) }}><PanelLeft size={17} /></IconButton>
        <IconButton label="主页" click={home}><Home size={17} /></IconButton>
      </div>
      <div className="title-path flex min-w-0 items-center gap-2">
        {settings ? <span>设置</span> : active
          ? <><span className="source-label">{activeScope === 'library' ? '我的文档' : activeScope === 'project' ? '项目空间' : '本机文件'}</span>
            <ChevronRight size={14} />
            {rename?.session.path === active.path
              ? <input className="document-rename" aria-label="文档名称" autoFocus value={rename.name}
                  onFocus={event => event.currentTarget.select()} onChange={event => setRename({ ...rename, name: event.target.value })}
                  onBlur={() => setRename(undefined)} onKeyDown={event => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Escape') { event.stopPropagation(); setRename(undefined) }
                    if (event.key === 'Enter') renameActive()
                  }} />
              : <button className="document-name" title={active.path} aria-label={'重命名 ' + active.name}
                  onDoubleClick={() => setRename({ session: active, name: active.name.replace(/\.[^.]+$/, '') })}
                  onKeyDown={event => {
                    if (event.key === 'F2' || event.key === 'Enter') {
                      event.preventDefault()
                      setRename({ session: active, name: active.name.replace(/\.[^.]+$/, '') })
                    }
                  }}>{active.name}</button>}
            {dirty && <span className="unsaved-dot" title="未保存" />}</>
          : <strong>Ymd</strong>}
      </div>
      {!settings && active?.kind === 'markdown' && <div className="segments mode-switch" aria-label="编辑模式">
        {modes.map(({ value, label, icon: Icon }) => <button key={value} type="button" title={label} aria-label={label}
          aria-pressed={active.mode === value} onClick={() => { flushEditor.current?.(); sessions.patch(active.path, { mode: value as EditorMode }) }}>
          <Icon size={14} /><span>{label}</span></button>)}
      </div>}
      <div className="title-actions ml-auto flex items-center gap-1">
        {!settings && <>
          {active && <IconButton label={dirty ? '保存' : '已保存'} click={() => commandRef.current('save')} disabled={!dirty && active.mode !== 'map'}>
            {dirty ? <Save size={17} /> : <Check size={17} />}
          </IconButton>}
          {active && <IconButton label="在文件管理器中显示" click={() => run(() => window.desktop.reveal(active.path))}><LocateFixed size={16} /></IconButton>}
          <IconButton label="搜索文档" click={() => commandRef.current('search')}><Search size={18} /></IconButton>
          <IconButton label="新建文档" click={() => create()}><Plus size={19} /></IconButton>
          <IconButton label="新建绘图" click={() => create('drawing')}><Shapes size={17} /></IconButton>
        </>}
      </div>
    </header>
    <div className="window-body">
      {settings ? <Settings initialPage={settingsPage} {...{ preferences, platform, library, project, windowsAcrylic, version, release, checking }}
        onProjectChange={changeProject} onReturn={() => setSettings(false)}
        onCheckUpdates={() => void checkForUpdates()}
        onOpenRelease={url => run(() => window.desktop.openExternal(url))}
        onOpenDirectory={location => run(() => window.desktop.openLibraryDirectory(location))}
        onChange={patch => {
          const next = { ...lastPreferences.current, ...patch }
          lastPreferences.current = next
          setPreferences(next)
          run(async () => { await window.desktop.setPreferences(next) })
        }} /> : <>
        {sidebar && <aside className="sidebar">
          <div className="sidebar-scroll">
            <button className="tree-row home-link" onClick={home}><Home size={18} /><span>主页</span></button>
            {markedSection('置顶', marks.pinned, Pin)}
            {markedSection('收藏', marks.starred, Star)}
            <section>
              <div className="section-heading"><h2>我的文档</h2>
                <IconButton label="在我的文档新建" click={() => create('markdown', library)}><Plus size={17} /></IconButton>
              </div>
              {tree(library, 'library', true)}
            </section>
            <section>
              <div className="section-heading"><h2>项目空间</h2>
                {project && <IconButton label="在项目空间新建" click={() => create('markdown', project)}><Plus size={17} /></IconButton>}
              </div>
              {project ? tree(project, 'project', false) : <button className="tree-row subtle" onClick={() => { setSettingsPage('文档库'); setSettings(true) }}>配置文档库</button>}
            </section>
            <section>
              <div className="section-heading"><h2>本机文件</h2><IconButton label="打开文件" click={openFile}><Plus size={17} /></IconButton></div>
              {local.length ? local.map(file => (
                <div key={file.path} className="local-file" data-selected={active?.path === file.path}>
                  <button className="tree-row" title={file.path} onClick={() => showFile(file, 'local')}><DocumentIcon kind={file.kind} /><span>{file.name}</span></button>
                  <IconButton label={`关闭 ${file.name}`} click={() => requestClose(file.path)}><X size={14} /></IconButton>
                </div>)) : <button className="tree-row subtle" onClick={openFile}><FileText size={17} /><span>打开文件…</span></button>}
            </section>
          </div>
          {release?.update && <button className="tree-row" onClick={() => { setSettingsPage('关于'); setSettings(true) }}>
            <CircleAlert size={16} /><span>可更新至 {release.update.version}</span>
          </button>}
          <button className="tree-row sidebar-footer" onClick={() => commandRef.current('preferences')}><Settings2 size={18} /><span>设置</span></button>
        </aside>}
        <main className="workspace">
          {active?.conflict && <div className="alert"><CircleAlert size={17} /><span>磁盘上的文件已变化。草稿仍在编辑器中。</span>
            <button onClick={() => setPrompt({ type: 'reload', session: active })}>重新载入</button>
            <button onClick={() => run(async () => {
              const file = await window.desktop.saveCopy(active.path, active.text)
              if (file) showFile(file)
            })}>另存副本</button>
          </div>}
          {!active ? <div className="home">
            <h1>我的文档</h1>
            <p>创建文档或打开已有的本机文件。</p>
            <div className="home-actions">
              <button onClick={() => create()}><FilePlus2 size={21} /><span>新建文档</span><kbd>{platform === 'darwin' ? '⌘' : 'Ctrl'} N</kbd></button>
              <button onClick={() => create('drawing')}><Shapes size={21} /><span>新建绘图</span><ChevronRight size={16} /></button>
              <button onClick={openFile}><FileText size={21} /><span>打开本机文件</span><ChevronRight size={16} /></button>
              <button onClick={importWorkbook} disabled={importing || !library}><FolderInput size={21} /><span>{importing ? '正在导入 Xmind…' : '导入 Xmind'}</span><ChevronRight size={16} /></button>
            </div>
          </div> : <Suspense fallback={<div className="startup">正在加载编辑器…</div>}>
            {active.kind === 'drawing'
              ? <DrawingEditor key={active.path + ':' + active.reload} text={active.text} dark={dark} onChange={edit} />
              : active.mode === 'markdown'
                ? <MarkdownEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path} modified={active.modified} platform={platform} remoteImages={preferences.remoteImages}
                  searchEngine={preferences.searchEngine} registerFlush={registerFlush}
                  find={find} jump={jump?.path === active.path ? jump : undefined} onChange={edit}
                  report={error => setNotice(message(error))}
                  pinned={marks.pinned.includes(active.path)} starred={marks.starred.includes(active.path)}
                  togglePin={() => marks.toggle('pinned', active.path)} toggleStar={() => marks.toggle('starred', active.path)}
                  move={() => moveFile(active)} trash={() => setPrompt({ type: 'trash', session: active })}
                  shortcuts={() => { setSettingsPage('快捷键'); setSettings(true) }}
                  printDocument={() => run(async () => {
                    const { printMarkdown } = await import('./editors/printMarkdown')
                    return window.desktop.printDocument(active.name, await printMarkdown(active.path, active.text))
                  })}
                  exportPdf={() => run(async () => {
                    const { printMarkdown } = await import('./editors/printMarkdown')
                    return window.desktop.exportPdf(active.name, await printMarkdown(active.path, active.text))
                  })}
                  duplicate={() => run(async () => {
                    const file = await window.desktop.duplicate(active.path, activeScope === 'project' && project ? project.path : library.path, active.text)
                    setRevision(value => value + 1)
                    showFile(file)
                  })}
                  reveal={() => run(() => window.desktop.reveal(active.path))}
                  saveCopy={() => run(async () => {
                    const file = await window.desktop.saveCopy(active.path, active.text)
                    if (file) { setRevision(value => value + 1); showFile(file) }
                  })} />
                : active.mode === 'outline'
                  ? <OutlineEditor key={active.path + ':' + active.reload} text={active.text} platform={platform} onChange={edit} />
                  : <MindMapEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path} dark={dark} onChange={edit}
                    registerFlush={registerFlush} importWorkbook={importWorkbook} importing={importing} />}
          </Suspense>}
        </main>
      </>}
    </div>
    {!prompt && notice && <div className="notice" role="alert"><CircleAlert size={17} />{notice}<IconButton label="关闭通知" click={() => setNotice('')}><X size={15} /></IconButton></div>}
    {searchOpen && <SearchDialog documents={sessions.documents} onOpen={openFromSearch} onClose={() => setSearchOpen(false)} />}
    <dialog ref={modal} onCancel={event => { event.preventDefault(); if (!busy) setPrompt(undefined) }} onClose={() => setNotice('')}>
      {prompt?.type === 'close' && <div>
        <h2>保留更改</h2><p>还有未保存的文档。关闭前需要保存吗？</p>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={() => setPrompt(undefined)} disabled={busy}>取消</button><button onClick={() => finishClose(prompt.path)} disabled={busy}>舍弃</button>
          <button className="primary" onClick={() => saveAndClose(prompt.path)} disabled={busy}>保存</button></footer>
      </div>}
      {prompt?.type === 'trash' && <div>
        <h2>移到回收站</h2><p>将「{prompt.session.name}」移到系统回收站。</p>
        {prompt.session.text !== prompt.session.saved && <p>当前草稿有未保存的更改。</p>}
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={() => setPrompt(undefined)} disabled={busy}>取消</button>
          <button className="primary" disabled={busy} onClick={() => run(async () => {
            setBusy(true)
            try {
              if (!await sessions.save(prompt.session.path)) { setPrompt(undefined); return }
              const saved = sessions.latest.current.find(document => document.path === prompt.session.path)
              if (!saved) return
              await window.desktop.trash(saved.path, saved.version)
              marks.relocate(saved.path)
              sessions.close(saved.path)
              setRevision(value => value + 1)
              setPrompt(undefined)
            } finally { setBusy(false) }
          })}>移到回收站</button></footer>
      </div>}
      {prompt?.type === 'reload' && <div><h2>重新载入文件</h2><p>载入磁盘上的版本会替换当前草稿。</p>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={() => setPrompt(undefined)} disabled={busy}><ArrowLeft size={14} />返回</button>
          <button className="primary" disabled={busy} onClick={() => run(async () => {
            setBusy(true)
            try { await sessions.reload(prompt.session); setPrompt(undefined) } finally { setBusy(false) }
          })}>重新载入</button></footer></div>}
    </dialog>
  </div>
}
