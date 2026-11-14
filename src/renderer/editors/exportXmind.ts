import JSZip from 'jszip'
import { branchStructure, mapTheme, palettes, type MapData, type MapSheet } from './mapAppearance'

type Sheet = Pick<MapSheet, 'id' | 'title' | 'settings' | 'tree'>
type Properties = Record<string, string>
type Topic = {
  id: string; class: 'topic'; title: string; structureClass?: string
  position?: { x: number; y: number }; branch?: 'folded'
  style?: { id: string; properties: Properties }; href?: string
  notes?: { plain: { content: string } }; labels?: string[]
  image?: { src: string; width: number; height: number }; markers?: { markerId: string }[]
  summaries?: { id: string; class: 'summary'; range: string; topicId: string }[]
  boundaries?: { id: string; class: 'boundary'; title: string; range: string }[]
  children?: { attached?: Topic[]; detached?: Topic[]; summary?: Topic[] }
}

const structures: Record<string, string> = {
  mindMap: 'org.xmind.ui.map', logicalStructure: 'org.xmind.ui.logic.right',
  logicalStructureLeft: 'org.xmind.ui.logic.left', organizationStructure: 'org.xmind.ui.org-chart.down',
  catalogOrganization: 'org.xmind.ui.tree.right', timeline: 'org.xmind.ui.timeline.horizontal',
  verticalTimeline: 'org.xmind.ui.timeline.vertical', fishbone: 'org.xmind.ui.fishbone.rightHeaded',
}
const styleKeys: Record<string, string> = {
  fillColor: 'svg:fill', color: 'fo:color', fontFamily: 'fo:font-family',
  fontSize: 'fo:font-size', fontWeight: 'fo:font-weight', fontStyle: 'fo:font-style',
  textDecoration: 'fo:text-decoration', textAlign: 'fo:text-align',
  borderColor: 'border-line-color', borderWidth: 'border-line-width',
  lineWidth: 'line-width', lineColor: 'line-color',
}
const shapes: Record<string, string> = {
  rectangle: 'rect', roundedRectangle: 'roundedRect', ellipse: 'ellipse', circle: 'circle', diamond: 'diamond', parallelogram: 'parallelogram',
}
const pixels = new Set(['fontSize', 'lineWidth', 'borderWidth'])
const id = () => crypto.randomUUID().replaceAll('-', '')
const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const list = (value: unknown) => Array.isArray(value) ? value : value == null ? [] : [value]
const range = (from: number, to: number) => '(' + from + ',' + to + ')'

