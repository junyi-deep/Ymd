import { useEffect, useRef, useState } from 'react'
import { Code2 } from 'lucide-react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Range } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, highlightSpecialChars, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { GFM } from '@lezer/markdown'

const inlineStyles: Record<string, string> = {
  StrongEmphasis: 'md-bold', Emphasis: 'md-italic', Strikethrough: 'md-strike',
  InlineCode: 'md-inline-code', Link: 'md-link', Autolink: 'md-link', TableCell: 'md-cell',
}
const markers = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark'])

class TaskBox extends WidgetType {
  constructor(readonly position: number, readonly checked: boolean) { super() }

  eq(other: TaskBox) { return this.position === other.position && this.checked === other.checked }

  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.setAttribute('aria-label', '切换任务状态')
    box.addEventListener('change', () => view.dispatch({ changes: {
      from: this.position + 1, to: this.position + 2, insert: box.checked ? 'x' : ' ',
    } }))
    return box
  }
}

function liveMarkdown(view: EditorView) {
  const ranges: Range<Decoration>[] = []
  const state = view.state
  const visible = (from: number, to: number) => state.selection.ranges.some(range => range.from <= to && range.to >= from)
  const activeLine = (from: number) => {
    const line = state.doc.lineAt(from)
    return visible(line.from, line.to)
  }
  const mark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to))
  }
  const hide = (from: number, to: number) => {
    if (from < to && state.doc.lineAt(from).to >= to) ranges.push(Decoration.replace({}).range(from, to))
  }
  const line = (from: number, className: string) => ranges.push(Decoration.line({ class: className }).range(from))
  const tree = syntaxTree(state)

  for (const viewport of view.visibleRanges) {
    tree.iterate({ from: viewport.from, to: viewport.to, enter(node) {
      const { name, from, to } = node
      const parent = node.node.parent
      const sourceLine = state.doc.lineAt(from)
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)
      const css = inlineStyles[name]
      if (css) mark(from, to, css)
      if (heading) line(sourceLine.from, 'md-heading md-h' + heading[1])
      if (name === 'QuoteMark') line(sourceLine.from, 'md-quote')
      if (name === 'FencedCode' || name === 'Table') {
        const last = state.doc.lineAt(to).number
        const firstVisible = state.doc.lineAt(viewport.from).number
        const lastVisible = state.doc.lineAt(viewport.to).number
        for (let index = Math.max(firstVisible, sourceLine.number); index <= Math.min(lastVisible, last); index++) {
          line(state.doc.line(index).from, name === 'Table' ? 'md-table' : 'md-code-block')
        }
      }
      if (name === 'HorizontalRule' && !activeLine(from)) {
        line(sourceLine.from, 'md-rule')
        hide(from, to)
      }
      if (name === 'ListMark' && parent?.parent?.name === 'BulletList' && !activeLine(from)) {
        ranges.push(Decoration.replace({ widget: new Bullet() }).range(from, to))
      }
      if (name === 'TaskMarker' && !activeLine(from)) {
        ranges.push(Decoration.replace({ widget: new TaskBox(from, /x/i.test(state.sliceDoc(from, to))) }).range(from, to))
      }
      if (name === 'Link' && !visible(from, to)) {
        const labelEnd = node.node.getChildren('LinkMark')[1]
        if (labelEnd) {
          hide(from, from + 1)
          hide(labelEnd.from, to)
        }
      }
      if (markers.has(name) && parent && parent.name !== 'FencedCode') {
        const inline = ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'].includes(parent.name)
        if (inline ? visible(parent.from, parent.to) : activeLine(from)) return
        const end = name === 'HeaderMark' || name === 'QuoteMark'
          ? to + (state.sliceDoc(to, Math.min(state.doc.length, to + 1)) === ' ' ? 1 : 0) : to
        hide(from, end)
      }
    } })
  }
  return Decoration.set(ranges, true)
}

class Bullet extends WidgetType {
  toDOM() {
    const bullet = document.createElement('span')
    bullet.textContent = '•'
    bullet.className = 'md-bullet'
    return bullet
  }
}

const live = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) { this.decorations = liveMarkdown(view) }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = liveMarkdown(update.view)
    }
  }
}, { decorations: plugin => plugin.decorations })

