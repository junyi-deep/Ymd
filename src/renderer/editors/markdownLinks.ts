import type { SyntaxNode } from '@lezer/common'
import { marked } from 'marked'
import type { EditorState, Text } from '@codemirror/state'
import { decodeImageAttribute } from './markdownImageSyntax'

const definitions = new WeakMap<Text, ReturnType<typeof marked.lexer>['links']>()
export const linkText = (source: string) => decodeImageAttribute(source.replace(/\\([!-\/:-@\[-\x60{-~])/g, '$1'))

export function markdownDestination(state: EditorState, node: SyntaxNode, label: string) {
  const url = node.getChild('URL')
  if (url) {
    const title = node.getChild('LinkTitle')
    const source = linkText(state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ''))
    const href = node.name === 'Autolink' && !source.includes(':') ? 'mailto:' + source : source
    return { href, title: title ? linkText(state.sliceDoc(title.from + 1, title.to - 1)) : undefined, url }
  }
  const reference = node.getChild('LinkLabel')
  const identifier = (reference && state.sliceDoc(reference.from + 1, reference.to - 1) || label)
    .trim().replace(/\s+/g, ' ').toLowerCase()
  if (!identifier) return
  let links = definitions.get(state.doc)
  if (!links) {
    const source = state.doc.toString()
    links = source.includes(']:') ? marked.lexer(source).links : Object.create(null)
    definitions.set(state.doc, links!)
  }
  const destination = links![identifier]
  if (destination) return { href: linkText(destination.href), title: destination.title || undefined, url: undefined }
}

export function safeMarkdownHref(href: string) {
  if (!href || /[\x00-\x20]/.test(href)) {
    if (!href || /[\x00-\x1f]/.test(href)) return
    href = href.replaceAll(' ', '%20')
  }
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(href)?.[0].toLowerCase()
  if (!scheme || ['https:', 'http:', 'mailto:', 'file:'].includes(scheme)) return href
}
