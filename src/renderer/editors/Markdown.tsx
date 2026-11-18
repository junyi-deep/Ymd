import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { BetweenHorizontalStart, Check, ChevronRight, Code2, Copy, Eye, FileDown, FileText, FolderInput, Info, Keyboard, ListTree, LocateFixed, MoreHorizontal, Pin, Printer, Search, Star, Layers, Trash2 } from 'lucide-react'
import { MarkdownMenu, type MenuItem } from './MarkdownMenu'
import { contextItems, insertMermaid, tabInList, typographyKeys } from './markdownCommands'
import { markdownDestination, safeMarkdownHref } from './markdownLinks'
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
import { ChangeSet, Compartment, EditorState, Prec, StateEffect, type EditorSelection, type Range } from '@codemirror/state'
import { Decoration, EditorView, highlightSpecialChars, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { markdownPageWidths, type CodeBlockPreferences, type ContextMenuItem, type MarkdownOutlinePreferences, type MarkdownPageWidth, type SearchEngine } from '../../shared/contracts'
import type { DocumentViewPosition } from './viewPosition'
import { colorOpening, highlightOpening, numberOpening } from './outlineTextStyle'
import type { ShortcutOverrides } from '../../shared/shortcuts'
import { getOutlineDepth, maxOutlineDepth, setOutlineDepth } from './markdownOutlineDepth'
import { PaneResize } from '../PaneResize'
import { mountMarkdownScrollbar } from './markdownScrollbar'
import { markdownFindPanel } from './markdownFind'
import { inlineHtmlEnd, MarkdownHtmlPreview } from './markdownHtmlPreview'
import { markdownBlockFrame } from './markdownBlockFrame'

class DocumentTitle extends WidgetType {
  constructor(readonly element: HTMLElement) { super() }
  eq(widget: DocumentTitle) { return widget.element === this.element }
  toDOM() { return this.element }
}

const inlineStyles: Record<string, string> = {
  StrongEmphasis: 'md-bold', Emphasis: 'md-italic', Strikethrough: 'md-strike',
  InlineCode: 'md-inline-code', Highlight: 'md-highlight', Underline: 'md-underline',
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

type PreviewSelection = { selection: EditorSelection; focused: boolean }
const refreshPreview = StateEffect.define<null>()

function liveMarkdown(view: EditorView, path: string, loadRemote: boolean,
  preview = { selection: view.state.selection, focused: view.hasFocus }) {
  const ranges: Range<Decoration>[] = []
  const state = view.state
  const visible = (from: number, to: number) => preview.selection.ranges.some(range => !state.readOnly && range.from <= to && range.to >= from)
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
    let coveredUntil = -1
    tree.iterate({ from: viewport.from, to: viewport.to, enter(node) {
      const { name, from, to } = node
      if (from < coveredUntil && to <= coveredUntil || name === 'Frontmatter' || name === 'HTMLBlock') return false
      if (name === 'HTMLTag') {
        const end = inlineHtmlEnd(state, node.node)
        if (end !== undefined && !(preview.focused && visible(from, end))) {
          ranges.push(Decoration.replace({ widget: new MarkdownHtmlPreview(state.sliceDoc(from, end), false, state.readOnly) }).range(from, end))
          coveredUntil = end
        }
        return false
      }
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
        const editing = preview.focused && visible(from, to)
        const reference = !editing && sourceLine.to >= to ? readImageReference(state, node.node) : undefined
        if (reference) {
          const standalone = sourceLine.text.trim() === reference.markdown
          ranges.push(Decoration.replace({ widget: new MarkdownImage(path, reference, loadRemote, standalone) }).range(from, to))
        }
        return false
      }
      if ((name === 'Link' || name === 'Autolink') && !(preview.focused && visible(from, to))) {
        const marks = node.node.getChildren('LinkMark')
        const labelFrom = marks[0]?.to ?? from
        const labelTo = marks[1]?.from ?? to
        const destination = markdownDestination(state, node.node, state.sliceDoc(labelFrom, labelTo))
        const href = destination && safeMarkdownHref(destination.href)
        if (href && labelTo > labelFrom) {
          hide(from, labelFrom)
          for (let start = labelTo; start < to;) {
            const end = Math.min(state.doc.lineAt(start).to, to)
            hide(start, end)
            start = end + 1
          }
          ranges.push(Decoration.mark({ tagName: 'a', class: 'md-link',
            attributes: { href, title: destination.title || href, draggable: 'false' } }).range(labelFrom, labelTo))
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
  private preview?: PreviewSelection
  private pressedSelection?: EditorSelection
  private pointer?: AbortController
  private settle?: ReturnType<typeof setTimeout>
  private moved = false

  constructor(private readonly view: EditorView) { this.decorations = liveMarkdown(view, path, loadRemote) }

  beginPointer(event: MouseEvent) {
    if (event.button !== 0) return
    this.destroy()
    // Keep the symbols hidden or visible exactly as they were when the drag began.
    // Revealing a delimiter moves the glyphs underneath CodeMirror's mouse hit-testing.
    this.pressedSelection = this.view.state.selection
    this.preview ??= { selection: this.pressedSelection, focused: this.view.hasFocus }
    const document = this.view.contentDOM.ownerDocument
    const pointer = this.pointer = new AbortController()
    this.moved = false
    const end = () => {
      pointer.abort()
      this.pointer = undefined
      // A link click follows mouseup. Keep the rendered anchor in place until it runs.
      this.settle = setTimeout(() => {
        this.settle = undefined
        this.pressedSelection = undefined
        if (!this.view.state.selection.ranges.every(range => range.empty)) return
        this.preview = undefined
        this.view.dispatch({ effects: refreshPreview.of(null) })
      }, 0)
    }
    document.addEventListener('mousemove', move => {
      if (!(move.buttons & 1)) end()
      else if (Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) > 4) this.moved = true
    }, { signal: pointer.signal })
    document.addEventListener('mouseup', end, { signal: pointer.signal, once: true })
    document.defaultView?.addEventListener('blur', end, { signal: pointer.signal, once: true })
  }

  activateLink(event: MouseEvent) {
    if (event.detail === 0) return true
    if (this.moved || event.shiftKey || !this.view.state.selection.main.empty) return false
    // Clicking a link is navigation, so keep the caret where it was before the click.
    if (this.pressedSelection) this.view.dispatch({ selection: this.pressedSelection })
    return true
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.transactions.some(tr => tr.selection && !tr.isUserEvent('select.pointer'))) this.preview = undefined
    if (update.startState.readOnly !== update.state.readOnly || update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state) ||
      update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshPreview)))) {
      this.decorations = liveMarkdown(update.view, path, loadRemote, this.preview)
    }
  }

  destroy() {
    this.pointer?.abort()
    clearTimeout(this.settle)
  }
}, {
  decorations: plugin => plugin.decorations,
  eventObservers: { mousedown(event) { this.beginPointer(event) } },
})

