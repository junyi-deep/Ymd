import { EditorSelection, Prec, Transaction, type ChangeSpec } from '@codemirror/state'
import { EditorView, type Command } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { indentLess, indentMore } from '@codemirror/commands'
import { searchEngines, type SearchEngine } from '../../shared/contracts'
import { inputChord, markdownShortcuts, shortcutAccelerator, shortcutMenuLabel, ShortcutSequence, shortcutsFor, shortcutValue,
  type MarkdownShortcut, type ShortcutOverrides } from '../../shared/shortcuts'
import { markdownHtml, markdownPlainText } from './markdownHtml'
import { chooseMarkdownImages } from './markdownImages'
import { insertFootnote, insertMetadata } from './markdownNotes'
import type { MenuItem } from './MarkdownMenu'

type EditCommand = { id: MarkdownShortcut; command: Command }

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

export const tabInList = (outdent = false): Command => view => {
  const { state } = view
  if (state.readOnly || !view.contentDOM.contains(view.dom.ownerDocument.activeElement)) return false
  const line = state.doc.lineAt(state.selection.main.head)
  let node = syntaxTree(state).resolveInner(Math.max(line.from, Math.min(line.to, state.selection.main.head)), -1)
  while (node.parent && node.name !== 'ListItem') node = node.parent
  if (node.name !== 'ListItem') {
    node = syntaxTree(state).resolve(line.from, 1)
    while (node.parent && node.name !== 'ListItem') node = node.parent
  }
  if (node.name !== 'ListItem') return false

  const previous = node.prevSibling?.getChild('ListMark')
  const parent = node.parent?.parent?.getChild('ListMark')
  const delta = outdent ? parent : previous
  if (!delta || !state.selection.main.empty) {
    if (!state.selection.main.empty) (outdent ? indentLess : indentMore)(view)
    return true
  }
  const padding = /^[ \t]+/.exec(state.sliceDoc(delta.to, state.doc.lineAt(delta.to).to))?.[0].length ?? 1
  const width = delta.to - delta.from + padding
  const first = state.doc.lineAt(node.from).number
  const last = state.doc.lineAt(node.to).number
  const changes: ChangeSpec[] = []
  for (let index = first; index <= last; index++) {
    const row = state.doc.line(index)
    if (!row.text.trim()) continue
    const leading = /^ */.exec(row.text)![0].length
    changes.push(outdent
      ? { from: row.from, to: row.from + Math.min(leading, width) }
      : { from: row.from, insert: ' '.repeat(width) })
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input.indent', scrollIntoView: true })
  return true
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

const insertHyperlink: Command = view => {
  const { from, to } = view.state.selection.main
  const label = view.state.sliceDoc(from, to) || '链接文字'
  const url = 'https://'
  const prefix = '[' + label + ']('
  view.dispatch({ changes: { from, to, insert: prefix + url + ')' }, selection: { anchor: from + prefix.length, head: from + prefix.length + url.length }, userEvent: 'input' })
  return true
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

const formats: EditCommand[] = [
  { id: 'bold', command: format('**') },
  { id: 'italic', command: format('*') },
  { id: 'underline', command: format('<u>', '</u>') },
  { id: 'code', command: format('`') },
  { id: 'strike', command: format('~~') },
  { id: 'highlight', command: format('==') },
  { id: 'hyperlink', command: insertHyperlink },
  { id: 'clear-style', command: clearStyle },
]
const paragraphs: EditCommand[] = [
  ...(['heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6'] as const)
    .map((id, index) => ({ id, command: paragraph('#'.repeat(index + 1) + ' ') })),
  { id: 'heading-more', command: headingLevel(1) },
  { id: 'heading-less', command: headingLevel(-1) },
  { id: 'quote', command: paragraph('> ') },
  { id: 'ordered-list', command: paragraph('1. ') },
  { id: 'unordered-list', command: paragraph('- ') },
  { id: 'task-list', command: paragraph('- [ ] ') },
  { id: 'indent', command: indentMore },
  { id: 'outdent', command: indentLess },
  { id: 'paragraph', command: paragraph('') },
]
export const insertMermaid = insertBlock('```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```', 'flowchart LR\n  A[开始] --> B[结束]')
const inserts: EditCommand[] = [
  { id: 'code-block', command: insertBlock('```text\n代码\n```', '代码') },
  { id: 'formula', command: insertBlock('$$\n公式\n$$', '公式') },
  { id: 'rule', command: insertBlock('---') },
  { id: 'mermaid', command: insertMermaid },
  { id: 'footnote', command: insertFootnote },
  { id: 'metadata', command: insertMetadata },
  { id: 'paragraph-before', command: insertParagraph(true) },
  { id: 'paragraph-after', command: insertParagraph(false) },
]
const editCommands = new Map([...paragraphs, ...formats, ...inserts].map(item => [item.id, item.command]))

export function typographyKeys(overrides: ShortcutOverrides, platform: string, chooseTable: () => void,
  chooseImage: (view: EditorView) => void) {
  const bindings = shortcutsFor('markdown', overrides, platform)
  const sequence = new ShortcutSequence()
  return Prec.highest(EditorView.domEventHandlers({
    blur() { sequence.reset() },
    keydown(event, view) {
      if (view.state.readOnly || event.isComposing || event.keyCode === 229 ||
          event.target instanceof Element && event.target.closest('input, textarea, select, button, dialog')) return false
      if (event.key === 'Escape') { sequence.reset(); return false }
      const chord = inputChord({ key: event.key, code: event.code, alt: event.altKey, control: event.ctrlKey, meta: event.metaKey,
        shift: event.shiftKey }, platform)
      const id = chord && sequence.take(chord, bindings, event.repeat)
      if (!id) return false
      if (id === 'table') chooseTable()
      else if (id === 'image') chooseImage(view)
      else if (id !== 'pending') return editCommands.get(id as MarkdownShortcut)?.(view) ?? false
      return true
    },
  }))
}

export function contextItems(view: EditorView, platform: string, path: string, report: (error: unknown) => void, readOnly: boolean,
  searchEngine: SearchEngine, shortcuts: ShortcutOverrides, chooseTable: () => void): MenuItem[] {
  const { state } = view
  const selection = state.selection.main
  const source = state.sliceDoc(selection.from, selection.to)
  const mod = 'CommandOrControl+'
  const commandItem = (id: MarkdownShortcut, run: () => void): MenuItem => {
    const key = shortcutValue(shortcuts, id, platform)
    return { label: shortcutMenuLabel(markdownShortcuts[id].label, key, platform), shortcut: shortcutAccelerator(key), run }
  }
  const toMenu = (item: EditCommand) => commandItem(item.id, () => { item.command(view); view.focus() })
  const pasteText = () => navigator.clipboard.readText().then(insert => {
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
    { label: '粘贴', shortcut: mod + 'V', disabled: readOnly, run: () => { void window.desktop.pasteMarkdownClipboard().catch(report) } },
    { label: '复制／粘贴为…', children: [
      { label: '复制为 Markdown', disabled: !source, run: () => { void copy(source) } },
      { label: '复制为 HTML 代码', disabled: !source, run: () => { void copy(markdownHtml(source)) } },
      { label: '复制内容并简化格式', disabled: !source, run: () => {
        const html = markdownHtml(source)
        void navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([markdownPlainText(source)], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }) })]).catch(report)
      } },
      { label: '复制为纯文本', disabled: !source, run: () => { void copy(markdownPlainText(source)) } },
      { label: '粘贴为纯文本', disabled: readOnly, run: () => { void pasteText() } },
    ] },
    { label: '段落', separator: true, disabled: readOnly, children: paragraphs.map(toMenu) },
    { label: '格式', disabled: readOnly, children: formats.map(toMenu) },
    { label: '插入', disabled: readOnly, children: [
      commandItem('table', chooseTable),
      commandItem('image', () => chooseMarkdownImages(view, path, report)),
      ...inserts.map(toMenu),
    ] },
    { label: '在网页中搜索选中文字', separator: true, disabled: !source.trim(), run: () => {
      const engine = searchEngines[searchEngine]
      const url = new URL(engine.url)
      url.searchParams.set(engine.parameter, source.trim())
      void window.desktop.openExternal(url.href).catch(report)
    } },
  ]
}
