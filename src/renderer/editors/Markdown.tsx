import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { BetweenHorizontalStart, Check, Code2, Copy, Eye, FileDown, FileText, FolderInput, Info, Keyboard, ListTree, LocateFixed, MoreHorizontal, Pin, Printer, Search, Star, Trash2 } from 'lucide-react'
import { MarkdownMenu, type MenuItem } from './MarkdownMenu'
import { contextItems, insertMermaid, tabInList, typographyKeys } from './markdownCommands'
import { markdownPlainText } from './markdownHtml'
import { chooseMarkdownImages, editImageReference, imageContextItems, isImageNode, MarkdownImage, markdownImageIntake, readImageReference, type ImageResizeRequest } from './markdownImages'
import { MediaViewer } from './MediaViewer'
import { mediaPreviewEvent, type MediaPreview } from './mediaPreview'
import { MarkdownImageSize } from './MarkdownImageSize'
import { codeBlockPreferences, renderedBlocks } from './renderedBlocks'
import { TableSizeGrid } from './TableSizeGrid'
import { insertTable, markdownTable } from './markdownTable'
import { expandMetadata, FootnoteReference, footnotes, insertFootnote, insertMetadata, markdownNotes, markdownWithMetadata, referenceNote } from './markdownNotes'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdownKeymap } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Range } from '@codemirror/state'
import { Decoration, EditorView, highlightSpecialChars, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { markdownPageWidths, type CodeBlockPreferences, type ContextMenuItem, type MarkdownOutlinePreferences, type MarkdownPageWidth, type SearchEngine } from '../../shared/contracts'
import type { DocumentViewPosition } from './viewPosition'
import { colorOpening, highlightOpening, numberOpening } from './outlineTextStyle'
import type { ShortcutOverrides } from '../../shared/shortcuts'
import { PaneResize } from '../PaneResize'

class DocumentTitle extends WidgetType {
  constructor(readonly element: HTMLElement) { super() }
  eq(widget: DocumentTitle) { return widget.element === this.element }
  toDOM() { return this.element }
}

const inlineStyles: Record<string, string> = {
  StrongEmphasis: 'md-bold', Emphasis: 'md-italic', Strikethrough: 'md-strike',
  InlineCode: 'md-inline-code', Highlight: 'md-highlight', Underline: 'md-underline', Link: 'md-link', Autolink: 'md-link',
}
const markers = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark', 'HighlightMark', 'UnderlineMark', 'TextColorMark', 'HighlightColorMark'])

class TaskBox extends WidgetType {
  constructor(readonly position: number, readonly checked: boolean, readonly readOnly: boolean) { super() }

  eq(other: TaskBox) { return this.position === other.position && this.checked === other.checked && this.readOnly === other.readOnly }

  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.disabled = this.readOnly
    box.setAttribute('aria-label', '切换任务状态')
    box.addEventListener('change', () => view.dispatch({ changes: {
      from: this.position + 1, to: this.position + 2, insert: box.checked ? 'x' : ' ',
    } }))
    return box
  }
}

