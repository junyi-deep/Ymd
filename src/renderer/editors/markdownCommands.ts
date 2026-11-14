import { EditorSelection, Transaction, type ChangeSpec } from '@codemirror/state'
import { EditorView, type Command, type KeyBinding } from '@codemirror/view'
import { indentLess, indentMore } from '@codemirror/commands'
import { searchEngines, type SearchEngine } from '../../shared/contracts'
import { markdownHtml, markdownPlainText } from './markdownHtml'
import type { MenuItem } from './MarkdownMenu'

type EditCommand = { label: string; command: Command; key?: string; mac?: string }

const paragraphPrefix = /^(\s*)(?:(?:#{1,6}|>|[-+*]|\d+[.)])(?:[ \t]+|$))(?:\[[ xX]\][ \t]+)?/

function paragraph(prefix: string | ((source: string) => string | undefined)): Command {
  return view => {
    const { state } = view
    const selection = state.selection.main
    const first = state.doc.lineAt(selection.from)
    const last = state.doc.lineAt(selection.empty ? selection.to : selection.to - 1)
    const changes: ChangeSpec[] = []
    for (let number = first.number; number <= last.number; number++) {
      const line = state.doc.line(number)
      const match = paragraphPrefix.exec(line.text)
      const whitespace = match?.[1] ?? /^\s*/.exec(line.text)![0]
      const next = typeof prefix === 'string' ? prefix : prefix((match?.[0] ?? '').trim())
      if (next === undefined) continue
      changes.push({ from: line.from, to: match ? line.from + match[0].length : line.from + whitespace.length,
        insert: whitespace + next })
    }
    if (!changes.length) return true
    view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true })
    return true
  }
}

const headingLevel = (change: number) => paragraph(source => {
  if (!/^#{1,6}$/.test(source)) return undefined
  return '#'.repeat(Math.max(1, Math.min(6, source.length + change))) + ' '
})

function format(start: string, end = start): Command {
  return view => {
    const { state } = view
    const spec = state.changeByRange(range => {
      const selected = state.sliceDoc(range.from, range.to)
      const wrapped = range.from >= start.length && state.sliceDoc(range.from - start.length, range.from) === start &&
        state.sliceDoc(range.to, Math.min(state.doc.length, range.to + end.length)) === end
      if (wrapped) {
        const from = range.from - start.length
        return { changes: { from, to: range.to + end.length, insert: selected }, range: EditorSelection.range(from, from + selected.length) }
      }
      return { changes: { from: range.from, to: range.to, insert: start + selected + end },
        range: EditorSelection.range(range.from + start.length, range.to + start.length) }
    })
    view.dispatch({ ...spec, userEvent: 'input.format', scrollIntoView: true })
    return true
  }
}

function insertBlock(snippet: string, highlight?: string): Command {
  return view => {
    const { state } = view
    const { from, to, empty } = state.selection.main
    const ending = state.doc.lineAt(to)
    const at = empty ? ending.to : from
    const leading = empty && ending.length ? '\n\n' : ''
    const insertion = leading + snippet
    const offset = highlight ? insertion.indexOf(highlight) : -1
    view.dispatch({ changes: { from: at, to: empty ? at : to, insert: insertion }, selection: offset < 0
      ? { anchor: at + insertion.length } : { anchor: at + offset, head: at + offset + highlight!.length },
      scrollIntoView: true, userEvent: 'input' })
    return true
  }
}

function insertAsset(kind: 'link' | 'image'): Command {
  return view => {
    const { from, to } = view.state.selection.main
    const current = view.state.sliceDoc(from, to)
    const label = current || (kind === 'image' ? '图片说明' : '链接文字')
    const url = kind === 'image' ? '图片路径' : 'https://'
    const prefix = (kind === 'image' ? '!' : '') + '[' + label + ']('
    view.dispatch({ changes: { from, to, insert: prefix + url + ')' }, selection: { anchor: from + prefix.length, head: from + prefix.length + url.length }, userEvent: 'input' })
    return true
  }
}

function insertParagraph(before: boolean): Command {
  return view => {
    const { doc, selection } = view.state
    const line = doc.lineAt(before ? selection.main.from : selection.main.to)
    const position = before ? line.from : line.to
    view.dispatch({ changes: { from: position, insert: '\n\n' }, selection: { anchor: before ? position : position + 2 }, scrollIntoView: true, userEvent: 'input' })
    return true
  }
}

const clearStyle: Command = view => {
  const { state } = view
  const selection = state.selection.main
  const line = state.doc.lineAt(selection.from)
  const from = selection.empty ? line.from : selection.from
  const to = selection.empty ? line.to : selection.to
  const insert = markdownPlainText(state.sliceDoc(from, to))
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from, head: from + insert.length }, userEvent: 'input.format' })
  return true
}

const headings = ['一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题']
  .map((label, index) => ({ label, command: paragraph('#'.repeat(index + 1) + ' '), key: 'Mod-' + (index + 1) }))
