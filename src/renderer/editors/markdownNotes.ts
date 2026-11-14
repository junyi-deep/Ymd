import { isolateHistory } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { Language, LanguageSupport, syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type Command, type DecorationSet } from '@codemirror/view'
import { Parser, type Input, type TreeFragment } from '@lezer/common'
import { GFM } from '@lezer/markdown'
import { footnoteDefinition, metadataClosing as closing, metadataOpening as opening, typoraMarkdown } from './markdownExtras'
import { markdownInlineHtml } from './markdownHtml'

const markdownLanguage = markdown({ extensions: [GFM, typoraMarkdown], addKeymap: false })
const mixedLanguage = yamlFrontmatter({ content: markdownLanguage })

class MarkdownWithMetadata extends Parser {
  createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]) {
    const parser = hasMetadata(input) ? mixedLanguage.language.parser : markdownLanguage.language.parser
    return parser.startParse(input, fragments, ranges)
  }
}

function hasMetadata(input: Input) {
  // An opening rule without a mate remains Markdown.
  if (input.length < opening.length || input.read(0, opening.length) !== opening) return false
  if (!input.lineChunks) return closing.test(input.read(opening.length, input.length))
  for (let position = opening.length; position < input.length;) {
    const line = input.chunk(position)
    if (line === '---') return true
    position += line.length
  }
  return false
}

export const markdownWithMetadata = new LanguageSupport(
  new Language(markdownLanguage.language.data, new MarkdownWithMetadata(), [], markdownLanguage.language.name),
  mixedLanguage.support,
)

type Footnote = { from: number; to: number; contentFrom: number; source: string; number?: number; firstReference?: number }

const footnoteLabel = (source: string) => source.slice(2, -1).toLowerCase()

function indexFootnotes(state: EditorState) {
  const definitions = new Map<string, Footnote>()
  const references: { from: number; label: string }[] = []
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === 'Frontmatter') return false
    if (node.name === 'FootnoteDefinition') {
      const source = state.sliceDoc(node.from, node.to)
      const marker = footnoteDefinition.exec(source)!
      const label = marker[1].toLowerCase()
      if (!definitions.has(label)) definitions.set(label, {
        from: node.from, to: node.to, contentFrom: node.from + marker[0].length,
        source: source.slice(marker[0].length).replace(/\n(?: {4}| {0,3}\t)/g, '\n'),
      })
      return false
    }
    if (node.name === 'FootnoteReference') references.push({ from: node.from, label: footnoteLabel(state.sliceDoc(node.from, node.to)) })
  } })
  let nextNumber = 1
  for (const reference of references) {
    const note = definitions.get(reference.label)
    if (note && note.number === undefined) {
      note.number = nextNumber++
      note.firstReference = reference.from
    }
  }
  return definitions
}

export const footnotes = StateField.define({
  create: indexFootnotes,
  update(value, transaction) {
    return transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? indexFootnotes(transaction.state) : value
  },
})

function jumpTo(view: EditorView, position: number) {
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) })
  view.focus()
}

export class FootnoteReference extends WidgetType {
  constructor(readonly note: Footnote) { super() }

  eq({ note }: FootnoteReference) {
    return note.contentFrom === this.note.contentFrom && note.number === this.note.number && note.source === this.note.source
  }

  toDOM(view: EditorView) {
    const superscript = document.createElement('sup')
    superscript.className = 'md-footnote-reference'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = String(this.note.number)
    button.setAttribute('aria-label', '跳转到脚注 ' + this.note.number)
    button.setAttribute('aria-description', this.note.source)
    button.addEventListener('click', () => jumpTo(view, this.note.contentFrom))
    const preview = document.createElement('span')
    preview.className = 'md-footnote-preview'
    preview.setAttribute('role', 'tooltip')
    preview.innerHTML = markdownInlineHtml(this.note.source)
    superscript.append(button, preview)
    const positionPreview = () => {
      const area = view.scrollDOM.getBoundingClientRect()
      const anchor = superscript.getBoundingClientRect()
      const previewWidth = preview.getBoundingClientRect().width
      preview.style.left = Math.min(0, area.right - anchor.left - previewWidth - 8) + 'px'
    }
    superscript.addEventListener('mouseenter', positionPreview)
    button.addEventListener('focus', positionPreview)
    return superscript
  }
}

class FootnoteBlock extends WidgetType {
  constructor(readonly note: Footnote, readonly readOnly: boolean) { super() }

  eq({ note, readOnly }: FootnoteBlock) {
    return note.contentFrom === this.note.contentFrom && note.number === this.note.number &&
      note.source === this.note.source && note.firstReference === this.note.firstReference && readOnly === this.readOnly
  }

