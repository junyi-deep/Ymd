const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app } = require('electron')

const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-git-diff-'))
const documents = path.join(profile, '.ymd', 'documents')
const project = path.join(documents, 'Project')
const file = path.join(project, 'Diff sample.md')
mkdirSync(project, { recursive: true })
app.setPath('userData', profile)
app.setPath('home', profile)
writeFileSync(path.join(profile, 'preferences.json'), '{"autoCheckUpdates":false,"autoSave":false}')
writeFileSync(path.join(documents, 'Outside.md'), '# Outside')

const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
git('init', '-q', '-b', 'topic/diff')
git('config', 'user.name', 'Ymd Tests')
git('config', 'user.email', 'ymd@example.invalid')
git('config', 'commit.gpgsign', 'false')
git('config', 'core.autocrlf', 'false')
const contents = (first, last) => '\uFEFF' + [
  '# History', first, ...Array.from({ length: 32 }, (_, index) => 'Context line ' + index), last, '',
].join('\r\n')
writeFileSync(file, contents('First commit A', 'Baseline B'))
git('add', '--', 'Diff sample.md')
git('commit', '-qm', 'Initial version')
const old = git('rev-parse', 'HEAD')
const subject = 'Latest version ' + 'long commit message '.repeat(9).trim()
writeFileSync(file, contents('Baseline A', 'Baseline B'))
git('add', '--', 'Diff sample.md')
git('commit', '-qm', subject, '-m', 'Additional commit details.')
const head = git('rev-parse', 'HEAD')

// A byte-level change Git sees even though the editor uses LF internally.
const formatFile = path.join(project, 'Format.md')
writeFileSync(formatFile, '## Same text\nSecond line\n')
git('add', '--', 'Format.md')
git('commit', '-qm', 'Add format example')
writeFileSync(formatFile, '\uFEFF## Same text\r\nSecond line\r\n')
const finalTip = git('rev-parse', 'HEAD')

