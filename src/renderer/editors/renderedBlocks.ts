import { EditorState, StateField, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { displayMath, renderBlockPreview } from './markdownPreviewMedia'

class RenderedBlock extends WidgetType {
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
    figure.append(edit, content)
    edit.addEventListener('click', () => {
      const position = view.posAtDOM(figure)
      const line = view.state.doc.lineAt(position)
      const next = view.state.doc.line(Math.min(line.number + 1, view.state.doc.lines))
      view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true })
      view.focus()
    })

    void renderBlockPreview(content, this.code, this.kind).catch(error => {
      content.classList.add('mermaid-error')
      content.textContent = (diagram ? 'Mermaid 无法渲染。' : '公式无法渲染。') + (error instanceof Error ? error.message : '')
    }).finally(() => { if (figure.isConnected) view.requestMeasure() })
    return figure
  }
}

function previews(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === 'Paragraph') {
      const raw = state.sliceDoc(node.from, node.to)
      const math = displayMath.exec(raw)
      if (!math || state.doc.lineAt(node.from).from !== node.from ||
        state.selection.ranges.some(range => !state.readOnly && range.from <= node.to && range.to >= node.from)) return
      ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(math[1], 'math', state.readOnly) }).range(node.from, node.to))
      return false
    }
    if (node.name !== 'FencedCode') return
    const info = node.node.getChild('CodeInfo')
    const end = node.node.lastChild
    if (!info || end?.name !== 'CodeMark' || end.from <= info.to ||
      state.sliceDoc(info.from, info.to).trim().toLowerCase() !== 'mermaid') return false
    if (state.selection.ranges.some(range => !state.readOnly && range.from <= node.to && range.to >= node.from)) return false
    const closing = state.doc.lineAt(end.from)
    if (state.sliceDoc(end.to, closing.to).trim()) return false
    const code = node.node.getChildren('CodeText').map(part => state.sliceDoc(part.from, part.to)).join('').trim()
    if (code) ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(code, 'mermaid', state.readOnly) }).range(node.from, closing.to))
    return false
  } })
  return Decoration.set(ranges)
}

export const renderedBlocks = StateField.define({
  create: previews,
  update(value, transaction) {
    return transaction.startState.readOnly !== transaction.state.readOnly || transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? previews(transaction.state) : value
  },
  provide: field => EditorView.decorations.from(field),
})
