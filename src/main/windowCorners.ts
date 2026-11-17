import { app, type BrowserWindow } from 'electron'
import path from 'node:path'
import { defaultPreferences, windowShadowPresets, type WindowShadowPreferences } from '../shared/contracts'

export function installWindowFrame(window: BrowserWindow, supportsAcrylic: boolean) {
  // A Win32 region clips renderer content and input. Acrylic needs a separate clipped visual.
  const koffi: typeof import('koffi', { with: { 'resolution-mode': 'import' } }) = require('koffi')
  const user = koffi.load('user32.dll')
  const gdi = koffi.load('gdi32.dll')
  const dwm = koffi.load('dwmapi.dll')
  const getRect = user.func('int __stdcall GetWindowRect(void *window, _Out_ int32_t *rect)')
  const getFrame = dwm.func('int __stdcall DwmGetWindowAttribute(void *window, uint32_t attribute, _Out_ int32_t *rect, uint32_t size)')
  const dpiFor = user.func('uint32_t __stdcall GetDpiForWindow(void *window)')
  const setRegion = user.func('int __stdcall SetWindowRgn(void *window, void *region, int redraw)')
  const createRegion = gdi.func('void * __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight)')
  const createRect = gdi.func('void * __stdcall CreateRectRgn(int left, int top, int right, int bottom)')
  const combine = gdi.func('int __stdcall CombineRgn(void *destination, void *first, void *second, int mode)')
  const deleteRegion = gdi.func('int __stdcall DeleteObject(void *region)')
  const handle = window.getNativeWindowHandle().readBigUInt64LE()
  const rect = new Int32Array(4)
  const frame = new Int32Array(4)
  const native = loadFrameLibrary()
  const backdrop = supportsAcrylic && native ? acrylicVisual(native) : undefined
  const shadow = native && shadowSurface(native)
  let shadowStyle = defaultPreferences.windowShadow
  let wantsAcrylic = false
  let acrylicTint = 0xd3d3d3
  let applied: string | undefined
  let needsRefresh = false
  let pending: NodeJS.Immediate | undefined

  function update() {
    pending = undefined
    if (window.isDestroyed()) return
    if (window.isMinimized() || !window.isVisible()) {
      shadow?.hide()
      return
    }
    const refresh = needsRefresh
    needsRefresh = false
    if (window.isMaximized() || window.isFullScreen() || window.isSnapped()) {
      shadow?.hide()
      if ((applied !== undefined || refresh) && setRegion(handle, null, 1)) applied = undefined
      backdrop?.update(wantsAcrylic, 0, acrylicTint)
      return
    }
    if (!getRect(handle, rect)) return
    const width = rect[2] - rect[0]
    const height = rect[3] - rect[1]
    if (width <= 0 || height <= 0) return
    // GetWindowRect includes invisible resize borders on some Windows configurations.
    // Use the visible DWM frame as the origin of the curves.
    const hasFrame = getFrame(handle, 9, frame, frame.byteLength) === 0
    const left = hasFrame ? Math.max(0, frame[0] - rect[0]) : 0
    const top = hasFrame ? Math.max(0, frame[1] - rect[1]) : 0
    const right = hasFrame ? Math.min(width, frame[2] - rect[0]) : width
    const bottom = hasFrame ? Math.min(height, frame[3] - rect[1]) : height
    if (left >= right || top >= bottom) return
    const dpi = dpiFor(handle) || 96
    const radius = Math.round(8 * dpi / 96)
    backdrop?.update(wantsAcrylic, radius, acrylicTint)
    if (shadowStyle.enabled) shadow?.show(rect[0] + left, rect[1] + top, right - left, bottom - top, radius, dpi, shadowStyle)
    else shadow?.hide()
    const shape = `${width}:${height}:${left}:${top}:${right}:${bottom}:${radius}`
    if (!refresh && shape === applied) return
    const region = createRegion(left, top, right, bottom, 2 * radius, 2 * radius)
    if (!region) return
    // Preserve the off-frame resize targets along the straight edges.
    for (const [l, t, r, b] of [
      [left + radius, 0, right - radius, top],
      [left + radius, bottom, right - radius, height],
      [0, top + radius, left, bottom - radius],
      [right, top + radius, width, bottom - radius],
    ]) {
      if (l >= r || t >= b) continue
      const edge = createRect(l, t, r, b)
      if (edge) {
        combine(region, region, edge, 2) // RGN_OR
        deleteRegion(edge)
      }
    }
    // Windows owns the region after a successful SetWindowRgn.
    if (setRegion(handle, region, 1)) applied = shape
    else deleteRegion(region)
  }

  const schedule = () => { pending ??= setImmediate(update) }
  const reapply = () => {
    needsRefresh = true
    schedule()
  }
  window.on('show', reapply)
  window.on('hide', schedule)
  window.webContents.once('did-finish-load', reapply)
  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
  window.on('minimize', schedule)
  window.on('restore', schedule)
  window.on('enter-full-screen', schedule)
  window.on('leave-full-screen', schedule)
  window.on('focus', schedule)
  window.once('closed', () => {
    clearImmediate(pending)
    shadow?.destroy()
    backdrop?.dispose()
  })
  update()

  return {
    setShadow(next: WindowShadowPreferences) {
      shadowStyle = next
      schedule()
    },
    setAcrylic(enabled: boolean, light: boolean) {
      wantsAcrylic = enabled
      acrylicTint = light ? 0xd3d3d3 : 0x232323
      if (backdrop && !backdrop.failed) schedule()
      else if (supportsAcrylic) window.setBackgroundMaterial(enabled ? 'acrylic' : 'none')
    },
  }

  function loadFrameLibrary() {
    try {
      const location = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main') : __dirname
      return koffi.load(path.join(location, 'window-backdrop.dll'))
    } catch (error) {
      console.warn('无法加载 Windows 窗口合成组件。', error)
    }
  }

  function acrylicVisual(library: NonNullable<typeof native>) {
    const create = library.func('int CreateAcrylicBackdrop(void *window, _Out_ void **backdrop)')
    const update = library.func('int UpdateAcrylicBackdrop(void *backdrop, int visible, int radius, uint32_t color)')
    const destroy = library.func('void DestroyAcrylicBackdrop(void *backdrop)')
    let instance: unknown
    let failed = false
    return {
      get failed() { return failed },
      update(enabled: boolean, radius: number, color: number) {
        if (failed || (!enabled && !instance)) return
        if (!instance) {
          const out = [null]
          const result = create(handle, out)
          instance = out[0]
          if (result || !instance) return fallback(result)
        }
        const result = update(instance, Number(enabled), radius, color)
        if (result) fallback(result)
      },
      dispose() {
        if (instance) destroy(instance)
      },
    }

    function fallback(result: number) {
      failed = true
      if (instance) destroy(instance)
      instance = undefined
      console.warn('无法设置 Windows Acrylic 合成。', (result >>> 0).toString(16))
      window.setBackgroundMaterial(wantsAcrylic ? 'acrylic' : 'none')
    }
  }

  function shadowSurface(library: NonNullable<typeof native>) {
    const create = library.func('void * CreateEditorShadow(void *window)')
    const update = library.func('void UpdateEditorShadow(void *shadow, int left, int top, int width, int height, int radius, int dpi, int spread, int blur, uint32_t color)')
    const destroy = library.func('void DestroyEditorShadow(void *shadow)')
    const instance = create(handle)
    if (!instance) return
    return {
      show: (x: number, y: number, width: number, height: number, radius: number, dpi: number, settings: WindowShadowPreferences) => {
        const { spread, blur } = windowShadowPresets[settings.preset]
        update(instance, x, y, width, height, radius, dpi, spread, blur, Number.parseInt(settings.color.slice(1), 16))
      },
      hide: () => { update(instance, 0, 0, 0, 0, 0, 0, 0, 0, 0) },
      destroy: () => { destroy(instance) },
    }
  }
}
