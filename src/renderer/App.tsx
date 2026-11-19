import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { AppWindow, ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, CircleAlert, Copy, FilePlus2, FileText, FolderInput, Home, ListChecks, ListTree, Network, PanelLeft, LocateFixed, Minus, Pencil, Pin, Plus, Save, Search, Settings2, Shapes, Square, Star, Trash2, X } from 'lucide-react'
import { defaultPreferences, defaultUpdateProxy, documentFontSizes, windowBlurTint, windowMaterialFor, type Command, type DocumentFile, type EditorMode, type Entry, type FileKind, type JournalDay, type JournalList, type Preferences, type RecoveryEntry, type Scope, type SearchHit, type TreeChange, type TreeMutation, type UpdateProxyInput, type VersionStatus } from '../shared/contracts'
import { documentLinkPath } from './documentLinks'
import { documentModePaths, moveDocumentMode } from './documentModes'
import { RenameInput } from './RenameInput'
import { FileTreeRow, FilesTree, type TreeDrag, type TreeRename } from './FilesTree'
import type { SettingsPage } from './Settings'
import { PaneResize } from './PaneResize'
import { useFileMarks } from './useFileMarks'
import { useDocuments, type Session } from './documents'
import type { OutlineSession } from './editors/outlineEditing'
import type { DocumentViewPosition } from './editors/viewPosition'
import { copyMapAppearance, discardInterruptedMapImports, initializeMapSettings, loadMapAppearance, relocateMapAppearance, saveImportedMap, styledMapPaths } from './editors/mapAppearance'
import { forgetAudio, storeAudio } from './editors/mapAudio'
import { mapDocumentPath, mapDocumentSheets, registerMapDocument, registeredMapPaths, relocateMapDocument, removeMapDocument } from './editors/mapDocumentLinks'
import { findTopic, type TopicLink } from './editors/mapTopicLinks'
import { shortcutLabel, shortcutValue, type AppShortcut } from '../shared/shortcuts'
import { moveOutlineDepth, outlineDepthPaths } from './editors/markdownOutlineDepth'
import { MarkdownMenu, type MenuItem } from './editors/MarkdownMenu'

const Settings = lazy(() => import('./Settings').then(module => ({ default: module.Settings })))
const SearchDialog = lazy(() => import('./SearchDialog').then(module => ({ default: module.SearchDialog })))
const MarkdownEditor = lazy(() => import('./editors/Markdown').then(module => ({ default: module.MarkdownEditor })))
const OutlineEditor = lazy(() => import('./editors/Outline').then(module => ({ default: module.OutlineEditor })))
const MindMapEditor = lazy(() => import('./editors/MindMap'))
const JournalStream = lazy(() => import('./JournalStream'))
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
  | { type: 'close'; path?: string; install?: boolean }
  | { type: 'conflict'; path: string }
  | { type: 'recovery' }
  | { type: 'trash'; session: Session }
  | { type: 'tree-trash'; entries: Entry[] }

