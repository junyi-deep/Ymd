const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app } = require('electron')

const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-markdown-html-'))
const documents = path.join(profile, '.ymd', 'documents')
mkdirSync(documents, { recursive: true })
app.setPath('userData', profile)
app.setPath('home', profile)
writeFileSync(path.join(profile, 'preferences.json'), '{"autoCheckUpdates":false,"autoSave":false}')
writeFileSync(path.join(documents, 'HTML.md'), [
  'Inline <span style="color: red; background-color: gold; position: fixed" onclick="void 0">red <b>bold</b></span> and <a href="javascript:void(0)">text</a>.',
  '',
  '<details open>',
  '<summary>Example</summary>',
  '<table><tr><td>cell</td></tr></table>',
  '</details>',
  '',
  'word word',
].join('\n'))
const outlineFile = path.join(documents, 'Outline search.md')
const outlineText = '\uFEFF' + [
  '# Header tag-a', '', '- Parent tag-b', '  - Child Tag-c', '    - Grandchild tag-d', '- tagged tag-e', '', 'After tag-f',
].join('\r\n')
writeFileSync(outlineFile, outlineText)

async function waitFor(read, label) {
  for (let i = 0; i < 120; i++) {
    const result = await read()
    if (result) return result
    await delay(50)
  }
  throw new Error(label)
}

async function check(window) {
  const { webContents } = window
  const evaluate = source => webContents.executeJavaScript(source)
  const control = label => `document.querySelector('.document-find [aria-label="${label}"]')`
  const click = label => evaluate(control(label) + '.click()')
  const value = (label, text) => evaluate(`(() => {
    const input = ${control(label)}
    input.value = ${JSON.stringify(text)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const key = (label, key, modifiers = {}) => evaluate(`${control(label)}.dispatchEvent(new KeyboardEvent('keydown',
    ${JSON.stringify({ bubbles: true, cancelable: true, key, ...modifiers })}))`)
  const openFind = async () => {
    webContents.send('ymd:command', 'find')
    await waitFor(() => evaluate("Boolean(document.querySelector('.document-find'))"), 'Find opened through the editor command')
    assert.deepEqual(await evaluate(`(() => {
      const panel = document.querySelector('.document-find-host .document-find')
      const box = panel.getBoundingClientRect()
      const title = document.querySelector('.title-path')
      const titlebar = title.closest('.titlebar').getBoundingClientRect()
      const search = ${control('查找')}
      const input = search.getBoundingClientRect()
      return [document.activeElement === search, ${control('替换为')}.parentElement.hidden,
        Math.abs(box.left - title.getBoundingClientRect().left - parseFloat(getComputedStyle(title).paddingLeft)) <= 1,
        box.top >= titlebar.bottom && box.top <= titlebar.bottom + 10, box.right <= innerWidth,
        document.elementFromPoint(input.left + input.width / 2, input.top + input.height / 2) === search]
    })()`), [true, true, true, true, true, true])
  }
  await waitFor(() => evaluate("Boolean(document.querySelector('.tree-row[title=\"HTML.md\"]'))"), 'HTML document listed')
  await evaluate("document.querySelector('.tree-row[title=\"HTML.md\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.md-html-block td'))"), 'HTML table rendered')
  assert.deepEqual(await evaluate(`(() => {
    const span = document.querySelector('.md-html-inline span[style]')
    const style = getComputedStyle(span)
    return [span.textContent, style.color, style.backgroundColor, style.position, span.hasAttribute('onclick'),
      document.querySelector('.md-html-inline a').hasAttribute('href'), document.querySelector('.md-html-block td').textContent]
  })()`), ['red bold', 'rgb(255, 0, 0)', 'rgb(255, 215, 0)', 'static', false, false, 'cell'])
  await openFind()
  await value('查找', 'word')
  await click('展开替换')
  await value('替换为', 'updated')
  await click('替换全部匹配')
  await waitFor(() => evaluate("document.querySelector('.markdown-surface .cm-content').textContent.includes('updated updated')"), 'Replace all updated the document')
  await key('查找', 'Escape')
  assert.equal(await evaluate("Boolean(document.querySelector('.document-find'))"), false)
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Markdown 编辑器')

  await evaluate(`document.querySelector('.tree-row[title="Outline search.md"]').click()`)
  await waitFor(() => evaluate("document.querySelector('.document-name')?.textContent === 'Outline search.md'"), 'Opened outline fixture')
  await evaluate(`document.querySelector('.mode-switch [aria-label="大纲"]').click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.outline-editor .outline-toggle'))"), 'Outline shows nested blocks')
  window.setContentSize(660, 680)
  await evaluate(`document.querySelector('.outline-editor [aria-label="折叠子块"]').click()`)
  await openFind()
  const result = () => evaluate("document.querySelector('.outline-find-source mark')?.textContent")
  await click('正则表达式')
  await value('查找', '[')
  assert.equal(await evaluate(control('查找') + '.getAttribute("aria-invalid")'), 'true')
  await click('区分大小写')
  await click('全字匹配')
  await value('查找', 'tag-([a-z])')
  await key('查找', 'Enter')
  await waitFor(async () => (await result()) === 'tag-a', 'First match in the surrounding Markdown')
  await key('查找', 'F3', { shiftKey: true })
  await waitFor(async () => (await result()) === 'tag-f', 'Previous match wraps to the end')
  await value('查找', 'tag-(d)')
  await click('下一个匹配')
  await waitFor(async () => (await result()) === 'tag-d', 'Search reveals a collapsed grandchild')
  await click('展开替换')
  await value('替换为', 'one-$1')
  await key('替换为', 'Enter')
  await waitFor(() => evaluate("document.querySelector('.outline-editor').textContent.includes('Grandchild one-d')"),
    'Single replacement expands a regular expression group')
  await value('查找', 'tag-([a-z])')
  await value('替换为', 'two-$1')
  await click('替换全部匹配')
  await key('查找', 'Escape')
  assert.equal(await evaluate("Boolean(document.querySelector('.document-find'))"), false)
  assert.equal(await evaluate("document.activeElement.className"), 'outline-editor')
  const replaced = outlineText.replace('tag-d', 'one-d').replace(/tag-([a-z])/g, 'two-$1')
  const save = async expected => {
    webContents.send('ymd:command', 'save')
    await waitFor(() => readFileSync(outlineFile, 'utf8') === expected, 'Save preserves the block tree, case, BOM, and line endings')
  }
  await save(replaced)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'z', bubbles: true, ${process.platform === 'darwin' ? 'metaKey' : 'ctrlKey'}: true }))`)
  await save(outlineText.replace('tag-d', 'one-d'))
  await evaluate(`document.querySelector('.mode-switch [aria-label="Markdown"]').click()`)
  await waitFor(() => evaluate("document.querySelector('.markdown-surface .cm-content')?.textContent.includes('Grandchild one-d')"),
    'Both editor modes see the same document after replacement and undo')
  console.log('Verified HTML styles, cleanup, and document find/replace in Markdown and outline on ' + process.platform)
}

const timeout = setTimeout(() => { console.error('Markdown HTML and find check timed out.'); app.exit(1) }, 45000)
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
