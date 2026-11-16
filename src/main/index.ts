import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, session, shell } from 'electron'
import type { IpcMainInvokeEvent, MediaAccessPermissionRequest, MenuItemConstructorOptions } from 'electron'
import { mkdir, readdir, readFile, writeFile, rename, open } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultPreferences, markdownImageExtensions, searchEngines } from '../shared/contracts'
import type { Command, ContextMenuItem, Desktop, DocumentFile, Entry, FileKind, MarkdownImageUpload, Preferences, TreeChange, TreeMutation } from '../shared/contracts'
import { Files, containsPath, fileKind } from './files'
import { LocalMapLocations } from './localMapLocations'
import { searchRoots } from './search'
import { printView } from './printing'
import { readReleaseStatus } from './releases'
import { appShortcuts, inputChord, isShortcutAccelerator, readShortcutOverrides, shortcutAccelerator, shortcutMenuLabel, ShortcutSequence, shortcutsFor, shortcutValue,
  type AppShortcut } from '../shared/shortcuts'

const files = new Files()
const dev = !app.isPackaged && process.argv.includes('--dev')
const rendererRoot = path.join(__dirname, '../renderer')
const rendererUrl = dev ? 'http://127.0.0.1:5173/' : 'ymd://app/'
protocol.registerSchemesAsPrivileged([{ scheme: 'ymd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
let window: BrowserWindow | null = null
let preferences = defaultPreferences
let closing = false
let searchController: AbortController | undefined
const windowsAcrylic = process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2]) >= 22621
const macVibrancy = 'hud'
let preferenceWrite: Promise<unknown> = Promise.resolve()
let recordingShortcut = false
const appKeySequence = new ShortcutSequence()
let appBindings = shortcutsFor('app', preferences.shortcuts, process.platform)

function normalizePreferences(value: Partial<Preferences> | null): Preferences {
  const transparency = value?.windowTransparency
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
      position: value?.markdownOutline?.position === 'left' ? 'left' : 'right',
      numbering: value?.markdownOutline?.numbering === 'flat' || value?.markdownOutline?.numbering === 'hierarchical'
        ? value.markdownOutline.numbering : 'none',
      visible: value?.markdownOutline?.visible === true,
    },
    animations: value?.animations !== false,
    documentTheme: value?.documentTheme === 'paper' || value?.documentTheme === 'mono' ? value.documentTheme : 'classic',
    autoSave: value?.autoSave === true,
    remoteImages: value?.remoteImages === true,
    autoCheckUpdates: value?.autoCheckUpdates === true,
    searchEngine: value?.searchEngine && Object.hasOwn(searchEngines, value.searchEngine) ? value.searchEngine : 'google',
    shortcuts: readShortcutOverrides(value?.shortcuts, process.platform),
  }
}

const macReducesTransparency = () => process.platform === 'darwin' && nativeTheme.prefersReducedTransparency
const glassEnabled = () => !preferences.solidBackground &&
  (process.platform === 'darwin' ? !macReducesTransparency() : windowsAcrylic)
const windowColor = () => nativeTheme.shouldUseDarkColors ? '#222323' : '#fdfdfd'
const overlayColors = () => ({ color: windowColor(), symbolColor: nativeTheme.shouldUseDarkColors ? '#ededee' : '#222528' })

function applyBackground() {
  nativeTheme.themeSource = preferences.theme
  const glass = glassEnabled()
  if (process.platform === 'darwin') window?.setVibrancy(glass ? macVibrancy : null)
  if (windowsAcrylic) {
    window?.setBackgroundMaterial(glass ? 'acrylic' : 'none')
    window?.setTitleBarOverlay(overlayColors())
  }
  window?.setBackgroundColor(glass ? '#00000000' : windowColor())
  if (process.platform === 'darwin') window?.webContents.send('ymd:reducedTransparency', macReducesTransparency())
}

function command(name: Command) {
  window?.webContents.send('ymd:command', name)
}

function setShortcutRecording(active: boolean) {
  recordingShortcut = active
  appKeySequence.reset()
  window?.webContents.setIgnoreMenuShortcuts(active)
}

function installMenu() {
  appBindings = shortcutsFor('app', preferences.shortcuts, process.platform)
  appKeySequence.reset()
  const entry = (id: AppShortcut): MenuItemConstructorOptions => {
    const value = shortcutValue(preferences.shortcuts, id, process.platform)
    return { label: shortcutMenuLabel(appShortcuts[id].label, value, process.platform), accelerator: shortcutAccelerator(value), click: () => command(id) }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { label: '文件', submenu: [entry('new-file'), entry('open-file'), entry('import-xmind'), entry('new-drawing'), entry('save'),
      { type: 'separator' }, entry('preferences'), { role: 'close' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' },
      { role: 'paste' }, { role: 'selectAll' }, entry('find'), entry('search')] },
    { role: 'windowMenu' },
  ]))
}

