import { Uint8ArrayReader, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { markdownImageExtension, markdownImageExtensions } from '../../shared/contracts'
import { writeList, projectList, type Block } from './listProjection'
import { audioTitle, readAudioNote } from './mapAudio'
import { branchStructure, collectMapAppearance, defaultMapSettings, encodeImportedTopic, type MapData, type MapSheet } from './mapAppearance'
import { progressMarkers, shapes, structures, styleKeys, topicLinkExtension } from './xmindFormat'
import { isExternalMapLink, mainSheetId, topicLinkUrl, type TopicLink } from './mapTopicLinks'
import { readLegacyXmind } from './xmindXml'

const MiB = 1024 * 1024
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const records = (value: unknown) => Array.isArray(value) ? value.map(asRecord) : []
const string = (value: unknown) => typeof value === 'string' ? value : ''
const size = (value: unknown, max = 2000) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?(?:px|pt)?$/.test(value) ? parseFloat(value) : NaN
  return Number.isFinite(number) && number >= 0 ? Math.min(max, number) : undefined
}
const color = (value: unknown) => typeof value === 'string' && CSS.supports('color', value) ? value : undefined
const entries = Object.entries
const layout = (value: unknown) => branchStructure(entries(structures).find(([, name]) => name === value)?.[0])
const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-15000, Math.min(15000, value)) : 0
const anchor = 20000

async function readEntry(entry: FileEntry, limit: number) {
  if (entry.encrypted) throw new Error('此 Xmind 文件包含加密内容。')
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limit) {
    throw new Error('Xmind 文件中有内容超过导入大小限制。')
  }
  const output = new Uint8Array(entry.uncompressedSize)
  let bytes = 0
  const controller = new AbortController()
  await entry.getData(new WritableStream({
    write(chunk: Uint8Array) {
      if (bytes + chunk.length > output.length) {
        controller.abort()
        throw new Error('Xmind 文件中的数据长度无效。')
      }
      output.set(chunk, bytes)
      bytes += chunk.length
    },
  }), { checkSignature: true, useWebWorkers: false, signal: controller.signal })
  if (bytes !== output.length) throw new Error('Xmind 文件中的数据不完整。')
  return output
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at, at + 16384))
  return btoa(binary)
}

function resourcePath(href: unknown) {
  if (typeof href !== 'string' || !href.startsWith('xap:')) return
  try {
    const path = decodeURIComponent(href.slice(4)).replace(/^\/+/, '')
    if (/^(resources|attachments)\//.test(path) && !path.includes('\\') &&
      path.split('/').every(part => part && part !== '..' && part !== '.')) return path
  } catch {}
}

function styles(value: unknown) {
  const properties = asRecord(asRecord(value).properties)
  const data: Record<string, string | number> = {}
  for (const [key, attribute] of entries(styleKeys)) {
    const raw = properties[attribute]
    const parsed = key === 'fillColor' || key.toLowerCase().endsWith('color') ? color(raw)
      : /Width$|^fontSize$/.test(key) ? size(raw, 240)
        : typeof raw === 'string' && raw.length <= 120 && !/[<>{};]/.test(raw) ? raw : undefined
    if (parsed !== undefined) data[key] = parsed === '$system$' ? 'system-ui' : parsed
  }
  const shape = string(properties['shape-class']).split('.').at(-1)
  const key = entries(shapes).find(([, name]) => name === shape)?.[0]
  if (key) data.shape = key
  return data
}

function topicRange(value: unknown, children: MapData[]) {
  const range = /^\((\d+),\s*(\d+)\)$/.exec(string(value))
  if (!range) return
  const [from, to] = [Number(range[1]), Number(range[2])]
  if (from <= to && to < children.length) return [from, to] as const
}

function editableBranches(nodes: MapData[]): Block[] {
  return nodes.flatMap(node => {
    if (node.data.ymdFloating === true) return []
    if (readAudioNote(node.data.ymdAudio)) return editableBranches(node.children ?? [])
    return [{ id: node.data.uid!, text: encodeImportedTopic(node.data.text ?? ''), marker: '-', children: editableBranches(node.children ?? []) }]
  })
}