export function App() {
  const sessions = useDocuments()
  const marks = useFileMarks()
  const active = sessions.active
  const [library, setLibrary] = useState<Entry>()
  const [journalRoot, setJournalRoot] = useState<Entry>()
  const [journals, setJournals] = useState<JournalList>()
  const [cleaningJournals, setCleaningJournals] = useState(false)
  const [recent, setRecent] = useState<Entry[]>([])
  const [defaultStickerDirectory, setDefaultStickerDirectory] = useState('')
  const [documentHistory, setDocumentHistory] = useState<Entry[]>([])
  const [treeMenu, setTreeMenu] = useState<{ kind: 'create' | 'open' | 'entry' | 'batch'; target?: Entry; x: number; y: number; recent?: boolean; anchor?: HTMLButtonElement }>()
  const [batch, setBatch] = useState<Map<string, Entry>>()
  const [batchScope, setBatchScope] = useState<'library' | 'local'>('library')
  const [revealLocalPath, setRevealLocalPath] = useState<string>()
  const [renamingEntry, setRenamingEntry] = useState<{ entry: Entry; name: string }>()
  const draggingEntry = useRef<{ entry: Entry; reorderable: boolean }>(undefined)
  const [windowsAcrylic, setWindowsAcrylic] = useState(false)
  const [platform, setPlatform] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [preferences, setPreferences] = useState(defaultPreferences)
  const lastPreferences = useRef(preferences)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [macReducesTransparency, setMacReducesTransparency] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [settings, setSettings] = useState(false)
  const [version, setVersion] = useState('')
  const [release, setRelease] = useState<VersionStatus>()
  const [updateProxy, setUpdateProxy] = useState(defaultUpdateProxy)
  const [dismissedUpdate, setDismissedUpdate] = useState<string>()
  const [checking, setChecking] = useState(false)
  const releaseCheckInFlight = useRef(false)
  const updateInstallInFlight = useRef(false)
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('外观')
  const [searchOpen, setSearchOpen] = useState(false)
  const [jump, setJump] = useState<{ path: string; line: number; id: number }>()
  const [mapJump, setMapJump] = useState<{ path: string; target: TopicLink }>()
  const [revision, setRevision] = useState(0)
  const [find, setFind] = useState(0)
  const findHost = useRef<HTMLDivElement>(null)
  const [prompt, setPrompt] = useState<Prompt>()
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([])
  const deferredConflicts = useRef(new Map<string, Session['disk']>())
  const refreshDocuments = useRef<(path?: string) => void>(() => {})
  const autoSaveTimers = useRef(new Map<string, { text: string; version: string; timer: number }>())
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const importPending = useRef(false)
  const [rename, setRename] = useState<{ session: Session; name: string; inDocument?: boolean }>()
  const flushEditor = useRef<(() => void) | undefined>(undefined)
  const outlineSessions = useRef(new Map<string, OutlineSession>())
  const viewPositions = useRef(new Map<string, DocumentViewPosition>())
  const registerFlush = useCallback((flush?: () => void) => { flushEditor.current = flush }, [])
  useEffect(() => window.desktop.onWindowMaximized(setMaximized), [])
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
    run(async () => { await window.desktop.setPreferences(patch) })
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
      setJournalRoot(result.journalRoot)
      setRecent(result.recent)
      setDocumentHistory(result.documentHistory)
      setDefaultStickerDirectory(result.defaultStickerDirectory)
      setWindowsAcrylic(result.windowsAcrylic)
      setMacReducesTransparency(result.macReducesTransparency)
      setPlatform(result.platform)
      setVersion(result.version)
      setUpdateProxy(result.updateProxy)
      if (result.release.update) setRelease(result.release)
      setPreferences(result.preferences)
      lastPreferences.current = result.preferences
      setRecoveries(result.recoveries)
      if (result.recoveries.length) setPrompt({ type: 'recovery' })
      if (result.initialFile) {
        const file = result.initialFile
        showFile(file, isJournalPath(result.journalRoot, file.path, result.platform) ? 'journal' : file.path.startsWith(result.library.path + (result.platform === 'win32' ? '\\' : '/')) ? 'library' : 'local')
      }
    })
    const query = matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => setSystemDark(query.matches)
    const onFocus = () => {
      setRevision(value => value + 1)
      const paths = sessions.latest.current.map(document => document.path)
      void window.desktop.watchDocuments(paths).catch(() => {})
      refreshDocuments.current()
    }
    query.addEventListener('change', onTheme)
    const unsubscribeTransparency = window.desktop.onReducedTransparency(setMacReducesTransparency)
    window.addEventListener('focus', onFocus)
    const unsubscribeUpdate = window.desktop.onUpdateStatus(setRelease)
    const unsubscribeDocuments = window.desktop.onDocumentChanged(path => refreshDocuments.current(path))
    const unsubscribePreferences = window.desktop.onPreferences(next => { lastPreferences.current = next; setPreferences(next) })
    const unsubscribeRecovery = window.desktop.onRecoveryList(setRecoveries)
    const unsubscribeHistory = window.desktop.onDocumentHistory(setDocumentHistory)
    const unsubscribeJournals = window.desktop.onJournalsChanged(setJournals)
    const unsubscribeWorkspace = window.desktop.onWorkspaceChange(next => {
      setLibrary(next.library)
      setRecent(next.recent)
      setRevision(value => value + 1)
    })
    const unsubscribe = window.desktop.onCommand(command => commandRef.current(command))
    return () => {
      unsubscribe()
      unsubscribeTransparency()
      unsubscribeUpdate()
      unsubscribeDocuments()
      unsubscribePreferences()
      unsubscribeRecovery()
      unsubscribeHistory()
      unsubscribeWorkspace()
      unsubscribeJournals()
      query.removeEventListener('change', onTheme)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (!version || !preferences.autoCheckUpdates && !preferences.autoDownloadUpdates) return
    void checkForUpdates(false)
    const interval = window.setInterval(() => void checkForUpdates(false), 6 * 60 * 60_000)
    return () => window.clearInterval(interval)
  }, [version, preferences.autoCheckUpdates, preferences.autoDownloadUpdates])

  useEffect(() => {
    if (preferences.autoDownloadUpdates && release?.update?.canDownload && !release.progress) {
      void window.desktop.downloadUpdate().catch(() => {})
    }
  }, [preferences.autoDownloadUpdates, release?.update?.version, release?.update?.canDownload, release?.progress?.state])

  async function saveUpdateProxy(input: UpdateProxyInput) {
    const saved = await window.desktop.setUpdateProxy(input)
    setUpdateProxy(saved)
    return saved
  }

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.size = preferences.size
    document.documentElement.dataset.windowMaterial = windowMaterialFor(preferences, platform, windowsAcrylic, macReducesTransparency)
    const tint = preferences.windowTransparent ? 1 - preferences.windowTransparency / 100 : windowBlurTint
    document.documentElement.style.setProperty('--window-tint-opacity', String(tint))
    document.documentElement.style.setProperty('--interface-font-size', preferences.interfaceFontSize + 'px')
    document.documentElement.style.setProperty('--document-font-size', preferences.documentFontSize + 'px')
    const family = preferences.interfaceFont
    document.documentElement.style.setProperty('--interface-font', ['system-ui', 'serif', 'monospace'].includes(family) ? family : JSON.stringify(family))
    document.documentElement.dataset.animation = preferences.animations ? 'full' : 'reduced'
    document.documentElement.dataset.documentTheme = preferences.documentTheme
  }, [dark, platform, preferences, windowsAcrylic, macReducesTransparency])

  useEffect(() => {
    if (settings || prompt || searchOpen || active?.kind !== 'markdown' || active.mode === 'map') return
    let distance = 0
    let previousTime = 0
    const resizeText = (event: WheelEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || !event.deltaY ||
          !(event.target instanceof Element) ||
          !event.target.closest('.markdown-surface, .document-outline nav, .outline-content, .journal-preview')) return
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 800 : 1)
      if (event.timeStamp - previousTime > 200 || Math.sign(delta) !== Math.sign(distance)) distance = 0
      previousTime = event.timeStamp
      distance += delta
      const steps = Math.trunc(distance / 100)
      if (!steps) return
      distance -= steps * 100
      const current = lastPreferences.current.documentFontSize
      const size = Math.max(documentFontSizes.min, Math.min(documentFontSizes.max, current - steps))
      if (size !== current) updatePreferences({ documentFontSize: size })
    }
    window.addEventListener('wheel', resizeText, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', resizeText, true)
  }, [active?.kind, active?.mode, settings, prompt, searchOpen])

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

  refreshDocuments.current = path => {
    for (const document of sessions.latest.current) {
      if (path && document.path !== path) continue
      void sessions.refresh(document.path, active?.path === document.path ? () => flushEditor.current?.() : undefined)
        .catch(error => { if (path) setNotice(message(error)) })
    }
  }
  const watchedDocuments = sessions.documents.map(document => document.path).join('\0')
  useEffect(() => {
    void window.desktop.watchDocuments(watchedDocuments ? watchedDocuments.split('\0') : [])
      .then(() => refreshDocuments.current()).catch(() => {})
  }, [watchedDocuments])

  useEffect(() => {
    const timers = autoSaveTimers.current
    for (const [path, pending] of timers) {
      const document = sessions.documents.find(item => item.path === path)
      if (!preferences.autoSave || !document || document.conflict || document.text === document.saved ||
          document.text !== pending.text || document.version !== pending.version) {
        window.clearTimeout(pending.timer)
        timers.delete(path)
      }
    }
    if (!preferences.autoSave) return
    for (const document of sessions.documents) {
      if (document.conflict || document.text === document.saved || timers.has(document.path)) continue
      const timer = window.setTimeout(() => {
        timers.delete(document.path)
        run(() => sessions.save(document.path))
      }, 1000)
      timers.set(document.path, { text: document.text, version: document.version, timer })
    }
  }, [sessions.documents, preferences.autoSave])

  useEffect(() => {
    if (prompt) return
    const conflict = sessions.documents.find(document => document.conflict && document.text !== document.saved &&
      (!deferredConflicts.current.has(document.path) || deferredConflicts.current.get(document.path) !== document.disk))
    if (conflict) setPrompt({ type: 'conflict', path: conflict.path })
  }, [sessions.documents, prompt])

  function dismissPrompt() {
    if (prompt?.type === 'close') void window.desktop.cancelClose()
    if (prompt?.type === 'conflict') deferredConflicts.current.set(prompt.path,
      sessions.latest.current.find(document => document.path === prompt.path)?.disk)
    setPrompt(undefined)
  }

  function within(entry: Entry, path: string) {
    const normalize = (value: string) => platform === 'win32' ? value.toLowerCase() : value
    const source = normalize(entry.path)
    const target = normalize(path)
    return source === target || entry.kind === 'directory' &&
      target.startsWith(source.replace(/[\\/]$/, '') + (platform === 'win32' ? '\\' : '/'))
  }

  function isJournalPath(root: Entry, file: string, system = platform) {
    const name = file.split(/[\\/]/).at(-1)
    if (!name || !/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return false
    const parent = file.slice(0, -name.length - 1)
    return system === 'win32' ? root.path.toLowerCase() === parent.toLowerCase() : root.path === parent
  }

  function scopeOf(path: string): Scope {
    if (journalRoot && isJournalPath(journalRoot, path)) return 'journal'
    return library && within(library, path) ? 'library' : 'local'
  }

  function showFile(file: Parameters<typeof sessions.open>[0], scope = scopeOf(file.path)) {
    if (active?.path !== file.path) flushEditor.current?.()
    if (journalRoot && isJournalPath(journalRoot, file.path)) scope = 'journal'
    const fallback = scope === 'journal' ? 'outline' : file.kind === 'markdown' && loadMapAppearance(file.path).imported ? 'map' : 'markdown'
    sessions.open(file, scope, fallback)
    setSettings(false)
    void window.desktop.recordDocumentOpen(file.path).catch(() => {})
    if (scope === 'local') void window.desktop.touchRecent(file.path).catch(() => {})
  }

  function openJournal(date?: string) {
    const intent = ++openIntent.current
    run(async () => {
      const updated = await window.desktop.listJournals()
      if (intent !== openIntent.current) return
      setJournals(updated)
      const day = date ?? updated.today
      const entry = updated.days.find(item => item.date === day)
      const file = sessions.latest.current.find(session => session.path === entry?.path) ?? await window.desktop.openJournal(day)
      if (intent === openIntent.current) showFile(file, 'journal')
    })
  }

  function cleanJournals() {
    if (cleaningJournals) return
    setCleaningJournals(true)
    run(async () => {
      try {
        const result = await window.desktop.cleanJournals()
        result.removed.forEach(file => moveDocumentMode(file))
        setNotice((result.removed.length ? '已将 ' + result.removed.length + ' 篇空小记移到回收站。' : '没有可清理的空小记。') +
          (result.failed ? ' 有 ' + result.failed + ' 篇未能移到回收站。' : ''))
      } finally { setCleaningJournals(false) }
    })
  }

  function deleteJournal(day: JournalDay) {
    flushEditor.current?.()
    run(async () => {
      if (!await sessions.save(day.path)) throw new Error('小记存在保存冲突，请处理后重试。')
      const session = sessions.latest.current.find(document => document.path === day.path)
      const updated = await window.desktop.deleteJournal(day.date, session?.version)
      updateTreePaths([{ source: { path: day.path, name: day.date + '.md', kind: 'markdown' } }], false)
      setJournals(updated)
      if (active?.path === day.path) {
        const index = journals?.days.findIndex(item => item.path === day.path) ?? 0
        const adjacent = updated.days[Math.max(0, Math.min(index, updated.days.length - 1))]
        if (adjacent) openJournal(adjacent.date)
        else sessions.showHome()
      }
    })
  }

  async function readMapDocument(path: string): Promise<DocumentFile> {
    const file = sessions.latest.current.find(document => document.path === path) ?? await window.desktop.read(path)
    if (file.kind !== 'markdown') throw new Error('请选择 Markdown 文档。')
    return file
  }

  async function followMapDocument(target: TopicLink) {
    const path = target.document && mapDocumentPath(target.document)
    if (!path || scopeOf(path) === 'journal') return false
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
        if (intent === openIntent.current) {
          showFile(file)
          if (scopeOf(file.path) === 'local') {
            setSidebar(true)
            setRevealLocalPath(file.path)
          }
        }
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

  function finishClose(path?: string, install = false) {
    if (install) {
      if (updateInstallInFlight.current) return
      updateInstallInFlight.current = true
      setBusy(true)
      run(async () => {
        try {
          await window.desktop.installUpdate()
          setPrompt(undefined)
        }
        finally { updateInstallInFlight.current = false; setBusy(false) }
      })
      return
    }
    if (path) { outlineSessions.current.delete(path); sessions.close(path) }
    else run(async () => {
      await Promise.all(sessions.latest.current.map(document => sessions.journal(document.path, null)))
      await window.desktop.finishClose()
    })
    setPrompt(undefined)
  }

  function requestClose(path?: string, install = false) {
    if (updateInstallInFlight.current) return
    flushEditor.current?.()
    if (sessions.hasPending(path)) {
      run(async () => { await sessions.waitForPending(path); requestClose(path, install) })
      return
    }
    if (sessions.latest.current.some(document => (!path || document.path === path) && document.saved !== document.text)) {
      setPrompt({ type: 'close', path, install })
    } else finishClose(path, install)
  }

  function saveAndClose(path?: string, install = false) {
    run(async () => {
      setBusy(true)
      try {
        for (const document of sessions.latest.current) {
          if ((!path || path === document.path) && !await sessions.save(document.path)) {
            void window.desktop.cancelClose()
            setPrompt(undefined)
            sessions.open(document, document.scope)
            setSettings(false)
            return
          }
        }
        finishClose(path, install)
      } finally {
        if (!updateInstallInFlight.current) setBusy(false)
      }
    })
  }

  commandRef.current = command => {
    if (command === 'close') {
      if (prompt || searchOpen) { void window.desktop.cancelClose(); return }
      requestClose()
    }
    if (prompt) return
    if (command === 'search') setSearchOpen(value => !value)
    if (searchOpen) return
    if (command === 'open-file') openFile()
    if (command === 'import-xmind') importWorkbook()
    if (command === 'new-file' || command === 'new-drawing') create(command === 'new-drawing' ? 'drawing' : 'markdown')
    if (command === 'preferences') { flushEditor.current?.(); setSettingsPage('外观'); setSettings(value => !value) }
    if (command === 'save' && active) { flushEditor.current?.(); run(() => sessions.save(active.path)) }
    if (command === 'find') {
      if (!settings && active?.kind === 'markdown') setFind(value => value + 1)
      else setSearchOpen(true)
    }
  }

  function create(kind: FileKind = 'markdown', directory = library, inlineRename = false) {
    if (!directory) return
    const intent = ++openIntent.current
    flushEditor.current?.()
    run(async () => {
      const file = await window.desktop.create(directory.path, kind)
      if (file.kind === 'markdown') initializeMapSettings(file.path, lastPreferences.current.mapDefaults)
      setRevision(value => value + 1)
      if (intent === openIntent.current) {
        showFile(file)
        if (inlineRename) startTreeRename(file)
      }
    })
  }

  function createFolder(directory = library, inlineRename = false) {
    if (!directory) return
    run(async () => {
      const folder = await window.desktop.createFolder(directory.path)
      if (inlineRename) startTreeRename(folder)
      setRevision(value => value + 1)
    })
  }

  const entryName = (entry: Entry) => entry.kind === 'directory' ? entry.name : entry.name.replace(/\.[^.]+$/, '')
  function startTreeRename(entry: Entry) {
    setRenamingEntry({ entry, name: entryName(entry) })
  }

  function saveRename(entry: Entry, value: string, cancel: () => void) {
    const name = value.trim()
    if (!name || name === entryName(entry)) cancel()
    else mutateEntries('rename', [entry], name)
  }

  function startBatch(scope: 'library' | 'local') {
    setBatchScope(scope)
    setBatch(new Map())
    if (scope === 'library' && preferences.libraryCollapsed) updatePreferences({ libraryCollapsed: false })
    if (scope === 'local' && preferences.localCollapsed) updatePreferences({ localCollapsed: false })
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
      ...outlineDepthPaths(), ...documentModePaths(), ...sessions.latest.current.map(session => session.path)])
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
        moveOutlineDepth(old, next)
        moveDocumentMode(old, next)
        remapped.set(old, next)
        const outline = outlineSessions.current.get(old)
        outlineSessions.current.delete(old)
        const position = viewPositions.current.get(old)
        viewPositions.current.delete(old)
        if (next) {
          sessions.relocate(old, next, name, scopeOf(next))
          if (outline) outlineSessions.current.set(next, outline)
          if (position) viewPositions.current.set(next, position)
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
          if (operation === 'rename') {
            setRenamingEntry(undefined)
            setRename(undefined)
          }
          setPrompt(undefined)
          if (metadataFailed) setNotice('文件操作已完成，部分导图信息未能更新。')
        }
        if (failed.length && operation === 'trash') setPrompt({ type: 'tree-trash', entries: failed.map(change => change.source) })
      } finally { setBusy(false) }
    })
  }

  function openPath(path: string, scope?: Scope, fromHistory = false) {
    const intent = ++openIntent.current
    run(async () => {
      const existing = sessions.latest.current.find(session => session.path === path)
      const document = existing ?? await (fromHistory ? window.desktop.openHistoryDocument(path) : window.desktop.read(path))
      if (intent !== openIntent.current) return
      if (document) showFile(document, scope)
      else setNotice('这个文档已不在原位置。')
    })
  }

  function followDocumentLink(document: string, href: string) {
    if (/^(https?:|mailto:)/i.test(href)) { run(() => window.desktop.openExternal(href)); return }
    try {
      const linked = documentLinkPath(href, document, platform)
      if (linked) openPath(linked)
      else setNotice('此链接指向不受支持的文件类型。')
    } catch { setNotice('链接无效。') }
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
      moveOutlineDepth(saved.path, file.path)
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

  function documentName(session: Session, inDocument = false) {
    const basename = session.name.replace(/\.[^.]+$/, '')
    const editing = rename?.session.path === session.path && !!rename.inDocument === inDocument
    const start = () => setRename({ session, name: basename, inDocument })
    if (editing) return <RenameInput className="document-rename" label={inDocument ? '文档标题' : '文档名称'}
      name={rename.name} busy={busy} change={name => setRename({ ...rename, name })}
      save={name => saveRename(rename.session, name, () => setRename(undefined))} cancel={() => setRename(undefined)} />
    return <button className="document-name" title={session.path} aria-label={'重命名 ' + (inDocument ? basename : session.name)}
      onDoubleClick={start} onKeyDown={event => {
        if (event.key === 'F2' || event.key === 'Enter') { event.preventDefault(); start() }
      }}>{inDocument ? basename : session.name}</button>
  }

  const filenameTitle = active && active.scope !== 'journal' && preferences.showFilenameTitle
    ? <h1 className="filename-title">{documentName(active, true)}</h1> : undefined

  function tree(entry: Entry, scope: Scope, expanded: boolean) {
    return <FilesTree key={entry.path} directory={entry} active={settings ? undefined : active?.path} {...{ revision, expanded }}
      onOpen={file => openPath(file.path, scope)}
      onCreate={(target, x, y) => setTreeMenu({ kind: 'create', target, x, y })}
      selection={scope === batchScope ? batch : undefined} onSelect={scope === batchScope ? toggleBatch : undefined}
      menuPath={treeMenu?.target?.path}
      expandedPaths={expandedFolders} hiddenPaths={scope === 'local' ? hiddenLocalEntries : undefined}
      onToggle={(folder, open) => run(() => window.desktop.setFolderExpanded(folder.path, open))}
      onDelete={busy ? undefined : target => mutateEntries('trash', [target])}
      onRemove={scope === 'local' ? removeLocalEntry : undefined}
      reorderable={scope === 'local'} drag={!busy ? treeDrag : undefined} rename={treeRename}
      onMenu={(target, x, y) => {
        if (scope === batchScope && batch) {
          if (!batch.has(target.path)) toggleBatch(target)
          setTreeMenu({ kind: 'batch', target, x, y })
        } else setTreeMenu({ kind: 'entry', target, x, y, recent: scope === 'local' && target.path === entry.path })
      }}
      onExpand={scope === 'local' ? directory => {
        void window.desktop.touchRecent(directory.path).catch(() => {})
      } : undefined} />
  }
  function removeLocalEntry(entry: Entry) {
    run(async () => {
      if (recent.some(item => item.path === entry.path)) setRecent(await window.desktop.removeRecent(entry.path))
      else await window.desktop.hideLocalEntry(entry.path)
    })
  }

  useEffect(() => {
    if (!revealLocalPath || !sidebar || settings) return
    const tree = document.getElementById('local-section-files')
    if (!tree) return
    const reveal = () => {
      const row = tree.querySelector<HTMLElement>('[data-tree-path="' + CSS.escape(revealLocalPath) + '"]')
      if (row) {
        row.scrollIntoView({ block: 'nearest' })
        setRevealLocalPath(undefined)
      }
    }
    const observer = new MutationObserver(reveal)
    observer.observe(tree, { childList: true, subtree: true })
    reveal()
    return () => observer.disconnect()
  }, [revealLocalPath, sidebar, settings])

  const viewingJournal = active?.scope === 'journal'
  useEffect(() => {
    if (!viewingJournal) return
    let current = true
    void window.desktop.listJournals().then(value => { if (current) setJournals(value) },
      error => { if (current) setNotice(message(error)) })
    return () => { current = false }
  }, [viewingJournal])

  if (!library) return <div className="startup">{notice || '正在打开文档库…'}</div>

  const dirty = active && active.saved !== active.text
  let position = active && viewPositions.current.get(active.path)
  if (active && !position) viewPositions.current.set(active.path, position = {})
  const edit = (text: string) => { if (active) sessions.patch(active.path, { text }) }
  const homeHint = (id: AppShortcut) => {
    const key = shortcutValue(preferences.shortcuts, id, platform)
    return key ? <kbd aria-hidden="true">{shortcutLabel(key, platform)}</kbd> : <ChevronRight size={16} />
  }
  const attachmentNames = new Set(['assets', preferences.attachmentFolder, ...(preferences.attachmentFolders ?? [])].map(name => name.toLowerCase()))
  const fixedAttachments = [preferences.attachmentDirectory, ...(preferences.attachmentDirectories ?? [])].filter((directory): directory is string => !!directory)
  const local = recent.filter(entry => entry.path !== library.path && (entry.kind === 'directory'
    ? preferences.showAttachmentDirectories || !attachmentNames.has(entry.name.toLowerCase()) &&
      !fixedAttachments.some(directory => platform === 'win32' ? directory.toLowerCase() === entry.path.toLowerCase() : directory === entry.path)
    : scopeOf(entry.path) === 'local')).slice(0, preferences.recentLimit)
  const expandedFolders = new Set(preferences.expandedFolders)
  const hiddenLocalEntries = new Set(preferences.hiddenLocalEntries)
  const treeRename: TreeRename | undefined = renamingEntry && {
    path: renamingEntry.entry.path, name: renamingEntry.name, busy,
    change: name => setRenamingEntry({ ...renamingEntry, name }),
    save: name => saveRename(renamingEntry.entry, name, () => setRenamingEntry(undefined)),
    cancel: () => setRenamingEntry(undefined),
  }
  const activeScope = active && scopeOf(active.path)
  const treeDrag: TreeDrag = {
    start: (entry, reorderable) => { draggingEntry.current = { entry, reorderable } },
    end: () => { draggingEntry.current = undefined },
    allowed: (target, place) => {
      const source = draggingEntry.current
      return !!source && source.entry.path !== target.path && (place === 'inside'
        ? !within(source.entry, target.path) && scopeOf(source.entry.path) === scopeOf(target.path)
        : source.reorderable)
    },
    move: (target, place) => {
      const source = draggingEntry.current
      draggingEntry.current = undefined
      if (!source) return
      if (place === 'inside') mutateEntries('move', [source.entry], undefined, false, target.path)
      else run(async () => setRecent(await window.desktop.reorderRecent(source.entry.path, target.path, place === 'after')))
    },
  }
  const newItems = (directory: Entry): MenuItem[] => [
    { label: 'Markdown 文档', icon: <FilePlus2 size={16} />, run: () => create('markdown', directory, true) },
    { label: '绘图文件', icon: <Shapes size={16} />, run: () => create('drawing', directory, true) },
    { label: '文件夹', icon: <FolderInput size={16} />, run: () => createFolder(directory, true) },
  ]
  const chosen = [...(batch?.values() ?? [])]
  const batchItems: MenuItem[] = [
    { label: '创建副本', icon: <Copy size={16} />, disabled: !chosen.length, run: () => mutateEntries('copy', chosen, undefined, true) },
    { label: '移动到…', icon: <FolderInput size={16} />, disabled: !chosen.length, run: () => mutateEntries('move', chosen, undefined, true) },
    ...(batchScope === 'local' ? [{ label: '移除', icon: <Minus size={16} />, disabled: !chosen.length, run: () => run(async () => {
      setRecent(await window.desktop.removeRecentEntries(chosen.map(entry => entry.path)))
      setBatch(new Map())
    }) }] : []),
    { label: '删除', icon: <Trash2 size={16} />, disabled: !chosen.length, run: () => setPrompt({ type: 'tree-trash', entries: chosen }) },
  ]
  const treeItems: MenuItem[] = treeMenu?.kind === 'batch' ? batchItems : treeMenu?.kind === 'open' ? [
    { label: '新建窗口', icon: <AppWindow size={16} />, run: () => run(() => window.desktop.newWindow()) },
    { label: '打开文件…', icon: <FileText size={16} />, run: openFile },
    { label: '打开文件夹…', icon: <FolderInput size={16} />, run: openDirectory },
  ] : treeMenu?.kind === 'entry' && treeMenu.target ? (() => {
    const { target } = treeMenu
    const items: MenuItem[] = [{ label: '在文件管理器中显示', icon: <LocateFixed size={16} />,
      run: () => run(() => window.desktop.reveal(target.path, target.kind === 'directory')) }]
    if (target.kind === 'directory') items.unshift({ label: '新建', icon: <Plus size={16} />, children: newItems(target) })
    else {
      items.unshift({ label: '在新窗口打开', icon: <AppWindow size={16} />, run: () => run(() => window.desktop.newWindow(target.path)) })
      items.push({ label: marks.pinned.includes(target.path) ? '取消置顶' : '置顶', icon: <Pin size={16} />, run: () => marks.toggle('pinned', target.path) })
      items.push({ label: marks.starred.includes(target.path) ? '取消收藏' : '收藏', icon: <Star size={16} />, run: () => marks.toggle('starred', target.path) })
    }
    if (scopeOf(target.path) === 'library') {
      items.push({ label: '创建副本', icon: <Copy size={16} />, run: () => mutateEntries('copy', [target]) })
      items.push({ label: '移动到…', icon: <FolderInput size={16} />, run: () => mutateEntries('move', [target]) })
    } else {
      items.unshift({ label: '导入到我的文档', icon: <FolderInput size={16} />, run: () => mutateEntries('import', [target]) })
    }
    items.push({ label: '重命名', icon: <Pencil size={16} />, run: () => startTreeRename(target) })
    if (scopeOf(target.path) === 'library') items.push({ label: '删除', icon: <Trash2 size={16} />, separator: true,
      run: () => setPrompt({ type: 'tree-trash', entries: [target] }) })
    if (treeMenu.recent) items.push({ label: '从最近记录移除', icon: <Minus size={16} />, separator: true, run: () => removeLocalEntry(target) })
    return items
  })() : newItems(treeMenu?.target ?? library)
  const menuAt = (event: MouseEvent<HTMLButtonElement>, kind: 'create' | 'open', target?: Entry) => {
    const anchor = event.currentTarget
    const rect = anchor.getBoundingClientRect()
    setTreeMenu(current => current?.anchor === anchor ? undefined : { kind, target, x: rect.left, y: rect.bottom + 4, anchor })
  }
  const home = () => { flushEditor.current?.(); ++openIntent.current; setSettings(false); sessions.showHome() }
  const saveStatus = active && <button type="button" className="tool-button save-status" aria-label={dirty ? '保存' : '已保存'}
    disabled={!dirty && active.mode !== 'map'} onClick={() => commandRef.current('save')}>
    {dirty ? <Save size={14} /> : <Check size={14} />}{dirty ? '未保存' : '已保存'}
  </button>

  const documentEditor = active && <Suspense fallback={<div className="startup">正在加载编辑器…</div>}>
      {active.kind === 'drawing'
        ? <DrawingEditor key={active.path + ':' + active.reload} text={active.text} dark={dark} onChange={edit}
          backup={() => run(async () => {
            if (await window.desktop.saveCopy(active.path, active.text)) setNotice('已保存原文件副本。')
          })}
          reveal={() => run(() => window.desktop.reveal(active.path))} />
        : active.mode === 'markdown'
          ? <MarkdownEditor key={active.path} reload={active.reload} text={active.text} name={active.name} path={active.path} modified={active.modified} platform={platform} remoteImages={preferences.remoteImages} keyOverrides={preferences.shortcuts} position={position!}
            fontSize={preferences.documentFontSize}
            outline={preferences.markdownOutline} filenameTitle={filenameTitle} saveStatus={saveStatus}
            width={preferences.markdownPageWidth} codeBlocks={preferences.codeBlocks} setWidth={markdownPageWidth => updatePreferences({ markdownPageWidth })}
            updateOutline={patch => updatePreferences({ markdownOutline: { ...lastPreferences.current.markdownOutline, ...patch } })}
            searchEngine={preferences.searchEngine} registerFlush={registerFlush}
            find={find} findHost={findHost} jump={jump?.path === active.path ? jump : undefined} onChange={edit}
            report={error => setNotice(message(error))}
            followLink={href => followDocumentLink(active.path, href)}
            pinned={marks.pinned.includes(active.path)} starred={marks.starred.includes(active.path)}
            togglePin={() => marks.toggle('pinned', active.path)} toggleStar={() => marks.toggle('starred', active.path)}
            move={viewingJournal ? undefined : () => moveFile(active)}
            trash={viewingJournal ? undefined : () => setPrompt({ type: 'trash', session: active })}
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
            ? <OutlineEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path} position={position!}
              find={find} findHost={findHost}
              filenameTitle={filenameTitle} platform={platform} followLink={href => followDocumentLink(active.path, href)} remoteImages={preferences.remoteImages} sessions={outlineSessions.current} onChange={edit}
              width={preferences.outlinePageWidth} embedded={viewingJournal}
              codeOptions={{ lineNumbers: preferences.outlineCodeLineNumbers, wrap: preferences.codeBlocks.wrap }}
              editRemainderLine={line => {
                setJump({ path: active.path, line, id: Date.now() })
                sessions.setMode(active.path, 'markdown')
              }}
              setWidth={outlinePageWidth => updatePreferences({ outlinePageWidth })}
              remainderVisible={preferences.outlineRemainderVisible} setRemainderVisible={outlineRemainderVisible => updatePreferences({ outlineRemainderVisible })} />
            : <MindMapEditor key={active.path + ':' + active.reload} text={active.text} name={active.name} path={active.path} dark={dark} onChange={edit} find={find} position={position!}
              overviewPreferences={preferences.mapOverview} panelWidth={preferences.mapPanelWidth}
              resizePanel={mapPanelWidth => updatePreferences({ mapPanelWidth })}
              rememberSettings={patch => updatePreferences({ mapDefaults: { ...lastPreferences.current.mapDefaults, ...patch } })}
              stickerDirectory={preferences.stickerDirectory}
              platform={platform} keyOverrides={preferences.shortcuts} remoteImages={preferences.remoteImages}
              remainderVisible={preferences.mapRemainderVisible} setRemainderVisible={mapRemainderVisible => updatePreferences({ mapRemainderVisible })}
              registerFlush={registerFlush} importWorkbook={importWorkbook} importing={importing}
              readMapDocument={readMapDocument} followMapDocument={followMapDocument} consumedMapJump={consumedMapJump}
              entryJump={mapJump?.path === active.path ? mapJump.target : undefined}
              linkDocuments={sessions.documents.filter(document => document.kind === 'markdown' && document.path !== active.path)} />}
    </Suspense>

  return <div className="window" data-platform={platform} data-sidebar={sidebar || settings}
    style={{ '--sidebar-user-width': preferences.sidebarWidth === undefined ? undefined : preferences.sidebarWidth + 'px' } as CSSProperties}>
    <header className="titlebar flex items-center">
      <div className="window-controls flex items-center gap-1">
        <IconButton label="切换侧栏" click={() => { if (settings) setSettings(false); else setSidebar(!sidebar) }}><PanelLeft size={17} /></IconButton>
        <IconButton label="主页" click={home}><Home size={17} /></IconButton>
        {!sidebar && !settings && <IconButton label="每日小记" click={() => openJournal()}><CalendarDays size={17} /></IconButton>}
      </div>
      <div className="titlebar-content">
        <div className="title-path flex min-w-0 items-center gap-2">
          {settings ? <span>设置</span> : active
            ? <><span className="source-label">{activeScope === 'journal' ? '每日小记' : activeScope === 'library' ? '我的文档' : '本机文件'}</span>
              <ChevronRight size={14} />
              {viewingJournal ? <strong>{active.name.replace(/\.md$/, '')}</strong> : documentName(active)}
              {dirty && <span className="unsaved-dot" title="未保存" />}</>
            : <strong>Ymd</strong>}
        </div>
        <div className="document-find-anchor"><div className="document-find-host" ref={findHost} /></div>
        {!settings && active?.kind === 'markdown' && <div className="segments mode-switch" aria-label="编辑模式">
          {modes.filter(item => !viewingJournal || item.value !== 'map').map(({ value, label, icon: Icon }) => <button key={value} type="button" title={label} aria-label={label}
            aria-pressed={active.mode === value} onClick={() => { flushEditor.current?.(); sessions.setMode(active.path, value as EditorMode) }}>
            <Icon size={14} /><span>{label}</span></button>)}
        </div>}
        <div className="title-actions ml-auto flex items-center gap-1">
          {!settings && <>
            {active && <IconButton label="在文件管理器中显示" click={() => run(() => window.desktop.reveal(active.path))}><LocateFixed size={18} /></IconButton>}
            <IconButton label="搜索文档" click={() => commandRef.current('search')}><Search size={18} /></IconButton>
          </>}
          {platform === 'win32' && <div className="window-caption" role="group" aria-label="窗口操作">
            <IconButton label="最小化窗口" click={() => run(() => window.desktop.windowAction('minimize'))}><Minus size={18} /></IconButton>
            <IconButton label={maximized ? '还原窗口' : '最大化窗口'} click={() => run(() => window.desktop.windowAction('maximize'))}>
              {maximized ? <Copy size={18} /> : <Square size={18} />}
            </IconButton>
            <IconButton label="关闭窗口" click={() => run(() => window.desktop.windowAction('close'))}><X size={18} /></IconButton>
          </div>}
        </div>
      </div>
    </header>
    <div className="window-body">
      {settings ? <Suspense fallback={<div className="startup">正在加载设置…</div>}><Settings initialPage={settingsPage} {...{ preferences, platform, library, windowsAcrylic, macReducesTransparency, version, release, checking }}
        defaultStickerDirectory={defaultStickerDirectory}
        onStorageChange={(kind, reset) => run(() => window.desktop.changeStorageDirectory(kind, reset))}
        onOpenStorage={kind => run(() => window.desktop.openStorageDirectory(kind))}
        onLibraryChange={changeLibrary} onReturn={() => setSettings(false)}
        onCheckUpdates={() => void checkForUpdates()} onDownloadUpdate={() => run(() => window.desktop.downloadUpdate())}
        onInstallUpdate={() => requestClose(undefined, true)} updateProxy={updateProxy} onSaveUpdateProxy={saveUpdateProxy}
        onOpenRelease={url => run(() => window.desktop.openExternal(url))}
        onOpenDirectory={() => run(() => window.desktop.openLibraryDirectory())}
        onChange={updatePreferences} /></Suspense> : <>
        {sidebar && <aside className="sidebar">
          <div className="sidebar-scroll">
            <button className="tree-row journal-nav" type="button" data-selected={viewingJournal} onClick={() => openJournal()}>
              <CalendarDays size={17} /><span>每日小记</span>
            </button>
            {markedSection('置顶', marks.pinned, Pin)}
            {markedSection('收藏', marks.starred, Star)}
            <section>
              <div className="section-heading"><h2><button type="button" className="section-toggle" aria-expanded={!preferences.libraryCollapsed} aria-controls="library-section-files"
                onClick={() => updatePreferences({ libraryCollapsed: !preferences.libraryCollapsed })}>
                {preferences.libraryCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}我的文档</button></h2>
                <div className="section-actions">
                  {batch && batchScope === 'library' ? <>
                    <button className="icon-button" type="button" aria-label="全选我的文档" title="全选" onClick={() => run(async () => {
                      const entries = await window.desktop.list(library.path)
                      setBatch(current => entries.every(entry => current?.has(entry.path)) ? new Map() : new Map(entries.map(entry => [entry.path, entry])))
                    })}><Check size={15} /></button>
                    <IconButton label="退出批量操作" click={() => setBatch(undefined)}><X size={17} /></IconButton>
                  </> : <>
                    <IconButton label="批量操作" click={() => startBatch('library')}><ListChecks size={16} /></IconButton>
                    <button className="icon-button" type="button" aria-label="在我的文档新建" title="新建" aria-haspopup="menu"
                      onClick={event => menuAt(event, 'create', library)}><Plus size={17} /></button>
                  </>}
                </div>
              </div>
              <div id="library-section-files">{!preferences.libraryCollapsed && tree(library, 'library', true)}</div>
            </section>
            <section>
              <div className="section-heading"><h2><button type="button" className="section-toggle" aria-expanded={!preferences.localCollapsed} aria-controls="local-section-files"
                onClick={() => updatePreferences({ localCollapsed: !preferences.localCollapsed })}>
                {preferences.localCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}本机文件</button></h2>
                <div className="section-actions">
                {batch && batchScope === 'local' ? <>
                  <IconButton label="全选本机文件" click={() => setBatch(current => local.every(entry => current?.has(entry.path))
                    ? new Map() : new Map(local.map(entry => [entry.path, entry])))}><Check size={15} /></IconButton>
                  <IconButton label="退出本机文件批量操作" click={() => setBatch(undefined)}><X size={17} /></IconButton>
                </> : <IconButton label="本机文件批量操作" click={() => startBatch('local')} disabled={!local.length}><ListChecks size={16} /></IconButton>}
                <button className="icon-button" type="button" aria-label="添加本机文件或文件夹" title="打开" aria-haspopup="menu"
                  onClick={event => menuAt(event, 'open')}><Plus size={17} /></button>
                </div>
              </div>
              <div id="local-section-files">{!preferences.localCollapsed && (local.length ? local.map(entry => entry.kind === 'directory' ? tree(entry, 'local', false) :
                <FileTreeRow key={entry.path} entry={entry} depth={0} selected={active?.path === entry.path} menuOpen={treeMenu?.target?.path === entry.path}
                  checked={batchScope === 'local' ? batch?.has(entry.path) : undefined} onCheck={() => toggleBatch(entry)}
                  rename={treeRename?.path === entry.path ? treeRename : undefined}
                  reorderable drag={!busy && !(batch && batchScope === 'local') ? treeDrag : undefined} onRemove={() => removeLocalEntry(entry)}
                  onDelete={busy ? undefined : () => mutateEntries('trash', [entry])}
                  onClick={() => batch && batchScope === 'local' ? toggleBatch(entry) : openPath(entry.path, 'local')}
                  onMenu={(x, y) => {
                    if (batch && batchScope === 'local') {
                      if (!batch.has(entry.path)) toggleBatch(entry)
                      setTreeMenu({ kind: 'batch', target: entry, x, y })
                    } else setTreeMenu({ kind: 'entry', target: entry, x, y, recent: true })
                  }} />)
                : <button className="tree-row subtle" onClick={event => menuAt(event, 'open')}><FileText size={17} /><span>打开本机文件或文件夹…</span></button>)}</div>
            </section>
          </div>
          {batch && <div className="tree-batch-actions" aria-label="批量操作">
            <small>{chosen.length} 项</small>
            {batchItems.map(item => <IconButton key={item.label} label={item.label} click={item.run!} disabled={item.disabled || busy}>{item.icon}</IconButton>)}
          </div>}
          {release?.update && <button className="tree-row" onClick={() => { setSettingsPage('应用更新'); setSettings(true) }}>
            <CircleAlert size={16} /><span>可更新至 {release.update.version}</span>
          </button>}
          <button className="tree-row sidebar-footer" onClick={() => commandRef.current('preferences')}><Settings2 size={18} /><span>设置</span></button>
          <PaneResize pane="sidebar" side="left" apply={sidebarWidth => updatePreferences({ sidebarWidth })} />
        </aside>}
        <main className="workspace">
          {active?.conflict && <div className="alert"><CircleAlert size={17} /><span>磁盘上的文件已变化。草稿仍在编辑器中。</span>
            <button onClick={() => setPrompt({ type: 'conflict', path: active.path })}>处理冲突</button>
            <button onClick={() => run(async () => {
              const file = await window.desktop.saveCopy(active.path, active.text)
              if (file) { setRecent(await window.desktop.listRecent()); showFile(file) }
            })}>另存副本</button>
          </div>}
          {!active ? <div className="home-screen"><div className="home">
            <h1>我的文档</h1>
            <p>创建文档或打开已有的本机文件。</p>
            {recoveries.length > 0 && <button className="tool-button" onClick={() => setPrompt({ type: 'recovery' })}>恢复未保存的文档</button>}
            <div className="home-actions">
              <button onClick={() => create()}><FilePlus2 size={21} /><span>新建文档</span>{homeHint('new-file')}</button>
              <button onClick={() => create('drawing')}><Shapes size={21} /><span>新建绘图</span>{homeHint('new-drawing')}</button>
              <button onClick={openFile}><FileText size={21} /><span>打开本机文件</span>{homeHint('open-file')}</button>
              <button onClick={importWorkbook} disabled={importing || !library}><FolderInput size={21} /><span>{importing ? '正在导入 Xmind…' : '导入 Xmind'}</span>{homeHint('import-xmind')}</button>
            </div>
            <section className="home-recent" aria-labelledby="home-recent-title">
              <h2 id="home-recent-title">最近打开</h2>
              {documentHistory.length ? <ul>
                {documentHistory.map(entry => {
                  const Icon = entry.kind === 'drawing' ? Shapes : FileText
                  const parent = entry.path.slice(0, -entry.name.length).replace(/[\\/]$/, '')
                  const location = scopeOf(entry.path) === 'journal' ? '每日小记' : scopeOf(entry.path) === 'library' ? '我的文档' + parent.slice(library.path.length) : parent
                  return <li key={entry.path}><button type="button" className="tree-row" title={entry.path}
                    onClick={() => openPath(entry.path, undefined, true)}>
                    <Icon size={17} aria-hidden="true" /><span><strong>{entry.name}</strong><small>{location}</small></span>
                  </button></li>
                })}
              </ul> : <p>还没有最近打开的文档。</p>}
            </section>
          </div></div> : viewingJournal ? <Suspense fallback={<div className="startup">正在加载小记…</div>}>
            <JournalStream list={journals} active={active.path} open={openJournal} clean={cleanJournals} cleaning={cleaningJournals} remove={deleteJournal}
              width={active.mode === 'outline' ? preferences.outlinePageWidth : preferences.markdownPageWidth}
              setWidth={width => updatePreferences(active.mode === 'outline' ? { outlinePageWidth: width } : { markdownPageWidth: width })}
              drafts={new Map(sessions.documents.map(document => [document.path, document.text]))}
              remoteImages={preferences.remoteImages} followLink={followDocumentLink}>{documentEditor}</JournalStream>
          </Suspense> : documentEditor}
          {active && (active.kind === 'drawing' || active.mode !== 'markdown') && <footer className="document-status">{saveStatus}</footer>}
        </main>
      </>}
    </div>
    {!prompt && notice && <div className="notice" role="alert"><CircleAlert size={17} />{notice}<IconButton label="关闭通知" click={() => setNotice('')}><X size={15} /></IconButton></div>}
    {!settings && !prompt && !notice && release?.progress?.state === 'ready' && release.update &&
      dismissedUpdate !== release.update.version && <div className="notice" role="status">
        <span>{'Ymd ' + release.update.version + ' 已下载'}</span>
        <button className="tool-button" onClick={() => requestClose(undefined, true)}>重启并安装</button>
        <IconButton label="忽略更新通知" click={() => setDismissedUpdate(release.update!.version)}><X size={15} /></IconButton>
      </div>}
    {treeMenu && !settings && <MarkdownMenu key={treeMenu.kind + ':' + (treeMenu.target?.path ?? '')}
      items={treeItems} close={() => setTreeMenu(undefined)} point={treeMenu} anchor={treeMenu.anchor} nativeStyle />}
    {searchOpen && <Suspense fallback={null}><SearchDialog documents={sessions.documents} onOpen={openFromSearch} onClose={() => setSearchOpen(false)} /></Suspense>}
    <dialog ref={modal} onCancel={event => { event.preventDefault(); if (!busy) dismissPrompt() }} onClose={() => setNotice('')}>
      {prompt?.type === 'tree-trash' && <div>
        <h2>移到回收站</h2>
        <p>{prompt.entries.length === 1 ? '将「' + prompt.entries[0].name + '」移到系统回收站。' : '将选中的 ' + prompt.entries.length + ' 项移到系统回收站。'}</p>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={() => setPrompt(undefined)} disabled={busy}>取消</button>
          <button className="primary" disabled={busy} onClick={() => mutateEntries('trash', prompt.entries, undefined, !!batch)}>移到回收站</button></footer>
      </div>}
      {prompt?.type === 'close' && <div>
        <h2>保留更改</h2><p>{prompt.install ? '重启安装前是否保存未保存的文档？' : '还有未保存的文档。关闭前需要保存吗？'}</p>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button onClick={dismissPrompt} disabled={busy}>取消</button><button onClick={() => finishClose(prompt.path, prompt.install)} disabled={busy}>舍弃</button>
          <button className="primary" onClick={() => saveAndClose(prompt.path, prompt.install)} disabled={busy}>保存</button></footer>
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
      {prompt?.type === 'conflict' && (() => {
        const document = sessions.documents.find(item => item.path === prompt.path)
        if (!document) return null
        return <div>
          <h2>文件内容冲突</h2>
          <p>「{document.name}」{document.disk === null ? '已从磁盘移除' : '有外部更改'}。请选择要保留的版本。</p>
          {notice && <p className="form-error" role="alert">{notice}</p>}
          <footer>
            <button disabled={busy} onClick={dismissPrompt}>稍后处理</button>
            <button className="conflict-load" disabled={busy || !document.disk} onClick={() => run(async () => {
              setBusy(true)
              try {
                if (await sessions.reload(document.path)) setPrompt(undefined)
                else { await sessions.refresh(document.path); setNotice('磁盘文件已移除。') }
              } finally { setBusy(false) }
            })}>加载磁盘版本</button>
            <button className="conflict-overwrite" disabled={busy || document.disk === undefined} onClick={() => run(async () => {
              setBusy(true)
              try {
                const ok = await sessions.save(document.path, { version: document.disk?.version ?? null })
                if (ok) setPrompt(undefined)
                else setNotice('磁盘版本再次变更，请重新确认。')
              } finally { setBusy(false) }
            })}>用当前内容覆盖</button>
          </footer>
        </div>
      })()}
      {prompt?.type === 'recovery' && <div>
        <h2>恢复未保存的文档</h2>
        {recoveries.map(entry => <div className="recovery-row" key={entry.id}>
          <span title={entry.path}>{entry.path.split(/[\\/]/).at(-1)}</span>
          <button className="tool-button" disabled={busy} onClick={() => run(async () => {
            setBusy(true)
            try {
              if (sessions.latest.current.some(document => document.path === entry.path && document.saved !== document.text)) {
                setNotice('请先保存当前窗口里同名文档的更改。')
                return
              }
              const restored = await window.desktop.restoreDraft(entry.id)
              if (restored) {
                showFile(restored.file)
                await sessions.restore(restored.file, restored.draft, restored.missing, scopeOf(restored.file.path))
                await window.desktop.discardDraft(entry.id)
                setPrompt(undefined)
              }
            } finally { setBusy(false) }
          })}>恢复</button>
          <button className="tool-button" disabled={busy} onClick={() => run(async () => {
            await window.desktop.discardDraft(entry.id)
            if (recoveries.length === 1) setPrompt(undefined)
          })}>丢弃</button>
        </div>)}
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <footer><button disabled={busy} onClick={dismissPrompt}>稍后处理</button></footer>
      </div>}
    </dialog>
  </div>
}