function liveMarkdown(view: EditorView, path: string, loadRemote: boolean) {
  const ranges: Range<Decoration>[] = []
  const state = view.state
  const visible = (from: number, to: number) => state.selection.ranges.some(range => !state.readOnly && range.from <= to && range.to >= from)
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
      if (name === 'Frontmatter') return false
      if (name === 'FootnoteReference' && !visible(from, to)) {
        const note = referenceNote(state, from, to)
        if (note) ranges.push(Decoration.replace({ widget: new FootnoteReference(note) }).range(from, to))
        return false
      }
      const parent = node.node.parent
      const sourceLine = state.doc.lineAt(from)
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)
      const css = inlineStyles[name]
      if (css) mark(from, to, css)
      if (name === 'TextColor' || name === 'HighlightColor') {
        const highlight = name === 'HighlightColor'
        const opening = state.sliceDoc(from, Math.min(from + 40, to))
        const color = (highlight ? highlightOpening : colorOpening).exec(opening)?.[1]
        if (color) mark(from, to, (highlight ? 'ymd-highlight-' : 'ymd-text-') + color)
        else if (!highlight && numberOpening.test(opening)) mark(from, to, 'ymd-outline-number')
      }
      if (heading) {
        line(sourceLine.from, 'md-heading md-h' + heading[1])
        // CodeMirror samples short, plain-text lines to estimate its offscreen height.
        mark(sourceLine.from, sourceLine.to, 'md-heading-text')
      }
      if (name === 'QuoteMark') line(sourceLine.from, 'md-quote')
      if (name === 'FencedCode' || name === 'Table') {
        const last = state.doc.lineAt(to).number
        const firstVisible = state.doc.lineAt(viewport.from).number
        const lastVisible = state.doc.lineAt(viewport.to).number
        for (let index = Math.max(firstVisible, sourceLine.number); index <= Math.min(lastVisible, last); index++) {
          const styled = state.doc.line(index)
          line(styled.from, name === 'Table' ? 'md-table' : 'md-code-block')
          if (name === 'FencedCode') mark(styled.from, styled.to, 'md-code-text')
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
        ranges.push(Decoration.replace({ widget: new TaskBox(from, /x/i.test(state.sliceDoc(from, to)), state.readOnly) }).range(from, to))
      }
      if (isImageNode(name)) {
        const editing = !state.readOnly && state.selection.ranges.some(range => range.from < to && range.to > from)
        const reference = !editing && sourceLine.to >= to ? readImageReference(state, node.node) : undefined
        if (reference) {
          const standalone = sourceLine.text.trim() === reference.markdown
          ranges.push(Decoration.replace({ widget: new MarkdownImage(path, reference, loadRemote, standalone) }).range(from, to))
        }
        return false
      }
      if (name === 'Link' && !visible(from, to)) {
        const labelEnd = node.node.getChildren('LinkMark')[1]
        if (labelEnd) {
          hide(from, from + 1)
          hide(labelEnd.from, to)
        }
      }
      if (markers.has(name) && parent && parent.name !== 'FencedCode') {
        const inline = ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Highlight', 'Underline', 'TextColor', 'HighlightColor'].includes(parent.name)
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

const live = (path: string, loadRemote: boolean) => ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) { this.decorations = liveMarkdown(view, path, loadRemote) }

  update(update: ViewUpdate) {
    if (update.startState.readOnly !== update.state.readOnly || update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = liveMarkdown(update.view, path, loadRemote)
    }
  }
}, { decorations: plugin => plugin.decorations })

type StatusKind = 'words' | 'lines' | 'modified'
type OpenMenu = 'outline-numbering' | 'more' | 'status'
type Heading = { pos: number; level: number; title: string }
const outlineNumberings = [
  ['none', '不显示编号'], ['flat', '数字序号'], ['hierarchical', '带层级的数字序号'],
] as const

interface Props {
  position: DocumentViewPosition
  text: string
  name: string
  path: string
  modified: number
  platform: string
  remoteImages: boolean
  searchEngine: SearchEngine
  keyOverrides: ShortcutOverrides
  filenameTitle?: React.ReactNode
  saveStatus?: React.ReactNode
  outline: MarkdownOutlinePreferences
  width: MarkdownPageWidth
  codeBlocks: CodeBlockPreferences
  setWidth: (width: MarkdownPageWidth) => void
  updateOutline: (patch: Partial<MarkdownOutlinePreferences>) => void
  registerFlush: (flush?: () => void) => void
  onChange: (text: string) => void
  find: number
  jump?: { line: number; id: number }
  reveal: () => void
  saveCopy: () => void
  duplicate: () => void
  move: () => void
  trash: () => void
  shortcuts: () => void
  exportPdf: () => void
  printDocument: () => void
  pinned: boolean
  starred: boolean
  togglePin: () => void
  toggleStar: () => void
  report: (error: unknown) => void
}

