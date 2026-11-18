import { WidgetType, type EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState } from '@codemirror/state'
import { isInlineHtmlTag, markdownHtmlFragment } from './markdownHtml'
import { safeMarkdownHref } from './markdownLinks'

export function inlineHtmlEnd(state: EditorState, node: SyntaxNode) {
  const source = state.sliceDoc(node.from, node.to)
  const name = /^<([a-z][a-z0-9]*)\b/i.exec(source)?.[1].toLowerCase()
  if (!name || !isInlineHtmlTag(name)) return
  if (name === 'br' || name === 'wbr') return node.to
  const lineEnd = Math.min(state.doc.lineAt(node.from).to, node.to + 16_384)
  const rest = state.sliceDoc(node.to, lineEnd)
  const tags = /<!--.*?-->|<\/?([a-z][a-z0-9-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
  let depth = 1
  for (const match of rest.matchAll(tags)) {
    if (match[1]?.toLowerCase() !== name) continue
    if (match[0].startsWith('</')) {
      if (--depth === 0) return node.to + match.index + match[0].length
    } else depth++
  }
}

export class MarkdownHtmlPreview extends WidgetType {
  constructor(readonly source: string, readonly block: boolean, readonly readOnly: boolean) { super() }

  eq(other: MarkdownHtmlPreview) {
    return this.source === other.source && this.block === other.block && this.readOnly === other.readOnly
  }

  get lineBreaks() { return this.block ? 0 : this.source.match(/<br\b/gi)?.length ?? 0 }

  toDOM(view: EditorView) {
    const preview = document.createElement(this.block ? 'div' : 'span')
    preview.className = this.block ? 'md-html-block outline-markdown' : 'md-html-inline'
    const sanitized = markdownHtmlFragment(this.source, !this.block)
    for (const link of sanitized.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = link.getAttribute('href')
      if (href && safeMarkdownHref(href)) {
        link.classList.add('md-link')
        link.draggable = false
      } else link.removeAttribute('href')
    }
    if (this.block) {
      for (const table of sanitized.querySelectorAll('table')) {
        const viewport = document.createElement('div')
        viewport.className = 'outline-table-scroll'
        table.replaceWith(viewport)
        viewport.append(table)
      }
    }
    preview.append(sanitized)
    if (!this.readOnly) preview.addEventListener('dblclick', event => {
      if (event.target instanceof Element && event.target.closest('a, summary')) return
      const position = view.posAtDOM(preview)
      const offset = Math.min(1, this.source.length)
      view.dispatch({ selection: { anchor: position + offset }, scrollIntoView: true })
      view.focus()
    })
    return preview
  }
}
