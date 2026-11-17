const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app, BrowserWindow, nativeTheme } = require('electron')

const windows = process.platform === 'win32'
const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-window-material-'))
const documents = path.join(profile, '.ymd', 'documents')
mkdirSync(documents, { recursive: true })
writeFileSync(path.join(documents, 'Window check.md'), '# Window check\n')
app.setPath('userData', profile)
app.setPath('home', profile)

const vibrancyCalls = []
let reducesTransparency = false
if (!windows) {
  // The CI desktop may prefer reduced transparency. Exercise both settings without changing the host.
  Object.defineProperty(nativeTheme, 'prefersReducedTransparency', { get: () => reducesTransparency })
  const setVibrancy = BrowserWindow.prototype.setVibrancy
  BrowserWindow.prototype.setVibrancy = function (value) {
    vibrancyCalls.push(value)
    return setVibrancy.call(this, value)
  }
}

function dwmAttribute(window, attribute) {
  const dwm = require('koffi').load('dwmapi.dll')
  const read = dwm.func('int __stdcall DwmGetWindowAttribute(void *window, int attribute, _Out_ int32_t *value, int size)')
  const hwnd = window.getNativeWindowHandle().readBigUInt64LE()
  const value = new Int32Array(1)
  const result = read(hwnd, attribute, value, value.byteLength)
  if (result !== 0) throw new Error(`DwmGetWindowAttribute(${attribute}) failed: ${(result >>> 0).toString(16)}`)
  return value[0]
}

async function waitFor(read, matches, label) {
  let result
  for (let attempt = 0; attempt < 120; attempt++) {
    result = await read()
    if (matches(result)) return result
    await delay(75)
  }
  throw new Error(`${label}. Last value ${JSON.stringify(result)}`)
}

function roundedRegion(window) {
  const koffi = require('koffi')
  const user = koffi.load('user32.dll')
  const gdi = koffi.load('gdi32.dll')
  const read = user.func('int __stdcall GetWindowRgn(void *window, void *region)')
  const getRect = user.func('int __stdcall GetWindowRect(void *window, _Out_ int32_t *rect)')
  const frameRect = koffi.load('dwmapi.dll').func('int __stdcall DwmGetWindowAttribute(void *window, int attribute, _Out_ int32_t *rect, int size)')
  const create = gdi.func('void * __stdcall CreateRectRgn(int, int, int, int)')
  const contains = gdi.func('int __stdcall PtInRegion(void *region, int x, int y)')
  const dispose = gdi.func('int __stdcall DeleteObject(void *region)')
  const handle = window.getNativeWindowHandle().readBigUInt64LE()
  return () => {
    const region = create(0, 0, 0, 0)
    try {
      if (!read(handle, region)) return 'none'
      const rect = new Int32Array(4)
      const frame = new Int32Array(4)
      if (!getRect(handle, rect) || frameRect(handle, 9, frame, frame.byteLength) !== 0) return 'unknown'
      const x = frame[0] - rect[0], y = frame[1] - rect[1]
      const right = frame[2] - rect[0] - 1, bottom = frame[3] - rect[1] - 1
      if (!contains(region, (x + right) >> 1, (y + bottom) >> 1)) return 'empty'
      return [[x, y], [right, y], [x, bottom], [right, bottom]].map(([x, y]) => contains(region, x, y) ? 'square' : 'round').join(' ')
    } finally { dispose(region) }
  }
}

function windowShadow(window) {
  const user = require('koffi').load('user32.dll')
  const find = user.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 windowClass, str16 title)')
  const owner = user.func('uintptr_t __stdcall GetWindow(void *window, int command)')
  const visible = user.func('int __stdcall IsWindowVisible(void *window)')
  const handle = window.getNativeWindowHandle().readBigUInt64LE()
  return () => {
    let shadow = null
    while ((shadow = find(null, shadow, 'Static', 'Ymd window shadow'))) {
      if (BigInt(owner(shadow, 4)) === handle) return !!visible(shadow) // GW_OWNER
    }
    return false
  }
}

