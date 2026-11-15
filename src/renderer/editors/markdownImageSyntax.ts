import type { MarkdownConfig } from '@lezer/markdown'

export interface ImageSizing { width?: string; height?: string; zoom?: string }

export const isRemoteMarkdownImage = (url: string) => /^https?:\/\//i.test(url)
export const isEmbeddedMarkdownImage = (url: string) => /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(url)

interface ImageAttribute {
  name: string
  value?: string
  from: number
  to: number
  valueFrom: number
}

export function parseImageTag(source: string) {
  if (!/^<img(?=[\t />])/i.test(source)) return
  const attributes: ImageAttribute[] = []
  const closing = /[\t ]*\/?>/y
  const attribute = /[\t ]+([^\s"'<>\/=]+)(?:[\t ]*=[\t ]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"'`<>=]+)))?/y
  let offset = 4
  while (offset < source.length) {
    closing.lastIndex = offset
    const close = closing.exec(source)
    if (close) {
      if (attributes.some(item => item.name === 'src' && item.value !== undefined)) {
        return { length: closing.lastIndex, close: close[0], attributes }
      }
      return
    }
    attribute.lastIndex = offset
    const match = attribute.exec(source)
    if (!match) return
    const [, name, double, single, bare] = match
    const value = double ?? single ?? bare
    const valueEnd = attribute.lastIndex - (double !== undefined || single !== undefined ? 1 : 0)
    attributes.push({ name: name.toLowerCase(), value, from: offset, to: attribute.lastIndex,
      valueFrom: valueEnd - (value?.length ?? 0) })
    offset = attribute.lastIndex
  }
}

export const markdownImageTags: MarkdownConfig = {
  defineNodes: ['HtmlImage', { name: 'HtmlImageBlock', block: true }],
  parseBlock: [{
    name: 'HtmlImageBlock',
    before: 'HTMLBlock',
    parse(context, line) {
      if (line.next !== 60) return false
      const raw = line.text.slice(line.pos)
      const image = parseImageTag(raw)
      if (!image || raw.slice(image.length).trim()) return false
      const from = context.lineStart + line.pos
      context.addElement(context.elt('HtmlImageBlock', from, from + image.length))
      context.nextLine()
      return true
    },
  }],
  parseInline: [{
    name: 'HtmlImage',
    before: 'HTMLTag',
    parse(context, next, position) {
      if (next !== 60 || context.slice(position, position + 4).toLowerCase() !== '<img') return -1
      const image = parseImageTag(context.slice(position, context.end))
      return image ? context.addElement(context.elt('HtmlImage', position, position + image.length)) : -1
    },
  }],
}

export function decodeImageAttribute(value: string) {
  if (!value.includes('&')) return value
  const text = document.createElement('textarea')
  text.innerHTML = value.replaceAll('<', '&lt;')
  return text.value
}

export function markdownImageLine(source: string) {
  if (!/^ {0,3}<img[\t />]/i.test(source)) return
  const end = source.indexOf('\n')
  const raw = end < 0 ? source : source.slice(0, end + 1)
  const text = raw.trim()
  if (parseImageTag(text)?.length === text.length) return { raw, text }
}

export function imageDimension(value: string) {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(px|%)?$/i.exec(value.trim())
  const amount = match ? Number(match[1]) : 0
  return amount > 0 && amount <= 32768 ? amount + (match?.[2]?.toLowerCase() ?? 'px') : undefined
}

function imageZoom(value: string) {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(%)?$/.exec(value.trim())
  if (!match) return
  const factor = Number(match[1]) / (match[2] ? 100 : 1)
  if (factor > 0 && factor <= 10) return factor + ''
}

function imageStyle(text: string) {
  const style = document.createElement('span').style
  style.cssText = text
  return style
}

export function readImageSizing(get: (name: string) => string | undefined): ImageSizing {
  const style = imageStyle(get('style') ?? '')
  return { width: imageDimension(style.width || get('width') || ''), height: imageDimension(style.height || get('height') || ''),
    zoom: imageZoom(style.getPropertyValue('zoom')) }
}

export function readHtmlImage(source: string) {
  const tag = parseImageTag(source)
  if (tag?.length !== source.length) return
  const src = tag.attributes.find(item => item.name === 'src' && item.value !== undefined)
  if (src?.value === undefined) return
  const attribute = (name: string) => {
    const raw = tag.attributes.find(item => item.name === name)?.value
    return raw === undefined ? undefined : decodeImageAttribute(raw)
  }
  return { source: decodeImageAttribute(src.value), label: attribute('alt') ?? '', title: attribute('title'),
    sizing: readImageSizing(attribute), src: { from: src.valueFrom, to: src.valueFrom + src.value.length } }
}

export function imageHasSizing({ width, height, zoom }: ImageSizing) {
  return !!(width || height || zoom)
}

export function applyImageSizing(image: HTMLImageElement, sizing: ImageSizing) {
  if (sizing.width) image.style.width = sizing.width
  if (sizing.height) image.style.height = sizing.height
  if (sizing.zoom) image.style.setProperty('zoom', sizing.zoom)
}

function attributeValue(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function writeSizedImage(reference: { markdown: string; source: string; label: string; title?: string }, sizing: ImageSizing) {
  const { markdown, source, label, title } = reference
  const tag = parseImageTag(markdown)
  const existingStyle = tag?.attributes.find(item => item.name === 'style')?.value
  const style = imageStyle(existingStyle ? decodeImageAttribute(existingStyle) : '')
  for (const name of ['width', 'height', 'zoom']) style.removeProperty(name)
  if (sizing.zoom) {
    const percent = Number(sizing.zoom) * 100
    style.setProperty('zoom', String(Number(percent.toFixed(4))) + '%')
  }
  const attributes = tag
    ? tag.attributes.filter(item => !['width', 'height', 'style'].includes(item.name)).map(item => markdown.slice(item.from, item.to)).join('')
    : ' src="' + attributeValue(source) + '" alt="' + attributeValue(label) + '"' +
      (title === undefined ? '' : ' title="' + attributeValue(title) + '"')
  return (tag ? markdown.slice(0, 4) : '<img') + attributes
    + (sizing.width ? ' width="' + attributeValue(sizing.width) + '"' : '')
    + (sizing.height ? ' height="' + attributeValue(sizing.height) + '"' : '')
    + (style.cssText ? ' style="' + attributeValue(style.cssText) + '"' : '')
    + (tag?.close ?? ' />')
}
