import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronRight, CircleAlert, Copy, FilePlus2, FileText, FolderInput, Home, ListChecks, ListTree, Network, PanelLeft, LocateFixed, Pencil, Pin, Plus, Save, Search, Settings2, Shapes, Star, Trash2, X } from 'lucide-react'
import { defaultPreferences, type Command, type DocumentFile, type EditorMode, type Entry, type FileKind, type Preferences, type Scope, type SearchHit, type TreeChange, type TreeMutation, type VersionStatus } from '../shared/contracts'
import { FileTreeRow, FilesTree, type TreeDrag, type TreeRename } from './FilesTree'
import { SearchDialog } from './SearchDialog'
import { Settings } from './Settings'
import { useFileMarks } from './useFileMarks'
import { useDocuments, type Session } from './documents'
import { MarkdownEditor } from './editors/Markdown'
import { OutlineEditor } from './editors/Outline'
import type { OutlineSession } from './editors/outlineEditing'
import { copyMapAppearance, discardInterruptedMapImports, loadMapAppearance, relocateMapAppearance, saveImportedMap, styledMapPaths } from './editors/mapAppearance'
import { forgetAudio, storeAudio } from './editors/mapAudio'
import { mapDocumentPath, mapDocumentSheets, registerMapDocument, registeredMapPaths, relocateMapDocument, removeMapDocument } from './editors/mapDocumentLinks'
import { findTopic, type TopicLink } from './editors/mapTopicLinks'
import { shortcutLabel, shortcutValue, type AppShortcut } from '../shared/shortcuts'
import { MarkdownMenu, type MenuItem } from './editors/MarkdownMenu'

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
  | { type: 'tree-trash'; entries: Entry[] }

