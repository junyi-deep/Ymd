import { EditorState, Facet, StateField, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { CodeBlockPreferences } from '../../shared/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Scan } from 'lucide-react'
import { diagramPreview, openMediaPreview } from './mediaPreview'
import { CodePreview } from './markdownCodePreview'
import { MarkdownHtmlPreview } from './markdownHtmlPreview'
import { markdownBlockFrame } from './markdownBlockFrame'
import { displayMath, scheduleBlockPreview } from './markdownPreviewMedia'

class RenderedBlock extends WidgetType {
  private cancel?: () => void
  destroy() { this.cancel?.() }
  constructor(readonly code: string, readonly kind: 'mermaid' | 'math', readonly readOnly: boolean) { super() }

  eq(other: RenderedBlock) { return this.code === other.code && this.kind === other.kind && this.readOnly === other.readOnly }

  toDOM(view: EditorView) {
    const figure = document.createElement('figure')
    figure.className = 'mermaid-preview'
    const diagram = this.kind === 'mermaid'
    figure.setAttribute('aria-label', diagram ? 'Mermaid 图' : '公式块')
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.hidden = this.readOnly
    edit.className = 'tool-button mermaid-edit'
    edit.textContent = diagram ? '编辑图表' : '编辑公式'
    const content = document.createElement('div')
    content.className = 'mermaid-content'
    content.textContent = diagram ? '正在绘制 Mermaid 图…' : '正在渲染公式…'
    const tools = document.createElement('div')
    tools.className = 'mermaid-tools'
    tools.append(edit)
    figure.append(tools, content)
    edit.addEventListener('click', () => {
      const position = view.posAtDOM(figure)
      const line = view.state.doc.lineAt(position)
      const next = view.state.doc.line(Math.min(line.number + 1, view.state.doc.lines))
      view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true })
      view.focus()
    })

    this.cancel = scheduleBlockPreview(content, this.code, this.kind, view.scrollDOM, () => {
      view.requestMeasure()
      const svg = diagram && content.querySelector('svg')
      if (!svg) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'icon-button'
      button.title = button.ariaLabel = '查看 Mermaid 图'
      button.innerHTML = renderToStaticMarkup(createElement(Scan, { size: 16, 'aria-hidden': true }))
      button.addEventListener('click', () => openMediaPreview(figure, diagramPreview(svg)))
      tools.append(button)
    }, error => {
      content.classList.add('mermaid-error')
      content.textContent = (diagram ? 'Mermaid 无法渲染。' : '公式无法渲染。') + (error instanceof Error ? error.message : '')
      view.requestMeasure()
    })
    return markdownBlockFrame(figure)
  }
}

export const codeBlockPreferences = Facet.define<CodeBlockPreferences, CodeBlockPreferences>({
  combine: values => values[0] ?? { lineNumbers: false, wrap: false },
})

function previews(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === 'HTMLBlock') {
      const start = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      const source = state.sliceDoc(node.from, node.to)
      const editing = !state.readOnly && state.selection.ranges.some(range => range.from < to && range.to > start)
      if (!editing && /^ {0,3}$/.test(state.sliceDoc(start, node.from))) {
        ranges.push(Decoration.replace({ block: true, widget: new MarkdownHtmlPreview(source, true, state.readOnly) }).range(start, to))
      }
      return false
    }
    if (node.name === 'Paragraph') {
      const raw = state.sliceDoc(node.from, node.to)
      const math = displayMath.exec(raw)
      if (!math || state.doc.lineAt(node.from).from !== node.from ||
        state.selection.ranges.some(range => !state.readOnly && range.from <= node.to && range.to >= node.from)) return
      ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(math[1], 'math', state.readOnly) }).range(node.from, node.to))
      return false
    }
    if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return
    const fenced = node.name === 'FencedCode'
    const info = node.node.getChild('CodeInfo')
    const end = node.node.lastChild
    const closed = fenced && end?.name === 'CodeMark' && end.from > node.from
    const last = state.doc.lineAt(node.to)
    const to = closed && !state.sliceDoc(node.to, last.to).trim() ? last.to : node.to
    const from = state.doc.lineAt(node.from)
    const inside = !state.readOnly && state.selection.ranges.some(range =>
      range.empty ? range.from > node.from && range.from < to : range.from < to && range.to > node.from)
    if (inside || fenced && !closed) return false
    const language = info ? state.sliceDoc(info.from, info.to).trim() : ''
    const blocks = node.node.getChildren('CodeText')
    let line = (fenced ? from.number + 1 : from.number)
    let code = ''
    for (const part of blocks) {
      const start = state.doc.lineAt(part.from).number
      code += '\n'.repeat(Math.max(0, start - line)) + state.sliceDoc(part.from, part.to)
      line = state.doc.lineAt(part.to).number
    }
    code += '\n'.repeat(Math.max(0, last.number - Number(closed) - line))
    if (language.toLowerCase() === 'mermaid' && code.trim()) {
      ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(code.trim(), 'mermaid', state.readOnly) }).range(node.from, to))
    } else {
      const prefix = state.sliceDoc(from.from, node.from)
      const start = /^[ \t>]*$/.test(prefix) ? from.from : node.from
      const codeStart = blocks[0]?.from ?? state.doc.line(Math.min(from.number + 1, state.doc.lines)).from
      const editAt = Math.min(Math.max(node.from + 1, codeStart), to - 1)
      const mark = fenced ? node.node.getChild('CodeMark') : null
      const languageRange = mark ? { from: info?.from ?? mark.to, to: info?.to ?? mark.to } : undefined
      const lineOffsets = code.split('\n').map((text, index) => {
        const source = state.doc.line(from.number + Number(fenced) + index)
        return (text && source.text.endsWith(text) ? source.to - text.length : source.from) - start
      })
      const widget = new CodePreview({ from: start, editAt, code, language, languageRange, lineOffsets, quoteDepth: (prefix.match(/>/g) ?? []).length }, state.facet(codeBlockPreferences), state.readOnly)
      ranges.push(Decoration.replace({ block: true, widget }).range(start, to))
    }
    return false
  } })
  return Decoration.set(ranges)
}

export const renderedBlocks = StateField.define({
  create: previews,
  update(value, transaction) {
    return transaction.startState.readOnly !== transaction.state.readOnly || transaction.docChanged || transaction.selection ||
      transaction.startState.facet(codeBlockPreferences) !== transaction.state.facet(codeBlockPreferences) || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? previews(transaction.state) : value
  },
  provide: field => EditorView.decorations.from(field),
})
