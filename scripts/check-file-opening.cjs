const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, realpathSync, writeFileSync, existsSync } = require('node:fs')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { app } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const started = performance.now()
const profile = realpathSync(process.env.YMD_OPEN_CHECK_PROFILE || mkdtempSync(path.join(os.tmpdir(), 'ymd-file-opening-')))
const outside = path.join(profile, 'Outside project')
const cold = path.join(outside, '启动文档.MD')
const warm = path.join(outside, 'Warm document.md')
const drop = path.join(outside, 'Drop sample.md')
const sibling = path.join(outside, 'Keep another.md')
const slowRecent = path.join(outside, 'Slow recent path.md')
app.setPath('home', profile)
app.setPath('userData', profile)
const second = process.env.YMD_OPEN_CHECK_PROFILE !== undefined
let restoreRecent
if (!second) {
  mkdirSync(outside)
  for (const [file, text] of [[cold, 'Cold document text'], [warm, 'Warm document text'], [drop, 'Dropped document text'], [sibling, 'Other document text']]) {
    writeFileSync(file, '# ' + text)
  }
  writeFileSync(path.join(profile, 'preferences.json'), '{"autoCheckUpdates":false,"autoSave":false}')
  writeFileSync(path.join(profile, 'recent.json'), JSON.stringify([slowRecent, warm, sibling].map(file => ({ path: file, kind: 'markdown' }))))
  const result = new Promise(resolve => { restoreRecent = resolve })
  const resolvePath = fs.realpath
  fs.realpath = async (file, ...args) => {
    if (file === slowRecent) await result
    return resolvePath(file, ...args)
  }
  process.argv.push(cold)
}

async function check(window) {
  const web = window.webContents
  const evaluate = code => web.executeJavaScript(code)
  const query = selector => 'document.querySelector(' + JSON.stringify(selector) + ')'
  const wait = async (code, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(code)) return
      await delay(40)
    }
    throw new Error(label)
  }
  const click = async selector => {
    await wait('Boolean(' + query(selector) + ')', selector)
    await evaluate(query(selector) + '.click()')
  }
  const content = text => wait(`${query('.markdown-surface .cm-content')}?.textContent.includes(${JSON.stringify(text)})`, `Editor shows ${text}`)
  await content('Cold document text')
  console.log('Cold launch to editable Markdown with a blocked recent path: ' + Math.round(performance.now() - started) + ' ms')
  restoreRecent()
  const child = spawn(process.execPath, [__filename, warm], { env: { ...process.env, YMD_OPEN_CHECK_PROFILE: profile }, stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  await content('Warm document text')
  assert.equal(await exited, 0, 'The launch hands the file to the running instance')
  await click('.tree-row[title="Keep another.md"]')
  await content('Other document text')
  await click('.tree-row[title="Warm document.md"]')
  await content('Warm document text')
  await click('button[aria-label="移除 Warm document.md"]')
  await wait('Boolean(' + query('.home-screen') + ')', 'Removing the active local file returns home')
  assert.ok(existsSync(warm), 'Removing keeps the file on disk')
  web.debugger.attach()
  try {
    const point = await evaluate(`(() => {
      const area = document.querySelector('.home-screen').getBoundingClientRect()
      return { x: area.left + area.width / 2, y: area.top + area.height / 2 }
    })()`)
    const data = { items: [], files: [drop], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await web.debugger.sendCommand('Input.dispatchDragEvent', { type, ...point, data })
    }
  } finally { web.debugger.detach() }
  await content('Dropped document text')
  await click('button[aria-label="删除 Drop sample.md"]')
  await click('button[aria-label="确认删除 Drop sample.md"]')
  await wait('Boolean(' + query('.home-screen') + ')', 'Deleting the active local file returns home even with other sessions')
  assert.equal(existsSync(drop), false)
  console.log('Verified cold and warm open, file drag/drop, local removal and deletion on ' + process.platform)
}

if (!second) {
  const timeout = setTimeout(() => app.exit(1), 35000)
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => {
      void check(window).then(() => { clearTimeout(timeout); app.exit(0) }, error => {
        console.error(error)
        clearTimeout(timeout)
        app.exit(1)
      })
    })
  })
}
require('../dist/main/index.js')
