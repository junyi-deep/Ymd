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
writeFileSync(path.join(documents, 'Fence input.md'), 'Before the card.\n\n\n\nAfter the card.')
writeFileSync(path.join(documents, 'Outline input.md'), '- Before the card.\n- \n- After the card.\n')

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
  const doubleClick = async query => {
    await wait('Boolean(' + selector(query) + ')', query)
    await evaluate(selector(query) + ".dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))")
  }
  const debuggerCommand = (method, params) => window.webContents.debugger.sendCommand(method, params)
  const type = text => debuggerCommand('Input.insertText', { text })
  const enter = async () => {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
    await debuggerCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
    await debuggerCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  }
  const undo = () => evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z', bubbles: true, cancelable: true, ${process.platform === 'darwin' ? 'metaKey' : 'ctrlKey'}: true,
  }))`)
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
    if (type === 'Mermaid' && !scope) {
      const bounds = side => evaluate(`(() => {
        const thumb = document.querySelector('.media-thumb-frame[data-side="${side}"]')
        if (!thumb) return false
        const map = thumb.getBoundingClientRect()
        const button = thumb.querySelector('.media-thumb-switch').getBoundingClientRect()
        return Math.abs(button.bottom - map.bottom) < 2 && (${side === 'right'} ? button.right <= map.left : button.left >= map.right)
      })()`)
      await wait("Boolean(document.querySelector('.media-thumb-switch'))", 'Mini map is mounted')
      assert.equal(await bounds('right'), true)
      await click(dialog + ' .media-thumb-switch')
      assert.equal(await bounds('left'), true)
      await click(dialog + ' .media-thumb-switch')
      assert.equal(await bounds('right'), true)
    }
    await click(dialog + ' button[aria-label="关闭查看器"]')
  }

  await change('Diagrams', 'Markdown')
  const preview = '.md-code-preview'
  const activeToolbar = '.md-code-edit-header'
  const numbers = ' button[aria-label="显示行号"]'
  const wrap = ' button[aria-label="自动换行"]'
  await click(preview + numbers)
  await click(preview + wrap)
  await wait("Boolean(document.querySelector('.md-code-preview[data-wrap=\"true\"] [data-numbered]'))", 'Preview uses both card options')
  await click('.md-code-preview button[aria-label="编辑代码块"]')
  assert.equal(await evaluate(selector(activeToolbar + numbers) + '.getAttribute("aria-pressed")'), 'true')
  await wait("Boolean(document.querySelector('.cm-line.md-code-wrap[data-code-line=\"1\"]'))", 'Editing keeps the preview settings')
  await click(activeToolbar + wrap)
  await wait("Boolean(document.querySelector('.cm-line.md-code-nowrap[data-code-line=\"1\"]'))", 'Editing changes the line wrapping')
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
  assert.equal(await evaluate(selector(diagram('Mermaid') + ' .mermaid-edit') + '.textContent'), '')
  await doubleClick(diagram('Mermaid') + ' .mermaid-content svg')
  await wait("Boolean(document.querySelector('.md-code-block .tok-keyword'))", 'Mermaid syntax highlighting in Markdown')
  assert.equal(await evaluate(selector(activeToolbar + numbers) + '.getAttribute("aria-pressed")'), 'false')
  await click(activeToolbar + numbers)
  await click(activeToolbar + wrap)
  await wait("Boolean(document.querySelector('.cm-line.md-code-wrap[data-code-line=\"1\"]'))", 'Diagram editing applies card options')
  await evaluate(`(() => { const view = ${view}; view.dispatch({ selection: { anchor: 0 } }) })()`)
  await open('PlantUML', 'Sequence sample')
  await doubleClick(diagram('PlantUML') + ' .mermaid-content svg')
  await wait("Array.from(document.querySelectorAll('.md-code-block .tok-keyword')).some(word => word.textContent === 'participant')",
    'PlantUML syntax highlighting in Markdown')

  await change('Outline diagrams', '大纲')
  await open('PlantUML', 'FirstClass')
  await doubleClick(diagram('PlantUML') + ' .mermaid-content svg')
  await wait("Boolean(document.querySelector('.outline-code-edit .tok-keyword'))", 'PlantUML syntax highlighting in outline')
  await click('.outline-code-card:has(.outline-code-edit)' + numbers)
  await click('.outline-code-card:has(.outline-code-edit)' + wrap)
  await wait("Boolean(document.querySelector('.outline-code-edit .cm-lineWrapping') && document.querySelector('.outline-code-edit .cm-lineNumbers'))", 'Outline diagram editor uses both card options')
  await evaluate("document.querySelector('.outline-editor').focus()")
  await open('Mermaid', 'Outline sample', '.outline-code-card ')
  const toggle = selector('.outline-surrounding button[role="switch"]')
  await wait('Boolean(' + toggle + ')', 'Outline remainder')
  await evaluate(`if (${toggle}.getAttribute('aria-checked') === 'false') ${toggle}.click()`)
  await open('Mermaid', 'Mermaid Start', '.outline-surrounding ')
  await doubleClick('.outline-surrounding ' + diagram('Mermaid') + ' .mermaid-content svg')
  await wait("Boolean(document.querySelector('.md-code-edit-header') && document.querySelector('.md-code-block .tok-keyword')?.textContent === 'flowchart')",
    'Double-clicking an outline remainder chart opens its Markdown source')
  const atLine = async line => {
    await evaluate(`(() => { const view = ${view}; view.dispatch({ selection: { anchor: view.state.doc.line(${line}).from } }); view.focus() })()`)
  }
  const markdownState = () => evaluate(`[ ${view}.state.doc.toString(), ${view}.state.selection.main.head ]`)
  await change('Fence input', 'Markdown')
  await wait('Boolean(' + view + ')', 'Blank Markdown fixture loaded')
  await atLine(3)
  for (let index = 0; index < 3; index++) await type('`')
  assert.deepEqual(await markdownState(), ['Before the card.\n\n```\n```\n\nAfter the card.', 'Before the card.\n\n```'.length])
  await wait('Boolean(' + selector(activeToolbar) + ')', 'The third backtick enters editing mode')
  await enter()
  assert.deepEqual(await markdownState(), ['Before the card.\n\n```\n\n```\n\nAfter the card.', 'Before the card.\n\n```\n'.length])
  await atLine(3)
  await type('Inserted above')
  assert.deepEqual(await markdownState(), ['Before the card.\n\nInserted above\n```\n\n```\n\nAfter the card.', 'Before the card.\n\nInserted above'.length])
  await atLine(4)
  await enter()
  assert.deepEqual(await markdownState(), ['Before the card.\n\nInserted above\n\n```\n\n```\n\nAfter the card.', 'Before the card.\n\nInserted above\n'.length])
  await click(preview + ' button[aria-label="删除代码块"]')
  assert.equal((await markdownState())[0], 'Before the card.\n\nInserted above\n\n\nAfter the card.')
  await undo()
  assert.match((await markdownState())[0], /```\n\n```/)

  await change('Outline input', '大纲')
  await click('.outline-preview[aria-label="编辑块 空块"]')
  for (let index = 0; index < 3; index++) await type('`')
  const opening = selector('.outline-code-fence')
  await wait(opening + " === document.activeElement && document.activeElement.selectionStart === 3", 'Outline keeps its caret after the opening fence')
  await evaluate(opening + '.setSelectionRange(0, 0)')
  await type('Above in outline')
  await wait("document.querySelector('.outline-editor textarea:focus')?.value === 'Above in outline'", 'Typing before the outline fence inserts a block above it')
  await click('.outline-code-card button[aria-label="编辑代码块"]')
  await evaluate(opening + '.setSelectionRange(0, 0)')
  await enter()
  await wait("document.querySelector('.outline-editor textarea:focus')?.value === ''", 'Enter before an outline fence inserts an empty block above it')
  await click('.outline-code-card button[aria-label="删除代码块"]')
  assert.equal(await evaluate('Boolean(' + selector('.outline-code-card') + ')'), false)
  await undo()
  await wait('Boolean(' + selector('.outline-code-card') + ')', 'Outline can undo deleting a code card')
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