type StatusKind = 'words' | 'lines' | 'modified'
type OpenMenu = 'outline-depth' | 'outline-numbering' | 'more' | 'status'
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
  fontSize: number
  reload: number
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
  move?: () => void
  trash?: () => void
  shortcuts: () => void
  exportPdf: () => void
  printDocument: () => void
  pinned: boolean
  starred: boolean
  togglePin: () => void
  toggleStar: () => void
  followLink: (href: string) => void
  report: (error: unknown) => void
}

export function MarkdownEditor({ text, name, path, modified, platform, remoteImages, searchEngine, keyOverrides, outline, filenameTitle, saveStatus, updateOutline, width, codeBlocks, setWidth, registerFlush, onChange, find, jump, reveal, saveCopy, duplicate, move, trash, shortcuts, exportPdf, printDocument, pinned, starred, togglePin, toggleStar, followLink, report, position, fontSize, reload }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [titleHost] = useState(() => markdownBlockFrame())
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
  const appliedReload = useRef(reload)
  const serialization = useRef({ bom: '', newline: '\n' })
  const previousFind = useRef(find)
  const [source, setSource] = useState(position.markdown?.source ?? false)
  const sourceMode = useRef(source)
  sourceMode.current = source
  const [menu, setMenu] = useState<OpenMenu>()
  const [outlineDepth, changeOutlineDepth] = useState(() => getOutlineDepth(path))
  const [expandedHeadings, setExpandedHeadings] = useState(new Map<string, boolean>())
  const [activeHeading, setActiveHeading] = useState(-1)
  const headingsNav = useRef<HTMLElement>(null)
  const depthPopover = useRef<HTMLDivElement>(null)
  const depthTrigger = useRef<HTMLButtonElement>(null)
  const refreshHeading = useRef<(() => void) | undefined>(undefined)
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
  const livePreview = useMemo(() => live(path, remoteImages), [path, remoteImages])
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

  function createState(raw: string) {
    const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
    const newline = raw.match(/\r\n|\n|\r/)?.[0] ?? '\n'
    const doc = raw.slice(bom.length).replace(/\r\n|\r/g, '\n')
    serialization.current = { bom, newline }
    return EditorState.create({
      doc,
      extensions: [
        highlightSpecialChars(), history(), keymap.of([...defaultKeymap.filter(binding =>
          !['Mod-i', 'Mod-[', 'Mod-]'].includes(binding.key ?? '') && (platform === 'darwin' || binding.key !== 'Shift-Mod-k')), ...historyKeymap]),
        EditorView.lineWrapping, markdownWithMetadata, syntaxHighlighting(classHighlighter), indentUnit.of('  '), footnotes, keyMode.current.of(writingKeys()),
        search({ createPanel: markdownFindPanel, scrollToMatch: match => EditorView.scrollIntoView(match, { y: 'center' }) }), Prec.high(keymap.of([{ key: 'Enter', run: expandMetadata },
          { key: 'Tab', run: tabInList(), shift: tabInList(true) },
          ...markdownKeymap, ...searchKeymap.filter(binding => binding.key !== 'Mod-f')])),
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
        markdownImageIntake(path, report),
        renderMode.current.of(sourceMode.current ? [] : [livePreview, codeBlockPreferences.of(codeBlocks), renderedBlocks, markdownTable, markdownNotes]),
        readMode.current.of([EditorState.readOnly.of(reading), EditorView.editable.of(!reading)]), titleMode.current.of(titleExtension),
        EditorView.updateListener.of(update => {
          const { bom, newline } = serialization.current
          if (update.docChanged) change.current(bom + update.state.doc.toString().replaceAll('\n', newline))
          if (update.geometryChanged || update.viewportChanged) refreshHeading.current?.()
        }),
      ],
    })
  }

  useLayoutEffect(() => {
    let state = createState(initial.current)
    const previous = position.markdown
    const sameText = previous?.text === initial.current
    if (sameText) state = state.update({ selection: { anchor: previous.anchor, head: previous.head } }).state
    const editor = new EditorView({
      parent: host.current!,
      scrollTo: previous && (sameText ? previous.scroll : EditorView.scrollIntoView(Math.min(state.doc.length, previous.top), { y: 'start' })),
      state,
    })
    view.current = editor
    const unmountScrollbar = mountMarkdownScrollbar(editor, host.current!)
    return () => {
      const { anchor, head } = editor.state.selection.main
      const { bom, newline } = serialization.current
      position.markdown = { anchor, head, source: sourceMode.current, scroll: editor.scrollSnapshot(),
        top: editor.lineBlockAtHeight(editor.scrollDOM.scrollTop).from,
        text: bom + editor.state.doc.toString().replaceAll('\n', newline) }
      unmountScrollbar()
      editor.destroy()
      view.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const editor = view.current
    if (!editor || appliedReload.current === reload) return
    appliedReload.current = reload
    let state = createState(text)
    const before = editor.state.doc.toString()
    const after = state.doc.toString()
    let from = 0
    let oldEnd = before.length
    let newEnd = after.length
    while (from < oldEnd && from < newEnd && before.charCodeAt(from) === after.charCodeAt(from)) from++
    while (oldEnd > from && newEnd > from && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
      oldEnd--
      newEnd--
    }
    const changes = ChangeSet.of({ from, to: oldEnd, insert: after.slice(from, newEnd) }, before.length)
    state = state.update({ selection: editor.state.selection.map(changes) }).state
    const scroll = editor.scrollSnapshot().map(changes)
    // Retain the scroll container while replacing external content and clearing its undo history.
    editor.setState(state)
    if (scroll) editor.dispatch({ effects: scroll })
  }, [reload])

  useLayoutEffect(() => {
    view.current?.dispatch({ effects: titleMode.current.reconfigure(titleExtension) })
  }, [titleExtension])

  useEffect(() => { view.current?.requestMeasure() }, [fontSize])

  useEffect(() => {
    view.current?.dispatch({ effects: keyMode.current.reconfigure(writingKeys()) })
  }, [keyOverrides, platform])

  useEffect(() => {
    registerFlush(() => view.current?.dom.querySelector<HTMLInputElement>('.markdown-table-widget input:focus')?.blur())
    return () => registerFlush()
  }, [registerFlush])

  useEffect(() => {
    view.current?.dispatch({ effects: renderMode.current.reconfigure(source ? [] : [livePreview, codeBlockPreferences.of(codeBlocks), renderedBlocks, markdownTable, markdownNotes]) })
  }, [source, livePreview, codeBlocks])
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
    const ancestors: { level: number; ordinal: number; children: number; pos: number }[] = []
    let roots = 0
    return headings.map((heading, index) => {
      while (ancestors.length && ancestors.at(-1)!.level >= heading.level) ancestors.pop()
      const parent = ancestors.at(-1)
      const depth = ancestors.length
      const lineage = ancestors.map(item => item.pos)
      ancestors.push({ level: heading.level, ordinal: parent ? ++parent.children : ++roots, children: 0, pos: heading.pos })
      const id = ancestors.map(item => item.ordinal).join('.')
      const number = outline.numbering === 'flat' ? String(index + 1) : outline.numbering === 'hierarchical' ? id : ''
      return { ...heading, id, depth, lineage, number, branch: (headings[index + 1]?.level ?? 0) > heading.level }
    })
  }, [headings, outline.numbering])
  const displayedHeadings = useMemo(() => {
    const parents: boolean[] = []
    return numberedHeadings.flatMap(heading => {
      parents.length = heading.depth
      const visible = parents.every(Boolean)
      const expanded = expandedHeadings.get(heading.id) ?? heading.depth + 1 < outlineDepth
      parents.push(visible && expanded)
      return visible ? [{ ...heading, expanded }] : []
    })
  }, [numberedHeadings, expandedHeadings, outlineDepth])
  const currentHeading = numberedHeadings.find(item => item.pos === activeHeading)
  const visibleActiveHeading = currentHeading && [activeHeading, ...currentHeading.lineage.toReversed()]
    .find(pos => displayedHeadings.some(item => item.pos === pos))
  useEffect(() => {
    const editor = view.current
    if (!outline.visible || !editor) return
    let frame = 0
    const refresh = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const top = editor.scrollDOM.getBoundingClientRect().top - editor.documentTop
        const offset = editor.lineBlockAtHeight(top + 24).from
        let low = 0
        let high = headings.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (headings[middle].pos <= offset) low = middle + 1
          else high = middle
        }
        setActiveHeading(headings[low - 1]?.pos ?? -1)
      })
    }
    refreshHeading.current = refresh
    editor.scrollDOM.addEventListener('scroll', refresh, { passive: true })
    refresh()
    return () => {
      refreshHeading.current = undefined
      cancelAnimationFrame(frame)
      editor.scrollDOM.removeEventListener('scroll', refresh)
    }
  }, [headings, outline.visible])
  useEffect(() => {
    const nav = headingsNav.current
    const current = nav?.querySelector('[aria-current="location"]')
    if (!nav || !current) return
    const outer = nav.getBoundingClientRect()
    const item = current.getBoundingClientRect()
    if (item.top < outer.top) nav.scrollTop -= outer.top - item.top
    else if (item.bottom > outer.bottom) nav.scrollTop += item.bottom - outer.bottom
  }, [visibleActiveHeading, displayedHeadings])
  useEffect(() => {
    if (menu !== 'outline-depth') return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !depthPopover.current?.contains(event.target) &&
          !depthTrigger.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      depthTrigger.current?.focus()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [menu])
  const outlineItems: MenuItem[] = outlineNumberings.map(([numbering, label]) => ({
    label, selected: outline.numbering === numbering, run: () => { updateOutline({ numbering }); numberingTrigger.current?.focus() },
  }))
  const docItems: MenuItem[] = [
    { label: '页宽设置', icon: <BetweenHorizontalStart size={16} />, children: markdownPageWidths.map(([value, label]) => ({
      label, selected: width === value, run: () => setWidth(value),
    })) },
    { label: '查找和替换', icon: <Search size={16} />, separator: true, run: () => { if (view.current) openSearchPanel(view.current) } },
    ...(move ? [{ label: '移动到', icon: <FolderInput size={16} />, separator: true, run: move }] : []),
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
    ...(trash ? [{ label: '删除', icon: <Trash2 size={16} />, run: trash }] : []),
    { label: '快捷键', icon: <Keyboard size={16} />, separator: true, run: shortcuts },
  ]
  const statusItems: MenuItem[] = ([
    ['words', '字数'], ['lines', '行数'], ['modified', '更新时间'],
  ] as const).map(([value, label]) => ({ label, selected: status === value, run: () => setStatus(value) }))

  function goToHeading(pos: number) {
    const editor = view.current
    if (!editor || pos > editor.state.doc.length) return
    editor.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 16 }) })
    if (!reading) editor.focus()
  }

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
          <button ref={depthTrigger} type="button" className="icon-button" title="目录层级" aria-label="目录层级"
            aria-expanded={menu === 'outline-depth'} aria-controls="markdown-outline-depth"
            onClick={() => toggleMenu('outline-depth')}><Layers size={16} /></button>
          <button ref={numberingTrigger} className="icon-button" title="目录编号" aria-label="目录编号" aria-haspopup="menu"
            aria-expanded={menu === 'outline-numbering'} onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              setNumberingPoint({ x: rect.left, y: rect.bottom + 4 })
              toggleMenu('outline-numbering')
            }}><Eye size={16} /></button>
        </div></header>
        {menu === 'outline-numbering' && numberingPoint && <MarkdownMenu items={outlineItems} close={close}
          point={numberingPoint} anchor={numberingTrigger.current ?? undefined} />}
        {menu === 'outline-depth' && <div id="markdown-outline-depth" ref={depthPopover} className="outline-depth"
          style={{ '--outline-depth-progress': (outlineDepth - 1) * 20 + '%' } as CSSProperties}>
          <div className="outline-depth-marks" aria-hidden="true">{Array.from({ length: maxOutlineDepth }, (_, index) =>
            <i key={index} data-passed={index + 1 <= outlineDepth} />)}</div>
          <input type="range" min={1} max={maxOutlineDepth} step={1} value={outlineDepth}
            aria-label="显示目录层级" aria-valuetext={outlineDepth + ' 层'}
            onChange={event => {
              const value = event.currentTarget.valueAsNumber
              changeOutlineDepth(value)
              setExpandedHeadings(new Map())
              setOutlineDepth(path, value)
            }} />
        </div>}
        <nav ref={headingsNav} aria-label="文档标题">{displayedHeadings.map(heading => <div key={heading.pos} className="outline-heading-row"
          data-current={heading.pos === visibleActiveHeading} style={{ paddingInlineStart: heading.depth * 10 }}>
          {heading.branch ? <button type="button" className="outline-heading-toggle" aria-expanded={heading.expanded}
            aria-label={(heading.expanded ? '折叠 ' : '展开 ') + heading.title} onClick={() =>
              setExpandedHeadings(current => new Map(current).set(heading.id, !heading.expanded))}><ChevronRight size={13} /></button>
            : <span className="outline-heading-toggle" />}
          <button type="button" className="outline-heading-link" aria-current={heading.pos === visibleActiveHeading ? 'location' : undefined}
            title={heading.title} onClick={() => goToHeading(heading.pos)}>{heading.number && <span className="outline-heading-number">{heading.number}</span>}
            <span className="outline-heading-title">{heading.title}</span></button>
        </div>)}</nav>
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
          const anchor = event.target instanceof Element && event.target.closest<HTMLAnchorElement>('a.md-link')
          if (!anchor) return
          event.preventDefault()
          if (view.current?.plugin(livePreview)?.activateLink(event.nativeEvent) === false) return
          const href = anchor.getAttribute('href')
          if (!href) return
          if (href.startsWith('#')) {
            let slug: string
            try { slug = decodeURIComponent(href.slice(1)) } catch { return }
            const heading = headings.find(item => item.title.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s/g, '-') === slug)
            if (heading) goToHeading(heading.pos)
          } else followLink(href)
        }} onDoubleClick={event => {
          const editor = view.current
          if (editor && event.target instanceof Element && editImageReference(editor, event.target)) event.preventDefault()
        }} onContextMenu={event => {
          if (event.target instanceof Element && event.target.closest('.filename-title, .markdown-scrollbar')) return
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