async function check(window) {
  const { webContents: web } = window
  web.debugger.attach()
  await web.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  const evaluate = source => web.executeJavaScript(source)
  const query = selector => 'document.querySelector(' + JSON.stringify(selector) + ')'
  const wait = async (read, label) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const value = await read()
      if (value) return value
      await delay(50)
    }
    throw new Error(label + ' ' + await evaluate(`${query('.git-diff-status')}?.textContent ?? ''`))
  }
  const visible = selector => wait(() => evaluate('Boolean(' + query(selector) + ')'), selector)
  const click = async selector => { await visible(selector); await evaluate(query(selector) + '.click()') }
  const view = query('.markdown-surface .cm-content') + '.cmTile.root.view'
  const buttons = '.cm-merge-revert button'
  const picker = label => `button.git-diff-version-label[aria-label="${label}"]`
  const left = query(picker('基准版本'))
  const right = query(picker('比较版本'))
  const chooseVersion = async (label, search) => {
    await click(picker(label))
    const input = query(`input[aria-label="搜索${label}"]`)
    await wait(() => evaluate(`${input} === document.activeElement`), 'The commit search receives focus')
    await evaluate(`(() => {
      const input = ${input}
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(search)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await wait(() => evaluate("document.querySelectorAll('.git-version-option').length === 1"), 'Commit search filters the timeline')
    const key = key => evaluate(input + `.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`)
    await key('ArrowDown')
    assert.equal(await evaluate(query('.git-version-option') + '.getAttribute("aria-selected")'), 'true')
    await key('Enter')
    assert.ok(await evaluate(query(picker(label)) + ' === document.activeElement'))
  }

  await click('.tree-row[title="Outside.md"]')
  await visible('.markdown-surface .cm-content')
  assert.equal(await evaluate('Boolean(' + query('.git-branch-button') + ')'), false)
  await click('.tree-row[title="Project"]')
  await click('.tree-row[title="Diff sample.md"]')
  await visible('.git-branch-button')
  assert.equal(await evaluate(query('.git-branch-button') + '.textContent'), 'topic/diff')
  assert.notEqual(git('diff', old, finalTip, '--', 'Diff sample.md'), '')
  assert.equal(git('diff', 'HEAD', '--', 'Diff sample.md'), '')
  await click('.git-branch-button')
  const initial = await wait(() => evaluate(`document.querySelector('.git-diff-status')?.textContent === '没有内容差异' ? 'empty'
    : document.querySelector('.cm-merge-a .cm-content')?.textContent.includes('First commit A') ? 'previous' : ''`), 'Initial comparison')
  assert.equal(initial, 'previous', 'A clean file opens a comparison with its previous content version')
  assert.equal(await evaluate(left + '.dataset.ref'), old)
  await chooseVersion('基准版本', 'Additional commit details')
  assert.equal(await evaluate(left + '.dataset.ref'), head)
  await wait(() => evaluate(query('.git-diff-status') + "?.textContent === '没有内容差异'"), 'Explicitly selecting identical versions remains empty')
  await click('button[aria-label="返回编辑"]')
  writeFileSync(file, contents('Working A', 'Working B'))
  await wait(() => evaluate(view + ".state.doc.toString().includes('Working B')"), 'The editor reads the new file contents')
  await evaluate(`(() => {
    const editor = ${view}
    const from = editor.state.doc.toString().indexOf('Working B')
    editor.dispatch({ changes: { from, to: from + 'Working B'.length, insert: 'Unsaved B' } })
  })()`)
  await click('.git-branch-button')
  await visible(buttons)
  assert.equal(await evaluate(left + '.dataset.ref'), finalTip)
  await chooseVersion('基准版本', 'LATEST VERSION')
  await visible(buttons)
  assert.equal(await evaluate(left + '.dataset.ref'), head)
  assert.match(await evaluate(left + '.title'), /Additional commit details/)
  assert.equal(await evaluate(query('.git-diff-version-label code') + '.textContent'), git('rev-parse', '--short', head))
  assert.ok(await evaluate("Array.from(document.querySelectorAll('.cm-merge-b .cm-changedLine')).some(line => line.textContent === 'Unsaved B')"))
  await visible('.cm-collapsedLines')
  await click('button[aria-label="显示完整内容"]')
  await wait(() => evaluate("!document.querySelector('.cm-collapsedLines')"), 'Full comparison shows unchanged lines')

  await chooseVersion('比较版本', git('rev-parse', '--short', old))
  await wait(() => evaluate("document.querySelector('.cm-merge-b .cm-content')?.textContent.includes('First commit A')"), 'Historical right version')
  assert.match(await evaluate(right + '.title'), /Initial version/)
  assert.equal(await evaluate('Boolean(' + query(buttons) + ')'), false)
  await chooseVersion('比较版本', '当前文件')
  await visible(buttons)

  const paneWidth = () => evaluate(query('.cm-mergeViewEditor') + '.getBoundingClientRect().width')
  const width = await paneWidth()
  const point = await evaluate(`(() => {
    const rect = ${query('.git-diff-divider')}.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + 15 }
  })()`)
  const mouse = (type, x, options = {}) => web.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y: point.y, ...options })
  await mouse('mouseMoved', point.x)
  await mouse('mousePressed', point.x, { button: 'left', buttons: 1, clickCount: 1 })
  await mouse('mouseMoved', point.x + 70, { buttons: 1 })
  await mouse('mouseReleased', point.x + 70, { button: 'left', clickCount: 1 })
  await wait(async () => await paneWidth() > width + 45, 'The divider resizes the actual editor pane')

  await click(buttons)
  await wait(() => evaluate(view + ".state.doc.toString().includes('Baseline A')"), 'Apply changes the real editor')
  assert.match(await evaluate(view + '.state.doc.toString()'), /Unsaved B/)
  assert.equal(readFileSync(file, 'utf8'), contents('Working A', 'Working B'), 'Applying changes the draft before saving')
  await click('button[aria-label="返回编辑"]')
  web.send('ymd:command', 'save')
  await wait(() => readFileSync(file, 'utf8') === contents('Baseline A', 'Unsaved B'), 'Save preserves BOM and CRLF')
  await evaluate(`${view}.focus()
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true,
      ${process.platform === 'darwin' ? 'metaKey' : 'ctrlKey'}: true }))`)
  assert.match(await evaluate(view + '.state.doc.toString()'), /Working A/)
  assert.match(await evaluate(view + '.state.doc.toString()'), /Unsaved B/)
  assert.equal(git('diff', '--cached', '--name-only'), '')
  await click('.tree-row[title="Format.md"]')
  await wait(() => evaluate(view + ".state.doc.toString().includes('Same text')"), 'The format example is the active document')
  await click('.git-branch-button')
  await wait(() => evaluate(query('.git-diff-status') + '?.textContent.includes("右侧 有 BOM · CRLF")'), 'Git-visible format changes are shown')
  assert.equal(await evaluate('Boolean(' + query(buttons) + ')'), false)
  web.debugger.detach()
  console.log('Verified Git history search, content and format diffs, split resizing, hunk apply, save and undo on ' + process.platform)
}

const timeout = setTimeout(() => { console.error('Git diff check timed out.'); app.exit(1) }, 45000)
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
