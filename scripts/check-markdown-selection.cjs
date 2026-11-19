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
const chart = '```mermaid\nflowchart LR\nA --> B\n```'
writeFileSync(path.join(documents, 'After diagrams.md'), [
  '# 记录', chart, chart, '**表变更说明：**' + label, '> 这是下方的引用，内容应与正文选区区分。', table,
].join('\n\n'))
writeFileSync(path.join(documents, 'Editable table.md'), [
  'Before the table.', '', '| Field | Value |', '| --- | --- |', '| **A deliberately wide table cell** | Short |', '', 'After the table.',
].join('\n'))

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
  for (const name of ['Link', 'Bold', 'After diagrams']) {
    const button = "document.querySelector('button.tree-row[title=\"" + name + ".md\"]')"
    await waitFor(() => evaluate('Boolean(' + button + ')'))
    await evaluate(button + '.click()')
    await waitFor(() => evaluate(`document.querySelector('.document-name')?.textContent === '${name}.md' &&
      Boolean(document.querySelector('.markdown-table-widget'))`))
    if (name === 'After diagrams') {
      await waitFor(() => evaluate("document.querySelectorAll('.mermaid-content svg').length === 2"))
    }
    for (const backward of [false, true]) {
      const rect = await evaluate(`(() => {
        const content = document.querySelector('.markdown-surface .cm-content')
        const view = content.cmTile.root.view
        view.focus()
        view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })
        const target = ${JSON.stringify(target)}
        const line = [...content.querySelectorAll('.cm-line')].find(line => line.textContent.includes(target))
        if (!line) return
        const nodes = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
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
      assert.equal(await evaluate('getSelection()?.toString()'), target, name)
      const copied = await webContents.executeJavaScript("document.execCommand('copy'); navigator.clipboard.readText()", true)
      assert.equal(copied, target)
    }
  }
  await checkEditableTable(evaluate, mouse)
  webContents.debugger.detach()
  console.log('Verified Markdown drag selection, copying, and table editing on ' + process.platform)
}

async function checkEditableTable(evaluate, mouse) {
  const figure = '.markdown-table-widget'
  const cell = figure + ' td[data-column="0"]'
  const button = `document.querySelector('button.tree-row[title="Editable table.md"]')`
  await waitFor(() => evaluate('Boolean(' + button + ')'))
  await evaluate(button + '.click()')
  await waitFor(() => evaluate(`document.querySelector('.document-name')?.textContent === 'Editable table.md' && Boolean(document.querySelector('${cell}'))`))
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

  const point = selector => evaluate(`(() => {
    const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
    return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
  })()`)
  const click = async ({ x, y }) => {
    await mouse('mouseMoved', x, y)
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
    await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 })
  }
  const widths = () => evaluate(`[...document.querySelectorAll('${figure} th')].map(cell => cell.getBoundingClientRect().width)`)
  for (const inside of [false, true]) {
    const before = await widths()
    await click(await point(cell))
    assert.equal(await evaluate(`Boolean(document.querySelector('${cell} input:focus'))`), true, 'Click opens the cell editor')
    const editing = await widths()
    const gap = await evaluate(`(() => {
      const widget = document.querySelector('${figure}')
      const { right } = widget.getBoundingClientRect()
      const grid = widget.querySelector('table').getBoundingClientRect()
      const content = widget.closest('.cm-content').getBoundingClientRect()
      const x = ${inside} ? (grid.right + right) / 2 : (right + content.right) / 2
      if (x <= grid.right) throw new Error('The test table needs a right margin')
      return { x, y: (grid.top + grid.bottom) / 2 }
    })()`)
    const replacement = inside ? 'Saved inside the table block' : 'Saved from the page margin'
    await evaluate(`document.querySelector('${cell} input').value = ${JSON.stringify(replacement)}`)
    await click(gap)
    assert.deepEqual({
      stableColumns: editing.every((size, index) => Math.abs(size - before[index]) < 1),
      rendered: await evaluate(`Boolean(document.querySelector('${figure}'))`),
      committed: await evaluate(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString().includes(${JSON.stringify(replacement)})`),
    }, { stableColumns: true, rendered: true, committed: true }, `Column widths ${before} → ${editing}`)
  }

  await click(await point(figure + ' button[aria-label="编辑表格源码"]'))
  assert.equal(await evaluate(`Boolean(document.querySelector('${figure}'))`), false, 'The explicit source button still opens source')
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