const formats: EditCommand[] = [
  { label: '加粗', command: format('**'), key: 'Mod-b' },
  { label: '斜体', command: format('*'), key: 'Mod-i' },
  { label: '下划线', command: format('<u>', '</u>'), key: 'Mod-u' },
  { label: '代码', command: format('`'), key: 'Mod-Shift-`' },
  { label: '删除线', command: format('~~'), key: 'Alt-Shift-5', mac: 'Ctrl-Shift-`' },
  { label: '高亮', command: format('==') },
  { label: '超链接', command: insertAsset('link'), key: 'Mod-k' },
  { label: '清除样式', command: clearStyle, key: 'Mod-\\' },
]
const paragraphs: EditCommand[] = [
  ...headings,
  { label: '增加标题级别', command: headingLevel(1), key: 'Mod-=' },
  { label: '减少标题级别', command: headingLevel(-1), key: 'Mod--' },
  { label: '引用', command: paragraph('> '), key: 'Mod-Shift-q', mac: 'Alt-Mod-q' },
  { label: '有序列表', command: paragraph('1. '), key: 'Mod-Shift-[', mac: 'Alt-Mod-o' },
  { label: '无序列表', command: paragraph('- '), key: 'Mod-Shift-]', mac: 'Alt-Mod-u' },
  { label: '任务列表', command: paragraph('- [ ] ') },
  { label: '缩进', command: indentMore, key: 'Mod-[' },
  { label: '减少缩进', command: indentLess, key: 'Mod-]' },
  { label: '段落', command: paragraph(''), key: 'Mod-0' },
]
export const insertMermaid = insertBlock('```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```', 'flowchart LR\n  A[开始] --> B[结束]')
const tableKey = { key: 'Mod-t', mac: 'Alt-Mod-t' }
const inserts: EditCommand[] = [
  { label: '图像', command: insertAsset('image') },
  { label: '代码块', command: insertBlock('```text\n代码\n```', '代码'), key: 'Mod-Shift-k', mac: 'Alt-Mod-c' },
  { label: '公式块', command: insertBlock('$$\n公式\n$$', '公式'), key: 'Mod-Shift-m', mac: 'Alt-Mod-b' },
  { label: '水平分割线', command: insertBlock('---') },
  { label: 'Mermaid 图', command: insertMermaid },
  { label: '在上方插入段落', command: insertParagraph(true) },
  { label: '在下方插入段落', command: insertParagraph(false) },
]

export function typographyKeys(chooseTable: () => void): KeyBinding[] {
  return [...paragraphs, ...formats, ...inserts, { label: '表格', ...tableKey, command: () => { chooseTable(); return true } }]
    .flatMap(item => item.key ? [{ key: item.key, mac: item.mac, run: view => !view.state.readOnly && item.command(view) }] : [])
}

export function contextItems(view: EditorView, platform: string, path: string, report: (error: unknown) => void, readOnly: boolean, searchEngine: SearchEngine, chooseTable: () => void): MenuItem[] {
  const { state } = view
  const selection = state.selection.main
  const source = state.sliceDoc(selection.from, selection.to)
  const mod = 'CommandOrControl+'
  const displayKey = (item: Pick<EditCommand, 'key' | 'mac'>) => (platform === 'darwin' ? item.mac ?? item.key : item.key)
    ?.replace('Mod-', mod).replace('Shift-', 'Shift+').replace('Alt-', 'Alt+').replace('Ctrl-', 'Control+')
    .replace(/[a-z]$/, key => key.toUpperCase())
  const toMenu = (item: EditCommand): MenuItem =>
    ({ label: item.label, shortcut: displayKey(item), run: () => { item.command(view); view.focus() } })
  const chooseImage = () => {
    void window.desktop.chooseMarkdownImage(path).then(source => {
      if (!source || !view.dom.isConnected) return
      const { from, to } = view.state.selection.main
      const label = (view.state.sliceDoc(from, to) || '图片').replaceAll(']', '\\]').replace(/\s+/g, ' ')
      const insert = '![' + label + '](' + source + ')'
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input' })
      view.focus()
    }).catch(report)
  }
  const paste = () => navigator.clipboard.readText().then(insert => {
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, annotations: Transaction.userEvent.of('input.paste') })
    view.focus()
  }).catch(report)
  const copy = (text: string) => navigator.clipboard.writeText(text).catch(report)
  const cut = () => {
    if (!source) return
    void navigator.clipboard.writeText(source).then(() => {
      if (view.state !== state) return
      view.dispatch({ changes: { from: selection.from, to: selection.to }, userEvent: 'delete.cut' })
      view.focus()
    }).catch(report)
  }
  return [
    { label: '剪切', shortcut: mod + 'X', disabled: !source || readOnly, run: cut },
    { label: '拷贝', shortcut: mod + 'C', disabled: !source, run: () => { void copy(source) } },
    { label: '粘贴', shortcut: mod + 'V', disabled: readOnly, run: () => { void paste() } },
    { label: '复制／粘贴为…', children: [
      { label: '复制为 Markdown', disabled: !source, run: () => { void copy(source) } },
      { label: '复制为 HTML 代码', disabled: !source, run: () => { void copy(markdownHtml(source)) } },
      { label: '复制内容并简化格式', disabled: !source, run: () => {
        const html = markdownHtml(source)
        void navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([markdownPlainText(source)], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }) })]).catch(report)
      } },
      { label: '复制为纯文本', disabled: !source, run: () => { void copy(markdownPlainText(source)) } },
      { label: '粘贴为纯文本', disabled: readOnly, run: () => { void paste() } },
    ] },
    { label: '段落', separator: true, disabled: readOnly, children: paragraphs.map(toMenu) },
    { label: '格式', disabled: readOnly, children: formats.map(toMenu) },
    { label: '插入', disabled: readOnly, children: [
      { label: '表格', shortcut: displayKey(tableKey), run: chooseTable },
      ...inserts.map(item => item.label === '图像' ? { label: item.label, run: chooseImage } : toMenu(item)),
    ] },
    { label: '在网页中搜索选中文字', separator: true, disabled: !source.trim(), run: () => {
      const engine = searchEngines[searchEngine]
      const url = new URL(engine.url)
      url.searchParams.set(engine.parameter, source.trim())
      void window.desktop.openExternal(url.href).catch(report)
    } },
  ]
}
