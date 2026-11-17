const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app } = require('electron')

const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-markdown-selection-'))
const documents = path.join(profile, '.ymd', 'documents')
mkdirSync(documents, { recursive: true })
app.setPath('userData', profile)
app.setPath('home', profile)
writeFileSync(path.join(profile, 'preferences.json'), '{"autoCheckUpdates":false}')
const target = '字段配置、同步索引并'
const label = '保存' + target + '启用'
const table = '| 字段名 | 字段类型 |\n|---|---|\n| title | string |'
for (const [name, text] of [['Link', '[' + label + '](https://example.com/)'], ['Bold', '**' + label + '**']]) {
  writeFileSync(path.join(documents, name + '.md'), '表变更说明：' + text + '\n\n' + table + '\n')
}

async function waitFor(read) {
  for (let i = 0; i < 120; i++) {
    const result = await read()
    if (result) return result
    await delay(50)
  }
  throw new Error('Markdown editor fixture did not become ready.')
}

async function check(window) {
  const { webContents } = window
  const evaluate = source => webContents.executeJavaScript(source)
  webContents.debugger.attach()
  const mouse = (type, x, y, options = {}) => webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, ...options })
  for (const name of ['Link', 'Bold']) {
    const button = "document.querySelector('button.tree-row[title=\"" + name + ".md\"]')"
    await waitFor(() => evaluate('Boolean(' + button + ')'))
    await evaluate(button + '.click()')
    await waitFor(() => evaluate(`document.querySelector('.document-name')?.textContent === '${name}.md' &&
      Boolean(document.querySelector('.markdown-table-widget'))`))
    for (const backward of [false, true]) {
      const rect = await evaluate(`(() => {
        const content = document.querySelector('.markdown-surface .cm-content')
        const view = content.cmTile.root.view
        view.focus()
        view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })
        const nodes = document.createTreeWalker(content.querySelector('.cm-line'), NodeFilter.SHOW_TEXT)
        const target = ${JSON.stringify(target)}
        for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
          const index = node.data.indexOf(target)
          if (index < 0) continue
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + target.length)
          const { left, right, y, height } = range.getBoundingClientRect()
          return { left, right, y: y + height / 2 }
        }
      })()`)
      assert.ok(rect, 'The rendered label contains the sample text')
      const [start, end] = backward ? [rect.right, rect.left] : [rect.left, rect.right]
      await mouse('mouseMoved', start, rect.y)
      await mouse('mousePressed', start, rect.y, { button: 'left', buttons: 1, clickCount: 1 })
      for (let i = 1; i <= 10; i++) await mouse('mouseMoved', start + (end - start) * i / 10, rect.y, { buttons: 1 })
      await mouse('mouseReleased', end, rect.y, { button: 'left', clickCount: 1 })
      assert.equal(await evaluate('getSelection()?.toString()'), target)
      const copied = await webContents.executeJavaScript("document.execCommand('copy'); navigator.clipboard.readText()", true)
      assert.equal(copied, target)
    }
  }
  webContents.debugger.detach()
  console.log('Verified drag selection and copying above a Markdown table on ' + process.platform)
}

const timeout = setTimeout(() => { console.error('Markdown selection check timed out.'); app.exit(1) }, 45000)
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
