export type MediaPreview = { type: 'image' | 'diagram'; src: string; title: string; svg?: string }
export const mediaPreviewEvent = 'ymd:media-preview'

export function openMediaPreview(element: HTMLElement, request: MediaPreview) {
  element.dispatchEvent(new CustomEvent(mediaPreviewEvent, { bubbles: true, detail: request }))
}

export function diagramPreview(svg: SVGSVGElement): MediaPreview {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const viewBox = svg.viewBox.baseVal
  const bounds = svg.getBoundingClientRect()
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // Pele's presentation attributes reference variables defined on the SVG root.
  const style = getComputedStyle(svg)
  for (const token of ['bg', 'fg', 'muted', 'line', 'surface', 'surface-alt', 'border', 'accent', 'font', 'font-mono', 'radius']) {
    const name = '--pele-' + token
    const value = style.getPropertyValue(name).trim()
    if (value) copy.style.setProperty(name, value)
  }
  copy.style.removeProperty('max-width')
  copy.style.removeProperty('height')
  const width = viewBox.width || bounds.width
  const height = viewBox.height || bounds.height
  copy.setAttribute('width', String(width))
  copy.setAttribute('height', String(height))
  const source = new XMLSerializer().serializeToString(copy)
  return { type: 'diagram', title: 'Mermaid 图', svg: source, src: 'data:image/svg+xml,' + encodeURIComponent(source) }
}