function createWindow() {
  closing = false
  nativeTheme.themeSource = preferences.theme
  const glass = glassEnabled()
  window = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 660,
    minHeight: 510,
    title: 'Ymd',
    backgroundColor: glass ? '#00000000' : windowColor(),
    // DWM needs the title bar hidden to extend the backdrop through the client area.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : windowsAcrylic ? 'hidden' : 'default',
    titleBarOverlay: windowsAcrylic ? { ...overlayColors(), height: 49 } : undefined,
    autoHideMenuBar: windowsAcrylic,
    backgroundMaterial: windowsAcrylic && glass ? 'acrylic' : undefined,
    vibrancy: process.platform === 'darwin' && glass ? macVibrancy : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  applyBackground()
  window.on('blur', () => appKeySequence.reset())
  window.webContents.on('did-start-navigation', () => setShortcutRecording(false))
  window.webContents.on('before-input-event', (event, input) => {
    if (recordingShortcut || input.type !== 'keyDown' || input.isComposing) return
    const chord = inputChord(input, process.platform)
    if (!chord) {
      if (input.key === 'Escape') appKeySequence.reset()
      return
    }
    const matched = appKeySequence.take(chord, appBindings, input.isAutoRepeat)
    if (!matched) return
    event.preventDefault()
    if (matched !== 'pending') command(matched as AppShortcut)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault() })
  window.on('close', event => {
    if (closing || window?.webContents.isCrashed() || window?.webContents.isLoadingMainFrame()) return
    event.preventDefault()
    command('close')
  })
  window.on('closed', () => { searchController?.abort(); window = null })
  void window.loadURL(rendererUrl)
}

