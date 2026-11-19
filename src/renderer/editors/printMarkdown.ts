import DOMPurify from 'dompurify'
import { diagramKind, renderDiagram } from './renderDiagram'
import { Marked } from 'marked'
import type { Tokens } from 'marked'
import markedFootnote from 'marked-footnote'
import { markdownBody } from './markdownExtras'
import { applyImageSizing, isEmbeddedMarkdownImage, isRemoteMarkdownImage, markdownImageLine, readImageSizing } from './markdownImageSyntax'
import { cleanMarkdownStyles } from './markdownHtml'
import { displayMath } from './markdownPreviewMedia'

export async function printMarkdown(file: string, source: string) {
  const parser = new Marked({ gfm: true, breaks: false })
  parser.use(markedFootnote({ description: '脚注', backRefLabel: '返回脚注引用 {0}', headingClass: '' }))
  parser.use({
    extensions: [{
      name: 'imageLine',
      level: 'block',
      tokenizer(source) {
        const line = markdownImageLine(source)
        if (line) return { type: 'imageLine', ...line }
      },
      renderer(token) { return token.text + '\n' },
    }],
    walkTokens: async token => {
      if (token.type === 'code') {
        const code = token as Tokens.Code
        const kind = diagramKind(code.lang)
        if (!kind) return
        try {
          const svg = await renderDiagram(kind, code.text)
          Object.assign(token, { type: 'html', text: '<figure>' + svg + '</figure>' })
        } catch {}
      }
      if (token.type === 'paragraph') {
        const paragraph = token as Tokens.Paragraph
        const math = displayMath.exec(paragraph.text)
        if (!math) return
        try {
          const { default: katex } = await import('katex')
          Object.assign(token, { type: 'html', text: '<figure>' + katex.renderToString(math[1], {
            displayMode: true, output: 'mathml', trust: false, maxExpand: 1000,
          }) + '</figure>' })
        } catch {}
      }
    },
  })
  const html = await parser.parse(markdownBody(source), { async: true })
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ['form', 'style', 'iframe', 'video', 'audio', 'object', 'embed', 'foreignObject'],
  })
  // Keeping the images inside a template prevents their sources from loading in the editor.
  const output = document.createElement('template')
  output.innerHTML = sanitized
  cleanMarkdownStyles(output.content)
  const images = [...output.content.querySelectorAll('img')]
  await Promise.all(images.map(async image => {
    const sizing = readImageSizing(name => image.getAttribute(name) ?? undefined)
    for (const name of ['height', 'width', 'style', 'srcset', 'sizes']) image.removeAttribute(name)
    applyImageSizing(image, sizing)
    const parent = image.parentElement
    if (!parent || parent.localName === 'p' && parent.childElementCount === 1 && !parent.textContent?.trim()) {
      image.dataset.standalone = 'true'
    }
    const source = image.getAttribute('src')
    if (!source || isRemoteMarkdownImage(source) || isEmbeddedMarkdownImage(source)) return
    const embedded = await window.desktop.readMarkdownImage(file, source).catch(() => null)
    if (embedded) image.setAttribute('src', embedded)
    else image.removeAttribute('src')
  }))
  return output.innerHTML
}