export async function importXmind(data: ArrayBuffer) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(data)))
  try {
    const files = new Map<string, FileEntry>()
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory) continue
      if (files.has(entry.filename) || files.size >= 4096) throw new Error('Xmind 文件包含重复条目或过多文件。')
      files.set(entry.filename, entry)
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const readText = async (file: FileEntry, limit: number) => decoder.decode(await readEntry(file, limit))
    const workbook = files.get('content.json') ?? files.get('content.xml')
    if (!workbook) throw new Error('Xmind 工作簿缺少内容文件。')
    const content = await readText(workbook, 12 * MiB)
    const stylesheet = files.get('styles.xml')
    const source: unknown = workbook.filename === 'content.json' ? JSON.parse(content)
      : readLegacyXmind(content, stylesheet ? await readText(stylesheet, 4 * MiB) : undefined)
    if (!Array.isArray(source) || !source.length || source.length > 50) throw new Error('Xmind 工作簿没有可读取的画布，或画布超过 50 张。')
    const metadata = files.get('metadata.json')
    const activeSheet = metadata ? string(asRecord(JSON.parse(decoder.decode(await readEntry(metadata, MiB)))).activeSheetId) : ''
    const resources = new Map<string, Uint8Array>()
    const audios: { id: string; blob: Blob }[] = []
    const audioByResource = new Map<string, string>()
    const unconverted = new Set<string>()
    const sheetTargets = new Map<string, TopicLink>()
    const topicTargets = new Map<string, TopicLink | null>()
    const links: { node: MapData; destination: string; localTopics: Map<string, MapData>; sheet: string;
      bidirectional: boolean; generated: boolean }[] = []
    let resourceBytes = 0
    let topicCount = 0

    async function resource(path: string) {
      const cached = resources.get(path)
      if (cached) return cached
      const file = files.get(path)
      if (!file) return
      const bytes = await readEntry(file, Math.min(24 * MiB, 40 * MiB - resourceBytes))
      resources.set(path, bytes)
      resourceBytes += bytes.length
      return bytes
    }

    async function addImage(node: MapData, data: Record<string, unknown>) {
      if (!data.src) return
      const path = resourcePath(data.src)
      const ext = path ? markdownImageExtension(path) : undefined
      const bytes = path && ext ? await resource(path) : undefined
      if (!ext || !bytes?.length) { unconverted.add('图片'); return }
      const type = markdownImageExtensions[ext]
      const source = 'data:' + type + ';base64,' + base64(bytes)
      let width = size(data.width), height = size(data.height)
      if (!width || !height) {
        const image = new Image()
        image.src = source
        try {
          await image.decode()
          width = Math.min(image.naturalWidth, 480)
          height = width * image.naturalHeight / image.naturalWidth
        } catch { unconverted.add('图片'); return }
      }
      const align = string(data.align)
      node.data.image = source
      node.data.imageTitle = node.data.text ?? ''
      node.data.imageSize = { width, height }
      if (/^(top|bottom|left|right)$/.test(align)) node.data.imgPlacement = align
    }

    async function addAttachments(node: MapData, href: unknown) {
      if (typeof href !== 'string' || !href) return
      if (isExternalMapLink(href)) { node.data.hyperlink = href; return }
      const path = resourcePath(href)
      const bytes = path ? await resource(path) : undefined
      if (!path || !bytes?.length) { unconverted.add('链接或附件'); return }
      node.data.attachmentName = path.split('/').at(-1)!.replace(/[<>:"/\\|?*&]/g, '_').slice(0, 160)
      node.data.attachmentUrl = 'data:application/octet-stream;base64,' + base64(bytes)
    }

    async function addAudio(node: MapData, raw: unknown) {
      for (const extension of records(raw)) {
        if (extension.provider !== 'org.xmind.ui.audionotes') {
          if (/task/i.test(string(extension.provider))) unconverted.add('任务扩展属性')
          continue
        }
        const refs = Array.isArray(extension.resourceRefs) ? extension.resourceRefs : []
        const timing = records(extension.content)
        if (!refs.length) unconverted.add('录音')
        for (const [index, ref] of refs.entries()) {
          const path = resourcePath(ref)
          const bytes = path?.toLowerCase().endsWith('.webm') ? await resource(path) : undefined
          if (!path || !bytes?.length) { unconverted.add('录音'); continue }
          let id = audioByResource.get(path)
          if (!id) {
            id = crypto.randomUUID()
            audioByResource.set(path, id)
            audios.push({ id, blob: new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }) })
          }
          const duration = (size(timing[index]?.duration, 86_400_000) ?? 0) / 1000
          if (!index && node.data.text === audioTitle && !node.children?.length) node.data.ymdAudio = { id, duration }
          else {
            node.children ??= []
            node.children.push({ data: { text: audioTitle, uid: crypto.randomUUID(), ymdAudio: { id, duration } } })
          }
        }
      }
    }

    const sheets: MapSheet[] = []
    let active: string | undefined
    for (const rawSheet of source.map(asRecord)) {
      const sheetId = sheets.length ? crypto.randomUUID() : mainSheetId
      const originalSheet = string(rawSheet.id)
      if (originalSheet && !sheetTargets.has(originalSheet)) sheetTargets.set(originalSheet, { sheet: sheetId })
      const ids = new Map<string, MapData>()
      let floating = 0
      async function topic(raw: Record<string, unknown>, depth: number, detached = false): Promise<MapData> {
        if (++topicCount > 10000 || depth > 80 || !Object.hasOwn(raw, 'title') && !Object.hasOwn(raw, 'id')) {
          throw new Error('Xmind 主题无效，或数量与层级超过导入限制。')
        }
        const text = string(raw.title).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        const node: MapData = { data: { ...styles(raw.style), text, uid: crypto.randomUUID(), expand: raw.branch !== 'folded' }, children: [] }
        const id = string(raw.id)
        if (id && !ids.has(id)) {
          ids.set(id, node)
          topicTargets.set(id, topicTargets.has(id) ? null : { sheet: sheetId, topic: node.data.uid })
        }
        const structure = layout(raw.structureClass)
        if (structure && depth) node.data.ymdStructure = structure
        if (!structure && raw.structureClass) unconverted.add('部分布局')
        if (detached) {
          const position = asRecord(raw.position)
          node.data.ymdFloating = true
          node.data.customLeft = anchor + (Object.hasOwn(position, 'x') ? coordinate(position.x) : 300)
          node.data.customTop = anchor + (Object.hasOwn(position, 'y') ? coordinate(position.y) : -160 + 70 * floating)
          floating++
        } else if (depth && Object.keys(asRecord(raw.position)).length) {
          unconverted.add('部分手动位置')
        }
        const notes = asRecord(raw.notes)
        const note = string(asRecord(notes.plain).content) || records(asRecord(asRecord(notes.html).content).paragraphs)
          .map(paragraph => records(paragraph.spans).map(span => string(span.text)).join('')).join('\n')
        if (note) node.data.note = note
        const tags = Array.isArray(raw.labels) ? raw.labels : typeof raw.labels === 'string' ? raw.labels.split(',') : []
        const labels = tags.map(string).filter(Boolean)
        if (labels.length) node.data.tag = labels
        const icons = records(raw.markers).flatMap(marker => {
          const id = string(marker.markerId)
          if (/^priority-[1-9]$/.test(id)) return ['priority_' + id.at(-1)]
          const progress = progressMarkers.findIndex(markerId => markerId === id)
          if (progress > 0) return ['progress_' + progress]
          if (id) unconverted.add('部分标记')
          return []
        })
        if (icons.length) node.data.icon = icons
        await addImage(node, asRecord(raw.image))
        const href = string(raw.href)
        const extension = records(raw.extensions).find(extension => extension.provider === topicLinkExtension)
        const supplemental = records(extension?.content)[0]
        const topicHref = href.startsWith('xmind:#') ? href : string(supplemental?.href)
        if (topicHref.startsWith('xmind:#')) {
          const reference = topicHref.slice('xmind:#'.length)
          let destination = reference
          try { destination = decodeURIComponent(reference) } catch {}
          links.push({ node, destination, localTopics: ids, sheet: sheetId,
            bidirectional: supplemental?.bidirectional === true && supplemental.href === topicHref,
            generated: supplemental?.generated === true && supplemental.href === topicHref })
        }
        if (!href.startsWith('xmind:#')) await addAttachments(node, href)
        const children = asRecord(raw.children)
        if (records(children.callout).length) unconverted.add('标注')
        const attached: MapData[] = []
        for (const child of records(children.attached)) attached.push(await topic(child, depth + 1))
        node.children = [...attached]
        for (const child of records(children.detached)) node.children.push(await topic(child, depth + 1, true))
        for (const boundary of records(raw.boundaries)) {
          const range = topicRange(boundary.range, attached)
          if (!range) continue
          const groupId = crypto.randomUUID()
          for (const child of attached.slice(range[0], range[1] + 1)) {
            child.data.outerFrame = { groupId, text: string(boundary.title) }
          }
        }
        const summaries = new Map(records(children.summary).map(topic => [string(topic.id), topic]))
        for (const summary of records(raw.summaries)) {
          const range = topicRange(summary.range, attached)
          const target = summaries.get(string(summary.topicId))
          if (!range || !target) continue
          const list = Array.isArray(node.data.generalization) ? node.data.generalization : []
          node.data.generalization = [...list, { uid: crypto.randomUUID(), text: string(target.title), range: [...range] }]
        }
        await addAudio(node, raw.extensions)
        return node
      }

      const rawRoot = asRecord(rawSheet.rootTopic)
      const tree = await topic(rawRoot, 0)
      if (floating) {
        tree.data.customLeft = anchor
        tree.data.customTop = anchor
      }
      for (const line of records(rawSheet.relationships)) {
        const start = ids.get(string(line.end1Id))
        const to = ids.get(string(line.end2Id))?.data.uid
        if (!start || !to || start.data.uid === to) continue
        const targets = Array.isArray(start.data.associativeLineTargets) ? start.data.associativeLineTargets : []
        if (!targets.includes(to)) start.data.associativeLineTargets = [...targets, to]
        const title = string(line.title)
        if (title) start.data.associativeLineText = { ...asRecord(start.data.associativeLineText), [to]: title }
      }
      const background = color(asRecord(asRecord(rawSheet.style).properties)['svg:fill'])
      const settings = { ...defaultMapSettings, layout: layout(rawRoot.structureClass) ?? defaultMapSettings.layout,
        ...(background ? { background } : {}), colored: false }
      const title = string(rawSheet.title) || string(rawSheet.sheetTitle) || tree.data.text || '画布 ' + (sheets.length + 1)
      if (sheets.length && activeSheet && originalSheet === activeSheet) active = sheetId
      sheets.push({ id: sheetId, title, settings, tree })
    }
    const resolved = links.flatMap(({ node, destination, localTopics, sheet, bidirectional, generated }) => {
      const local = localTopics.get(destination)
      const target = local ? { sheet, topic: local.data.uid } : topicTargets.get(destination) ?? sheetTargets.get(destination)
      if (target) return [{ node, origin: { sheet, topic: node.data.uid }, target, bidirectional, generated }]
      unconverted.add('失效的主题链接')
      return []
    })
    const paired = new Map(resolved.filter(item => item.bidirectional)
      .map(({ origin, target }) => [topicLinkUrl(origin), topicLinkUrl(target)]))
    for (const { node, origin, target, bidirectional, generated } of resolved) {
      if (generated && paired.get(topicLinkUrl(target)) === topicLinkUrl(origin)) continue
      node.data.hyperlink = topicLinkUrl({ ...target, bidirectional })
    }
    const [main, ...other] = sheets
    const text = writeList({ before: '', after: '', newline: '\n', blocks: [] }, editableBranches(main.tree.children ?? []))
    if (!projectList(text)) throw new Error('首张画布的文字无法转换为可编辑的 Markdown 大纲。')
    const appearance = collectMapAppearance(main.settings, main.tree, {
      settings: main.settings, styles: [], sheets: other, imported: { title: main.title, root: main.tree.data.text ?? '', active },
    })
    return { text, appearance, audios, unconverted: [...unconverted] }
  } finally {
    await reader.close()
  }
}
