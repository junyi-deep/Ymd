import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, screen, session, shell } from 'electron'
import type { IpcMainInvokeEvent, WebContents, MediaAccessPermissionRequest, MenuItemConstructorOptions } from 'electron'
import { mkdir, readdir, readFile, writeFile, rename, open } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultPreferences, documentHistoryLimit, mapExportExtensions, markdownImageExtensions, paneWidths, searchEngines, windowMaterialFor } from '../shared/contracts'
import type { Command, ContextMenuItem, Desktop, DocumentFile, Entry, FileKind, MapExportKind, MapShotRect, MarkdownImageUpload, Preferences, TreeChange, TreeMutation } from '../shared/contracts'
import { Files, containsPath, fileKind } from './files'
import { LocalMapLocations } from './localMapLocations'
import { searchRoots } from './search'
import { printView } from './printing'
import { registerPitchWindow } from './pitchWindow'
import { DocumentWatcher } from './documentWatcher'
import { Recovery } from './recovery'
import { Releases } from './releases'
import { appShortcuts, inputChord, isShortcutAccelerator, readShortcutOverrides, shortcutAccelerator, shortcutMenuLabel, ShortcutSequence, shortcutsFor, shortcutValue,
  type AppShortcut } from '../shared/shortcuts'

const files = new Files()
const dev = !app.isPackaged && process.argv.includes('--dev')
const rendererRoot = path.join(__dirname, '../renderer')
const rendererUrl = dev ? 'http://127.0.0.1:5173/' : 'ymd://app/'
protocol.registerSchemesAsPrivileged([{ scheme: 'ymd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
type EditorWindow = {
  window: BrowserWindow; initialFile?: DocumentFile; closing: boolean; search?: AbortController
  recording: boolean; keys: ShortcutSequence; documents: Set<string>; watchRevision: number
  draftRevisions: Map<string, symbol>
  resolveClose?: (closed: boolean) => void
}
const editors = new Map<number, EditorWindow>()
let lastEditor: EditorWindow | undefined
let quitAllowed = false
let quitPending = false
let windowSize = { width: 1220, height: 800 }
let sizeFile: string | undefined
let sizeTimer: NodeJS.Timeout | undefined
let recovery: Recovery
const documentsWatcher = new DocumentWatcher((id, file) => editors.get(id)?.window.webContents.send('ymd:documentChanged', file))
let preferences = defaultPreferences
const windowsAcrylic = process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2]) >= 22621
const macVibrancy = 'hud'
let preferenceWrite: Promise<unknown> = Promise.resolve()
let appBindings = shortcutsFor('app', preferences.shortcuts, process.platform)

function normalizePreferences(value: Partial<Preferences> | null): Preferences {
  const transparency = value?.windowTransparency
  const width = (raw: unknown, { min, max }: { min: number; max: number }) =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : undefined
  return {
    theme: value?.theme === 'dark' || value?.theme === 'light' ? value.theme : 'system',
    size: value?.size === 'small' || value?.size === 'large' ? value.size : 'normal',
    solidBackground: value?.solidBackground === true,
    windowTransparency: typeof transparency === 'number' && Number.isFinite(transparency)
      ? Math.min(100, Math.max(0, Math.round(transparency / 5) * 5)) : defaultPreferences.windowTransparency,
    libraryDirectory: typeof value?.libraryDirectory === 'string' && path.isAbsolute(value.libraryDirectory) ? value.libraryDirectory : undefined,
    recentLimit: typeof value?.recentLimit === 'number' && Number.isFinite(value.recentLimit)
      ? Math.min(100, Math.max(1, Math.round(value.recentLimit))) : defaultPreferences.recentLimit,
    markdownOutline: {
      width: width(value?.markdownOutline?.width, paneWidths.outline),
      position: value?.markdownOutline?.position === 'left' ? 'left' : 'right',
      numbering: value?.markdownOutline?.numbering === 'flat' || value?.markdownOutline?.numbering === 'hierarchical'
        ? value.markdownOutline.numbering : 'none',
      visible: value?.markdownOutline?.visible === true,
    },
    sidebarWidth: width(value?.sidebarWidth, paneWidths.sidebar),
    markdownPageWidth: value?.markdownPageWidth === 'narrow' || value?.markdownPageWidth === 'wide' ? value.markdownPageWidth : 'normal',
    outlinePageWidth: value?.outlinePageWidth === 'narrow' || value?.outlinePageWidth === 'wide' ? value.outlinePageWidth : 'normal',
    outlineRemainderVisible: value?.outlineRemainderVisible !== false,
    mapRemainderVisible: value?.mapRemainderVisible !== false,
    codeBlocks: { lineNumbers: value?.codeBlocks?.lineNumbers === true, wrap: value?.codeBlocks?.wrap === true },
    animations: value?.animations !== false,
    documentTheme: value?.documentTheme === 'paper' || value?.documentTheme === 'mono' ? value.documentTheme : 'classic',
    autoSave: value?.autoSave !== false,
    remoteImages: value?.remoteImages === true,
    autoCheckUpdates: value?.autoCheckUpdates === true,
    autoDownloadUpdates: value?.autoDownloadUpdates === true,
    searchEngine: value?.searchEngine && Object.hasOwn(searchEngines, value.searchEngine) ? value.searchEngine : 'google',
    shortcuts: readShortcutOverrides(value?.shortcuts, process.platform),
  }
}

const macReducesTransparency = () => process.platform === 'darwin' && nativeTheme.prefersReducedTransparency
const windowMaterial = (value = preferences) => windowMaterialFor(value, process.platform, windowsAcrylic, macReducesTransparency())
const windowColor = () => nativeTheme.shouldUseDarkColors ? '#222323' : '#fdfdfd'
const overlayColors = () => ({ color: windowColor(), symbolColor: nativeTheme.shouldUseDarkColors ? '#ededee' : '#222528' })

function editorFor(contents?: WebContents | null) {
  if (!contents) return
  const owner = BrowserWindow.fromWebContents(contents)
  return owner && editors.get(owner.id) || undefined
}

function broadcast(channel: string, value: unknown) {
  for (const editor of editors.values()) {
    if (!editor.window.webContents.isDestroyed()) editor.window.webContents.send(channel, value)
  }
}

function applyBackground(target?: BrowserWindow) {
  nativeTheme.themeSource = preferences.theme
  const material = windowMaterial()
  for (const window of target ? [target] : [...editors.values()].map(editor => editor.window)) {
    if (process.platform === 'darwin') window.setVibrancy(material === 'vibrancy' ? macVibrancy : null)
    if (windowsAcrylic) {
      window.setBackgroundMaterial(material === 'acrylic' ? 'acrylic' : 'none')
      window.setTitleBarOverlay(overlayColors())
    }
    window.setBackgroundColor(material === 'solid' ? windowColor() : '#00000000')
    if (process.platform === 'darwin') window.webContents.send('ymd:reducedTransparency', macReducesTransparency())
  }
}

function command(name: Command, editor = editorFor(BrowserWindow.getFocusedWindow()?.webContents) ?? lastEditor) {
  if (editor && !editor.window.webContents.isDestroyed()) editor.window.webContents.send('ymd:command', name)
}

function setShortcutRecording(editor: EditorWindow, active: boolean) {
  editor.recording = active
  editor.keys.reset()
  editor.window.webContents.setIgnoreMenuShortcuts(active)
}

function flushWindowSize() {
  if (!sizeTimer || !sizeFile) return
  clearTimeout(sizeTimer)
  sizeTimer = undefined
  try {
    writeFileSync(sizeFile + '.tmp', JSON.stringify(windowSize), { flush: true })
    renameSync(sizeFile + '.tmp', sizeFile)
  } catch {}
}

async function closeEditors(except?: EditorWindow) {
  for (const editor of [...editors.values()]) {
    if (editor === except || editor.window.isDestroyed()) continue
    const closed = await new Promise<boolean>(resolve => {
      editor.resolveClose = resolve
      editor.window.show()
      editor.window.focus()
      editor.window.close()
    })
    if (!closed) return false
  }
  return true
}

function installMenu() {
  appBindings = shortcutsFor('app', preferences.shortcuts, process.platform)
  for (const editor of editors.values()) editor.keys.reset()
  const entry = (id: AppShortcut): MenuItemConstructorOptions => {
    const value = shortcutValue(preferences.shortcuts, id, process.platform)
    return { label: shortcutMenuLabel(appShortcuts[id].label, value, process.platform), accelerator: shortcutAccelerator(value), click: () => command(id) }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { label: '文件', submenu: [{ label: '新建窗口', click: () => createWindow() }, entry('new-file'), entry('open-file'), entry('import-xmind'), entry('new-drawing'), entry('save'),
      { type: 'separator' }, entry('preferences'), { role: 'close' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' },
      { role: 'paste' }, { role: 'selectAll' }, entry('find'), entry('search')] },
    { role: 'windowMenu' },
  ]))
}

