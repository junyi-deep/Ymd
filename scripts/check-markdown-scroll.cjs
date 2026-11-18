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
const diagrams = Array.from({ length: 150 }, (_, i) =>
  '## Diagram ' + i + '\n\n```mermaid\nflowchart TD\nA --> B --> C --> D --> E --> F --> G --> H\n```\n\n').join('')
writeFileSync(path.join(documents, 'Drag.md'), diagrams + '# End of document\n')
writeFileSync(path.join(documents, 'Fast.md'), diagrams + '# End of document\n')
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

async function checkDrag(window) {
  const { webContents } = window
  const evaluate = source => webContents.executeJavaScript(source)
  async function open(name) {
    const button = "document.querySelector('button.tree-row[title=\"" + name + ".md\"]')"
    await waitFor(() => evaluate('Boolean(' + button + ')'), 'Drag sample listed')
    await evaluate(button + '.click()')
    await waitFor(() => evaluate(`document.querySelector('.document-name')?.textContent === '${name}.md' &&
      Boolean(document.querySelector('.mermaid-content svg'))`), 'First diagram rendered')
  }
  await open('Drag')
  const geometry = () => evaluate(`(() => {
    const scroller = document.querySelector('.markdown-surface .cm-scroller')
    const track = document.querySelector('.markdown-scrollbar').getBoundingClientRect()
    const thumb = document.querySelector('.markdown-scrollbar-thumb').getBoundingClientRect()
    return { x: track.left + track.width / 2, top: track.top, bottom: track.bottom, center: thumb.top + thumb.height / 2,
      height: scroller.scrollHeight, offset: scroller.scrollTop, remaining: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop }
  })()`)
  const start = await geometry()
  assert.ok(start.bottom > start.top && start.center > start.top, 'Scrollbar track and thumb are visible')
  assert.equal(await evaluate(`document.elementFromPoint(${start.x}, ${start.center})?.className`),
    'markdown-scrollbar-thumb', 'Initial mouse hit is on the thumb')
  const mouse = (type, y, options = {}) => webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: start.x, y, ...options })
  await mouse('mouseMoved', start.center)
  await mouse('mousePressed', start.center, { button: 'left', buttons: 1, clickCount: 1 })
  let heightChanged = false
  for (const fraction of [.1, .2, .3, .4, .5, .6, .7, .8]) {
    const y = start.top + (start.bottom - start.top) * fraction
    await mouse('mouseMoved', y, { buttons: 1 })
    try {
      await waitFor(async () => Math.abs((await geometry()).center - y) <= 2, 'Thumb follows the mouse')
    } catch (error) {
      console.log({ start, y, actual: await geometry(), dragging: await evaluate("document.querySelector('.markdown-scrollbar').dataset.dragging") })
      throw error
    }
    await delay(75)
    heightChanged ||= Math.abs((await geometry()).height - start.height) > 200
  }
  assert.ok(heightChanged, 'Diagram rendering changed the scroll height while dragging')
  await mouse('mouseMoved', start.bottom - 1, { buttons: 1 })
  await waitFor(async () => Math.abs((await geometry()).remaining) <= 1, 'Thumb reached the current document end')
  await mouse('mouseReleased', start.bottom - 1, { button: 'left', clickCount: 1 })
  await delay(250)
  assert.ok(Math.abs((await geometry()).remaining) <= 1, 'Releasing the thumb keeps the viewport at the bottom')
  await open('Fast')
  const top = await geometry()
  assert.ok(top.offset < 100, JSON.stringify({ start, top }))
  await mouse('mouseMoved', top.center)
  await mouse('mousePressed', top.center, { button: 'left', buttons: 1, clickCount: 1 })
  await mouse('mouseMoved', top.bottom - 1, { buttons: 1 })
  await mouse('mouseReleased', top.bottom - 1, { button: 'left', clickCount: 1 })
  await delay(750)
  assert.ok(Math.abs((await geometry()).remaining) <= 1, 'Fast drag and release reaches the bottom after late layout')
  console.log('Verified scrollbar dragging with late-rendered diagrams on ' + process.platform)
}

async function checkExternalRefresh(window) {
  const { webContents } = window
  const evaluate = source => webContents.executeJavaScript(source)
  await waitFor(() => evaluate("Boolean(document.querySelector('button.tree-row[title=\"Scroll.md\"]'))"), 'Sample listed')
  await evaluate("document.querySelector('button.tree-row[title=\"Scroll.md\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.markdown-table-widget'))"), 'Table rendered')
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
  console.log('Verified wheel scrolling after external changes on ' + process.platform)
}

async function check(window) {
  window.webContents.debugger.attach()
  await checkDrag(window)
  if (process.platform === 'win32') await checkExternalRefresh(window)
  window.webContents.debugger.detach()
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