export function MarkdownEditor({ text, name, path, modified, platform, remoteImages, searchEngine, keyOverrides, outline, filenameTitle, saveStatus, updateOutline, width, codeBlocks, setWidth, registerFlush, onChange, find, jump, reveal, saveCopy, duplicate, move, trash, shortcuts, exportPdf, printDocument, pinned, starred, togglePin, toggleStar, report, position }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [titleHost] = useState(() => document.createElement('div'))
  const titleMode = useRef(new Compartment())
  const hasTitle = !!filenameTitle
  const titleExtension = useMemo(() => hasTitle ? EditorView.decorations.of(Decoration.set([
    Decoration.widget({ widget: new DocumentTitle(titleHost), block: true, side: -1 }).range(0),
  ])) : [], [hasTitle, titleHost])
  const [media, setMedia] = useState<MediaPreview>()
  useEffect(() => {
    const element = host.current!
    const show = (event: Event) => setMedia((event as CustomEvent<MediaPreview>).detail)
    element.addEventListener(mediaPreviewEvent, show)
    return () => element.removeEventListener(mediaPreviewEvent, show)
  }, [])
  const view = useRef<EditorView>(null)
  const change = useRef(onChange)
  const initial = useRef(text)
  const previousFind = useRef(find)
  const [source, setSource] = useState(position.markdown?.source ?? false)
  const sourceMode = useRef(source)
  sourceMode.current = source
  const [menu, setMenu] = useState<OpenMenu>()
  const [headings, setHeadings] = useState<Heading[]>([])
  const [status, setStatus] = useState<StatusKind>('words')
  const [reading, setReading] = useState(false)
  const [info, setInfo] = useState(false)
  const [imageResize, setImageResize] = useState<ImageResizeRequest>()
  const infoDialog = useRef<HTMLDialogElement>(null)
  const tableDialog = useRef<HTMLDialogElement>(null)
  const [tableOpen, setTableOpen] = useState(false)
  const [tableRows, setTableRows] = useState('3')
  const [tableColumns, setTableColumns] = useState('2')
  const [tableHover, setTableHover] = useState<{ rows: number; columns: number }>()
  const numberingTrigger = useRef<HTMLButtonElement>(null)
  const [numberingPoint, setNumberingPoint] = useState<{ x: number; y: number }>()
  const readMode = useRef(new Compartment())
  const renderMode = useRef(new Compartment())
  const keyMode = useRef(new Compartment())
  change.current = onChange
  const showTable = () => {
    setTableHover(undefined)
    tableDialog.current?.showModal()
    setTableOpen(true)
  }
  const addTable = (rows: number, columns: number) => {
    if (!view.current || !Number.isInteger(rows) || rows < 1 || rows > 100 ||
        !Number.isInteger(columns) || columns < 1 || columns > 30) return
    setTableRows(String(rows))
    setTableColumns(String(columns))
    tableDialog.current?.close()
    insertTable(view.current, rows, columns)
  }
  const writingKeys = () => typographyKeys(keyOverrides, platform, showTable, editor => chooseMarkdownImages(editor, path, report))

  useLayoutEffect(() => {
    const raw = initial.current
    const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
    const newline = raw.match(/\r\n|\n|\r/)?.[0] ?? '\n'
    const doc = raw.slice(bom.length).replace(/\r\n|\r/g, '\n')
    const previous = position.markdown
    const sameText = previous?.text === raw
    const editor = new EditorView({
      parent: host.current!,
      scrollTo: previous && (sameText ? previous.scroll : EditorView.scrollIntoView(Math.min(doc.length, previous.top), { y: 'start' })),
      state: EditorState.create({
        doc,
        selection: sameText ? { anchor: previous.anchor, head: previous.head } : undefined,
        extensions: [
          highlightSpecialChars(), history(), keymap.of([...defaultKeymap.filter(binding =>
            !['Mod-i', 'Mod-[', 'Mod-]'].includes(binding.key ?? '') && (platform === 'darwin' || binding.key !== 'Shift-Mod-k')), ...historyKeymap]),
          EditorView.lineWrapping, markdownWithMetadata, syntaxHighlighting(classHighlighter), indentUnit.of('  '), footnotes, keyMode.current.of(writingKeys()),
          search({ top: true }), Prec.high(keymap.of([{ key: 'Enter', run: expandMetadata },
            { key: 'Tab', run: tabInList(), shift: tabInList(true) },
            ...markdownKeymap, ...searchKeymap.filter(binding => binding.key !== 'Mod-f')])),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
          markdownImageIntake(path, report),
          renderMode.current.of(sourceMode.current ? [] : [live(path, remoteImages), codeBlockPreferences.of(codeBlocks), renderedBlocks, markdownTable, markdownNotes]),
          readMode.current.of([]), titleMode.current.of(titleExtension),
          EditorView.updateListener.of(update => {
            if (update.docChanged) change.current(bom + update.state.doc.toString().replaceAll('\n', newline))
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      const { anchor, head } = editor.state.selection.main
      position.markdown = { anchor, head, source: sourceMode.current, scroll: editor.scrollSnapshot(),
        top: editor.lineBlockAtHeight(editor.scrollDOM.scrollTop).from,
        text: bom + editor.state.doc.toString().replaceAll('\n', newline) }
      editor.destroy()
      view.current = null
    }
  }, [])

  useLayoutEffect(() => {
    view.current?.dispatch({ effects: titleMode.current.reconfigure(titleExtension) })
  }, [titleExtension])

  useEffect(() => {
    view.current?.dispatch({ effects: keyMode.current.reconfigure(writingKeys()) })
  }, [keyOverrides, platform])

  useEffect(() => {
    registerFlush(() => view.current?.dom.querySelector<HTMLInputElement>('.markdown-table-widget input:focus')?.blur())
    return () => registerFlush()
  }, [registerFlush])

  useEffect(() => {
    view.current?.dispatch({ effects: renderMode.current.reconfigure(source ? [] : [live(path, remoteImages), codeBlockPreferences.of(codeBlocks), renderedBlocks, markdownTable, markdownNotes]) })
  }, [source, path, remoteImages, codeBlocks])
  useEffect(() => {
    view.current?.dispatch({ effects: readMode.current.reconfigure([
      EditorState.readOnly.of(reading), EditorView.editable.of(!reading),
    ]) })
  }, [reading])
  useEffect(() => {
    if (info) infoDialog.current?.showModal()
    else if (infoDialog.current?.open) infoDialog.current.close()
  }, [info])
  useEffect(() => {
    const editor = view.current
    if (!editor || !jump) return
    const line = editor.state.doc.line(Math.min(jump.line, editor.state.doc.lines))
    editor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    editor.focus()
  }, [jump])
  useEffect(() => {
    if (find !== previousFind.current && view.current) {
      openSearchPanel(view.current)
      previousFind.current = find
    }
  }, [find])
  const close = () => setMenu(undefined)
  const toggleMenu = (value: OpenMenu) => setMenu(current => current === value ? undefined : value)
  const statisticsText = useDeferredValue(text)
  const [characters, setCharacters] = useState<number>()
  useEffect(() => {
    if (status !== 'words' && !info) return
    const idle = window.requestIdleCallback(() => {
      const words = markdownPlainText(statisticsText)
        .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' $& ')
        .match(/[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*|[^\u0000-\u007f\s]/gu)?.length ?? 0
      setCharacters(words)
    }, { timeout: 800 })
    return () => window.cancelIdleCallback(idle)
  }, [statisticsText, status, info])
  const lineCount = view.current?.state.doc.lines ?? 1
  const updateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(modified)
  const statusText = status === 'words' ? `${characters ?? '…'} 字` : status === 'lines' ? `${lineCount} 行` : updateTime
  useEffect(() => {
    const state = view.current?.state
    if (!outline.visible || !state) return
    let pending: number | undefined
    const update = () => {
      const tree = ensureSyntaxTree(state, state.doc.length, 18)
      if (!tree) {
        pending = window.setTimeout(update, 16)
        return
      }
      const next: Heading[] = []
      tree.iterate({ enter(node) {
        if (node.name === 'Frontmatter') return false
        const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)
        if (!match) return
        const title = state.sliceDoc(node.from, node.to).split('\n')[0].replace(/^#{1,6}\s+|\s+#+\s*$/g, '').trim()
        if (title) next.push({ pos: node.from, level: Number(match[1]), title })
      } })
      setHeadings(next)
    }
    pending = window.setTimeout(update, 66)
    return () => window.clearTimeout(pending)
  }, [text, outline.visible])
  const numberedHeadings = useMemo(() => {
    const ancestors: { level: number; ordinal: number; children: number }[] = []
    let roots = 0
    return headings.map((heading, index) => {
      while (ancestors.length && ancestors.at(-1)!.level >= heading.level) ancestors.pop()
      const parent = ancestors.at(-1)
      const depth = ancestors.length
      ancestors.push({ level: heading.level, ordinal: parent ? ++parent.children : ++roots, children: 0 })
      const number = outline.numbering === 'flat' ? String(index + 1) : outline.numbering === 'hierarchical'
        ? ancestors.map(item => item.ordinal).join('.') : ''
      return { ...heading, depth, number }
    })
  }, [headings, outline.numbering])
  const outlineItems: MenuItem[] = outlineNumberings.map(([numbering, label]) => ({
    label, selected: outline.numbering === numbering, run: () => { updateOutline({ numbering }); numberingTrigger.current?.focus() },
  }))
  const docItems: MenuItem[] = [
    { label: '页宽设置', icon: <BetweenHorizontalStart size={16} />, children: markdownPageWidths.map(([value, label]) => ({
      label, selected: width === value, run: () => setWidth(value),
    })) },
    { label: '查找和替换', icon: <Search size={16} />, separator: true, run: () => { if (view.current) openSearchPanel(view.current) } },
    { label: '移动到', icon: <FolderInput size={16} />, separator: true, run: move },
    { label: pinned ? '从“置顶”移除' : '添加到“置顶”', icon: <Pin size={16} />, run: togglePin },
    { label: starred ? '取消收藏' : '添加到收藏', icon: <Star size={16} />, run: toggleStar },
    { label: '创建副本', icon: <Copy size={16} />, separator: true, run: duplicate },
    { label: '下载为', icon: <FileDown size={16} />, children: [
      { label: 'Markdown', icon: <FileText size={16} />, run: saveCopy },
      { label: 'PDF', icon: <FileDown size={16} />, run: exportPdf },
    ] },
    { label: '打印', icon: <Printer size={16} />, separator: true, run: printDocument },
    { label: '文档信息', icon: <Info size={16} />, separator: true, run: () => setInfo(true) },
    { label: '源码模式', icon: <Code2 size={16} />, separator: true, selected: source, run: () => { setSource(!source); view.current?.focus() } },
    { label: '更多', icon: <MoreHorizontal size={16} />, children: [
      { label: reading ? '编辑模式' : '阅读模式', icon: <Eye size={16} />, run: () => setReading(!reading) },
      { label: '插入 Mermaid 图', icon: <ListTree size={16} />, disabled: reading, run: () => { if (view.current) { insertMermaid(view.current); view.current.focus() } } },
      { label: '插入脚注', disabled: reading, run: () => { if (view.current) { insertFootnote(view.current); view.current.focus() } } },
      { label: '插入 YAML 元数据', disabled: reading, run: () => { if (view.current) { insertMetadata(view.current); view.current.focus() } } },
      { label: '在文件管理器中显示', icon: <LocateFixed size={16} />, run: reveal },
      { label: '拷贝文件路径', icon: <Copy size={16} />, run: () => { void navigator.clipboard.writeText(path).catch(report) } },
    ] },
    { label: '删除', icon: <Trash2 size={16} />, run: trash },
    { label: '快捷键', icon: <Keyboard size={16} />, separator: true, run: shortcuts },
  ]
  const statusItems: MenuItem[] = ([
    ['words', '字数'], ['lines', '行数'], ['modified', '更新时间'],
  ] as const).map(([value, label]) => ({ label, selected: status === value, run: () => setStatus(value) }))

  function openContextMenu(editor: EditorView, x: number, y: number, items: MenuItem[]) {
    const mapping: (() => void)[] = []
    const serialize = (items: MenuItem[]): ContextMenuItem[] => items.map(item => {
      return {
        label: item.label,
        id: item.run ? mapping.push(item.run) - 1 : undefined,
        shortcut: item.shortcut,
        disabled: item.disabled,
        selected: item.selected,
        separator: item.separator,
        children: item.children ? serialize(item.children) : undefined,
      }
    })
    void window.desktop.markdownContextMenu(x, y, serialize(items))
      .then(index => {
        if (!editor.dom.isConnected) return
        editor.focus()
        if (index !== null) mapping[index]?.()
      }).catch(report)
  }

  return <div className="markdown-editor" data-source={source} data-width={width}>
    <div className="document-editing" data-outline={outline.visible ? outline.position : undefined}
      style={{ '--outline-user-width': outline.width === undefined ? undefined : outline.width + 'px' } as CSSProperties}>
      {outline.visible && <aside id="markdown-outline" className="document-outline" aria-label="Markdown 标题目录">
        <header><strong>目录</strong><div className="outline-header-actions">
          <button ref={numberingTrigger} className="icon-button" title="目录编号" aria-label="目录编号" aria-haspopup="menu"
            aria-expanded={menu === 'outline-numbering'} onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              setNumberingPoint({ x: rect.left, y: rect.bottom + 4 })
              toggleMenu('outline-numbering')
            }}><Eye size={16} /></button>
        </div></header>
        {menu === 'outline-numbering' && numberingPoint && <MarkdownMenu items={outlineItems} close={close}
          point={numberingPoint} anchor={numberingTrigger.current ?? undefined} />}
        <nav>{numberedHeadings.map(heading => <button type="button" key={heading.pos}
          style={{ paddingInlineStart: 8 + heading.depth * 10 }} title={heading.title} onClick={() => {
            const editor = view.current
            if (!editor) return
            editor.dispatch({ selection: { anchor: heading.pos }, effects: EditorView.scrollIntoView(heading.pos, { y: 'start', yMargin: 20 }) })
            if (!reading) editor.focus()
          }}>{heading.number && <span className="outline-heading-number">{heading.number}</span>}<span className="outline-heading-title">{heading.title}</span></button>)}</nav>
        {!headings.length && <p>还没有标题</p>}
        <PaneResize pane="outline" side={outline.position} apply={width => updateOutline({ width })} />
      </aside>}
      <div className="markdown-main">
        <div className="editor-tools">
          <button className="icon-button" title="文档目录" aria-label="文档目录" aria-controls="markdown-outline"
            aria-expanded={outline.visible} onClick={() => { close(); updateOutline({ visible: !outline.visible }) }}><ListTree size={17} /></button>
          <div className="menu-anchor">
            <button className="icon-button" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded={menu === 'more'}
              onClick={() => toggleMenu('more')}><MoreHorizontal size={20} /></button>
            {menu === 'more' && <MarkdownMenu items={docItems} close={close} />}
          </div>
        </div>
        {hasTitle && createPortal(filenameTitle, titleHost)}
        <div className="markdown-surface" ref={host} onClick={event => {
          if (event.defaultPrevented || event.target instanceof Element && event.target.closest('.filename-title')) return
          if ((!event.metaKey && !event.ctrlKey) || !view.current) return
          const editor = view.current
          const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos === null) return
          let node = syntaxTree(editor.state).resolveInner(pos, -1)
          while (node.parent && !['Link', 'Autolink'].includes(node.name)) node = node.parent
          const url = node.getChild('URL')
          if (url) {
            event.preventDefault()
            void window.desktop.openExternal(editor.state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '')).catch(report)
          }
        }} onDoubleClick={event => {
          const editor = view.current
          if (editor && event.target instanceof Element && editImageReference(editor, event.target)) event.preventDefault()
        }} onContextMenu={event => {
          if (event.target instanceof Element && event.target.closest('.filename-title')) return
          const editor = view.current
          if (!editor) return
          event.preventDefault()
          close()
          const imageItems = event.target instanceof Element ? imageContextItems(editor, event.target, report, setImageResize) : undefined
          if (imageItems) {
            openContextMenu(editor, event.clientX, event.clientY, imageItems)
            return
          }
          const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
          const selection = editor.state.selection.main
          if (pos !== null && (pos < selection.from || pos > selection.to)) editor.dispatch({ selection: { anchor: pos } })
          const items = contextItems(editor, platform, path, report, reading, searchEngine, keyOverrides, showTable)
          openContextMenu(editor, event.clientX, event.clientY, items)
        }} />
      </div>
    </div>
    <footer className="document-status">
      <div className="menu-anchor">
        <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'status'} title="切换文档统计" onClick={() => toggleMenu('status')}>{statusText}</button>
        {menu === 'status' && <MarkdownMenu items={statusItems} close={close} upward />}
      </div>
      {saveStatus}
    </footer>
    {media && <MediaViewer request={media} close={() => setMedia(undefined)} />}
    {imageResize && <MarkdownImageSize request={imageResize} close={() => setImageResize(undefined)} />}
    <dialog ref={tableDialog} aria-label="插入表格" onClose={() => setTableOpen(false)}>
      <form onSubmit={event => {
        event.preventDefault()
        addTable(Number(tableRows), Number(tableColumns))
      }}>
        <h2>插入表格</h2>
        <div className="table-dimensions">
          <span>行 × 列</span>
          <input name="rows" aria-label="行数（含表头）" type="number" min="1" max="100" value={tableHover?.rows ?? tableRows} required
            onChange={event => { setTableHover(undefined); setTableRows(event.target.value) }} />
          <span aria-hidden="true">×</span>
          <input name="columns" aria-label="列数" type="number" min="1" max="30" value={tableHover?.columns ?? tableColumns} required
            onChange={event => { setTableHover(undefined); setTableColumns(event.target.value) }} />
        </div>
        {tableOpen && <TableSizeGrid size={{ rows: Number(tableRows), columns: Number(tableColumns) }} selection={tableHover}
          preview={setTableHover} insert={addTable} />}
        <footer>
          <button type="button" onClick={() => tableDialog.current?.close()}>取消</button>
          <button type="submit" className="primary">插入</button>
        </footer>
      </form>
    </dialog>
    <dialog ref={infoDialog} onCancel={event => { event.preventDefault(); setInfo(false) }}>
      <h2>文档信息</h2>
      <dl className="document-info">
        <dt>名称</dt><dd>{name}</dd>
        <dt>位置</dt><dd>{path}</dd>
        <dt>统计</dt><dd>{characters ?? '…'} 字 · {lineCount} 行</dd>
        <dt>更新</dt><dd>{updateTime}</dd>
      </dl>
      <footer><button type="button" onClick={() => setInfo(false)}><Check size={14} />完成</button></footer>
    </dialog>
  </div>
}
