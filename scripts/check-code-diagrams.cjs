const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { app, clipboard } = require('electron')

const profile = mkdtempSync(path.join(os.tmpdir(), 'ymd-code-diagrams-'))
const documents = path.join(profile, '.ymd', 'documents')
mkdirSync(documents, { recursive: true })
app.setPath('userData', profile)
app.setPath('home', profile)
writeFileSync(path.join(profile, 'preferences.json'), '{"autoCheckUpdates":false,"autoSave":false}')
const mermaid = ['flowchart LR', '  A[Mermaid Start] --> B[Done]']
const fence = (language, code) => ['```' + language, ...code, '```']
const outlineFence = (language, code) => fence(language, code).map((line, index) => (index === 0 ? '- ' : '  ') + line)
const editableCode = 'const edited = 42'
writeFileSync(path.join(documents, 'Diagrams.md'), [
  '# Examples', '', ...fence('javascript title="sample"', ['const edited = 41']), '',
  ...fence('mermaid', mermaid), '', ...fence('plantuml', ['participant Alice', 'Alice -> Bob : Sequence sample']), '',
].join('\n'))
writeFileSync(path.join(documents, 'Outline diagrams.md'), [
  '# Remainder', '', ...fence('mermaid', mermaid), '',
  ...outlineFence('puml', ['@startuml', 'class FirstClass', 'class SecondClass', 'FirstClass --> SecondClass', '@enduml']),
  ...outlineFence('mermaid', ['sequenceDiagram', '  Lia->>Mo: Outline sample']), '',
].join('\n'))

async function check(window) {
  window.webContents.debugger.attach()
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  const evaluate = script => window.webContents.executeJavaScript(script)
  const wait = async (script, label) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      const result = await evaluate(script)
      if (result) return result
      await delay(50)
    }
    const errors = await evaluate("Array.from(document.querySelectorAll('.mermaid-error'), value => value.textContent)")
    throw new Error(label + ' ' + errors.join(' '))
  }
  const selector = query => 'document.querySelector(' + JSON.stringify(query) + ')'
  const click = async query => { await wait('Boolean(' + selector(query) + ')', query); await evaluate(selector(query) + '.click()') }
  const change = async (file, mode) => {
    await click('.tree-row[title="' + file + '.md"]')
    await wait(`document.querySelector('.document-name')?.textContent === ${JSON.stringify(file + '.md')}`, file)
    await click('.mode-switch [aria-label="' + mode + '"]')
  }
  const diagram = type => '.mermaid-preview[aria-label="' + type + ' 图"]'
  const open = async (type, expected, scope = '') => {
    const card = scope + diagram(type)
    const button = card + ' button[aria-label="查看 ' + type + ' 图"]'
    await wait(`Boolean(${selector(card)})`, type + ' preview')
    await evaluate(selector(card) + ".scrollIntoView({ block: 'center' })")
    await click(button)
    const dialog = 'dialog[open][aria-label="查看 ' + type + ' 图"]'
    const image = selector(dialog + ' img')
    await wait(image + '?.naturalWidth > 0', type + ' viewer loads its image')
    assert.ok(await evaluate(`decodeURIComponent(${image}.src).includes(${JSON.stringify(expected)})`), type + ' SVG has the diagram label')
    assert.ok(await evaluate(`Array.from(${selector(dialog)}.querySelectorAll('button')).some(button => button.textContent.includes('下载 SVG'))`))
    await click(dialog + ' button[aria-label="关闭查看器"]')
  }

  await change('Diagrams', 'Markdown')
  await click('.md-code-preview button[aria-label="编辑代码块"]')
  const view = "document.querySelector('.markdown-surface .cm-content').cmTile.root.view"
  await evaluate(`(() => {
    const view = ${view}
    const line = view.state.doc.line(4)
    view.dispatch({ changes: { from: line.from, to: line.to, insert: ${JSON.stringify(editableCode)} } })
  })()`)
  await click('.md-code-edit-header button[aria-label="复制代码"]')
  await wait("Boolean(document.querySelector('.md-code-edit-header [aria-label=\"已复制代码\"]'))", 'Copy resolves')
  assert.equal(await clipboard.readText(), editableCode)
  const picker = selector('.md-code-edit-header input[aria-label="代码语言"]')
  await evaluate(`(() => {
    const input = ${picker}
    input.focus()
    input.value = 'typescript'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })()`)
  assert.equal(await evaluate(view + '.state.doc.line(3).text'), '```typescript title="sample"')
  await evaluate(`(() => { const view = ${view}; view.dispatch({ selection: { anchor: 0 } }) })()`)
  await open('Mermaid', 'Mermaid Start')
  await click(diagram('Mermaid') + ' .mermaid-edit')
  await wait("Boolean(document.querySelector('.md-code-block .tok-keyword'))", 'Mermaid syntax highlighting in Markdown')
  await evaluate(`(() => { const view = ${view}; view.dispatch({ selection: { anchor: 0 } }) })()`)
  await open('PlantUML', 'Sequence sample')
  await click(diagram('PlantUML') + ' .mermaid-edit')
  await wait("Array.from(document.querySelectorAll('.md-code-block .tok-keyword')).some(word => word.textContent === 'participant')",
    'PlantUML syntax highlighting in Markdown')

  await change('Outline diagrams', '大纲')
  await open('PlantUML', 'FirstClass')
  await click('.outline-code-card button[aria-label="编辑代码块"]')
  await wait("Boolean(document.querySelector('.outline-code-edit .tok-keyword'))", 'PlantUML syntax highlighting in outline')
  await evaluate("document.querySelector('.outline-editor').focus()")
  await open('Mermaid', 'Outline sample', '.outline-code-card ')
  const toggle = selector('.outline-surrounding button[role="switch"]')
  await wait('Boolean(' + toggle + ')', 'Outline remainder')
  await evaluate(`if (${toggle}.getAttribute('aria-checked') === 'false') ${toggle}.click()`)
  await open('Mermaid', 'Mermaid Start', '.outline-surrounding ')
  window.webContents.debugger.detach()
  console.log('Verified diagram previews and viewers, syntax highlighting, code language editing and copying on ' + process.platform)
}

const timeout = setTimeout(() => { console.error('Code and diagram check timed out.'); app.exit(1) }, 45000)
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