function createWindow(initialFile?: DocumentFile) {
  nativeTheme.themeSource = preferences.theme
  const material = windowMaterial()
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    width: Math.max(660, Math.min(windowSize.width, workArea.width)),
    height: Math.max(510, Math.min(windowSize.height, workArea.height)),
    minWidth: 660,
    minHeight: 510,
    title: 'Ymd',
    // A clear background requires an alpha-capable macOS window even when launched in solid mode.
    transparent: process.platform === 'darwin',
    backgroundColor: material === 'solid' ? windowColor() : '#00000000',
    // DWM needs the title bar hidden to extend the backdrop through the client area.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : windowsAcrylic ? 'hidden' : 'default',
    titleBarOverlay: windowsAcrylic ? { ...overlayColors(), height: 49 } : undefined,
    autoHideMenuBar: windowsAcrylic,
    backgroundMaterial: material === 'acrylic' ? 'acrylic' : undefined,
    vibrancy: material === 'vibrancy' ? macVibrancy : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  const editor: EditorWindow = { window, initialFile, closing: false, recording: false,
    keys: new ShortcutSequence(), documents: new Set(), watchRevision: 0, draftRevisions: new Map() }
  editors.set(window.id, editor)
  lastEditor = editor
  applyBackground(window)
  window.on('focus', () => { lastEditor = editor })
  window.on('blur', () => editor.keys.reset())
  window.on('resize', () => {
    if (window.isMaximized() || window.isFullScreen() || window.isMinimized()) return
    const { width, height } = window.getNormalBounds()
    if (width < 660 || height < 510) return
    windowSize = { width, height }
    clearTimeout(sizeTimer)
    sizeTimer = setTimeout(flushWindowSize, 250)
  })
  window.webContents.on('render-process-gone', () => { void recovery.wait() })
  window.webContents.on('did-start-navigation', () => setShortcutRecording(editor, false))
  window.webContents.on('before-input-event', (event, input) => {
    if (editor.recording || input.type !== 'keyDown' || input.isComposing) return
    const chord = inputChord(input, process.platform)
    if (!chord) {
      if (input.key === 'Escape') editor.keys.reset()
      return
    }
    const matched = editor.keys.take(chord, appBindings, input.isAutoRepeat)
    if (!matched) return
    event.preventDefault()
    if (matched !== 'pending') command(matched as AppShortcut, editor)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault() })
  window.on('close', event => {
    if (editor.closing || quitAllowed || window.webContents.isCrashed() || window.webContents.isLoadingMainFrame()) return
    event.preventDefault()
    command('close', editor)
  })
  const id = window.id
  window.on('closed', () => {
    editor.search?.abort()
    documentsWatcher.remove(id)
    editors.delete(id)
    if (lastEditor === editor) lastEditor = [...editors.values()].at(-1)
    editor.resolveClose?.(true)
    flushWindowSize()
    void recovery.wait()
  })
  void window.loadURL(rendererUrl)
}

