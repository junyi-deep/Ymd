const xlink = 'http://www.w3.org/1999/xlink'
const svg = 'http://www.w3.org/2000/svg'
const namespace = 'urn:xmind:xmap:xmlns:content:2.0'

function children(element: Element | undefined, name: string) {
  return [...(element?.children ?? [])].filter(child => child.localName === name)
}

const child = (element: Element | undefined, name: string) => children(element, name)[0]
const title = (element: Element | undefined) => child(element, 'title')?.textContent ?? ''
const attribute = (element: Element | undefined, name: string) => element?.getAttribute(name) ?? undefined
const linked = (element: Element, name: string) => element.getAttributeNS(xlink, name) ?? element.getAttribute(name) ?? undefined

function parseXml(source: string) {
  if (/<!DOCTYPE/i.test(source)) throw new Error('Xmind XML 含有不受支持的文档类型声明。')
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('无法读取 Xmind 的 XML 数据。')
  return document
}

export function readLegacyXmind(content: string, stylesheet?: string) {
  const document = parseXml(content)
  if (document.documentElement.localName !== 'xmap-content' || document.documentElement.namespaceURI !== namespace) {
    throw new Error('无法识别 Xmind 工作簿的 XML 格式。')
  }
  const byId = new Map<string, Record<string, string>>()
  if (stylesheet) {
    for (const style of parseXml(stylesheet).getElementsByTagNameNS('*', 'style')) {
      const id = style.getAttribute('id')
      const properties = [...style.children].filter(element => element.localName.endsWith('-properties'))
      if (id && properties.length) byId.set(id, Object.fromEntries(properties.flatMap(element =>
        [...element.attributes].map(attribute => [attribute.name, attribute.value]))))
    }
  }
  const styleFor = (element: Element) => ({ properties: byId.get(attribute(element, 'style-id') ?? '') })
  let count = 0

  function topic(element: Element | undefined, depth = 0): Record<string, unknown> {
    if (!element || depth > 80 || ++count > 10000) throw new Error('Xmind 主题无效，或数量与层级超过导入限制。')
    const lists = children(child(element, 'children'), 'topics')
    const childrenByType: Record<string, unknown> = {}
    for (const group of lists) {
      const type = attribute(group, 'type')
      if (type === 'attached' || type === 'detached' || type === 'summary' || type === 'callout') {
        childrenByType[type] = children(group, 'topic').map(node => topic(node, depth + 1))
      }
    }
    const image = child(element, 'img')
    const position = child(element, 'position')
    const plain = child(child(element, 'notes'), 'plain') ?? child(child(element, 'notes'), 'html')
    const boundaries = children(child(element, 'boundaries'), 'boundary')
    const summaries = children(child(element, 'summaries'), 'summary')
    const extensions = children(child(element, 'extensions'), 'extension').map(extension => ({
      provider: attribute(extension, 'provider'),
      content: [...(child(extension, 'content')?.children ?? [])].map(entry => ({ name: entry.localName, content: entry.textContent })),
    }))
    return {
      id: attribute(element, 'id'), title: title(element), style: styleFor(element),
      href: linked(element, 'href'), branch: attribute(element, 'branch'), structureClass: attribute(element, 'structure-class'),
      width: child(element, 'title')?.getAttributeNS(svg, 'width') ?? undefined,
      ...(position ? { position: { x: Number(position.getAttributeNS(svg, 'x')), y: Number(position.getAttributeNS(svg, 'y')) } } : {}),
      notes: { plain: { content: plain?.textContent } },
      labels: children(child(element, 'labels'), 'label').map(label => label.textContent),
      markers: children(child(element, 'marker-refs'), 'marker-ref').map(marker => ({ markerId: attribute(marker, 'marker-id') })),
      image: image ? { src: attribute(image, 'src') ?? linked(image, 'href'),
        width: image.getAttributeNS(svg, 'width') ?? attribute(image, 'width'), height: image.getAttributeNS(svg, 'height') ?? attribute(image, 'height') } : undefined,
      children: childrenByType,
      extensions,
      boundaries: boundaries.map(frame => ({ title: title(frame), range: attribute(frame, 'range') })),
      summaries: summaries.map(summary => ({ topicId: attribute(summary, 'topic-id'), range: attribute(summary, 'range') })),
    }
  }

  return children(document.documentElement, 'sheet').map(sheet => ({
    id: attribute(sheet, 'id'), title: title(sheet), style: styleFor(sheet), rootTopic: topic(child(sheet, 'topic')),
    relationships: children(child(sheet, 'relationships'), 'relationship').map(relationship => ({
      end1Id: attribute(relationship, 'end1'), end2Id: attribute(relationship, 'end2'), title: title(relationship),
    })),
  }))
}