export function App() {
  const sessions = useDocuments()
  const marks = useFileMarks()
  const active = sessions.active
  const [library, setLibrary] = useState<Entry>()
  const [recent, setRecent] = useState<Entry[]>([])
  const [treeMenu, setTreeMenu] = useState<{ kind: 'create' | 'open' | 'entry' | 'batch'; target?: Entry; x: number; y: number; recent?: boolean; anchor?: HTMLButtonElement }>()
  const [batch, setBatch] = useState<Map<string, Entry>>()
  const [renamingEntry, setRenamingEntry] = useState<{ entry: Entry; name: string }>()
  const draggingEntry = useRef<Entry>(undefined)
  const [windowsAcrylic, setWindowsAcrylic] = useState(false)
  const [platform, setPlatform] = useState('')
  const [preferences, setPreferences] = useState(defaultPreferences)
  const lastPreferences = useRef(preferences)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [macReducesTransparency, setMacReducesTransparency] = useState(false)
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
  const [mapJump, setMapJump] = useState<{ path: string; target: TopicLink }>()
  const [revision, setRevision] = useState(0)
  const [find, setFind] = useState(0)
  const [prompt, setPrompt] = useState<Prompt>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const importPending = useRef(false)
  const [rename, setRename] = useState<{ session: Session; name: string }>()
  const flushEditor = useRef<(() => void) | undefined>(undefined)
  const outlineSessions = useRef(new Map<string, OutlineSession>())
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

  function updatePreferences(patch: Partial<Preferences>) {
    const next = { ...lastPreferences.current, ...patch }
    lastPreferences.current = next
    setPreferences(next)
    run(async () => { await window.desktop.setPreferences(next) })
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
      setRecent(result.recent)
      setWindowsAcrylic(result.windowsAcrylic)
      setMacReducesTransparency(result.macReducesTransparency)
      setPlatform(result.platform)
      setVersion(result.version)
      setPreferences(result.preferences)
      lastPreferences.current = result.preferences
    })
    const query = matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => setSystemDark(query.matches)
    const onFocus = () => setRevision(value => value + 1)
    query.addEventListener('change', onTheme)
    const unsubscribeTransparency = window.desktop.onReducedTransparency(setMacReducesTransparency)
    window.addEventListener('focus', onFocus)
    const unsubscribe = window.desktop.onCommand(command => commandRef.current(command))
    return () => {
      unsubscribe()
      unsubscribeTransparency()
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
    document.documentElement.dataset.windowMaterial = preferences.solidBackground || macReducesTransparency ? 'solid'
      : platform === 'darwin' ? 'vibrancy' : windowsAcrylic ? 'acrylic' : 'solid'
    document.documentElement.style.setProperty('--window-transparency', preferences.windowTransparency + '%')
    document.documentElement.dataset.animation = preferences.animations ? 'full' : 'reduced'
    document.documentElement.dataset.documentTheme = preferences.documentTheme
  }, [dark, platform, preferences, windowsAcrylic, macReducesTransparency])

  useEffect(() => {
    if (!settings || prompt || searchOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) setSettings(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [settings, prompt, searchOpen])

  useEffect(() => {
    if (!batch || prompt || searchOpen || treeMenu || settings) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented &&
          !(event.target instanceof Element && event.target.closest('input:not([type="checkbox"]), textarea, [contenteditable]'))) {
        event.preventDefault()
        setBatch(undefined)
      }
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [batch, prompt, searchOpen, treeMenu, settings])

  useEffect(() => {
    if (prompt && modal.current && !modal.current.open) modal.current.showModal()
    if (!prompt && modal.current?.open) modal.current.close()
  }, [prompt])

  useEffect(() => {
    if (!preferences.autoSave || !active || active.conflict || active.text === active.saved) return
    const timer = window.setTimeout(() => run(() => sessions.save(active.path)), 900)
    return () => window.clearTimeout(timer)
  }, [preferences.autoSave, active?.path, active?.version, active?.text, active?.conflict])

  function within(entry: Entry, path: string) {
    const normalize = (value: string) => platform === 'win32' ? value.toLowerCase() : value
    const source = normalize(entry.path)
    const target = normalize(path)
    return source === target || entry.kind === 'directory' &&
      target.startsWith(source.replace(/[\\/]$/, '') + (platform === 'win32' ? '\\' : '/'))
  }

  function scopeOf(path: string): Scope {
    return library && within(library, path) ? 'library' : 'local'
  }

  function showFile(file: Parameters<typeof sessions.open>[0], scope = scopeOf(file.path)) {
    if (active?.path !== file.path) flushEditor.current?.()
    const openMap = file.kind === 'markdown' && !sessions.latest.current.some(document => document.path === file.path) &&
      !!loadMapAppearance(file.path).imported
    sessions.open(file, scope)
    if (openMap) sessions.patch(file.path, { mode: 'map' })
    setSettings(false)
  }

  async function readMapDocument(path: string): Promise<DocumentFile> {
    const file = sessions.latest.current.find(document => document.path === path) ?? await window.desktop.read(path)
    if (file.kind !== 'markdown') throw new Error('请选择 Markdown 文档。')
    return file
  }

  async function followMapDocument(target: TopicLink) {
    const path = target.document && mapDocumentPath(target.document)
    if (!path) return false
    const intent = ++openIntent.current
    try {
      const file = await readMapDocument(path)
      if (intent !== openIntent.current) return true
      const sheet = mapDocumentSheets(file).find(item => item.id === target.sheet)
      if (!sheet || target.topic && !findTopic(sheet.tree, target.topic)) return false
      showFile(file)
      sessions.patch(file.path, { mode: 'map' })
      setMapJump({ path: file.path, target: { sheet: target.sheet, topic: target.topic } })
      return true
    } catch { return intent !== openIntent.current }
  }

  const consumedMapJump = useCallback((target: TopicLink) => {
    setMapJump(current => current?.target === target ? undefined : current)
  }, [])

  function openFile() {
    const intent = ++openIntent.current
    run(async () => {
      const file = await window.desktop.chooseFile()
      if (file) {
        setRecent(await window.desktop.listRecent())
        if (intent === openIntent.current) showFile(file)
      }
    })
  }

  function openDirectory() {
    run(async () => {
      const result = await window.desktop.chooseLocalDirectory()
      if (result) setRecent(result)
    })
  }

  function importWorkbook() {
    const directory = library
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
        const { text, appearance, audios, crossDocumentLinks, unconverted } = await importXmind(source.data)
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
        if (crossDocumentLinks) {
          try { registerMapDocument(file.path) } catch { unconverted.push('跨文档反向链接') }
        }
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

  function changeLibrary(reset = false) {
    run(async () => {
      const entry = await (reset ? window.desktop.resetLibraryDirectory() : window.desktop.chooseLibraryDirectory())
      if (!entry) return
      lastPreferences.current = { ...lastPreferences.current, libraryDirectory: reset ? undefined : entry.path }
      setPreferences(lastPreferences.current)
      setLibrary(entry)
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
    if (path) { outlineSessions.current.delete(path); sessions.close(path) }
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
      if (!settings && active?.kind === 'markdown' && (active.mode === 'markdown' || active.mode === 'map')) setFind(value => value + 1)
      else setSearchOpen(true)
    }
  }

  function create(kind: FileKind = 'markdown', directory = library) {
    if (!directory) return
    const intent = ++openIntent.current
    flushEditor.current?.()
    run(async () => {
      const file = await window.desktop.create(directory.path, kind)
      setRevision(value => value + 1)
      if (intent === openIntent.current) showFile(file)
    })
  }

  function createFolder(directory = library) {
    if (!directory) return
    run(async () => {
      await window.desktop.createFolder(directory.path)
      setRevision(value => value + 1)
    })
  }

  function toggleBatch(entry: Entry) {
    setBatch(current => {
      const next = new Map(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.set(entry.path, entry)
      return next
    })
  }

  function updateTreePaths(changes: TreeChange[], copying: boolean) {
    const paths = new Set([...marks.pinned, ...marks.starred, ...styledMapPaths(), ...registeredMapPaths(),
      ...sessions.latest.current.map(session => session.path)])
    const remapped = new Map<string, string | undefined>()
    let metadataFailed = false
    for (const { source, target } of changes) {
      for (const old of paths) {
        if (!within(source, old)) continue
        const next = target ? target.path + old.slice(source.path.length) : undefined
        if (next === old) continue
        const name = next?.split(/[\\/]/).at(-1) ?? ''
        try {
          if (copying && next) copyMapAppearance(old, next, name)
          else if (next) {
            relocateMapAppearance(old, next, name)
            relocateMapDocument(old, next)
          } else removeMapDocument(old)
        } catch { metadataFailed = true }
        if (copying) continue
        remapped.set(old, next)
        const outline = outlineSessions.current.get(old)
        outlineSessions.current.delete(old)
        if (next) {
          sessions.relocate(old, next, name, scopeOf(next))
          if (outline) outlineSessions.current.set(next, outline)
        } else sessions.close(old)
      }
    }
    if (remapped.size) marks.remap(remapped)
    return metadataFailed
  }

  function mutateEntries(operation: TreeMutation['operation'], entries: Entry[], name?: string, clearSelection = false, destination?: string) {
    flushEditor.current?.()
    run(async () => {
      const copying = operation === 'copy' || operation === 'import'
      setBusy(true)
      try {
        if (!copying) {
          const open = sessions.latest.current.filter(session => entries.some(entry => within(entry, session.path)))
          for (const session of open) {
            if (!await sessions.save(session.path)) throw new Error('已有文件在磁盘上发生变化，请解决冲突后重试。')
          }
        }
        const changes = await window.desktop.mutateTree({ operation, name, destination, entries: entries.map(entry => {
          const open = sessions.latest.current.find(session => session.path === entry.path)
          return { ...entry, version: open?.version, text: copying ? open?.text : undefined }
        }) })
        if (!changes) return
        const failed = changes.filter(change => change.error)
        const metadataFailed = updateTreePaths(changes.filter(change => !change.error), copying)
        setRevision(value => value + 1)
        setRecent(await window.desktop.listRecent())
        if (clearSelection) setBatch(failed.length ? new Map(failed.map(({ source }) => [source.path, source])) : undefined)
        if (failed.length) {
          const first = failed[0]
          setNotice((failed.length > 1 ? failed.length + ' 项未完成。' : '') + first.source.name + '，' + first.error)
        } else {
          if (operation === 'rename') setRenamingEntry(undefined)
          setPrompt(undefined)
          if (metadataFailed) setNotice('文件操作已完成，部分导图信息未能更新。')
        }
        if (failed.length && operation === 'trash') setPrompt({ type: 'tree-trash', entries: failed.map(change => change.source) })
      } finally { setBusy(false) }
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
      setRecent(await window.desktop.listRecent())
      setRevision(value => value + 1)
      try { relocateMapDocument(saved.path, file.path) }
      catch { setNotice('文件位置已更新，无法更新指向它的主题链接。') }
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
      onCreate={(target, x, y) => setTreeMenu({ kind: 'create', target, x, y })}
      selection={scope === 'library' ? batch : undefined} onSelect={scope === 'library' ? toggleBatch : undefined}
      drag={scope === 'library' && !busy ? treeDrag : undefined} rename={treeRename}
      onMenu={(target, x, y) => {
        if (scope === 'library' && batch) {
          if (!batch.has(target.path)) toggleBatch(target)
          setTreeMenu({ kind: 'batch', x, y })
        } else setTreeMenu({ kind: 'entry', target, x, y, recent: scope === 'local' && target.path === entry.path })
      }}
      onExpand={scope === 'local' ? directory => {
        if (directory.path === entry.path) run(async () => setRecent(await window.desktop.touchRecent(directory.path)))
      } : undefined} />
  }

  if (!library) return <div className="startup">{notice || '正在打开文档库…'}</div>

  const dirty = active && active.saved !== active.text
  const edit = (text: string) => { if (active) sessions.patch(active.path, { text }) }
  const homeHint = (id: AppShortcut) => {
    const key = shortcutValue(preferences.shortcuts, id, platform)
    return key ? <kbd aria-hidden="true">{shortcutLabel(key, platform)}</kbd> : <ChevronRight size={16} />
  }
  const local = recent.filter(entry => entry.path !== library.path && (entry.kind === 'directory' || scopeOf(entry.path) === 'local')).slice(0, preferences.recentLimit)
  const treeRename: TreeRename | undefined = renamingEntry && {
    path: renamingEntry.entry.path, name: renamingEntry.name, busy,
    change: name => setRenamingEntry({ ...renamingEntry, name }),
    save: () => mutateEntries('rename', [renamingEntry.entry], renamingEntry.name),
    cancel: () => setRenamingEntry(undefined),
  }
  const activeScope = active && scopeOf(active.path)
  const treeDrag: TreeDrag = {
    start: entry => { draggingEntry.current = entry },
    end: () => { draggingEntry.current = undefined },
    allowed: target => !!draggingEntry.current && !within(draggingEntry.current, target.path),
    move: target => {
      const source = draggingEntry.current
      draggingEntry.current = undefined
      if (source) mutateEntries('move', [source], undefined, false, target.path)
    },
  }
  const newItems = (directory: Entry): MenuItem[] => [
    { label: 'Markdown 文档', icon: <FilePlus2 size={16} />, run: () => create('markdown', directory) },
    { label: '绘图文件', icon: <Shapes size={16} />, run: () => create('drawing', directory) },
    { label: '文件夹', icon: <FolderInput size={16} />, run: () => createFolder(directory) },
  ]
  const chosen = [...(batch?.values() ?? [])]
  const batchItems: MenuItem[] = [
    { label: '创建副本', icon: <Copy size={16} />, disabled: !chosen.length, run: () => mutateEntries('copy', chosen, undefined, true) },
    { label: '移动到…', icon: <FolderInput size={16} />, disabled: !chosen.length, run: () => mutateEntries('move', chosen, undefined, true) },
    { label: '删除', icon: <Trash2 size={16} />, disabled: !chosen.length, run: () => setPrompt({ type: 'tree-trash', entries: chosen }) },
  ]
  const treeItems: MenuItem[] = treeMenu?.kind === 'batch' ? batchItems : treeMenu?.kind === 'open' ? [
    { label: '打开文件…', icon: <FileText size={16} />, run: openFile },
    { label: '打开文件夹…', icon: <FolderInput size={16} />, run: openDirectory },
  ] : treeMenu?.kind === 'entry' && treeMenu.target ? (() => {
    const { target } = treeMenu
    const items: MenuItem[] = [{ label: '在文件管理器中显示', icon: <LocateFixed size={16} />,
      run: () => run(() => window.desktop.reveal(target.path, target.kind === 'directory')) }]
    if (target.kind === 'directory') items.unshift({ label: '新建', icon: <Plus size={16} />, children: newItems(target) })
    else {
      items.unshift({ label: '打开', run: () => openPath(target.path) })
      items.push({ label: marks.pinned.includes(target.path) ? '取消置顶' : '置顶', icon: <Pin size={16} />, run: () => marks.toggle('pinned', target.path) })
      items.push({ label: marks.starred.includes(target.path) ? '取消收藏' : '收藏', icon: <Star size={16} />, run: () => marks.toggle('starred', target.path) })
    }
    if (scopeOf(target.path) === 'library') {
      items.push({ label: '创建副本', icon: <Copy size={16} />, run: () => mutateEntries('copy', [target]) })
      items.push({ label: '移动到…', icon: <FolderInput size={16} />, run: () => mutateEntries('move', [target]) })
    } else {
      items.unshift({ label: '导入到文档库', icon: <FolderInput size={16} />, run: () => mutateEntries('import', [target]) })
    }
    items.push({ label: '重命名', icon: <Pencil size={16} />, run: () => setRenamingEntry({ entry: target,
      name: target.kind === 'directory' ? target.name : target.name.replace(/\.[^.]+$/, '') }) })
    if (scopeOf(target.path) === 'library') items.push({ label: '删除', icon: <Trash2 size={16} />, separator: true,
      run: () => setPrompt({ type: 'tree-trash', entries: [target] }) })
    if (treeMenu.recent) items.push({ label: '从最近记录移除', separator: true, run: () => run(async () => setRecent(await window.desktop.removeRecent(target.path))) })
    return items
  })() : newItems(treeMenu?.target ?? library)
  const menuAt = (event: MouseEvent<HTMLButtonElement>, kind: 'create' | 'open', target?: Entry) => {
    const anchor = event.currentTarget
    const rect = anchor.getBoundingClientRect()
    setTreeMenu(current => current?.anchor === anchor ? undefined : { kind, target, x: rect.left, y: rect.bottom + 4, anchor })
  }
  const home = () => { flushEditor.current?.(); ++openIntent.current; setSettings(false); sessions.showHome() }
  return <div className="window" data-platform={platform} data-sidebar={sidebar || settings}>
    <header className="titlebar flex items-center">
      <div className="window-controls flex items-center gap-1">
        <IconButton label="切换侧栏" click={() => { if (settings) setSettings(false); else setSidebar(!sidebar) }}><PanelLeft size={17} /></IconButton>
        <IconButton label="主页" click={home}><Home size={17} /></IconButton>
      </div>
      <div className="title-path flex min-w-0 items-center gap-2">
        {settings ? <span>设置</span> : active
          ? <><span className="source-label">{activeScope === 'library' ? '我的文档' : '本机文件'}</span>
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
      {settings ? <Settings initialPage={settingsPage} {...{ preferences, platform, library, windowsAcrylic, macReducesTransparency, version, release, checking }}
        onLibraryChange={changeLibrary} onReturn={() => setSettings(false)}
        onCheckUpdates={() => void checkForUpdates()}
        onOpenRelease={url => run(() => window.desktop.openExternal(url))}
        onOpenDirectory={() => run(() => window.desktop.openLibraryDirectory())}
        onChange={updatePreferences} /> : <>
        {sidebar && <aside className="sidebar">
          <div className="sidebar-scroll">
            <button className="tree-row home-link" onClick={home}><Home size={18} /><span>主页</span></button>
            {markedSection('置顶', marks.pinned, Pin)}
            {markedSection('收藏', marks.starred, Star)}
            <section>
              <div className="section-heading"><h2>我的文档</h2>
                <div className="section-actions">
                  {batch ? <>
                    <button className="icon-button" type="button" aria-label="全选我的文档" title="全选" onClick={() => run(async () => {
                      const entries = await window.desktop.list(library.path)
                      setBatch(current => entries.every(entry => current?.has(entry.path)) ? new Map() : new Map(entries.map(entry => [entry.path, entry])))
                    })}><Check size={15} /></button>
                    <IconButton label="退出批量操作" click={() => setBatch(undefined)}><X size={17} /></IconButton>
                  </> : <>
                    <IconButton label="批量操作" click={() => setBatch(new Map())}><ListChecks size={16} /></IconButton>
                    <button className="icon-button" type="button" aria-label="在我的文档新建" title="新建" aria-haspopup="menu"
                      onClick={event => menuAt(event, 'create', library)}><Plus size={17} /></button>
                  </>}
                </div>
              </div>
              {tree(library, 'library', true)}
            </section>
            <section>
              <div className="section-heading"><h2>本机文件</h2>
                <button className="icon-button" type="button" aria-label="添加本机文件或文件夹" title="打开" aria-haspopup="menu"
                  onClick={event => menuAt(event, 'open')}><Plus size={17} /></button>
              </div>
              {local.length ? local.map(entry => entry.kind === 'directory' ? tree(entry, 'local', false) :
                <FileTreeRow key={entry.path} entry={entry} depth={0} selected={active?.path === entry.path}
                  rename={treeRename?.path === entry.path ? treeRename : undefined}
                  onClick={() => {
                    openPath(entry.path, 'local')
                    run(async () => setRecent(await window.desktop.touchRecent(entry.path)))
                  }} onMenu={(x, y) => setTreeMenu({ kind: 'entry', target: entry, x, y, recent: true })} />)
                : <button className="tree-row subtle" onClick={event => menuAt(event, 'open')}><FileText size={17} /><span>打开本机文件或文件夹…</span></button>}
            </section>
          </div>
          {batch && <div className="tree-batch-actions" aria-label="批量操作">
            <small>{chosen.length} 项</small>
            {batchItems.map(item => <IconButton key={item.label} label={item.label} click={item.run!} disabled={item.disabled || busy}>{item.icon}</IconButton>)}
          </div>}
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
              if (file) { setRecent(await window.desktop.listRecent()); showFile(file) }
            })}>另存副本</button>
          </div>}
          {!active ? <div className="home">
            <h1>我的文档</h1>
            <p>创建文档或打开已有的本机文件。</p>
            <div className="home-actions">
              <button onClick={() => create()}><FilePlus2 size={21} /><span>新建文档</span>{homeHint('new-file')}</button>
              <button onClick={() => create('drawing')}><Shapes size={21} /><span>新建绘图</span>{homeHint('new-drawing')}</button>
              <button onClick={openFile}><FileText size={21} /><span>打开本机文件</span>{homeHint('open-file')}</button>
              <button onClick={importWorkbook} disabled={importing || !library}><FolderInput size={21} /><span>{importing ? '正在导入 Xmind…' : '导入 Xmind'}</span>{homeHint('import-xmind')}</button>
            </div>
          </div> : <Suspense fallback={<div className="startup">正在加载编辑器…</div>}>
            {active.kind === 'drawing'
              ? <DrawingEditor key={active.path + ':' + active.reload} text={active.text} dark={dark} onChange={edit} />
              : active.mode === 'markdown'
                ? <MarkdownEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path} modified={active.modified} platform={platform} remoteImages={preferences.remoteImages} keyOverrides={preferences.shortcuts}
                  outline={preferences.markdownOutline}
                  updateOutline={patch => updatePreferences({ markdownOutline: { ...lastPreferences.current.markdownOutline, ...patch } })}
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
                    const file = await window.desktop.duplicate(active.path, library.path, active.text)
                    setRevision(value => value + 1)
                    showFile(file)
                  })}
                  reveal={() => run(() => window.desktop.reveal(active.path))}
                  saveCopy={() => run(async () => {
                    const file = await window.desktop.saveCopy(active.path, active.text)
                    if (file) { setRecent(await window.desktop.listRecent()); setRevision(value => value + 1); showFile(file) }
                  })} />
                : active.mode === 'outline'
                  ? <OutlineEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path}
                    platform={platform} remoteImages={preferences.remoteImages} sessions={outlineSessions.current} onChange={edit} />
                  : <MindMapEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path} dark={dark} onChange={edit} find={find}
                    platform={platform} keyOverrides={preferences.shortcuts}
                    registerFlush={registerFlush} importWorkbook={importWorkbook} importing={importing}
                    readMapDocument={readMapDocument} followMapDocument={followMapDocument} consumedMapJump={consumedMapJump}
                    entryJump={mapJump?.path === active.path ? mapJump.target : undefined}
                    linkDocuments={sessions.documents.filter(document => document.kind === 'markdown' && document.path !== active.path)} />}
          </Suspense>}
        </main>
      </>}
    </div>
    {!prompt && notice && <div className="notice" role="alert"><CircleAlert size={17} />{notice}<IconButton label="关闭通知" click={() => setNotice('')}><X size={15} /></IconButton></div>}
    {treeMenu && !settings && <MarkdownMenu key={treeMenu.kind + ':' + (treeMenu.target?.path ?? '')}
      items={treeItems} close={() => setTreeMenu(undefined)} point={treeMenu} anchor={treeMenu.anchor} nativeStyle />}
    {searchOpen && <SearchDialog documents={sessions.documents} onOpen={openFromSearch} onClose={() => setSearchOpen(false)} />}
    <dialog ref={modal} onCancel={event => { event.preventDefault(); if (!busy) setPrompt(undefined) }} onClose={() => setNotice('')}>
      {prompt?.type === 'tree-trash' && <div>
        <h2>移到回收站</h2>
        <p>{prompt.entries.length === 1 ? '将「' + prompt.entries[0].name + '」移到系统回收站。' : '将选中的 ' + prompt.entries.length + ' 项移到系统回收站。'}</p>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={() => setPrompt(undefined)} disabled={busy}>取消</button>
          <button className="primary" disabled={busy} onClick={() => mutateEntries('trash', prompt.entries, undefined, !!batch)}>移到回收站</button></footer>
      </div>}
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
              setRecent(await window.desktop.listRecent())
              marks.relocate(saved.path)
              sessions.close(saved.path)
              setRevision(value => value + 1)
              setPrompt(undefined)
              removeMapDocument(saved.path)
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