  toDOM(view: EditorView) {
    const row = document.createElement('div')
    row.className = 'md-footnote-definition'
    const back = document.createElement('button')
    back.type = 'button'
    back.textContent = String(this.note.number)
    back.setAttribute('aria-label', '返回脚注引用 ' + this.note.number)
    back.addEventListener('click', () => jumpTo(view, this.note.firstReference!))
    const content = document.createElement(this.readOnly ? 'span' : 'button')
    content.className = 'md-footnote-content'
    content.innerHTML = markdownInlineHtml(this.note.source) || '空脚注'
    if (content instanceof HTMLButtonElement) {
      content.type = 'button'
      content.title = '编辑脚注'
      content.addEventListener('click', () => jumpTo(view, this.note.contentFrom))
    }
    row.append(back, content)
    return row
  }
}

class MetadataBlock extends WidgetType {
  constructor(readonly source: string, readonly readOnly: boolean) { super() }

  eq(other: MetadataBlock) { return other.source === this.source && other.readOnly === this.readOnly }

  toDOM(view: EditorView) {
    const block = document.createElement('section')
    block.className = 'md-metadata'
    block.setAttribute('aria-label', 'YAML 元数据')
    const heading = document.createElement(this.readOnly ? 'span' : 'button')
    heading.textContent = 'YAML 元数据'
    if (heading instanceof HTMLButtonElement) {
      heading.type = 'button'
      heading.setAttribute('aria-label', '编辑 YAML 元数据')
      heading.addEventListener('click', () => jumpTo(view, opening.length))
    }
    const code = document.createElement('pre')
    code.textContent = this.source
    block.append(heading, code)
    return block
  }
}

function notesPreview(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const active = (from: number, to: number) => !state.readOnly &&
    state.selection.ranges.some(range => range.from <= to && range.to >= from)
  const metadata = syntaxTree(state).topNode.getChild('Frontmatter')
  if (metadata) {
    const end = state.doc.lineAt(metadata.to - 1)
    if (!active(0, end.to)) {
      const content = state.sliceDoc(opening.length, end.from).replace(/\n$/, '')
      ranges.push(Decoration.replace({ block: true, widget: new MetadataBlock(content, state.readOnly) }).range(0, end.to))
    }
  }
  for (const note of state.field(footnotes).values()) {
    const start = state.doc.lineAt(note.from).from
    if (note.number !== undefined && !active(start, note.to)) {
      ranges.push(Decoration.replace({ block: true, widget: new FootnoteBlock(note, state.readOnly) }).range(start, note.to))
    }
  }
  return Decoration.set(ranges, true)
}

export const markdownNotes = StateField.define({
  create: notesPreview,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || transaction.startState.readOnly !== transaction.state.readOnly ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ? notesPreview(transaction.state) : value
  },
  provide: field => EditorView.decorations.from(field),
})

export function referenceNote(state: EditorState, from: number, to: number) {
  return state.field(footnotes).get(footnoteLabel(state.sliceDoc(from, to)))
}

function addMetadata(view: EditorView, from: number) {
  const title = '标题'
  const template = opening + 'title: ' + title + '\n---\n' + (from < view.state.doc.length ? '\n' : '')
  const anchor = opening.length + 'title: '.length
  view.dispatch({ changes: { from: 0, to: from, insert: template }, selection: { anchor, head: anchor + title.length },
    annotations: isolateHistory.of('full'), scrollIntoView: true, userEvent: 'input' })
  return true
}

export const insertMetadata: Command = view => {
  if (view.state.readOnly) return false
  if (syntaxTree(view.state).topNode.getChild('Frontmatter')) {
    jumpTo(view, opening.length)
    return true
  }
  return addMetadata(view, 0)
}

export const expandMetadata: Command = view => {
  const { state } = view
  const first = state.doc.line(1)
  const selection = state.selection.main
  if (state.readOnly || !selection.empty || selection.from !== first.to || first.text !== '---' ||
      syntaxTree(state).topNode.getChild('Frontmatter')) return false
  return addMetadata(view, Math.min(first.to + 1, state.doc.length))
}

export const insertFootnote: Command = view => {
  const { state } = view
  if (state.readOnly) return false
  const position = state.selection.main.to
  const tree = syntaxTree(state)
  if (position < (tree.topNode.getChild('Frontmatter')?.to ?? 0)) return false
  const node = tree.resolveInner(position, -1)
  for (let parent: typeof node | null = node; parent; parent = parent.parent) {
    if (['InlineCode', 'FencedCode', 'CodeBlock', 'FootnoteDefinition'].includes(parent.name) && position < parent.to) return false
  }
  const source = state.doc.toString()
  const taken = new Set(Array.from(source.matchAll(/\[\^(\d+)\]/g), match => match[1]))
  let id = 1
  while (taken.has(String(id))) id++
  const reference = '[^' + id + ']'
  const placeholder = '脚注内容'
  const after = position === state.doc.length || !source.endsWith('\n') ? '\n\n' : source.endsWith('\n\n') ? '' : '\n'
  const definition = after + reference + ': '
  const end = state.doc.length
  const anchor = end + reference.length + definition.length
  view.dispatch({
    changes: position === end ? { from: end, insert: reference + definition + placeholder }
      : [{ from: position, insert: reference }, { from: end, insert: definition + placeholder }],
    selection: { anchor, head: anchor + placeholder.length },
    annotations: isolateHistory.of('full'), scrollIntoView: true, userEvent: 'input',
  })
  return true
}
