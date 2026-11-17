import { memo, useLayoutEffect, useRef } from 'react'
import { Marked, marked, type Links } from 'marked'
import { markdownBody } from './markdownExtras'
import { sanitizeMarkdownHtml } from './markdownHtml'
import { decodeImageAttribute, markdownImageLine, readHtmlImage } from './markdownImageSyntax'
import { createMarkdownImage, displayMath, scheduleBlockPreview, type PreviewImage } from './markdownPreviewMedia'

const previews = new WeakMap<HTMLElement, { observer: IntersectionObserver; pending: Map<Element, () => void> }>()

function deferPreview(scroll: HTMLElement, view: HTMLElement, render: () => void) {
  let queue = previews.get(scroll)
  if (!queue) {
    const pending = new Map<Element, () => void>()
    const observer = new IntersectionObserver(items => {
      for (const item of items) {
        if (!item.isIntersecting) continue
        observer.unobserve(item.target)
        const paint = pending.get(item.target)
        pending.delete(item.target)
        paint?.()
      }
    }, { root: scroll, rootMargin: '450px 0px' })
    queue = { observer, pending }
    previews.set(scroll, queue)
  }
  queue.pending.set(view, render)
  queue.observer.observe(view)
  return () => {
    queue.observer.unobserve(view)
    queue.pending.delete(view)
    if (!queue.pending.size) {
      queue.observer.disconnect()
      if (previews.get(scroll) === queue) previews.delete(scroll)
    }
  }
}

export function outlineReferences(text: string) {
  return text.includes(']:') ? JSON.stringify(marked.lexer(markdownBody(text)).links) : ''
}

export const OutlineMarkdown = memo(function OutlineMarkdown({ text, path, remoteImages, links, className, block }: {
  text: string; path: string; remoteImages: boolean; links?: Links; className?: string; block?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const view = root.current!
    const scroll = block ? view.closest<HTMLElement>('.outline-editor') : null
    const cancelDiagrams: (() => void)[] = []
    const populate = () => {
      const markdown = text.replace(/^\uFEFF/, '')
      const source = block && /^\[[ xX]\]\s/.test(markdown) ? '- ' + markdown : markdown
      const images = new Map<string, PreviewImage>()
      const diagrams = new Map<string, { code: string; kind: 'mermaid' | 'math' }>()
      const prefix = crypto.randomUUID() + '-'
      const imagePlaceholder = (image: PreviewImage) => {
        const id = prefix + images.size
        images.set(id, image)
        return `<span data-preview-image="${id}"></span>`
      }
      const blockPlaceholder = (code: string, kind: 'mermaid' | 'math') => {
        const id = prefix + diagrams.size
        diagrams.set(id, { code, kind })
        return `<figure data-preview-block="${id}"></figure>`
      }
      const parser = new Marked({ gfm: true, breaks: true }, {
        tokenizer: {
          html(source) {
            const image = markdownImageLine(source)
            return image ? { type: 'html', block: true, pre: false, ...image } : false
          },
        },
        renderer: {
          image(token) {
            const text = this.parser.parseInline(token.tokens, this.parser.textRenderer)
            return imagePlaceholder({ source: decodeImageAttribute(token.href), label: decodeImageAttribute(text),
              title: token.title == null ? undefined : decodeImageAttribute(token.title), sizing: {} })
          },
          html(token) {
            const image = readHtmlImage(token.text.trim())
            return image ? imagePlaceholder(image) : false
          },
          code(token) {
            if (token.text.trim() && token.lang?.trim().toLowerCase() === 'mermaid') return blockPlaceholder(token.text, 'mermaid')
            return false
          },
          paragraph(token) {
            const math = displayMath.exec(token.text)
            return math ? blockPlaceholder(math[1], 'math') : false
          },
        },
      })
      const lexer = new parser.Lexer(parser.defaults)
      Object.assign(lexer.tokens.links, links)
      const template = document.createElement('template')
      template.innerHTML = source ? sanitizeMarkdownHtml(parser.parser(lexer.lex(source))) : '&nbsp;'
      const output = template.content
      for (const table of output.querySelectorAll('table')) {
        const viewport = document.createElement('div')
        viewport.className = 'outline-table-scroll'
        table.replaceWith(viewport)
        viewport.append(table)
      }
      for (const placeholder of output.querySelectorAll<HTMLElement>('[data-preview-image]')) {
        const image = images.get(placeholder.dataset.previewImage ?? '')
        if (!image) continue
        const parent = placeholder.parentElement
        const standalone = !parent || parent.localName === 'p' && parent.childElementCount === 1 && !parent.textContent?.trim()
        placeholder.replaceWith(createMarkdownImage(path, image, remoteImages, standalone))
      }
      for (const figure of output.querySelectorAll<HTMLElement>('figure[data-preview-block]')) {
        const preview = diagrams.get(figure.dataset.previewBlock ?? '')
        if (!preview) continue
        delete figure.dataset.previewBlock
        const diagram = preview.kind === 'mermaid'
        figure.className = 'mermaid-preview'
        figure.setAttribute('aria-label', diagram ? 'Mermaid 图' : '公式块')
        const content = document.createElement('div')
        content.className = 'mermaid-content'
        content.textContent = diagram ? '正在绘制 Mermaid 图…' : '正在渲染公式…'
        figure.append(content)
        cancelDiagrams.push(scheduleBlockPreview(content, preview.code, preview.kind,
          scroll ?? view.closest('.outline-editor, .map-remainder .document-remainder-body'), undefined, () => {
          content.classList.add('mermaid-error')
          content.textContent = diagram ? 'Mermaid 无法渲染。' : '公式无法渲染。'
          const raw = document.createElement('pre')
          raw.textContent = preview.code
          figure.append(raw)
        }))
      }
      view.replaceChildren(output)
    }
    const cancelPreview = scroll && !view.hasChildNodes() ? deferPreview(scroll, view, populate) : undefined
    if (!cancelPreview) populate()
    return () => { cancelPreview?.(); cancelDiagrams.forEach(cancel => cancel()) }
  }, [text, path, remoteImages, links, block])

  return <div ref={root} className={className} />
})
