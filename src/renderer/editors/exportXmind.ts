import JSZip from 'jszip'
import { pitchExtension, readPitchOptions, readPitchTopic } from '../../shared/pitch'
import { branchStructure, mapTheme, palettes, type MapData, type MapSheet } from './mapAppearance'
import { loadAudio, readAudioNote } from './mapAudio'
import { calloutShapeClasses, progressMarkers, shapes, structures, styleKeys, topicLinkExtension } from './xmindFormat'
import { readTopicLink, topicLinkUrl, xmindAddressLink, type TopicLink } from './mapTopicLinks'
import { calloutDefaults, calloutTopicId, readCallouts } from './mapCallouts'
import { readTask, readTodo, type MapTask } from './mapTasks'
import { exportTaskContent, taskExtension } from './xmindTasks'
import { encodeXmindCalendar, readWorkCalendar } from './workCalendar'
import { equationExtension, readEquation } from './mapEquation'
import { numberingExtension, readNumbering } from './mapNumbering'

type Sheet = Pick<MapSheet, 'id' | 'title' | 'settings' | 'tree'>
type Properties = Record<string, string>
type Topic = {
  id: string; class: 'topic'; title: string; structureClass?: string
  position?: { x: number; y: number }; branch?: 'folded'; width?: number
  style?: { id: string; properties: Properties }; href?: string
  notes?: { plain: { content: string } }; labels?: string[]
  image?: { src: string; width: number; height: number; align?: string; isMathJaxImage?: boolean }; markers?: { markerId: string }[]
  summaries?: { id: string; class: 'summary'; range: string; topicId: string }[]
  boundaries?: { id: string; class: 'boundary'; title: string; range: string }[]
  extensions?: { provider: string; content: unknown; resourceRefs?: string[] }[]
  children?: { attached?: Topic[]; detached?: Topic[]; summary?: Topic[]; callout?: Topic[] }
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
  const resource = (extension: string, data: string | Promise<ArrayBuffer>, name?: string) => {
    const path = 'resources/' + id() + (name ? '/' + name : '.' + extension)
    zip.file(path, data, { base64: typeof data === 'string' })
    manifest['file-entries'][path] = {}
    return 'xap:' + path.split('/').map(encodeURIComponent).join('/')
  }
  const audioResources = new Map<string, string>()
  const documentIds = new Map<string, { id: string; topics: Map<string, string> }>()
  const topicsById = new Map<string, Topic>()
  const links: { output: Topic; target: TopicLink }[] = []

  const content = sheets.map(sheet => {
    const ids = new Map<string, string>()
    const sheetId = id()
    documentIds.set(sheet.id, { id: sheetId, topics: ids })
    const connections: { source: string; target: string; title: string }[] = []
    const tasks: { output: Topic; task: MapTask }[] = []
    const rootPosition = sheet.tree.data
    const theme = mapTheme(sheet.settings, dark)
    const palette = palettes[sheet.settings.palette] ?? palettes.ocean

    function topic(node: MapData, depth: number, branch: number, callout?: string): Topic {
      const { data } = node
      const output: Topic = { id: id(), class: 'topic', title: data.text ?? '' }
      topicsById.set(output.id, output)
      const audio = readAudioNote(data.ymdAudio)
      if (audio) {
        let ref = audioResources.get(audio.id)
        if (!ref) {
          ref = resource('webm', loadAudio(audio.id).then(blob => blob.arrayBuffer()))
          audioResources.set(audio.id, ref)
        }
        output.extensions = [{ provider: 'org.xmind.ui.audionotes', content: [{ duration: Math.round(audio.duration * 1000) }], resourceRefs: [ref] }]
      }
      const linkId = callout ?? data.uid
      if (linkId) ids.set(linkId, output.id)
      const numbering = readNumbering(data.ymdNumbering)
      if (numbering) output.extensions = [...(output.extensions ?? []), { provider: numberingExtension, content: numbering }]
      if (data.ymdPitch) output.extensions = [...(output.extensions ?? []), { provider: pitchExtension, content: readPitchTopic(data.ymdPitch) }]
      const task = readTask(data.ymdTask)
      const todo = readTodo(data.ymdTodo)
      if (task) tasks.push({ output, task })
      else if (todo) output.extensions = [...(output.extensions ?? []), { provider: taskExtension, content: { status: todo } }]
      const structure = depth === 0 ? branchStructure(sheet.settings.layout) ?? 'mindMap' : branchStructure(data.ymdStructure)
      if (structure) output.structureClass = structures[structure]
      if (data.expand === false && node.children?.length) output.branch = 'folded'
      if (callout) {
        if (number(data.calloutX) && number(data.calloutY)) output.position = { x: Number(data.calloutX), y: Number(data.calloutY) }
        if (number(data.calloutWidth)) output.width = Number(data.calloutWidth)
      } else if (data.ymdFloating === true && number(data.customLeft) && number(data.customTop)) {
        output.position = { x: Number(data.customLeft) - Number(rootPosition.customLeft ?? 0), y: Number(data.customTop) - Number(rootPosition.customTop ?? 0) }
      }
      const appearance: Record<string, unknown> = { ...(callout ? calloutDefaults : depth === 0 ? theme.root : depth === 1 ? theme.second : theme.node),
        lineWidth: theme.lineWidth, lineColor: sheet.settings.colored && depth ? palette.colors[branch % palette.colors.length] : theme.lineColor,
        ...data }
      const properties: Properties = {}
      for (const [key, attribute] of Object.entries(styleKeys)) {
        const value = key === 'fontFamily' && appearance[key] === 'system-ui' ? '$system$' : appearance[key]
        if (typeof value === 'string' || number(value)) properties[attribute] = String(value) + (pixels.has(key) && typeof value === 'number' ? 'pt' : '')
      }
      if (callout) {
        const shape = typeof data.shape === 'string' && Object.hasOwn(calloutShapeClasses, data.shape) ? data.shape : calloutDefaults.shape
        properties['callout-shape-class'] = calloutShapeClasses[shape]
      } else if (typeof data.shape === 'string' && Object.hasOwn(shapes, data.shape)) properties['shape-class'] = 'org.xmind.topicShape.' + shapes[data.shape]
      output.style = { id: id(), properties }
      if (typeof data.note === 'string' && data.note) output.notes = { plain: { content: data.note } }
      const attachment = typeof data.attachmentUrl === 'string' && /^data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)$/.exec(data.attachmentUrl)
      const address = xmindAddressLink(data.hyperlink)
      if (attachment) {
        const name = String(data.attachmentName ?? '附件').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 160).replace(/^[.]+|[. ]+$/g, '')
        output.href = resource('', attachment[1], name || '附件')
        if (address) {
          output.extensions = [...(output.extensions ?? []), {
            provider: topicLinkExtension, content: [{ href: address }], resourceRefs: [],
          }]
        }
      } else if (address) output.href = address
      const target = readTopicLink(data.hyperlink)
      if (target) links.push({ output, target })
      const labels = list(data.tag).map(item => typeof item === 'string' ? item : record(item).text)
        .filter((item): item is string => typeof item === 'string' && !!item)
      if (labels.length) output.labels = labels
      const markers = list(data.icon).flatMap(item => {
        if (typeof item !== 'string') return []
        const [kind, value] = item.split('_')
        if (kind === 'priority' && /^[1-9]$/.test(value)) return [{ markerId: 'priority-' + value }]
        const markerId = progressMarkers[Number(value)]
        if (kind === 'progress' && markerId) return [{ markerId }]
        return []
      })
      if (markers.length) output.markers = markers
      const image = typeof data.image === 'string' && /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,([A-Za-z0-9+/=]+)$/i.exec(data.image)
      const size = record(data.imageSize)
      const equation = readEquation(data.ymdEquation)
      if (image && number(size.width) && number(size.height)) {
        const align = typeof data.imgPlacement === 'string' && /^(top|bottom|left|right)$/.test(data.imgPlacement) ? data.imgPlacement : undefined
        output.image = { src: resource(image[1] === 'jpeg' ? 'jpg' : image[1], image[2]),
          width: Number(size.width), height: Number(size.height), align, ...(equation ? { isMathJaxImage: true } : {}) }
      }
      if (equation) {
        const imageSource = output.image?.src
        output.extensions = [...(output.extensions ?? []), { provider: equationExtension,
          content: { content: equation, imageSource }, ...(imageSource ? { resourceRefs: [imageSource] } : {}) }]
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
      const callouts = readCallouts(data.ymdCallouts)
      if (data.uid && callouts.length) {
        const owner = data.uid
        output.children = { ...output.children, callout: callouts.map(note => topic(note, depth + 1, branch, calloutTopicId(owner, note.data.uid))) }
      }
      return output
    }

    const rootTopic = topic(sheet.tree, 0, 0)
    const calendar = readWorkCalendar(sheet.tree.data.ymdWorkCalendar)
    for (const { output, task } of tasks) {
      output.extensions = [...(output.extensions ?? []), { provider: taskExtension, content: exportTaskContent(task, ids) }]
    }
    const relationships = connections.flatMap(connection => {
      const to = ids.get(connection.target)
      return to ? [{ id: id(), class: 'relationship', end1Id: connection.source, end2Id: to, title: connection.title }] : []
    })
    const extensions = [
      ...(calendar ? [encodeXmindCalendar(calendar, id)] : []),
      ...(sheet.settings.pitch ? [{ provider: pitchExtension, content: readPitchOptions(sheet.settings.pitch) }] : []),
    ]
    return { id: sheetId, class: 'sheet', title: sheet.title, rootTopic, relationships, topicPositioning: 'fixed',
      ...(calendar ? { nonWorkingDaysSkipping: calendar.enabled ? 'skip' : 'include' } : {}),
      ...(extensions.length ? { extensions } : {}),
      style: { id: id(), properties: { 'svg:fill': theme.backgroundColor } } }
  })
  const reverse: { sourceId: string; destination: Topic }[] = []
  for (const { output, target } of links) {
    if (target.document) {
      output.extensions = [...(output.extensions ?? []), {
        provider: topicLinkExtension, content: [{ href: topicLinkUrl(target) }], resourceRefs: [],
      }]
      continue
    }
    const destination = documentIds.get(target.sheet)
    const targetId = target.topic ? destination?.topics.get(target.topic) : destination?.id
    if (!targetId) continue
    const href = 'xmind:#' + targetId
    if (output.href || target.bidirectional) {
      output.extensions = [...(output.extensions ?? []), {
        provider: topicLinkExtension, content: [{ href, ...(target.bidirectional ? { bidirectional: true } : {}) }],
        resourceRefs: [],
      }]
    }
    if (!output.href) output.href = href
    const targetTopic = target.topic ? topicsById.get(targetId) : undefined
    if (target.bidirectional && targetTopic) reverse.push({ sourceId: output.id, destination: targetTopic })
  }
  // Xmind has one native href per topic. Use an unoccupied slot for the return link.
  for (const { sourceId, destination } of reverse) {
    if (destination.href) continue
    const href = 'xmind:#' + sourceId
    destination.href = href
    destination.extensions = [...(destination.extensions ?? []), {
      provider: topicLinkExtension, content: [{ href, generated: true }], resourceRefs: [],
    }]
  }

  zip.file('content.json', JSON.stringify(content))
  const activeIndex = sheets.findIndex(sheet => sheet.id === active)
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'Ymd' }, dataStructureVersion: '2', activeSheetId: content[Math.max(0, activeIndex)]?.id }))
  zip.file('manifest.json', JSON.stringify(manifest))
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
