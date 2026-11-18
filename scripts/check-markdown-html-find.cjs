const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
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
  await waitFor(() => evaluate("Boolean(document.querySelector('.tree-row[title=\"HTML.md\"]'))"), 'HTML document listed')
  await evaluate("document.querySelector('.tree-row[title=\"HTML.md\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.md-html-block td'))"), 'HTML table rendered')
  assert.deepEqual(await evaluate(`(() => {
    const span = document.querySelector('.md-html-inline span[style]')
    const style = getComputedStyle(span)
    return [span.textContent, style.color, style.backgroundColor, style.position, span.hasAttribute('onclick'),
      document.querySelector('.md-html-inline a').hasAttribute('href'), document.querySelector('.md-html-block td').textContent]
  })()`), ['red bold', 'rgb(255, 0, 0)', 'rgb(255, 215, 0)', 'static', false, false, 'cell'])
  webContents.send('ymd:command', 'find')
  await waitFor(() => evaluate("Boolean(document.querySelector('.markdown-find'))"), 'Find opened through the editor command')
  assert.deepEqual(await evaluate(`(() => {
    const panel = document.querySelector('.markdown-find')
    const box = panel.getBoundingClientRect()
    const surface = document.querySelector('.markdown-surface').getBoundingClientRect()
    return [document.activeElement.getAttribute('aria-label'), panel.querySelector('[aria-label="替换为"]').parentElement.hidden,
      box.top - surface.top <= 10 && surface.right - box.right <= 24, getComputedStyle(panel).boxShadow !== 'none']
  })()`), ['查找', true, true, true])
  await evaluate(`(() => {
    const setValue = (label, value) => {
      const input = document.querySelector('.markdown-find [aria-label="' + label + '"]')
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setValue('查找', 'word')
    document.querySelector('.markdown-find [aria-label="展开替换"]').click()
    setValue('替换为', 'updated')
    document.querySelector('.markdown-find [aria-label="替换全部匹配"]').click()
  })()`)
  await waitFor(() => evaluate("document.querySelector('.markdown-surface .cm-content').textContent.includes('updated updated')"), 'Replace all updated the document')
  await evaluate("document.querySelector('.markdown-find [aria-label=\"关闭查找\"]').click()")
  assert.equal(await evaluate("Boolean(document.querySelector('.markdown-find'))"), false)
  console.log('Verified HTML styles, cleanup, and Markdown find/replace on ' + process.platform)
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
