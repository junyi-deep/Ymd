import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronRight, CircleAlert, FilePlus2, FileText, Folder, FolderOpen, Home, ListTree, Network, PanelLeft, LocateFixed, Plus, Save, Search, Settings2, X } from 'lucide-react'
import { defaultPreferences, type Command, type EditorMode, type Entry, type FileKind, type Preferences, type Scope } from '../shared/contracts'
import { DocumentIcon, FilesTree } from './FilesTree'
import { Settings } from './Settings'
import { useDocuments, type Session } from './documents'
import { MarkdownEditor } from './editors/Markdown'
import { OutlineEditor } from './editors/Outline'

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
  | { type: 'create'; directory?: Entry }
  | { type: 'close'; path?: string }
  | { type: 'reload'; session: Session }

export function App() {
  const sessions = useDocuments()
  const active = sessions.active
  const [library, setLibrary] = useState<Entry>()
  const [projects, setProjects] = useState<Entry[]>([])
  const [platform, setPlatform] = useState('')
  const [preferences, setPreferences] = useState(defaultPreferences)
  const lastPreferences = useRef(preferences)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [sidebar, setSidebar] = useState(true)
  const [settings, setSettings] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [revision, setRevision] = useState(0)
  const [find, setFind] = useState(0)
  const [prompt, setPrompt] = useState<Prompt>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const flushEditor = useRef<(() => void) | undefined>(undefined)
  const registerFlush = useCallback((flush?: () => void) => { flushEditor.current = flush }, [])
  const modal = useRef<HTMLDialogElement>(null)
  const commandRef = useRef<(command: Command) => void>(() => {})
  const openIntent = useRef(0)
  const filter = filterText.trim().toLocaleLowerCase()
  const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && systemDark)

  const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
  function run(action: () => Promise<unknown>) {
    setNotice('')
    void action().catch(error => setNotice(message(error)))
  }

  useEffect(() => {
    run(async () => {
      const result = await window.desktop.initialize()
      setLibrary(result.library)
      setPlatform(result.platform)
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
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.size = preferences.size
    document.documentElement.dataset.vibrant = String(platform === 'darwin' && !preferences.solidBackground)
  }, [dark, platform, preferences])

  useEffect(() => {
    if (prompt && modal.current && !modal.current.open) modal.current.showModal()
    if (!prompt && modal.current?.open) modal.current.close()
  }, [prompt])

  function scopeOf(path: string): Scope {
    const inside = (directory: Entry) => path.startsWith(directory.path.replace(/[\\/]$/, '') + (platform === 'win32' ? '\\' : '/'))
    if (library && inside(library)) return 'library'
    return projects.some(inside) ? 'project' : 'local'
  }

  function showFile(file: Parameters<typeof sessions.open>[0], scope = scopeOf(file.path)) {
    if (active?.path !== file.path) flushEditor.current?.()
    sessions.open(file, scope)
    setSettings(false)
  }

  function openFile() {
    const intent = ++openIntent.current
    run(async () => {
      const file = await window.desktop.chooseFile()
      if (file && intent === openIntent.current) showFile(file)
    })
  }

  function openDirectory() {
    run(async () => {
      const directory = await window.desktop.chooseDirectory()
      if (!directory) return
      setProjects(current => [directory, ...current.filter(entry => entry.path !== directory.path)])
      setSidebar(true)
      setRevision(value => value + 1)
      setSettings(false)
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
    if (command === 'open-directory') openDirectory()
    if (command === 'open-file') openFile()
    if (command === 'new-file' && library) setPrompt({ type: 'create' })
    if (command === 'preferences') { flushEditor.current?.(); setSettings(value => !value) }
    if (command === 'save' && active) { flushEditor.current?.(); run(() => sessions.save(active.path)) }
    if (command === 'find') {
      if (!settings && active?.kind === 'markdown' && active.mode === 'markdown') setFind(value => value + 1)
      else { setSidebar(true); setFilterOpen(value => !value) }
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    run(async () => {
      setBusy(true)
      try {
        const file = await window.desktop.create(String(form.get('directory')), String(form.get('name')).trim(), form.get('kind') as FileKind)
        showFile(file)
        setRevision(value => value + 1)
        setPrompt(undefined)
      } finally {
        setBusy(false)
      }
    })
  }

  function tree(entry: Entry, scope: Scope, expanded: boolean) {
    return <FilesTree key={entry.path} directory={entry} active={settings ? undefined : active?.path} {...{ revision, filter, expanded }}
      onOpen={file => {
        const intent = ++openIntent.current
        run(async () => {
          const existing = sessions.latest.current.find(session => session.path === file.path)
          const document = existing ?? await window.desktop.read(file.path)
          if (intent === openIntent.current) showFile(document, scope)
        })
      }}
      onCreate={directory => setPrompt({ type: 'create', directory })} />
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
            <ChevronRight size={14} /><strong title={active.path}>{active.name}</strong>{dirty && <span className="unsaved-dot" title="未保存" />}</>
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
          <IconButton label="查找" click={() => commandRef.current('find')}><Search size={18} /></IconButton>
          <IconButton label="新建文档" click={() => setPrompt({ type: 'create' })}><Plus size={19} /></IconButton>
        </>}
      </div>
    </header>
    <div className="window-body">
      {settings ? <Settings {...{ preferences, platform, library }} onReturn={() => setSettings(false)}
        onChange={patch => {
          const next = { ...lastPreferences.current, ...patch }
          lastPreferences.current = next
          setPreferences(next)
          run(async () => { await window.desktop.setPreferences(next) })
        }} /> : <>
        {sidebar && <aside className="sidebar">
          <div className="sidebar-scroll">
            <button className="tree-row home-link" onClick={home}><Home size={18} /><span>主页</span></button>
            {filterOpen && <div className="sidebar-search"><Search size={15} /><input autoFocus aria-label="筛选文件" placeholder="筛选文件"
              value={filterText} onChange={event => setFilterText(event.target.value)} /><IconButton label="清除筛选" click={() => { setFilterText(''); setFilterOpen(false) }}><X size={14} /></IconButton></div>}
            <section>
              <div className="section-heading"><h2>我的文档</h2>
                <IconButton label="在我的文档新建" click={() => setPrompt({ type: 'create', directory: library })}><Plus size={17} /></IconButton>
              </div>
              {tree(library, 'library', true)}
            </section>
            <section>
              <div className="section-heading"><h2>项目空间</h2><IconButton label="打开目录" click={openDirectory}><FolderOpen size={16} /></IconButton></div>
              {projects.length ? projects.map(entry => tree(entry, 'project', false))
                : <button className="tree-row subtle" onClick={openDirectory}><Folder size={17} /><span>打开目录…</span></button>}
            </section>
            <section>
              <div className="section-heading"><h2>本机文件</h2><IconButton label="打开文件" click={openFile}><Plus size={17} /></IconButton></div>
              {local.length ? local.filter(file => file.name.toLocaleLowerCase().includes(filter)).map(file => (
                <div key={file.path} className="local-file" data-selected={active?.path === file.path}>
                  <button className="tree-row" title={file.path} onClick={() => showFile(file, 'local')}><DocumentIcon kind={file.kind} /><span>{file.name}</span></button>
                  <IconButton label={`关闭 ${file.name}`} click={() => requestClose(file.path)}><X size={14} /></IconButton>
                </div>)) : <button className="tree-row subtle" onClick={openFile}><FileText size={17} /><span>打开文件…</span></button>}
            </section>
          </div>
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
            <p>打开本地工作区，或创建一份新文档。</p>
            <div className="home-actions">
              <button onClick={() => setPrompt({ type: 'create' })}><FilePlus2 size={21} /><span>新建文档</span><kbd>{platform === 'darwin' ? '⌘' : 'Ctrl'} N</kbd></button>
              <button onClick={openDirectory}><FolderOpen size={21} /><span>打开项目目录</span><ChevronRight size={16} /></button>
              <button onClick={openFile}><FileText size={21} /><span>打开本机文件</span><ChevronRight size={16} /></button>
            </div>
          </div> : <Suspense fallback={<div className="startup">正在加载编辑器…</div>}>
            {active.kind === 'drawing'
              ? <DrawingEditor key={active.path + ':' + active.reload} text={active.text} dark={dark} onChange={edit} />
              : active.mode === 'markdown'
                ? <MarkdownEditor key={active.path + ':' + active.reload} text={active.text} find={find} onChange={edit} />
                : active.mode === 'outline'
                  ? <OutlineEditor key={active.path + ':' + active.reload} text={active.text} platform={platform} onChange={edit} />
                  : <MindMapEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} dark={dark} onChange={edit} registerFlush={registerFlush} />}
          </Suspense>}
        </main>
      </>}
    </div>
    {!prompt && notice && <div className="notice" role="alert"><CircleAlert size={17} />{notice}<IconButton label="关闭通知" click={() => setNotice('')}><X size={15} /></IconButton></div>}
    <dialog ref={modal} onCancel={event => { event.preventDefault(); if (!busy) setPrompt(undefined) }} onClose={() => setNotice('')}>
      {prompt?.type === 'create' && <form onSubmit={create}>
        <h2>新建文档</h2>
        <label>文件名<input name="name" placeholder="未命名" required autoFocus /></label>
        <label>文件类型<select name="kind"><option value="markdown">Markdown</option><option value="drawing">Excalidraw</option></select></label>
        <label>保存位置<select name="directory" defaultValue={prompt.directory?.path ?? library.path}>
          {[...new Map([library, ...projects, ...(prompt.directory ? [prompt.directory] : [])].map(entry => [entry.path, entry])).values()]
            .map(entry => <option value={entry.path} key={entry.path}>{entry.path === library.path ? '我的文档' : entry.name}</option>)}
        </select></label>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button type="button" onClick={() => setPrompt(undefined)} disabled={busy}>取消</button><button className="primary" disabled={busy}>创建</button></footer>
      </form>}
      {prompt?.type === 'close' && <div>
        <h2>保留更改</h2><p>还有未保存的文档。关闭前需要保存吗？</p>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={() => setPrompt(undefined)} disabled={busy}>取消</button><button onClick={() => finishClose(prompt.path)} disabled={busy}>舍弃</button>
          <button className="primary" onClick={() => saveAndClose(prompt.path)} disabled={busy}>保存</button></footer>
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