function handle<A extends unknown[], R>(name: keyof Desktop, run: (...args: A) => R) {
  ipcMain.handle('ymd:' + name, (event: IpcMainInvokeEvent, ...args: A) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== rendererUrl) throw new Error('无效的窗口请求。')
    return run(...args)
  })
}

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (permission === 'media') {
      return contents === window?.webContents && details.isMainFrame && details.mediaType === 'audio' && contents?.getURL() === rendererUrl
    }
    return permission !== 'display-capture'
  })
  session.defaultSession.setPermissionRequestHandler((contents, permission, reply, details) => {
    if (permission === 'media') {
      const types = (details as MediaAccessPermissionRequest).mediaTypes
      reply(contents === window?.webContents && details.isMainFrame && details.requestingUrl === rendererUrl &&
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
    searchController?.abort()
    library = selected
    files.retainRoots(roots())
    return library
  }

  handle('initialize', () => ({ library, recent, preferences, platform: process.platform, windowsAcrylic,
    macReducesTransparency: macReducesTransparency(), version: app.getVersion() }))
  handle('checkForUpdates', () => readReleaseStatus(app.getVersion()))
  handle('openLibraryDirectory', async () => {
    const message = await shell.openPath(library.path)
    if (message) throw new Error(message)
  })
  handle('list', (directory: string) => files.list(directory))
  handle('chooseLibraryDirectory', async () => {
    const result = await dialog.showOpenDialog(window!, { defaultPath: library.path, properties: ['openDirectory'] })
    return result.canceled ? null : updateLibrary(result.filePaths[0])
  })
  handle('resetLibraryDirectory', () => updateLibrary())
  handle('chooseLocalDirectory', async () => {
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
  handle('cancelSearch', () => { searchController?.abort() })
  handle('search', async (input: string) => {
    searchController?.abort()
    const query = typeof input === 'string' ? input.trim().slice(0, 256) : ''
    if (!query || /[\r\n\0]/.test(query)) return []
    const controller = new AbortController()
    searchController = controller
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
      if (searchController === controller) searchController = undefined
    }
  })
  handle('chooseFile', async (kind?: FileKind) => {
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
  async function mutateTree(mutation: TreeMutation): Promise<TreeChange[] | null> {
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
      if (!copying) await writeRecent(items => {
        const updated = items.flatMap(entry => {
          const change = changes.find(change => !change.error && (change.source.path === entry.path ||
            change.source.kind === 'directory' && containsPath(change.source.path, entry.path)))
          if (!change) return [entry]
          if (!change.target) return []
          const updatedPath = path.join(change.target.path, path.relative(change.source.path, entry.path))
          return [{ ...entry, path: updatedPath, name: path.basename(updatedPath) }]
        })
        for (const change of changes) {
          const target = change.target
          if (target && !containsPath(library.path, target.path) &&
              !updated.some(entry => entry.path === target.path || entry.kind === 'directory' && containsPath(entry.path, target.path))) updated.unshift(target)
        }
        return [...new Map(updated.map(entry => [entry.path, entry])).values()]
      }).catch(error => { console.warn('无法保存最近打开记录。', error) })
      return changes
    } finally {
      if (destination) temporaryRoots.delete(destination)
      files.retainRoots(roots())
    }
  }
  handle('mutateTree', (mutation: TreeMutation) => {
    treeWrite = treeWrite.catch(() => null).then(() => mutateTree(mutation))
    return treeWrite
  })
  handle('save', (file: string, text: string, version: string) => {
    if (typeof text !== 'string' || typeof version !== 'string') throw new Error('文件内容无效。')
    return files.save(file, text, version)
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
    }
    return document
  }
  handle('rename', async (file: string, name: string, version: string) => moveRecent(file, await files.renameDocument(file, name, version)))
  handle('move', async (file: string, version: string) => {
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
  })
  handle('openExternal', async (input: string) => {
    if (typeof input !== 'string' || input.length > 4096) throw new Error('链接无效。')
    const url = new URL(input)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('链接类型不受支持。')
    await shell.openExternal(url.href)
  })
  handle('chooseLocalMapLocation', (kind: Parameters<LocalMapLocations['choose']>[1], previous?: string) =>
    localMapLocations.choose(window!, kind, previous))
  handle('openLocalMapLocation', (url: string) => localMapLocations.open(window!, url))
  handle('chooseMarkdownImages', async (file: string) => {
    const canonical = await files.authorizedFile(file)
    const result = await dialog.showOpenDialog(window!, {
      defaultPath: path.dirname(canonical), properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: Object.keys(markdownImageExtensions) }],
    })
    return result.canceled ? [] : files.importImageFiles(canonical, result.filePaths)
  })
  handle('importMarkdownImages', (file: string, images: MarkdownImageUpload[]) => files.importImageBytes(file, images))
  handle('pasteMarkdownClipboard', () => window?.webContents.paste())
  handle('readMarkdownImage', (file: string, source: string) => {
    if (typeof source !== 'string') throw new Error('图片路径无效。')
    return files.readImage(file, source)
  })
  handle('markdownContextMenu', (x: number, y: number, items: ContextMenuItem[]) => new Promise<number | null>(resolve => {
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
  handle('exportPdf', async (name: string, html: string) => {
    const result = await dialog.showSaveDialog(window!, { defaultPath: path.parse(name).name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath || !window) return false
    const data = await printView(name, html, view => view.webContents.printToPDF({ printBackground: true }))
    await writeFile(result.filePath, data)
    return true
  })
  handle('chooseXmind', async () => {
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
  handle('saveXmind', async (name: string, data: ArrayBuffer) => {
    if (typeof name !== 'string' || !(data instanceof ArrayBuffer) || data.byteLength < 4 ||
        new DataView(data).getUint32(0) !== 0x504b0304) throw new Error('Xmind 文件内容无效。')
    const title = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || '思维导图'
    const result = await dialog.showSaveDialog(window!, { defaultPath: title + '.xmind', filters: [{ name: 'Xmind', extensions: ['xmind'] }] })
    if (result.canceled || !result.filePath) return false
    const destination = /\.xmind$/i.test(result.filePath) ? result.filePath : result.filePath + '.xmind'
    await writeFile(destination, Buffer.from(data), { flush: true })
    return true
  })
  handle('saveAudioNote', async (data: ArrayBuffer) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 4 ||
        new DataView(data).getUint32(0) !== 0x1a45dfa3) throw new Error('录音文件内容无效。')
    const result = await dialog.showSaveDialog(window!, { defaultPath: '录音备注.webm', filters: [{ name: 'WebM 音频', extensions: ['webm'] }] })
    if (result.canceled || !result.filePath) return false
    const destination = /\.webm$/i.test(result.filePath) ? result.filePath : result.filePath + '.webm'
    await writeFile(destination, Buffer.from(data), { flush: true })
    return true
  })
  handle('printDocument', (name: string, html: string) => printView(name, html, view => new Promise<void>((resolve, reject) => {
    view.webContents.print({ printBackground: true }, (printed, reason) => {
      if (printed || reason === 'Print job canceled') resolve()
      else reject(new Error(reason || '无法打印文档。'))
    })
  })))
  handle('saveCopy', async (file: string, text: string) => {
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
  handle('setPreferences', async (value: Preferences) => {
    let changedShortcuts = false
    let changedBackground = false
    const updated = await storePreferences(current => {
      const next = normalizePreferences({ ...value, libraryDirectory: current.libraryDirectory })
      changedShortcuts = JSON.stringify(current.shortcuts) !== JSON.stringify(next.shortcuts)
      changedBackground = current.theme !== next.theme || current.solidBackground !== next.solidBackground
      return next
    })
    if (changedShortcuts) installMenu()
    if (changedBackground) applyBackground()
    return updated
  })
  handle('setShortcutRecording', (active: boolean) => setShortcutRecording(active === true))
  handle('finishClose', () => { closing = true; window?.close() })
  installMenu()
  createWindow()
  nativeTheme.on('updated', applyBackground)
  app.on('activate', () => { if (!window) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
