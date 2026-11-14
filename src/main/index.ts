import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultPreferences } from '../shared/contracts'
import type { Command, ContextMenuItem, Desktop, Entry, FileKind, Preferences } from '../shared/contracts'
import { Files, fileKind } from './files'
import { searchRoots } from './search'
import { printView } from './printing'

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
let preferenceWrite: Promise<unknown> = Promise.resolve()

function normalizePreferences(value: Partial<Preferences> | null): Preferences {
  return {
    theme: value?.theme === 'dark' || value?.theme === 'light' ? value.theme : 'system',
    size: value?.size === 'small' || value?.size === 'large' ? value.size : 'normal',
    solidBackground: value?.solidBackground === true,
    projectDirectory: typeof value?.projectDirectory === 'string' && path.isAbsolute(value.projectDirectory) ? value.projectDirectory : undefined,
    animations: value?.animations !== false,
    documentTheme: value?.documentTheme === 'paper' || value?.documentTheme === 'mono' ? value.documentTheme : 'classic',
    autoSave: value?.autoSave === true,
    remoteImages: value?.remoteImages === true,
  }
}

function applyBackground() {
  nativeTheme.themeSource = preferences.theme
  const material = !preferences.solidBackground && (process.platform === 'darwin' || windowsAcrylic)
  if (process.platform === 'darwin') window?.setVibrancy(material ? 'sidebar' : null)
  if (windowsAcrylic) window?.setBackgroundMaterial(material ? 'acrylic' : 'none')
  window?.setBackgroundColor(material ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#222323' : '#fdfdfd')
}

function command(name: Command) {
  window?.webContents.send('ymd:command', name)
}

function createWindow() {
  closing = false
  window = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 660,
    minHeight: 510,
    title: 'Ymd',
    backgroundColor: '#fcfcfc',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    vibrancy: process.platform === 'darwin' && !preferences.solidBackground ? 'sidebar' : undefined,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  applyBackground()
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
  try {
    preferences = normalizePreferences(JSON.parse(await readFile(settings, 'utf8')))
  } catch {
    preferences = defaultPreferences
  }
  const library = await files.library(data)
  const defaultProject = app.getPath('documents')
  await mkdir(defaultProject, { recursive: true }).catch(() => {})
  const authorizeProject = (directory: string) => files.authorizeDirectory(directory).catch(() => null)
  let project: Entry | null = preferences.projectDirectory ? await authorizeProject(preferences.projectDirectory) : null
  project ??= await authorizeProject(defaultProject)
  files.retainRoots(project ? [library, project] : [library])

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

  async function updateProject(directory?: string) {
    const selected = await files.authorizeDirectory(directory ?? defaultProject)
    await storePreferences(current => ({ ...current, projectDirectory: directory ? selected.path : undefined }))
    searchController?.abort()
    project = selected
    files.retainRoots([library, selected])
    return project
  }

  handle('initialize', () => ({ library, project, preferences, platform: process.platform, windowsAcrylic }))
  handle('list', (directory: string) => files.list(directory))
  handle('chooseProjectDirectory', async () => {
    const result = await dialog.showOpenDialog(window!, { defaultPath: project?.path, properties: ['openDirectory'] })
    return result.canceled ? null : updateProject(result.filePaths[0])
  })
  handle('resetProjectDirectory', () => updateProject())
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
      return await searchRoots(binary, project && project.path !== library.path ? [library, project] : [library], query, controller.signal)
    } finally {
      if (searchController === controller) searchController = undefined
    }
  })
  handle('chooseFile', async () => {
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown 与 Excalidraw', extensions: ['md', 'excalidraw'] }],
    })
    return result.canceled ? null : files.authorizeFile(result.filePaths[0])
  })
  handle('read', (file: string) => files.read(file, true))
  handle('create', (directory: string, kind: FileKind) => files.create(directory, kind))
  handle('save', (file: string, text: string, version: string) => {
    if (typeof text !== 'string' || typeof version !== 'string') throw new Error('文件内容无效。')
    return files.save(file, text, version)
  })
  handle('duplicate', async (file: string, directory: string, text: string) => {
    if (typeof text !== 'string') throw new Error('文件内容无效。')
    return files.duplicate(file, directory, text)
  })
  handle('rename', (file: string, name: string, version: string) => files.renameDocument(file, name, version))
  handle('move', async (file: string, version: string) => {
    const canonical = await files.authorizedFile(file)
    const result = await dialog.showOpenDialog(window!, { defaultPath: path.dirname(canonical), properties: ['openDirectory'] })
    if (result.canceled) return null
    const selected = await files.authorizeDirectory(result.filePaths[0])
    try {
      return await files.move(canonical, selected.path, version)
    } finally {
      files.retainRoots(project ? [library, project] : [library])
    }
  })
  handle('trash', async (file: string, version: string) => {
    const canonical = await files.authorizedFile(file)
    const current = await files.read(canonical)
    if (current.version !== version) throw new Error('磁盘上的文件已变化，请重新载入后删除。')
    await shell.trashItem(canonical)
  })
  handle('openExternal', async (input: string) => {
    if (typeof input !== 'string' || input.length > 4096) throw new Error('链接无效。')
    const url = new URL(input)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('链接类型不受支持。')
    await shell.openExternal(url.href)
  })
  handle('chooseMarkdownImage', async (file: string) => {
    const canonical = await files.authorizedFile(file)
    const result = await dialog.showOpenDialog(window!, {
      defaultPath: path.dirname(canonical), properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] }],
    })
    return result.canceled ? null : files.importImage(canonical, result.filePaths[0])
  })
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
      const accelerator = typeof item.shortcut === 'string' && /^(?:CommandOrControl\+)(?:Shift\+)?[A-Z0-9]$/.test(item.shortcut)
        ? item.shortcut : undefined
      return [
        ...(item.separator ? [{ type: 'separator' } as const] : []),
        { label, submenu, enabled: item.disabled !== true, accelerator, registerAccelerator: false,
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
    return files.authorizeFile(destination)
  })
  handle('reveal', async (file: string) => shell.showItemInFolder(await files.authorizedFile(file)))
  handle('setPreferences', async (value: Preferences) => {
    const updated = await storePreferences(current => normalizePreferences({ ...value, projectDirectory: current.projectDirectory }))
    applyBackground()
    return updated
  })
  handle('finishClose', () => { closing = true; window?.close() })
  const items: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => command('new-file') },
      { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => command('open-file') },
      { label: '新建绘图', accelerator: 'CmdOrCtrl+Shift+N', click: () => command('new-drawing') },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { type: 'separator' },
      { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => command('preferences') },
      { role: 'close' },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { label: '查找和替换', accelerator: 'CmdOrCtrl+F', click: () => command('find') }, { label: '搜索文档', accelerator: 'CmdOrCtrl+J', click: () => command('search') }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(items))
  createWindow()
  nativeTheme.on('updated', applyBackground)
  app.on('activate', () => { if (!window) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