function handleEditor<A extends unknown[], R>(name: keyof Desktop, run: (editor: EditorWindow, ...args: A) => R) {
  ipcMain.handle('ymd:' + name, (event: IpcMainInvokeEvent, ...args: A) => {
    const editor = editorFor(event.sender)
    if (!editor || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('无效的窗口请求。')
    return run(editor, ...args)
  })
}

function handle<A extends unknown[], R>(name: keyof Desktop, run: (...args: A) => R) {
  handleEditor(name, (_editor, ...args: A) => run(...args))
}

void app.whenReady().then(async () => {
  registerPitchWindow(rendererUrl, contents => editorFor(contents)?.window ?? null)
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (permission === 'media') {
      return !!editorFor(contents) && details.isMainFrame && details.mediaType === 'audio' && contents?.getURL() === rendererUrl
    }
    return permission !== 'display-capture'
  })
  session.defaultSession.setPermissionRequestHandler((contents, permission, reply, details) => {
    if (permission === 'media') {
      const types = (details as MediaAccessPermissionRequest).mediaTypes
      reply(!!editorFor(contents) && details.isMainFrame && details.requestingUrl === rendererUrl &&
        types?.length === 1 && types[0] === 'audio')
      return
    }
    reply(permission !== 'display-capture')
  })
  protocol.handle('ymd', request => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname.slice(1)) || 'index.html'
    const target = path.resolve(rendererRoot, relative)
    const fromRoot = path.relative(rendererRoot, target)
    if (url.hostname !== 'app' || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
      return new Response(null, { status: 404 })
    }
    return net.fetch(pathToFileURL(target).href)
  })
  const data = app.getPath('userData')
  sizeFile = path.join(data, 'window-size.json')
  try {
    const size = JSON.parse(await readFile(sizeFile, 'utf8'))
    if (Number.isInteger(size.width) && size.width >= 660 && Number.isInteger(size.height) && size.height >= 510) windowSize = size
  } catch {}
  recovery = new Recovery(path.join(data, 'recovery'))
  await recovery.load()
  const releases = new Releases(data, status => broadcast('ymd:updateStatus', status))
  await releases.network.load()
  const settings = path.join(data, 'preferences.json')
  const recentFile = path.join(data, 'recent.json')
  const defaultLibrary = path.join(app.getPath('home'), '.ymd')
  const localMapLocations = new LocalMapLocations(path.join(data, 'map-locations.json'))
  let oldProject: unknown
  try {
    const value = JSON.parse(await readFile(settings, 'utf8'))
    preferences = normalizePreferences(value)
    oldProject = value?.projectDirectory
  } catch {
    preferences = defaultPreferences
  }
  let library = (preferences.libraryDirectory && await files.authorizeDirectory(preferences.libraryDirectory).catch(() => null))
    || await files.library(defaultLibrary)
  let recent: Entry[] = []
  let recentWrite: Promise<unknown> = Promise.resolve()
  let treeWrite: Promise<TreeChange[] | null> = Promise.resolve(null)
  const temporaryRoots = new Set<Entry>()
  const roots = () => [library, ...recent.filter(entry => entry.kind === 'directory' && entry.path !== library.path), ...temporaryRoots]
  const writeRecent = (change: (items: Entry[]) => Entry[]) => {
    const task = recentWrite.catch(() => {}).then(async () => {
      const next = change(recent).slice(0, 100)
      await writeFile(recentFile + '.tmp', JSON.stringify(next), { flush: true })
      await rename(recentFile + '.tmp', recentFile)
      recent = next
      files.retainRoots(roots())
      broadcast('ymd:workspaceChanged', { library, recent })
      return recent
    })
    recentWrite = task
    return task
  }
  const remember = (entry: Entry) => writeRecent(items => [entry, ...items.filter(item => item.path !== entry.path)])
  const oldLibrary = path.join(data, 'Documents')
  await mkdir(data, { recursive: true })
  const storedRecent = await readFile(recentFile, 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  })
  if (storedRecent === undefined) {
    const oldEntries = await readdir(oldLibrary).catch(() => [])
    const paths = [
      ...(oldEntries.some(name => !name.startsWith('.')) ? [oldLibrary] : []),
      ...(typeof oldProject === 'string' && path.isAbsolute(oldProject) ? [oldProject] : []),
    ]
    for (const location of paths) {
      const entry = await files.authorizeDirectory(location).catch(() => null)
      if (entry && entry.path !== library.path && !recent.some(item => item.path === entry.path)) recent.push(entry)
    }
    await writeRecent(items => items)
  } else {
    let parsed: unknown
    try { parsed = JSON.parse(storedRecent) } catch {}
    if (Array.isArray(parsed)) for (const saved of parsed.slice(0, 100)) {
      if (typeof saved?.path !== 'string' || !path.isAbsolute(saved.path)) continue
      const entry = await (saved.kind === 'directory' ? files.authorizeDirectory(saved.path) : files.authorizeFileEntry(saved.path)).catch(() => null)
      if (entry && !recent.some(item => item.path === entry.path)) recent.push(entry)
    }
    files.retainRoots(roots())
  }

  const historyFile = path.join(data, 'document-history.json')
  const storedHistory = await readFile(historyFile, 'utf8').catch(() => undefined)
  let documentHistory = recent.filter(entry => entry.kind !== 'directory').slice(0, documentHistoryLimit)
  if (storedHistory !== undefined) {
    let parsed: unknown
    try { parsed = JSON.parse(storedHistory) } catch {}
    if (Array.isArray(parsed)) {
      const entries = await Promise.all(parsed.slice(0, documentHistoryLimit).map(file =>
        typeof file === 'string' && path.isAbsolute(file) ? files.authorizeFileEntry(file).catch(() => null) : null))
      const available = entries.filter(entry => entry !== null)
      documentHistory = [...new Map(available.map(entry => [entry.path, entry])).values()]
    }
  }
  let historyWrite = Promise.resolve()
  function updateDocumentHistory(change: (entries: Entry[]) => Entry[] | Promise<Entry[]>) {
    const task = historyWrite.catch(() => {}).then(async () => {
      const changed = await change(documentHistory)
      if (changed === documentHistory) return
      const next = [...new Map(changed.map(entry => [entry.path, entry])).values()].slice(0, documentHistoryLimit)
      if (next.length === documentHistory.length && next.every((entry, index) => entry === documentHistory[index])) return
      await writeFile(historyFile + '.tmp', JSON.stringify(next.map(entry => entry.path)), { flush: true })
      await rename(historyFile + '.tmp', historyFile)
      documentHistory = next
      broadcast('ymd:documentHistory', next)
    })
    historyWrite = task
    return task
  }

  function relocateRecentEntries(entries: Entry[], changes: TreeChange[]) {
    return entries.flatMap(entry => {
      const change = changes.find(change => !change.error && (change.source.path === entry.path ||
        change.source.kind === 'directory' && containsPath(change.source.path, entry.path)))
      if (!change) return [entry]
      if (!change.target) return []
      const updatedPath = path.join(change.target.path, path.relative(change.source.path, entry.path))
      return [{ ...entry, path: updatedPath, name: path.basename(updatedPath) }]
    })
  }

  function storePreferences(update: (current: Preferences) => Preferences) {
    const task = preferenceWrite.catch(() => {}).then(async () => {
      const next = update(preferences)
      await writeFile(settings + '.tmp', JSON.stringify(next), { flush: true })
      await rename(settings + '.tmp', settings)
      preferences = next
      return next
    })
    preferenceWrite = task
    return task
  }

  async function updateLibrary(directory?: string) {
    const selected = directory ? await files.authorizeDirectory(directory) : await files.library(defaultLibrary)
    await storePreferences(current => ({ ...current, libraryDirectory: directory ? selected.path : undefined }))
    for (const editor of editors.values()) editor.search?.abort()
    library = selected
    files.retainRoots(roots())
    broadcast('ymd:workspaceChanged', { library, recent })
    broadcast('ymd:preferences', preferences)
    return library
  }

  handleEditor('initialize', editor => {
    const initialFile = editor.initialFile
    editor.initialFile = undefined
    return { library, recent, preferences, platform: process.platform, windowsAcrylic, initialFile,
      recoveries: recovery.list(), documentHistory, macReducesTransparency: macReducesTransparency(), version: app.getVersion(),
      updateProxy: releases.network.publicProxy(), release: releases.status }
  })
  handle('newWindow', async (file?: string) => {
    if (quitPending) return
    const initial = file === undefined ? undefined : await files.read(file, true)
    createWindow(initial)
  })
  handleEditor('watchDocuments', async (editor, paths: string[]) => {
    if (!Array.isArray(paths) || paths.length > 1000 || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) return
    const revision = ++editor.watchRevision
    const filesToWatch = await Promise.all(paths.map(async file => editor.documents.has(file)
      ? file : files.authorizedFile(file).catch(() => undefined)))
    if (revision !== editor.watchRevision || editor.window.isDestroyed()) return
    editor.documents = new Set(filesToWatch.filter(file => file !== undefined))
    documentsWatcher.set(editor.window.id, editor.documents)
  })
  handle('readDocumentState', async (file: string) => {
    try { return await files.read(file, true) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  })
  handleEditor('recordDraft', async (editor, file: string, draft: Parameters<Desktop['recordDraft']>[1]) => {
    if (typeof file !== 'string' || !fileKind(file) || draft !== null &&
        (typeof draft?.text !== 'string' || typeof draft?.version !== 'string')) return
    const revision = Symbol()
    editor.draftRevisions.set(file, revision)
    const canonical = editor.documents.has(file) ? file : await files.authorizedFile(file).catch(() => undefined)
    if (editor.draftRevisions.get(file) !== revision) return
    editor.draftRevisions.delete(file)
    if (canonical && !editor.window.isDestroyed()) recovery.schedule(editor.window.id, canonical, draft)
  })
  handleEditor('restoreDraft', async (editor, id: string) => {
    const saved = recovery.get(id)
    if (!saved) return null
    let file: DocumentFile
    let missing = false
    try { file = await files.authorizeFile(saved.path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      file = await files.authorizeMissing(saved.path)
      missing = true
    }
    editor.documents.add(file.path)
    const draft = { text: saved.text, version: saved.version }
    if (missing || file.text !== draft.text) {
      await recovery.preserve(editor.window.id, file.path, draft)
    }
    return { file, draft, missing }
  })
  handle('discardDraft', async (id: string) => {
    await recovery.discard(id)
    broadcast('ymd:recoveryList', recovery.list())
  })
  handle('checkForUpdates', () => releases.check())
  handle('downloadUpdate', () => releases.download())
  handle('setUpdateProxy', (proxy: Parameters<Desktop['setUpdateProxy']>[0]) => releases.network.save(proxy))
  handleEditor('installUpdate', async editor => {
    if (quitPending) return
    quitPending = true
    try {
      if (!await closeEditors(editor)) throw new Error('已取消在关闭窗口后安装更新。')
      await preferenceWrite
      await historyWrite.catch(() => {})
      await recovery.wait()
      await releases.install()
      for (const file of editor.documents) recovery.schedule(editor.window.id, file, null)
      await recovery.wait()
      quitAllowed = true
      app.quit()
    } finally { quitPending = false }
  })
  handle('openLibraryDirectory', async () => {
    const message = await shell.openPath(library.path)
    if (message) throw new Error(message)
  })
  handle('list', (directory: string) => files.list(directory))
  handleEditor('chooseLibraryDirectory', async ({ window }) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath: library.path, properties: ['openDirectory'] })
    return result.canceled ? null : updateLibrary(result.filePaths[0])
  })
  handle('resetLibraryDirectory', () => updateLibrary())
  handleEditor('chooseLocalDirectory', async ({ window }) => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })
    if (result.canceled) return null
    const entry = await files.authorizeDirectory(result.filePaths[0])
    return remember(entry)
  })
  handle('listRecent', () => recent)
  handle('touchRecent', (file: string) => writeRecent(items => {
    const entry = items.find(item => item.path === file)
    return entry ? [entry, ...items.filter(item => item.path !== file)] : items
  }))
  handle('removeRecent', (file: string) => writeRecent(items => items.filter(item => item.path !== file)))
  handle('recordDocumentOpen', (file: string) => updateDocumentHistory(async entries => {
    if (entries[0]?.path === file) return entries
    const canonical = await files.authorizedFile(file)
    const kind = fileKind(canonical)
    if (!kind) return entries
    return [{ path: canonical, name: path.basename(canonical), kind }, ...entries.filter(entry => entry.path !== canonical)]
  }))
  handle('openHistoryDocument', async (file: string) => {
    if (!documentHistory.some(entry => entry.path === file)) return null
    try { return await files.read(file, true) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await updateDocumentHistory(entries => entries.filter(entry => entry.path !== file))
      return null
    }
  })
  handleEditor('cancelSearch', editor => { editor.search?.abort() })
  handleEditor('search', async (editor, input: string) => {
    editor.search?.abort()
    const query = typeof input === 'string' ? input.trim().slice(0, 256) : ''
    if (!query || /[\r\n\0]/.test(query)) return []
    const controller = new AbortController()
    editor.search = controller
    const executable = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const binary = app.isPackaged ? path.join(process.resourcesPath, 'ripgrep', executable)
      : path.join(app.getAppPath(), 'node_modules/@vscode/ripgrep-universal/bin', `${process.platform}-${process.arch}`, executable)
    try {
      const locations = [library, ...recent.filter(entry => entry.path !== library.path &&
        (entry.kind === 'directory' || !containsPath(library.path, entry.path))).slice(0, preferences.recentLimit)]
      const authorized = await Promise.all(locations.map(async entry => {
        const file = await (entry.kind === 'directory' ? files.authorizedDirectory(entry.path) : files.authorizedFile(entry.path)).catch(() => '')
        return file === entry.path ? entry : undefined
      }))
      return await searchRoots(binary, authorized.filter(entry => entry !== undefined), query, controller.signal)
    } finally {
      if (editor.search === controller) editor.search = undefined
    }
  })
  handleEditor('chooseFile', async ({ window }, kind?: FileKind) => {
    const filters = kind === 'markdown' ? [{ name: 'Markdown', extensions: ['md'] }]
      : kind === 'drawing' ? [{ name: 'Excalidraw', extensions: ['excalidraw'] }]
      : [{ name: 'Markdown 与 Excalidraw', extensions: ['md', 'excalidraw'] }]
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters,
    })
    if (result.canceled) return null
    const file = result.filePaths[0]
    if (kind && fileKind(file) !== kind) throw new Error('所选文件类型与请求不符。')
    const document = await files.authorizeFile(file)
    const relative = path.relative(library.path, document.path)
    if (path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {
      const { path, name, kind } = document
      await remember({ path, name, kind })
    }
    return document
  })
  handle('read', (file: string) => files.read(file, true))
  handle('create', (directory: string, kind: FileKind) => files.create(directory, kind))
  handle('createFolder', (directory: string) => files.createFolder(directory))
  async function mutateTree(window: BrowserWindow, mutation: TreeMutation): Promise<TreeChange[] | null> {
    if (!mutation || !['copy', 'import', 'move', 'trash', 'rename'].includes(mutation.operation) ||
      !Array.isArray(mutation.entries) || !mutation.entries.length || mutation.entries.length > 1000 ||
      mutation.entries.some(entry => !entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) ||
        !['directory', 'markdown', 'drawing'].includes(entry.kind)) ||
      mutation.operation === 'rename' && (mutation.entries.length !== 1 || typeof mutation.name !== 'string')) {
      throw new Error('无效的文件操作。')
    }
    const { operation } = mutation
    const copying = operation === 'copy' || operation === 'import'
    const unique = [...new Map(mutation.entries.map(entry => [entry.path, entry])).values()]
    const entries = unique.filter(entry => !unique.some(parent => parent.kind === 'directory' && parent !== entry && containsPath(parent.path, entry.path)))
    let destination: Entry | undefined
    if (operation === 'move') {
      if (mutation.destination !== undefined) {
        const path = await files.authorizedDirectory(mutation.destination)
        if (!containsPath(library.path, path)) throw new Error('请选择文档库中的文件夹。')
        destination = await files.authorizeDirectory(path)
      } else {
        const dialogResult = await dialog.showOpenDialog(window!, { defaultPath: library.path, properties: ['openDirectory'] })
        if (dialogResult.canceled) return null
        destination = await files.authorizeDirectory(dialogResult.filePaths[0])
      }
      temporaryRoots.add(destination)
    }
    const changes: TreeChange[] = []
    try {
      for (const source of entries) {
        try {
          const folder = source.kind === 'directory'
          const canonical = await (folder ? files.authorizedDirectory(source.path) : files.authorizedFile(source.path))
          if (canonical === library.path || folder && containsPath(canonical, library.path)) throw new Error('请先在设置中更改文档库位置。')
          let target: Entry | undefined
          if (folder) {
            if (copying) target = await files.copyDirectory(canonical, operation === 'import' ? library.path : undefined)
            else if (operation === 'trash') await shell.trashItem(canonical)
            else target = await files.moveDirectory(canonical, destination?.path ?? '', operation === 'rename' ? mutation.name : undefined)
          } else {
            const document = await files.read(canonical)
            const version = source.version ?? document.version
            if (copying) {
              const parent = operation === 'import' ? library.path : await files.authorizedDirectory(path.dirname(canonical)).catch(() => library.path)
              target = await files.duplicate(canonical, parent, typeof source.text === 'string' ? source.text : document.text, operation === 'import')
            } else if (operation === 'trash') {
              if (document.version !== version) throw new Error('磁盘上的文件已变化，请重新载入后删除。')
              await shell.trashItem(canonical)
            } else if (operation === 'rename') target = await files.renameDocument(canonical, mutation.name!, version)
            else target = await files.move(canonical, destination!.path, version)
          }
          changes.push({ source: { path: canonical, name: path.basename(canonical), kind: source.kind }, target })
        } catch (error) {
          changes.push({ source, error: error instanceof Error ? error.message : String(error) })
        }
      }
      if (!copying) {
        await writeRecent(items => {
          const updated = relocateRecentEntries(items, changes)
          for (const change of changes) {
            const target = change.target
            if (target && !containsPath(library.path, target.path) &&
                !updated.some(entry => entry.path === target.path || entry.kind === 'directory' && containsPath(entry.path, target.path))) updated.unshift(target)
          }
          return [...new Map(updated.map(entry => [entry.path, entry])).values()]
        }).catch(error => { console.warn('无法保存最近打开记录。', error) })
        await updateDocumentHistory(entries => relocateRecentEntries(entries, changes)).catch(error => { console.warn('无法保存文档历史。', error) })
      }
      return changes
    } finally {
      if (destination) temporaryRoots.delete(destination)
      files.retainRoots(roots())
    }
  }
  handleEditor('mutateTree', ({ window }, mutation: TreeMutation) => {
    treeWrite = treeWrite.catch(() => null).then(() => mutateTree(window, mutation))
    return treeWrite
  })
  handle('save', (file: string, text: string, version: string | null) => {
    if (typeof text !== 'string' || version !== null && typeof version !== 'string') throw new Error('文件内容无效。')
    return files.save(file, text, version).then(result => { if (!('conflict' in result)) documentsWatcher.changed(file); return result })
  })
  handle('duplicate', async (file: string, directory: string, text: string) => {
    if (typeof text !== 'string') throw new Error('文件内容无效。')
    return files.duplicate(file, directory, text)
  })
  const moveRecent = async (oldPath: string, document: DocumentFile) => {
    if (document.path !== oldPath) {
      const record = { path: document.path, name: document.name, kind: document.kind }
      await writeRecent(items => {
        const next = items.filter(entry => entry.path !== oldPath && entry.path !== document.path)
        return containsPath(library.path, document.path) ? next : [record, ...next]
      }).catch(error => { console.warn('无法保存最近打开记录。', error) })
      await updateDocumentHistory(entries => entries.map(entry => entry.path === oldPath ? record : entry))
        .catch(error => { console.warn('无法保存文档历史。', error) })
    }
    return document
  }
  handle('rename', async (file: string, name: string, version: string) => moveRecent(file, await files.renameDocument(file, name, version)))
  handleEditor('move', async ({ window }, file: string, version: string) => {
    const canonical = await files.authorizedFile(file)
    const result = await dialog.showOpenDialog(window!, { defaultPath: path.dirname(canonical), properties: ['openDirectory'] })
    if (result.canceled) return null
    const selected = await files.authorizeDirectory(result.filePaths[0])
    temporaryRoots.add(selected)
    try {
      return await moveRecent(canonical, await files.move(canonical, selected.path, version))
    } finally {
      temporaryRoots.delete(selected)
      files.retainRoots(roots())
    }
  })
  handle('trash', async (file: string, version: string) => {
    const canonical = await files.authorizedFile(file)
    const current = await files.read(canonical)
    if (current.version !== version) throw new Error('磁盘上的文件已变化，请重新载入后删除。')
    await shell.trashItem(canonical)
    if (recent.some(entry => entry.path === canonical)) await writeRecent(items => items.filter(entry => entry.path !== canonical))
      .catch(error => { console.warn('无法保存最近打开记录。', error) })
    await updateDocumentHistory(entries => entries.filter(entry => entry.path !== canonical))
      .catch(error => { console.warn('无法保存文档历史。', error) })
  })
  handle('openExternal', async (input: string) => {
    if (typeof input !== 'string' || input.length > 4096) throw new Error('链接无效。')
    const url = new URL(input)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('链接类型不受支持。')
    await shell.openExternal(url.href)
  })
  handleEditor('chooseLocalMapLocation', ({ window }, kind: Parameters<LocalMapLocations['choose']>[1], previous?: string) =>
    localMapLocations.choose(window!, kind, previous))
  handleEditor('openLocalMapLocation', ({ window }, url: string) => localMapLocations.open(window!, url))
  handleEditor('chooseMarkdownImages', async ({ window }, file: string) => {
    const canonical = await files.authorizedFile(file)
    const result = await dialog.showOpenDialog(window!, {
      defaultPath: path.dirname(canonical), properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: Object.keys(markdownImageExtensions) }],
    })
    return result.canceled ? [] : files.importImageFiles(canonical, result.filePaths)
  })
  handle('importMarkdownImages', (file: string, images: MarkdownImageUpload[]) => files.importImageBytes(file, images))
  handleEditor('pasteMarkdownClipboard', ({ window }) => window.webContents.paste())
  handle('readMarkdownImage', (file: string, source: string) => {
    if (typeof source !== 'string') throw new Error('图片路径无效。')
    return files.readImage(file, source)
  })
  handle('readPreviewImage', async (source: string) => {
    if (typeof source !== 'string' || source.length > 8192) throw new Error('图片地址无效。')
    let url = new URL(source)
    const signal = AbortSignal.timeout(20_000)
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('图片地址无效。')
      const response = await net.fetch(url.href, { credentials: 'omit', redirect: 'manual', signal })
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location')
        await response.body?.cancel()
        if (!next) break
        url = new URL(next, url)
        continue
      }
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (!response.ok || !response.body || !type || !Object.values(markdownImageExtensions).some(value => value === type)) {
        await response.body?.cancel()
        throw new Error('网络图片无法下载或格式不受支持。')
      }
      const chunks: Buffer[] = []
      let length = 0
      const reader = response.body.getReader()
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > 15 * 1024 * 1024) { await reader.cancel(); throw new Error('网络图片超过 15 MB。') }
          chunks.push(Buffer.from(value))
        }
      } finally { reader.releaseLock() }
      return 'data:' + type + ';base64,' + Buffer.concat(chunks).toString('base64')
    }
    throw new Error('图片重定向次数过多。')
  })
  handleEditor('savePreviewImage', async ({ window }, name: string, format: 'png' | 'svg', data: ArrayBuffer) => {
    if (typeof name !== 'string' || !['png', 'svg'].includes(format) || !(data instanceof ArrayBuffer) ||
        !data.byteLength || data.byteLength > 64 * 1024 * 1024) throw new Error('导出图片无效或太大。')
    const title = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/^[.]+|[. ]+$/g, '').slice(0, 100) || '图片'
    const result = await dialog.showSaveDialog(window, { defaultPath: title + '.' + format,
      filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, Buffer.from(data))
    return true
  })
  handleEditor('markdownContextMenu', ({ window }, x: number, y: number, items: ContextMenuItem[]) => new Promise<number | null>(resolve => {
    if (!window || !Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(items)) { resolve(null); return }
    const template = (rows: ContextMenuItem[], depth = 0): MenuItemConstructorOptions[] => rows.slice(0, 30).flatMap(item => {
      if (!item || typeof item.label !== 'string') return []
      const submenu = depth < 2 && Array.isArray(item.children) ? template(item.children, depth + 1) : undefined
      const label = item.label.slice(0, 100)
      const accelerator = isShortcutAccelerator(item.shortcut) ? item.shortcut : undefined
      return [
        ...(item.separator ? [{ type: 'separator' } as const] : []),
        { label, submenu, enabled: item.disabled !== true, accelerator, registerAccelerator: false,
          ...(!submenu && typeof item.selected === 'boolean' ? { type: 'checkbox' as const, checked: item.selected } : {}),
          click: () => resolve(Number.isSafeInteger(item.id) ? item.id! : null) },
      ]
    })
    Menu.buildFromTemplate(template(items)).popup({ window, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), callback: () => resolve(null) })
  }))
  handleEditor('exportPdf', async ({ window }, name: string, html: string) => {
    const result = await dialog.showSaveDialog(window!, { defaultPath: path.parse(name).name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath || !window) return false
    const data = await printView(name, html, view => view.webContents.printToPDF({ printBackground: true }))
    await writeFile(result.filePath, data)
    return true
  })
  handleEditor('chooseXmind', async ({ window }) => {
    const selected = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'Xmind', extensions: ['xmind'] }] })
    if (selected.canceled || !selected.filePaths.length) return null
    const file = selected.filePaths[0]
    const handle = await open(file, 'r')
    try {
      const info = await handle.stat()
      const maxSize = 48 * 1024 * 1024
      if (!info.isFile() || info.size < 4 || info.size > maxSize) throw new Error('请选择小于或等于 48 MB 的 Xmind 文件。')
      const data = new ArrayBuffer(info.size)
      const buffer = Buffer.from(data)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      if (offset !== info.size || new DataView(data).getUint32(0) !== 0x504b0304 || (await handle.stat()).size !== info.size) {
        throw new Error('无法读取 Xmind 工作簿。')
      }
      return { name: path.parse(file).name, data }
    } finally {
      await handle.close()
    }
  })
  handle('createImportedMarkdown', (directory: string, name: string, text: string) => files.createImportedMarkdown(directory, name, text))
  handleEditor('saveXmind', async ({ window }, name: string, data: ArrayBuffer) => {
    if (typeof name !== 'string' || !(data instanceof ArrayBuffer) || data.byteLength < 4 ||
        new DataView(data).getUint32(0) !== 0x504b0304) throw new Error('Xmind 文件内容无效。')
    const title = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || '思维导图'
    const result = await dialog.showSaveDialog(window!, { defaultPath: title + '.xmind', filters: [{ name: 'Xmind', extensions: ['xmind'] }] })
    if (result.canceled || !result.filePath) return false
    const destination = /\.xmind$/i.test(result.filePath) ? result.filePath : result.filePath + '.xmind'
    await writeFile(destination, Buffer.from(data), { flush: true })
    return true
  })
  handleEditor('saveAudioNote', async ({ window }, data: ArrayBuffer) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 4 ||
        new DataView(data).getUint32(0) !== 0x1a45dfa3) throw new Error('录音文件内容无效。')
    const result = await dialog.showSaveDialog(window!, { defaultPath: '录音备注.webm', filters: [{ name: 'WebM 音频', extensions: ['webm'] }] })
    if (result.canceled || !result.filePath) return false
    const destination = /\.webm$/i.test(result.filePath) ? result.filePath : result.filePath + '.webm'
    await writeFile(destination, Buffer.from(data), { flush: true })
    return true
  })
  handleEditor('saveMapExport', async ({ window }, name: string, format: MapExportKind, data: ArrayBuffer) => {
    if (typeof name !== 'string' || typeof format !== 'string' || !Object.hasOwn(mapExportExtensions, format) || !(data instanceof ArrayBuffer) ||
        !data.byteLength || data.byteLength > 64 * 1024 * 1024) throw new Error('导图文件内容无效或过大。')
    const title = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120) || '思维导图'
    const extension = '.' + format
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: title + extension, filters: [{ name: mapExportExtensions[format], extensions: [format] }],
    })
    if (result.canceled || !result.filePath) return false
    const destination = result.filePath.toLowerCase().endsWith(extension) ? result.filePath : result.filePath + extension
    await writeFile(destination, Buffer.from(data), { flush: true })
    return true
  })
  handleEditor('captureMapShot', async ({ window }, rect: MapShotRect) => {
    const owner = window!
    const [width, height] = owner.getContentSize()
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) ||
      rect.x < 0 || rect.y < 0 || rect.width < 12 || rect.height < 12 ||
      rect.x + rect.width > width || rect.y + rect.height > height) throw new Error('截图区域超出窗口范围。')
    const image = await owner.webContents.capturePage(rect)
    if (image.isEmpty()) throw new Error('无法截取导图画布。')
    return Uint8Array.from(image.toPNG({ scaleFactor: Math.max(1, ...image.getScaleFactors()) })).buffer
  })
  handleEditor('outputMapShot', async ({ window }, data: ArrayBuffer, name?: string) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 24 || data.byteLength > 40 * 1024 * 1024 ||
        (name !== undefined && typeof name !== 'string')) throw new Error('截图内容无效或过大。')
    const header = new DataView(data)
    if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(12) !== 0x49484452 ||
        !header.getUint32(16) || !header.getUint32(20) || header.getUint32(16) * header.getUint32(20) > 50_000_000) {
      throw new Error('截图内容无效或过大。')
    }
    const bytes = Buffer.from(data)
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('无法读取截图。')
    if (name !== undefined) {
      const title = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || '思维导图'
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: path.join(app.getPath('desktop'), title + ' 截图.png'), filters: [{ name: 'PNG', extensions: ['png'] }],
      })
      if (result.canceled || !result.filePath) return false
      const destination = /\.png$/i.test(result.filePath) ? result.filePath : result.filePath + '.png'
      await writeFile(destination, bytes, { flush: true })
    }
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([data], { type: 'image/png' }) })])
    return true
  })
  handle('printDocument', (name: string, html: string) => printView(name, html, view => new Promise<void>((resolve, reject) => {
    view.webContents.print({ printBackground: true }, (printed, reason) => {
      if (printed || reason === 'Print job canceled') resolve()
      else reject(new Error(reason || '无法打印文档。'))
    })
  })))
  handleEditor('saveCopy', async ({ window }, file: string, text: string) => {
    const kind = fileKind(file)
    if (!kind || typeof text !== 'string') throw new Error('文件内容无效。')
    const extension = kind === 'markdown' ? '.md' : '.excalidraw'
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: path.basename(file, path.extname(file)) + ' 副本' + extension,
      filters: [{ name: kind === 'markdown' ? 'Markdown' : 'Excalidraw', extensions: [extension.slice(1)] }],
    })
    if (result.canceled || !result.filePath) return null
    const destination = result.filePath.toLowerCase().endsWith(extension) ? result.filePath : result.filePath + extension
    await writeFile(destination, text, { flag: 'wx', flush: true })
    const document = await files.authorizeFile(destination)
    if (!containsPath(library.path, document.path)) await remember({ path: document.path, name: document.name, kind: document.kind })
      .catch(error => { console.warn('无法保存最近打开记录。', error) })
    return document
  })
  handle('reveal', async (file: string, directory?: boolean) =>
    shell.showItemInFolder(await (directory ? files.authorizedDirectory(file) : files.authorizedFile(file))))
  handle('setPreferences', async (value: Partial<Preferences>) => {
    let changedShortcuts = false
    let changedBackground = false
    const updated = await storePreferences(current => {
      const next = normalizePreferences({ ...current, ...value, libraryDirectory: current.libraryDirectory })
      changedShortcuts = JSON.stringify(current.shortcuts) !== JSON.stringify(next.shortcuts)
      changedBackground = current.theme !== next.theme || windowMaterial(current) !== windowMaterial(next)
      return next
    })
    if (changedShortcuts) installMenu()
    if (changedBackground) applyBackground()
    broadcast('ymd:preferences', updated)
    return updated
  })
  handleEditor('setShortcutRecording', (editor, active: boolean) => setShortcutRecording(editor, active === true))
  handleEditor('cancelClose', editor => { editor.resolveClose?.(false); editor.resolveClose = undefined })
  handleEditor('finishClose', async editor => {
    await historyWrite.catch(() => {})
    await recovery.wait()
    editor.closing = true
    editor.window.close()
  })
  installMenu()
  createWindow()
  nativeTheme.on('updated', () => applyBackground())
  app.on('activate', () => { if (!editors.size && !quitPending) createWindow() })
})

app.on('before-quit', event => {
  flushWindowSize()
  if (quitAllowed || !editors.size) return
  event.preventDefault()
  if (quitPending) return
  quitPending = true
  void closeEditors().then(async closed => {
    if (!closed) return
    await recovery.wait()
    quitAllowed = true
    app.quit()
  }).finally(() => { quitPending = false })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !quitPending) app.quit() })
