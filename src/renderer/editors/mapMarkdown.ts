import type { MapNode } from 'simple-mind-map'
import { sanitizeMarkdownHtml } from './markdownHtml'
import { marked } from 'marked'

const installed = new WeakSet<MapNode>()
const syntax = /[*_~`<\[&\\]|^ {0,3}#{1,6} /m
const heading = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/

function topicHtml(source: string) {
  const html = source.split('\n').map(line => {
    const title = heading.exec(line)
    const content = marked.parseInline(title?.[1] ?? line, { gfm: true, async: false })
    return title ? '<strong>' + content + '</strong>' : content
  }).join('<br>')
  const rendered = document.createElement('template')
  rendered.innerHTML = sanitizeMarkdownHtml(html, true)
  for (const link of rendered.content.querySelectorAll('a')) link.removeAttribute('href')
  return rendered.innerHTML
}

export function displayMapMarkdown(node: MapNode) {
  if (installed.has(node)) return
  installed.add(node)
  // SimpleMindMap calls its prefix hook before laying out the node. Override only
  // its text measurement and painting, keeping the editable topic data as Markdown.
  const plain = node.createTextNode.bind(node)
  node.createTextNode = value => {
    const source = node.getData('text')
    if ((value !== undefined && node.mindMap.renderer.textEdit.getCurrentEditNode() === node) || typeof source !== 'string' || !syntax.test(source) || node.getData('richText')) return plain(value)
    const html = topicHtml(source)
    return html ? node.createRichTextNode(html) : plain()
  }
  const source = node.getData('text')
  if (typeof source === 'string' && syntax.test(source)) node._textData = node.createTextNode()
}
