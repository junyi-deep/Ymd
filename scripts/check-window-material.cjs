const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { promisify } = require('node:util')
const { app, BrowserWindow } = require('electron')

const windows = process.platform === 'win32'
const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-window-material-'))
const documents = path.join(profile, 'Documents')
mkdirSync(documents)
writeFileSync(path.join(documents, 'Window check.md'), '# Window check\n')
app.setPath('userData', profile)
app.setPath('documents', documents)

const vibrancyCalls = []
if (!windows) {
  const setVibrancy = BrowserWindow.prototype.setVibrancy
  BrowserWindow.prototype.setVibrancy = function (value) {
    vibrancyCalls.push(value)
    return setVibrancy.call(this, value)
  }
}

async function dwmBackdrop(window) {
  const hwnd = window.getNativeWindowHandle().readBigUInt64LE()
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Backdrop {
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
}
'@
$value = 0
$result = [Backdrop]::DwmGetWindowAttribute([IntPtr]([long]'${hwnd}'), 38, [ref]$value, 4)
if ($result -ne 0) { throw ('DwmGetWindowAttribute failed: ' + $result) }
Write-Output $value
`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20000 })
  return Number(stdout.trim())
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

async function check(window) {
  const evaluate = source => window.webContents.executeJavaScript(source)
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
  const toggle = () => evaluate(`document.querySelector('button[role="switch"][aria-label="不透明窗口背景"]').click()`)
  const glass = windows ? 'acrylic' : 'vibrancy'
  const before = await waitMaterial(glass)
  assert.match(before.sidebar, /^rgba\(/)
  assert.match(before.page, /^rgb\(/)
  if (windows) assert.equal(await dwmBackdrop(window), 3)
  else assert.equal(vibrancyCalls.at(-1), 'popover')

  const sample = 'button.tree-row[title="Window check.md"]'
  await waitFor(() => evaluate(`!!document.querySelector('${sample}')`), Boolean, 'Sample listed')
  await evaluate(`document.querySelector('${sample}').click()`)
  await waitFor(() => evaluate(`!!document.querySelector('[aria-label="重命名 Window check.md"]')`), Boolean, 'Sample document visible')
  window.setSize(680, 595)
  if (windows) {
    await waitFor(snapshot, value => value.captionStart > 0 && value.captionStart < 680 && value.toolsEnd <= value.captionStart + 1,
      'Window tools stay clear of the caption buttons')
  }
  await evaluate(`document.querySelector('.sidebar-footer').click()`)
  await waitFor(() => evaluate(`!!document.querySelector('button[role="switch"][aria-label="不透明窗口背景"]')`), Boolean, 'Appearance settings visible')
  const slider = 'input[aria-label="毛玻璃透明度"]'
  if (!windows) {
    assert.equal(await evaluate(`document.querySelector('${slider}').value`), '80')
    await evaluate(`(() => {
      const input = document.querySelector('${slider}')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '50')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await waitFor(snapshot, value => /^rgba\(.*0\.5\)$/.test(value.sidebar), 'Slider changes the sidebar tint')
    const readTransparency = async () => {
      const saved = await readFile(path.join(profile, 'preferences.json'), 'utf8').catch(() => '{}')
      return JSON.parse(saved).windowTransparency
    }
    await waitFor(readTransparency, value => value === 50, 'Slider setting saved')
  }
  await toggle()
  const solid = await waitMaterial('solid')
  assert.match(solid.sidebar, /^rgb\(/)
  if (windows) assert.equal(await dwmBackdrop(window), 1)
  else {
    assert.equal(vibrancyCalls.at(-1), null)
    assert.equal(await evaluate(`document.querySelector('${slider}').disabled`), true)
  }
  await toggle()
  await waitMaterial(glass)
  if (windows) assert.equal(await dwmBackdrop(window), 3)
  else {
    assert.equal(vibrancyCalls.at(-1), 'popover')
    assert.equal(await evaluate(`document.querySelector('${slider}').value`), '50')
  }
  console.log(windows ? 'Windows DWM Acrylic (3 → 1 → 3) and native caption layout verified.' : 'macOS Vibrancy, opaque mode, live tint and persistence verified.')
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
