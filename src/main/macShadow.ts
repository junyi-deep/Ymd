import { app, type BrowserWindow } from 'electron'
import path from 'node:path'
import { defaultPreferences, windowShadowPresets, type WindowShadowPreferences } from '../shared/contracts'

export function installMacShadow(window: BrowserWindow) {
  const koffi: typeof import('koffi', { with: { 'resolution-mode': 'import' } }) = require('koffi')
  const location = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main') : __dirname
  const library = koffi.load(path.join(location, 'window-shadow.dylib'))
  const create = library.func('void * CreateMacEditorShadow(void *view)')
  const update = library.func('void UpdateMacEditorShadow(void *shadow, int show, int spread, int blur, uint32_t color)')
  const destroy = library.func('void DestroyMacEditorShadow(void *shadow)')
  const shadow = create(window.getNativeWindowHandle().readBigUInt64LE())
  if (!shadow) throw new Error('无法创建 macOS 窗口阴影。')
  window.setHasShadow(false)
  let settings = defaultPreferences.windowShadow
  let scheduled: NodeJS.Immediate | undefined
  const sync = () => {
    scheduled = undefined
    if (window.isDestroyed()) return
    const { spread, blur } = windowShadowPresets[settings.preset]
    const visible = settings.enabled && window.isVisible() && !window.isMinimized() && !window.isMaximized() && !window.isFullScreen()
    update(shadow, Number(visible), spread, blur, Number.parseInt(settings.color.slice(1), 16))
  }
  const schedule = () => { scheduled ??= setImmediate(sync) }
  window.on('show', schedule)
  window.on('hide', schedule)
  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
  window.on('minimize', schedule)
  window.on('restore', schedule)
  window.on('enter-full-screen', schedule)
  window.on('leave-full-screen', schedule)
  window.once('closed', () => {
    clearImmediate(scheduled)
    destroy(shadow)
  })
  schedule()
  return (next: WindowShadowPreferences) => {
    settings = next
    schedule()
  }
}
