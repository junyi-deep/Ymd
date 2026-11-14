import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultPreferences } from '../shared/contracts'
import type { Command, Desktop, Preferences } from '../shared/contracts'
import { Files, fileKind } from './files'

const files = new Files()
const dev = !app.isPackaged && process.argv.includes('--dev')
const rendererRoot = path.join(__dirname, '../renderer')
const rendererUrl = dev ? 'http://127.0.0.1:5173/' : 'ymd://app/'
protocol.registerSchemesAsPrivileged([{ scheme: 'ymd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
let window: BrowserWindow | null = null
let preferences = defaultPreferences
let closing = false
let preferenceWrite: Promise<unknown> = Promise.resolve()

function normalizePreferences(value: Partial<Preferences> | null): Preferences {
  return {
    theme: value?.theme === 'dark' || value?.theme === 'light' ? value.theme : 'system',
    size: value?.size === 'small' || value?.size === 'large' ? value.size : 'normal',
    solidBackground: value?.solidBackground === true,
  }
}

function applyBackground() {
  if (process.platform === 'darwin') window?.setVibrancy(preferences.solidBackground ? null : 'sidebar')
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault() })
  window.on('close', event => {
    if (closing || window?.webContents.isCrashed() || window?.webContents.isLoadingMainFrame()) return
    event.preventDefault()
    command('close')
  })
  window.on('closed', () => { window = null })
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
  handle('initialize', () => ({ library, preferences, platform: process.platform }))
  handle('list', (directory: string) => files.list(directory))
  handle('chooseDirectory', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })
    return result.canceled ? null : files.authorizeDirectory(result.filePaths[0])
  })
  handle('chooseFile', async () => {
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown 与 Excalidraw', extensions: ['md', 'excalidraw'] }],
    })
    return result.canceled ? null : files.authorizeFile(result.filePaths[0])
  })
  handle('read', (file: string) => files.read(file))
  handle('create', (directory: string, name: string, kind: Parameters<Desktop['create']>[2]) => files.create(directory, name, kind))
  handle('save', (file: string, text: string, version: string) => {
    if (typeof text !== 'string' || typeof version !== 'string') throw new Error('文件内容无效。')
    return files.save(file, text, version)
  })
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
  handle('reveal', async (file: string) => shell.showItemInFolder((await files.read(file)).path))
  handle('setPreferences', (value: Preferences) => {
    const next = normalizePreferences(value)
    const task = preferenceWrite.catch(() => {}).then(async () => {
      await writeFile(settings + '.tmp', JSON.stringify(next), { flush: true })
      await rename(settings + '.tmp', settings)
      preferences = next
      applyBackground()
      return preferences
    })
    preferenceWrite = task
    return task
  })
  handle('finishClose', () => { closing = true; window?.close() })
  const items: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => command('new-file') },
      { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => command('open-file') },
      { label: '打开目录…', accelerator: 'CmdOrCtrl+Shift+O', click: () => command('open-directory') },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { type: 'separator' },
      { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => command('preferences') },
      { role: 'close' },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => command('find') }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(items))
  createWindow()
  app.on('activate', () => { if (!window) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
