const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app, BrowserWindow } = require('electron')

const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-markdown-scroll-'))
const documents = path.join(profile, '.ymd', 'documents')
mkdirSync(documents, { recursive: true })
writeFileSync(path.join(profile, 'preferences.json'), '{"autoCheckUpdates":false,"autoSave":false}')
const file = path.join(documents, 'Scroll.md')
const text = Array.from({ length: 120 }, (_, i) =>
  '## Section ' + i + '\n\nSome **formatted text** to scroll through.\n\n| Name | Value |\n|---|---|\n| Item | ' + i + ' |\n').join('\n')
writeFileSync(file, text)
app.setPath('userData', profile)
app.setPath('home', profile)

async function waitFor(read, label) {
  for (let i = 0; i < 60; i++) {
    const result = await read()
    if (result) return result
    await delay(50)
  }
  throw new Error(label)
}

async function check(window) {
  const { webContents } = window
  const evaluate = source => webContents.executeJavaScript(source)
  await waitFor(() => evaluate("Boolean(document.querySelector('button.tree-row[title=\"Scroll.md\"]'))"), 'Sample listed')
  await evaluate("document.querySelector('button.tree-row[title=\"Scroll.md\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.markdown-table-widget'))"), 'Table rendered')
  webContents.debugger.attach()
  const mouse = event => webContents.debugger.sendCommand('Input.dispatchMouseEvent', event)
  const position = await evaluate(`(() => {
    const scroller = document.querySelector('.markdown-surface .cm-scroller')
    globalThis.originalScrollContainer = scroller
    scroller.scrollTop = 3000
    const rect = scroller.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + 150 }
  })()`)
  await mouse({ type: 'mouseMoved', ...position })
  const other = new BrowserWindow({ width: 300, height: 260, show: false })
  const read = () => evaluate(`(() => {
    const scroller = document.querySelector('.markdown-surface .cm-scroller')
    return { scroll: scroller.scrollTop, text: scroller.querySelector('.cm-content').cmTile.root.view.state.doc.sliceString(0, 40) }
  })()`)
  for (let i = 0; i < 6; i++) {
    other.show()
    app.focus({ steal: true })
    other.focus()
    await waitFor(() => !window.isFocused(), 'Editor lost focus')
    const marker = 'External revision ' + i
    writeFileSync(file, marker + '\n\n' + text)
    await delay(380)
    other.hide()
    window.show()
    app.focus({ steal: true })
    window.focus()
    await waitFor(() => window.isFocused(), 'Editor regained focus')
    await waitFor(async () => (await read()).text.startsWith(marker), 'External revision loaded')
    assert.equal(await evaluate("document.querySelector('.markdown-surface .cm-scroller') === globalThis.originalScrollContainer"), true,
      'External refresh must retain the scroll container')
    await delay(150)
    const before = (await read()).scroll
    const delta = before > 1000 ? -200 : 200
    await mouse({ type: 'mouseWheel', ...position, deltaX: 0, deltaY: delta })
    await delay(250)
    const after = (await read()).scroll
    console.log('Focus cycle', i, JSON.stringify({ before, after, delta }))
    assert.equal(Math.sign(after - before), Math.sign(delta), 'Wheel must scroll after an external file update and focus switch')
  }
  other.destroy()
  webContents.debugger.detach()
  console.log('Verified wheel scrolling after external changes on ' + process.platform)
}

const timeout = setTimeout(() => { console.error('Markdown scroll check timed out.'); app.exit(1) }, 90000)
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
