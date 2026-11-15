import DOMPurify from 'dompurify'
import { applyImageSizing, imageHasSizing, isEmbeddedMarkdownImage, isRemoteMarkdownImage,
  type ImageSizing } from './markdownImageSyntax'

export type PreviewImage = { source: string; label: string; title?: string; sizing: ImageSizing }

export function createMarkdownImage(file: string, { label, source, title, sizing }: PreviewImage,
  loadRemote: boolean, standalone: boolean, onLoad?: () => void) {
  const wrapper = document.createElement('span')
  const fallback = label || '图像'
  wrapper.className = 'md-image'
  if (standalone) wrapper.dataset.standalone = 'true'
  if (imageHasSizing(sizing)) wrapper.dataset.sized = 'true'
  const display = (url: string) => {
    const image = document.createElement('img')
    image.alt = label
    if (title) image.title = title
    image.referrerPolicy = 'no-referrer'
    applyImageSizing(image, sizing)
    if (onLoad) image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', () => { wrapper.textContent = fallback + ' · 无法读取图像' }, { once: true })
    wrapper.replaceChildren(image)
    image.src = url
  }
  if (isRemoteMarkdownImage(source)) {
    if (loadRemote) display(source)
    else {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = fallback + ' · 加载网络图像'
      button.addEventListener('click', () => display(source))
      wrapper.append(button)
    }
  } else if (isEmbeddedMarkdownImage(source)) display(source)
  else {
    wrapper.textContent = fallback
    void window.desktop.readMarkdownImage(file, source).then(url => {
      if (url) display(url)
      else wrapper.textContent = fallback + ' · 找不到图像'
    }, () => { wrapper.textContent = fallback + ' · 无法读取图像' })
  }
  return wrapper
}

export const displayMath = /^\$\$[ \t]*\n([\s\S]+)\n\$\$[ \t]*$/

export async function renderMermaid(code: string) {
  const { renderAsync } = await import('pele/lazy')
  const { svg } = await renderAsync(code, {
    responsive: true, links: false, images: false, idPrefix: 'ymd-' + crypto.randomUUID().replaceAll('-', ''),
  })
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'foreignObject', 'a', 'image'],
  })
}

export async function renderBlockPreview(content: HTMLElement, code: string, kind: 'mermaid' | 'math') {
  if (kind === 'mermaid') content.innerHTML = await renderMermaid(code)
  else {
    const [katex] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    katex.default.render(code, content, { displayMode: true, trust: false, maxExpand: 1000 })
  }
}