async function check(window) {
  const evaluate = source => window.webContents.executeJavaScript(source)
  const emulateTransparencyPreference = reduce => {
    reducesTransparency = reduce
    nativeTheme.emit('updated')
  }
  const snapshot = () => evaluate(`(() => {
    const overlay = navigator.windowControlsOverlay
    const rect = overlay?.getTitlebarAreaRect()
    const actions = document.querySelector('.title-actions')
    const sidebar = document.querySelector('.sidebar')
    const page = document.querySelector('.workspace, .settings-main')
    return {
      material: document.documentElement.dataset.windowMaterial,
      overlay: overlay?.visible === true,
      captionStart: rect ? rect.x + rect.width : 0,
      toolsEnd: actions?.getBoundingClientRect().right,
      sidebar: sidebar && getComputedStyle(sidebar).backgroundColor,
      page: page && getComputedStyle(page).backgroundColor,
    }
  })()`)
  const waitMaterial = material => waitFor(snapshot, value => value.material === material && value.sidebar && value.page &&
    (!windows || value.overlay) && (window.getBackgroundColor() === '#000000') === (material !== 'solid'), `Expected ${material}`)
  const switcher = 'button[role="switch"][aria-label="透明窗口背景"]'
  const blur = 'button[role="switch"][aria-label="高斯模糊"]'
  const toggle = (control = switcher) => evaluate(`document.querySelector('${control}').click()`)
  const glass = windows ? 'acrylic' : 'vibrancy'
  const before = await waitMaterial(glass)
  assert.match(before.sidebar, /^rgba\(/)
  assert.match(before.page, /^rgb\(/)
  const region = windows ? roundedRegion(window) : undefined
  const shadow = windows ? windowShadow(window) : undefined
  const allRounded = value => value === 'round round round round'
  if (windows) {
    assert.notEqual(dwmAttribute(window, 38), 3, 'Acrylic uses its own clipped visual, with no rectangular DWM backdrop')
    await waitFor(region, allRounded, 'All four visible corners are rounded at startup')
    await waitFor(shadow, Boolean, 'First window has a visible shadow surface')
  } else assert.equal(vibrancyCalls.at(-1), 'hud')

  const sample = 'button.tree-row[title="Window check.md"]'
  await waitFor(() => evaluate(`!!document.querySelector('${sample}')`), Boolean, 'Sample listed')
  await evaluate(`document.querySelector('${sample}').click()`)
  await waitFor(() => evaluate(`!!document.querySelector('[aria-label="重命名 Window check.md"]')`), Boolean, 'Sample document visible')
  window.setSize(680, 595)
  if (windows) {
    await waitFor(snapshot, value => value.captionStart > 0 && value.captionStart < 680 && value.toolsEnd <= value.captionStart + 1,
      'Window tools stay clear of the caption buttons')
    await waitFor(region, allRounded, 'Resized window retains four rounded corners')
    window.minimize()
    await waitFor(shadow, value => !value, 'Minimized window hides its shadow')
    window.restore()
    await waitFor(shadow, Boolean, 'Restoring from minimized reapplies the shadow')
    window.maximize()
    await waitFor(region, value => value === 'none', 'Maximized window is unclipped')
    await waitFor(shadow, value => !value, 'Maximized window hides the shadow')
    window.unmaximize()
    await waitFor(region, allRounded, 'Restoring the window reapplies all four rounded corners')
    await waitFor(shadow, Boolean, 'Restoring from maximized reapplies the shadow')
  }
  await evaluate(`document.querySelector('.sidebar-footer').click()`)
  await waitFor(() => evaluate(`!!document.querySelector('${switcher}')`), Boolean, 'Appearance settings visible')
  assert.equal(await evaluate(`document.querySelector('${switcher}').getAttribute('aria-checked')`), 'true')
  const shadowToggle = 'button[role="switch"][aria-label="窗口阴影"]'
  assert.equal(await evaluate(`document.querySelector('${shadowToggle}').getAttribute('aria-checked')`), 'true')
  await toggle(shadowToggle)
  await waitFor(() => evaluate(`!document.querySelector('[aria-label="自定义阴影颜色"]')`), Boolean, 'Disabling the shadow hides its settings')
  if (windows) await waitFor(shadow, value => !value, 'The Windows shadow surface disappears when disabled')
  await toggle(shadowToggle)
  if (windows) await waitFor(shadow, Boolean, 'Enabling the shadow restores its Windows surface')
  const slider = 'input[aria-label="背景透明度"]'
  const setTransparency = value => evaluate(`(() => {
    const input = document.querySelector('${slider}')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const readTransparency = async () => {
    const saved = await readFile(path.join(profile, 'preferences.json'), 'utf8').catch(() => '{}')
    return JSON.parse(saved).windowTransparency
  }
  assert.equal(await evaluate(`document.querySelector('${slider}').value`), '80')
  const tintAlpha = (sidebar) => /^rgb\(/.test(sidebar) ? 1 : Number(/^rgba\(.+, ([\d.]+)\)$/.exec(sidebar)?.[1])
  const expectTint = alpha => waitFor(snapshot, value => Math.abs(tintAlpha(value.sidebar) - alpha) < .005,
    'Expected tint opacity ' + alpha)
  const expectNative = async blurred => {
    if (windows) assert.notEqual(dwmAttribute(window, 38), 3, 'Switching materials keeps the rectangular DWM backdrop disabled')
    else await waitFor(() => vibrancyCalls.at(-1), value => value === (blurred ? 'hud' : null), 'Expected native blur')
  }
  await setTransparency(100)
  await expectTint(0)
  await waitMaterial(glass)
  await expectNative(true)
  await toggle(blur)
  await waitMaterial('clear')
  await expectNative(false)
  for (const transparency of [0, 20, 50, 80, 91, 99]) {
    await setTransparency(transparency)
    await waitFor(readTransparency, value => value === transparency, 'Slider setting saved')
    await expectTint(1 - transparency / 100)
  }
  await toggle()
  const solid = await waitMaterial('solid')
  assert.match(solid.sidebar, /^rgb\(/)
  await expectNative(false)
  assert.equal(await evaluate(`document.querySelector('${slider}') === null`), true)
  await toggle(blur)
  await waitMaterial(glass)
  await expectTint(.25)
  await expectNative(true)
  assert.equal(await evaluate(`document.querySelector('${slider}') === null`), true)
  await toggle()
  await waitFor(() => evaluate(`document.querySelector('${slider}')?.value`), value => value === '99', 'Restored transparency')
  await expectTint(.01)
  assert.equal(window.getOpacity(), 1)
  if (!windows) {
    emulateTransparencyPreference(true)
    await waitMaterial('solid')
    await expectNative(false)
    assert.equal(await evaluate(`document.querySelector('${switcher}').disabled && document.querySelector('${blur}').disabled`), true)
    emulateTransparencyPreference(false)
    await waitMaterial(glass)
    await expectNative(true)
  }
  console.log('Verified the solid, clear, blur, and combined window states on ' + process.platform)
}

const timeout = setTimeout(() => { console.error('Window material check timed out.'); app.exit(1) }, 90000)
app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void check(window).then(() => { clearTimeout(timeout); app.exit(0) }, error => {
      console.error(error)
      clearTimeout(timeout)
      app.exit(1)
    })
  })
})
require('../dist/main/index.js')
