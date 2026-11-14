import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import type { Tokens } from 'marked'

export async function printMarkdown(file: string, source: string) {
  const parser = new Marked({ gfm: true, breaks: false })
  parser.use({
    walkTokens: async token => {
      if (token.type === 'code') {
        const code = token as Tokens.Code
        if (code.lang?.trim().toLowerCase() !== 'mermaid') return
        try {
          const { renderAsync } = await import('pele/lazy')
          const { svg } = await renderAsync(code.text, { responsive: true, links: false, images: false, idPrefix: 'ymd-print-' + crypto.randomUUID() })
          Object.assign(token, { type: 'html', text: '<figure>' + svg + '</figure>' })
        } catch {}
      }
      if (token.type === 'image') {
        const image = token as Tokens.Image
        if (/^https?:\/\//i.test(image.href)) return
        if (/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(image.href)) return
        image.href = await window.desktop.readMarkdownImage(file, image.href).catch(() => null) ?? ''
      }
      if (token.type === 'paragraph') {
        const paragraph = token as Tokens.Paragraph
        const math = /^\$\$[ \t]*\n([\s\S]+)\n\$\$[ \t]*$/.exec(paragraph.text)
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
  const html = await parser.parse(source, { async: true })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ['form', 'style', 'iframe', 'video', 'audio', 'object', 'embed', 'foreignObject'],
  })
}
