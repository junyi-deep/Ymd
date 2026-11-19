import { EditorState, Facet, StateField, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { CodeBlockPreferences } from '../../shared/contracts'
import { CodePreview, copyCodeButton } from './markdownCodePreview'
import { createCodeLanguagePicker, replaceCodeLanguage } from './codeCard'
import { MarkdownHtmlPreview } from './markdownHtmlPreview'
import { markdownBlockFrame } from './markdownBlockFrame'
import { displayMath, mountBlockPreview } from './markdownPreviewMedia'
import { diagramKind, type PreviewBlockKind } from './renderDiagram'

class RenderedBlock extends WidgetType {
  private cancel?: () => void
  destroy() { this.cancel?.() }
  constructor(readonly code: string, readonly kind: PreviewBlockKind, readonly readOnly: boolean) { super() }

  eq(other: RenderedBlock) { return this.code === other.code && this.kind === other.kind && this.readOnly === other.readOnly }

  toDOM(view: EditorView) {
    const figure = document.createElement('figure')
    let edit
    if (!this.readOnly) {
      edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'tool-button mermaid-edit'
      edit.textContent = this.kind === 'math' ? '编辑公式' : '编辑图表'
      edit.addEventListener('click', () => {
        const line = view.state.doc.lineAt(view.posAtDOM(figure))
        const next = view.state.doc.line(Math.min(line.number + 1, view.state.doc.lines))
        view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true })
        view.focus()
      })
    }
    this.cancel = mountBlockPreview(figure, this.code, this.kind, view.scrollDOM, { edit, measure: () => view.requestMeasure() })
    return markdownBlockFrame(figure)
  }
}

function closedFence(node: SyntaxNode) {
  return node.name === 'FencedCode' && node.lastChild?.name === 'CodeMark' && node.lastChild.from > node.from
}

function codeText(state: EditorState, node: SyntaxNode, closed: boolean) {
  let line = state.doc.lineAt(node.from).number + Number(node.name === 'FencedCode')
  let code = ''
  for (const part of node.getChildren('CodeText')) {
    const start = state.doc.lineAt(part.from).number
    code += '\n'.repeat(Math.max(0, start - line)) + state.sliceDoc(part.from, part.to)
    line = state.doc.lineAt(part.to).number
  }
  return code + '\n'.repeat(Math.max(0, state.doc.lineAt(node.to).number - Number(closed) - line))
}

function codeLanguageRange(node: SyntaxNode) {
  const mark = node.name === 'FencedCode' && node.getChild('CodeMark')
  if (!mark) return
  const info = node.getChild('CodeInfo')
  return { from: info?.from ?? mark.to, to: info?.to ?? mark.to }
}

class CodeEditToolbar extends WidgetType {
  constructor(readonly opening: number, readonly info: string, readonly fenced: boolean) { super() }

  eq(other: CodeEditToolbar) {
    return this.opening === other.opening && this.info === other.info && this.fenced === other.fenced
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('div')
    bar.className = 'md-code-header md-code-edit-header'
    bar.setAttribute('role', 'toolbar')
    bar.ariaLabel = '代码块编辑工具栏'
    const readNode = () => {
      let node: SyntaxNode | null = syntaxTree(view.state).resolve(this.opening, 1)
      while (node && node.name !== 'FencedCode' && node.name !== 'CodeBlock') node = node.parent
      return node?.from === this.opening ? node : undefined
    }
    if (this.fenced) bar.append(createCodeLanguagePicker(this.info, value => {
      const node = readNode()
      const range = node && codeLanguageRange(node)
      if (!range || view.state.readOnly) return
      const info = view.state.sliceDoc(range.from, range.to)
      view.dispatch({ changes: { ...range, insert: replaceCodeLanguage(info, value) }, userEvent: 'input' })
    }, () => view.focus()))
    else {
      const caption = document.createElement('span')
      caption.textContent = '纯文本'
      bar.append(caption)
    }
    bar.append(copyCodeButton(() => {
      const node = readNode()
      if (node) return codeText(view.state, node, closedFence(node))
    }))
    return bar
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
    const closed = closedFence(node.node)
    const last = state.doc.lineAt(node.to)
    const to = closed && !state.sliceDoc(node.to, last.to).trim() ? last.to : node.to
    const from = state.doc.lineAt(node.from)
    const inside = !state.readOnly && state.selection.ranges.some(range =>
      range.empty ? range.from > node.from && range.from < to : range.from < to && range.to > node.from)
    const language = info ? state.sliceDoc(info.from, info.to).trim() : ''
    if (inside) {
      const active = state.selection.main
      if (active.from >= node.from && active.to <= to) {
        ranges.push(Decoration.widget({ block: true, side: -1,
          widget: new CodeEditToolbar(node.from, language, fenced) }).range(from.from))
      }
      return false
    }
    if (fenced && !closed) return false
    const blocks = node.node.getChildren('CodeText')
    const code = codeText(state, node.node, closed)
    const kind = diagramKind(language)
    if (kind && code.trim()) {
      ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(code.trim(), kind, state.readOnly) }).range(node.from, to))
    } else {
      const prefix = state.sliceDoc(from.from, node.from)
      const start = /^[ \t>]*$/.test(prefix) ? from.from : node.from
      const codeStart = blocks[0]?.from ?? state.doc.line(Math.min(from.number + 1, state.doc.lines)).from
      const editAt = Math.min(Math.max(node.from + 1, codeStart), to - 1)
      const languageRange = codeLanguageRange(node.node)
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
