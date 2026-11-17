import { renderMermaid } from './renderMermaid'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Scan } from 'lucide-react'
import { openMediaPreview } from './mediaPreview'
import { applyImageSizing, imageHasSizing, isEmbeddedMarkdownImage, isRemoteMarkdownImage,
  type ImageSizing } from './markdownImageSyntax'

export type PreviewImage = { source: string; label: string; title?: string; sizing: ImageSizing }

export function createMarkdownImage(file: string, { label, source, title, sizing }: PreviewImage,
  loadRemote: boolean, standalone: boolean, onLoad?: () => void, viewer = false) {
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
    if (viewer) image.addEventListener('load', () => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'icon-button md-visual-open'
      button.title = button.ariaLabel = '查看图片'
      button.innerHTML = renderToStaticMarkup(createElement(Scan, { size: 16, 'aria-hidden': true }))
      button.addEventListener('click', event => {
        event.stopPropagation()
        openMediaPreview(wrapper, { type: 'image', title: label || '图片', src: image.currentSrc || url })
      })
      wrapper.append(button)
    }, { once: true })
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

async function renderBlockPreview(content: HTMLElement, code: string, kind: 'mermaid' | 'math') {
  if (kind === 'mermaid') content.innerHTML = await renderMermaid(code)
  else {
    const [katex] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    katex.default.render(code, content, { displayMode: true, trust: false, maxExpand: 1000 })
  }
}

const observers = new WeakMap<Element, { observer: IntersectionObserver; jobs: Map<Element, () => void> }>()

export function scheduleBlockPreview(content: HTMLElement, code: string, kind: 'mermaid' | 'math', root: Element | null,
  ready?: () => void, failed?: (error: unknown) => void) {
  let current = true
  const run = () => {
    // Render into a detached element so completed jobs from recycled widgets cannot change the visible document.
    const output = document.createElement('div')
    void renderBlockPreview(output, code, kind).then(() => {
      if (!current || !content.isConnected) return
      content.replaceChildren(...output.childNodes)
      ready?.()
    }, error => { if (current && content.isConnected) failed?.(error) })
  }
  if (!root) {
    queueMicrotask(() => { if (current) run() })
    return () => { current = false }
  }
  let group = observers.get(root)
  if (!group) {
    const jobs = new Map<Element, () => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        const render = jobs.get(entry.target)
        jobs.delete(entry.target)
        render?.()
      }
    }, { root, rootMargin: '240px 0px' })
    group = { observer, jobs }
    observers.set(root, group)
  }
  group.jobs.set(content, run)
  group.observer.observe(content)
  return () => {
    current = false
    group.observer.unobserve(content)
    group.jobs.delete(content)
    if (group.jobs.size === 0 && observers.get(root) === group) observers.delete(root)
  }
}
