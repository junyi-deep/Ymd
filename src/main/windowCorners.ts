import type { BrowserWindow } from 'electron'

export function installWindowCorners(window: BrowserWindow) {
  if (process.platform !== 'win32') return

  // Electron's per-pixel alpha windows cannot use DWM's automatic rounding.
  // A Win32 window region clips the whole surface, including the Acrylic backdrop.
  const koffi: typeof import('koffi', { with: { 'resolution-mode': 'import' } }) = require('koffi')
  const user = koffi.load('user32.dll')
  const gdi = koffi.load('gdi32.dll')
  const getRect = user.func('int __stdcall GetWindowRect(void *window, _Out_ int32_t *rect)')
  const dpiFor = user.func('uint32_t __stdcall GetDpiForWindow(void *window)')
  const setRegion = user.func('int __stdcall SetWindowRgn(void *window, void *region, int redraw)')
  const createRegion = gdi.func('void * __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight)')
  const deleteRegion = gdi.func('int __stdcall DeleteObject(void *region)')
  const handle = window.getNativeWindowHandle().readBigUInt64LE()
  const rect = new Int32Array(4)
  let applied: string | undefined
  let pending: NodeJS.Immediate | undefined

  function update() {
    pending = undefined
    if (window.isDestroyed() || window.isMinimized()) return
    if (window.isMaximized() || window.isFullScreen() || window.isSnapped()) {
      if (applied !== undefined && setRegion(handle, null, 1)) applied = undefined
      return
    }
    if (!getRect(handle, rect)) return
    const width = rect[2] - rect[0]
    const height = rect[3] - rect[1]
    const diameter = Math.round(16 * (dpiFor(handle) || 96) / 96)
    const shape = `${width}:${height}:${diameter}`
    if (shape === applied || width <= 0 || height <= 0) return
    const region = createRegion(0, 0, width + 1, height + 1, diameter, diameter)
    if (!region) return
    // Windows owns the region after a successful SetWindowRgn.
    if (setRegion(handle, region, 1)) applied = shape
    else deleteRegion(region)
  }

  const schedule = () => { pending ??= setImmediate(update) }
  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
  window.on('restore', schedule)
  window.on('enter-full-screen', schedule)
  window.on('leave-full-screen', schedule)
  window.once('closed', () => clearImmediate(pending))
  update()
}
