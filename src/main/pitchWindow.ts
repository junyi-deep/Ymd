import { BrowserWindow, dialog, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pitchImage, readPitchOptions, readPitchTopic, type PitchRequest, type PitchTopic } from '../shared/pitch'
import { printView } from './printing'

function readRequest(input: PitchRequest): PitchRequest {
  if (!input || typeof input.title !== 'string' || !['fullscreen', 'window', 'presenter'].includes(input.mode)) {
    throw new Error('演示内容无效。')
  }
  const ids = new Set<string>()
  let size = 0
  function read(topic: PitchTopic, depth: number): PitchTopic {
    if (!topic || typeof topic.id !== 'string' || !topic.id || topic.id.length > 256 || ids.has(topic.id) ||
        typeof topic.title !== 'string' || !Array.isArray(topic.children) || depth > 100 || ids.size >= 10_000) {
      throw new Error('演示主题无效或过多。')
    }
    const note = typeof topic.note === 'string' ? topic.note : undefined
    const image = pitchImage(topic.image) ? topic.image : undefined
    size += 2 * (topic.title.length + (note?.length ?? 0)) + (image?.length ?? 0)
    if (size > 48 * 1024 * 1024) throw new Error('演示内容过大。')
    ids.add(topic.id)
    return { id: topic.id, title: topic.title, note, image, options: readPitchTopic(topic.options),
      children: topic.children.map(child => read(child, depth + 1)) }
  }
  const root = read(input.root, 0)
  return { title: input.title.slice(0, 256), mode: input.mode, root, options: readPitchOptions(input.options),
    start: input.start && ids.has(input.start) ? input.start : undefined }
}

export function registerPitchWindow(editorUrl: string, editorWindow: (contents: Electron.WebContents) => BrowserWindow | null) {
  const url = new URL(editorUrl)
  url.searchParams.set('pitch', '1')
  const stageUrl = url.href
  let current: { window: BrowserWindow; request: PitchRequest } | undefined
  const isMac = process.platform === 'darwin'
  const fullscreen = (window: BrowserWindow) => window.isFullScreen() || isMac && window.isSimpleFullScreen()
  const notify = (window: BrowserWindow) => window.webContents.send('ymd:pitch:fullscreenChanged', fullscreen(window))
  const setFullscreen = (window: BrowserWindow, enabled: boolean) => {
    if (isMac && (!window.isFullScreen() || window.isSimpleFullScreen())) {
      window.setSimpleFullScreen(enabled)
      notify(window)
    } else window.setFullScreen(enabled)
  }
  const leaveSimpleFullscreen = (window: BrowserWindow) => {
    if (isMac && window.isSimpleFullScreen()) window.setSimpleFullScreen(false)
  }

  function stage(event: IpcMainInvokeEvent) {
    if (!current || event.sender !== current.window.webContents || event.senderFrame?.url !== stageUrl) {
      throw new Error('无效的演示窗口。')
    }
    return current
  }
  ipcMain.handle('ymd:openPitch', async (event, input: PitchRequest) => {
    const owner = editorWindow(event.sender)
    if (!owner || event.sender !== owner.webContents || event.senderFrame?.url !== editorUrl) throw new Error('无效的窗口请求。')
    const request = readRequest(input)
    if (current) {
      leaveSimpleFullscreen(current.window)
      current.window.destroy()
    }
    const bounds = screen.getDisplayMatching(owner.getBounds()).workArea
    const width = Math.min(1120, bounds.width)
    const height = Math.min(760, bounds.height)
    const window = new BrowserWindow({
      width, height, x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y + Math.round((bounds.height - height) / 2),
      minWidth: 520, minHeight: 390, title: request.title || '演示', show: false, autoHideMenuBar: true,
      backgroundColor: '#08090b',
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    current = { window, request }
    if (!isMac) window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (navigation, destination) => { if (destination !== stageUrl) navigation.preventDefault() })
    const close = () => {
      if (window.isDestroyed()) return
      leaveSimpleFullscreen(window)
      window.destroy()
    }
    window.on('close', () => leaveSimpleFullscreen(window))
    owner.once('closed', close)
    window.once('closed', () => {
      owner.off('closed', close)
      if (current?.window === window) current = undefined
    })
    window.on('enter-full-screen', () => notify(window))
    window.on('leave-full-screen', () => notify(window))
    try {
      await window.loadURL(stageUrl)
      if (!window.isDestroyed()) {
        window.show()
        if (request.mode === 'fullscreen') setFullscreen(window, true)
      }
    } catch (error) { close(); throw error }
  })
  ipcMain.handle('ymd:pitch:load', event => {
    const { window, request } = stage(event)
    return { ...request, platform: process.platform, fullscreen: fullscreen(window) }
  })
  ipcMain.handle('ymd:pitch:fullscreen', (event, value: boolean) => setFullscreen(stage(event).window, value === true))
  ipcMain.handle('ymd:pitch:close', event => stage(event).window.close())

  const destination = async (window: BrowserWindow, name: string, ext: 'pptx' | 'pdf') => {
    const title = (typeof name === 'string' ? name : '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120)
    const result = await dialog.showSaveDialog(window, { defaultPath: (title || '演示') + '.' + ext,
      filters: [{ name: ext === 'pptx' ? 'PowerPoint' : 'PDF', extensions: [ext] }] })
    if (!result.canceled && result.filePath) return result.filePath.toLowerCase().endsWith('.' + ext) ? result.filePath : result.filePath + '.' + ext
  }
  ipcMain.handle('ymd:pitch:savePowerPoint', async (event, title: string, bytes: ArrayBuffer) => {
    const { window } = stage(event)
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 4 || bytes.byteLength > 64 * 1024 * 1024 ||
        new DataView(bytes).getUint32(0) !== 0x504b0304) throw new Error('PowerPoint 内容无效或过大。')
    const file = await destination(window, title, 'pptx')
    if (!file) return false
    await writeFile(file, Buffer.from(bytes), { flush: true })
    return true
  })
  ipcMain.handle('ymd:pitch:savePdf', async (event, title: string, html: string) => {
    const { window } = stage(event)
    const file = await destination(window, title, 'pdf')
    if (!file) return false
    const bytes = await printView(typeof title === 'string' ? title : '演示', html, pdf =>
      pdf.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }))
    await writeFile(file, bytes, { flush: true })
    return true
  })
}