const inserts = [
  ['标题', '# 标题', '标题'], ['链接', '[链接文字](https://example.com)', '链接文字'],
  ['图片', '![图片说明](图片路径)', '图片路径'], ['引用', '> 引用文字', '引用文字'],
  ['无序列表', '- 列表项', '列表项'], ['有序列表', '1. 列表项', '列表项'],
  ['任务列表', '- [ ] 待办事项', '待办事项'], ['代码块', '```text\n代码\n```', '代码\n'],
  ['表格', '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |', '列一'],
  ['分隔线', '---', ''], ['公式块', '$$\n公式\n$$', '公式'], ['脚注', '[^1]\n\n[^1]: 注释', '注释'],
] as const

export function MarkdownEditor({ text, onChange, find }: { text: string; onChange: (text: string) => void; find: number }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const change = useRef(onChange)
  const initial = useRef(text)
  const previousFind = useRef(find)
  const [source, setSource] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const renderMode = useRef(new Compartment())
  change.current = onChange

  useEffect(() => {
    const raw = initial.current
    const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
    const newline = raw.match(/\r\n|\n|\r/)?.[0] ?? '\n'
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: raw.slice(bom.length).replace(/\r\n|\r/g, '\n'),
        extensions: [
          highlightSpecialChars(), history(), drawSelection(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping, markdown({ extensions: [GFM], addKeymap: false }),
          search({ top: true }), Prec.high(keymap.of([...markdownKeymap, ...searchKeymap])),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
          renderMode.current.of(live),
          EditorView.updateListener.of(update => {
            if (update.docChanged) change.current(bom + update.state.doc.toString().replaceAll('\n', newline))
          }),
        ],
      }),
    })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: renderMode.current.reconfigure(source ? [] : live) })
  }, [source])
  useEffect(() => {
    if (find !== previousFind.current && view.current) {
      openSearchPanel(view.current)
      previousFind.current = find
    }
  }, [find])
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector('button')?.focus()
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  function insert(label: string, snippet: string, selected: string) {
    const editor = view.current!
    const selection = editor.state.selection.main
    const inline = label === '链接' || label === '图片' || label === '脚注'
    const current = editor.state.sliceDoc(selection.from, selection.to)
    let from = selection.from
    let to = selection.to
    let value = snippet
    if (inline && current && label === '链接') value = snippet.replace('链接文字', () => current)
    if (!inline) {
      const line = editor.state.doc.lineAt(selection.to)
      if (line.length && !current) {
        from = line.to
        to = line.to
        value = (label === '分隔线' || label === '表格' || label === '代码块' || label === '公式块' ? '\n\n' : '\n') + value
      }
    }
    const start = selected ? value.indexOf(selected) : -1
    editor.dispatch({ changes: { from, to, insert: value }, selection: start < 0
      ? { anchor: from + value.length } : { anchor: from + start, head: from + start + selected.trimEnd().length }, scrollIntoView: true })
    setMenu(undefined)
    editor.focus()
  }

  return <div className="markdown-editor" data-source={source}>
    <div className="editor-tools"><button className="tool-button" aria-pressed={source} title="切换 Markdown 源码"
      onClick={() => { setSource(!source); view.current?.focus() }}><Code2 size={15} />源码</button></div>
    <div className="markdown-surface" ref={host} onContextMenu={event => {
      const editor = view.current
      if (!editor) return
      event.preventDefault()
      const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
      const selection = editor.state.selection.main
      if (pos !== null && (pos < selection.from || pos > selection.to)) editor.dispatch({ selection: { anchor: pos } })
      setMenu({ x: Math.min(event.clientX, window.innerWidth - 168), y: Math.min(event.clientY, window.innerHeight - 420) })
    }} />
    {menu && <div className="context-menu" role="menu" ref={menuRef} style={{ left: menu.x, top: Math.max(6, menu.y) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { setMenu(undefined); view.current?.focus() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const items = [...event.currentTarget.querySelectorAll('button')]
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          items[(index + items.length + (event.key === 'ArrowDown' ? 1 : -1)) % items.length]?.focus()
          event.preventDefault()
        }
      }}>
      <div className="menu-label">插入</div>
      {inserts.map(([label, snippet, selected]) => <button key={label} role="menuitem" onClick={() => insert(label, snippet, selected)}>{label}</button>)}
    </div>}
  </div>
}