export async function exportXmind(sheets: Sheet[], active: string, dark: boolean): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const manifest = { 'file-entries': { 'content.json': {}, 'metadata.json': {} } as Record<string, object> }
  const resource = (extension: string, base64: string) => {
    const path = 'resources/' + id() + '.' + extension
    zip.file(path, base64, { base64: true })
    manifest['file-entries'][path] = {}
    return 'xap:' + path
  }

  const content = sheets.map(sheet => {
    const ids = new Map<string, string>()
    const connections: { source: string; target: string; title: string }[] = []
    const rootPosition = sheet.tree.data
    const theme = mapTheme(sheet.settings, dark)
    const palette = palettes[sheet.settings.palette] ?? palettes.ocean

    function topic(node: MapData, depth: number, branch: number): Topic {
      const { data } = node
      const output: Topic = { id: id(), class: 'topic', title: data.text ?? '' }
      if (data.uid) ids.set(data.uid, output.id)
      const structure = depth === 0 ? branchStructure(sheet.settings.layout) ?? 'mindMap' : branchStructure(data.ymdStructure)
      if (structure) output.structureClass = structures[structure]
      if (data.expand === false && node.children?.length) output.branch = 'folded'
      if (data.ymdFloating === true && number(data.customLeft) && number(data.customTop)) {
        output.position = { x: Number(data.customLeft) - Number(rootPosition.customLeft ?? 0), y: Number(data.customTop) - Number(rootPosition.customTop ?? 0) }
      }
      const appearance: Record<string, unknown> = { ...(depth === 0 ? theme.root : depth === 1 ? theme.second : theme.node),
        lineWidth: theme.lineWidth, lineColor: sheet.settings.colored && depth ? palette.colors[branch % palette.colors.length] : theme.lineColor,
        ...data }
      const properties: Properties = {}
      for (const [key, attribute] of Object.entries(styleKeys)) {
        const value = key === 'fontFamily' && appearance[key] === 'system-ui' ? '$system$' : appearance[key]
        if (typeof value === 'string' || number(value)) properties[attribute] = String(value) + (pixels.has(key) && typeof value === 'number' ? 'pt' : '')
      }
      if (typeof data.shape === 'string' && Object.hasOwn(shapes, data.shape)) properties['shape-class'] = 'org.xmind.topicShape.' + shapes[data.shape]
      output.style = { id: id(), properties }
      if (typeof data.note === 'string' && data.note) output.notes = { plain: { content: data.note } }
      if (typeof data.hyperlink === 'string' && /^https?:\/\//i.test(data.hyperlink)) output.href = data.hyperlink
      const labels = list(data.tag).map(item => typeof item === 'string' ? item : record(item).text)
        .filter((item): item is string => typeof item === 'string' && !!item)
      if (labels.length) output.labels = labels
      const markers = list(data.icon).flatMap(item => {
        if (typeof item !== 'string') return []
        const [kind, value] = item.split('_')
        if (kind === 'priority' && /^[1-6]$/.test(value)) return [{ markerId: 'priority-' + value }]
        if (kind === 'progress' && value === '8') return [{ markerId: 'task-done' }]
        return []
      })
      if (markers.length) output.markers = markers
      const image = typeof data.image === 'string' && /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,([A-Za-z0-9+/=]+)$/i.exec(data.image)
      const size = record(data.imageSize)
      if (image && number(size.width) && number(size.height)) {
        output.image = { src: resource(image[1] === 'jpeg' ? 'jpg' : image[1], image[2]), width: Number(size.width), height: Number(size.height) }
      }
      const labelsByTarget = record(data.associativeLineText)
      for (const related of list(data.associativeLineTargets)) {
        if (typeof related !== 'string') continue
        connections.push({ source: output.id, target: related, title: String(labelsByTarget[related] ?? '') })
      }

      const children = node.children ?? []
      const attached: Topic[] = []
      const detached: Topic[] = []
      const indexes = new Map<number, number>()
      const groups = new Map<string, { from: number; to: number; title: string }>()
      children.forEach((child, index) => {
        const converted = topic(child, depth + 1, depth === 0 ? index : branch)
        if (child.data.ymdFloating === true) { detached.push(converted); return }
        const childIndex = attached.length
        indexes.set(index, childIndex)
        attached.push(converted)
        const frame = record(child.data.outerFrame)
        if (child.data.outerFrame) {
          const key = typeof frame.groupId === 'string' ? frame.groupId : 'frame-' + childIndex
          const group = groups.get(key)
          if (group) group.to = childIndex
          else groups.set(key, { from: childIndex, to: childIndex, title: typeof frame.text === 'string' ? frame.text : '' })
        }
      })
      if (attached.length || detached.length) output.children = { ...(attached.length ? { attached } : {}), ...(detached.length ? { detached } : {}) }
      if (groups.size) output.boundaries = [...groups.values()].map(group => ({ id: id(), class: 'boundary', title: group.title, range: range(group.from, group.to) }))
      const summary: Topic[] = []
      const summaries: NonNullable<Topic['summaries']> = []
      const addSummary = (result: Record<string, unknown>, from: number, to: number) => {
        const summaryId = id()
        summary.push({ id: summaryId, class: 'topic', title: typeof result.text === 'string' ? result.text : '' })
        summaries.push({ id: id(), class: 'summary', range: range(from, to), topicId: summaryId })
      }
      for (const item of list(data.generalization).map(record)) {
        if (!Array.isArray(item.range) || item.range.length !== 2) continue
        const [start, end] = item.range
        const inRange = [...indexes].filter(([index]) => index >= start && index <= end)
        if (inRange.length) addSummary(item, inRange[0][1], inRange.at(-1)![1])
      }
      for (const [index, attachedIndex] of indexes) {
        for (const item of list(children[index].data.generalization).map(record)) {
          if (!Array.isArray(item.range) || !item.range.length) addSummary(item, attachedIndex, attachedIndex)
        }
      }
      if (summaries.length) {
        output.children = { ...output.children, summary }
        output.summaries = summaries
      }
      return output
    }

    const rootTopic = topic(sheet.tree, 0, 0)
    const relationships = connections.flatMap(connection => {
      const to = ids.get(connection.target)
      return to ? [{ id: id(), class: 'relationship', end1Id: connection.source, end2Id: to, title: connection.title }] : []
    })
    return { id: id(), class: 'sheet', title: sheet.title, rootTopic, relationships, topicPositioning: 'fixed',
      style: { id: id(), properties: { 'svg:fill': theme.backgroundColor } } }
  })

  zip.file('content.json', JSON.stringify(content))
  const activeIndex = sheets.findIndex(sheet => sheet.id === active)
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'Ymd' }, dataStructureVersion: '2', activeSheetId: content[Math.max(0, activeIndex)]?.id }))
  zip.file('manifest.json', JSON.stringify(manifest))
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
