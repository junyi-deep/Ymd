import { Uint8ArrayReader, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { markdownImageExtension, markdownImageExtensions } from '../../shared/contracts'
import { equationExtension, readEquation } from './mapEquation'
import { pitchExtension, readPitchOptions, readPitchTopic } from '../../shared/pitch'
import { writeList, projectList, type Block } from './listProjection'
import { audioTitle, readAudioNote } from './mapAudio'
import { branchStructure, collectMapAppearance, defaultMapSettings, encodeImportedTopic, type MapData, type MapSheet } from './mapAppearance'
import { calloutShapeClasses, progressMarkers, shapes, structures, styleKeys, topicLinkExtension } from './xmindFormat'
import { linkLabels, mainSheetId, mapLinkType, readTopicLink, topicLinkUrl, xmindAddressLink, type TopicLink } from './mapTopicLinks'
import { readLegacyXmind } from './xmindXml'
import { calloutTopicId } from './mapCallouts'
import { importTaskExtension, legacyTaskExtension, taskExtension } from './xmindTasks'
import type { MapTask } from './mapTasks'
import { decodeXmindCalendar, workCalendarExtension } from './workCalendar'
import { legacyNumbering, numberingExtension, readNumbering } from './mapNumbering'

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
        : key === 'fontWeight' && typeof raw === 'number' && raw >= 100 && raw <= 900 ? String(raw)
          : typeof raw === 'string' && raw.length <= 120 && !/[<>{};]/.test(raw) ? raw : undefined
    if (parsed !== undefined) data[key] = parsed === '$system$' ? 'system-ui' : parsed
  }
  const shape = string(properties['shape-class']).split('.').at(-1)
  const key = entries(calloutShapeClasses).find(([, name]) => name === properties['callout-shape-class'])?.[0] ??
    entries(shapes).find(([, name]) => name === shape)?.[0]
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
    type ImportedTopic = { node: MapData; linkId: string }
    const links: { node: MapData; origin: TopicLink; destination: string; localTopics: Map<string, ImportedTopic>;
      bidirectional: boolean; generated: boolean }[] = []
    let resourceBytes = 0
    let topicCount = 0
    let crossDocumentLinks = false

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

    async function addEquation(node: MapData, latex: string, image: Record<string, unknown>) {
      node.data.ymdEquation = latex
      try {
        const { previewEquation, equationImage } = await import('./renderMapEquation')
        const preview = await previewEquation(latex)
        const width = size(image.width) ?? preview.width
        const height = size(image.height) ?? width * preview.height / preview.width
        node.data.image = await equationImage(preview)
        node.data.imageTitle = 'LaTeX 公式'
        node.data.imageSize = { width, height, custom: true }
        node.data.ymdOriginalImageSize = { width: preview.width, height: preview.height }
        const align = string(image.align)
        if (/^(top|bottom|left|right)$/.test(align)) node.data.imgPlacement = align
      } catch {
        await addImage(node, image)
        unconverted.add('部分公式')
      }
    }

    function addAddress(node: MapData, href: unknown) {
      const address = xmindAddressLink(href)
      if (!address) return false
      node.data.hyperlink = address
      node.data.hyperlinkTitle = linkLabels[mapLinkType(address)]
      return true
    }

    async function addAttachments(node: MapData, href: unknown) {
      if (typeof href !== 'string' || !href) return
      if (addAddress(node, href)) return
      const path = resourcePath(href)
      const bytes = path ? await resource(path) : undefined
      if (!path || !bytes?.length) { unconverted.add('链接或附件'); return }
      node.data.attachmentName = path.split('/').at(-1)!.replace(/[<>:"/\\|?*&]/g, '_').slice(0, 160)
      node.data.attachmentUrl = 'data:application/octet-stream;base64,' + base64(bytes)
    }

    async function addAudio(node: MapData, raw: unknown) {
      for (const extension of records(raw)) {
        if (extension.provider !== 'org.xmind.ui.audionotes') continue
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
      const ids = new Map<string, ImportedTopic>()
      const tasks: { uid: string; task: MapTask }[] = []
      let floating = 0
      async function topic(raw: Record<string, unknown>, depth: number,
        kind: 'attached' | 'detached' | 'callout' = 'attached', owner?: string,
        inheritedNumbering?: ReturnType<typeof legacyNumbering>): Promise<MapData> {
        if (++topicCount > 10000 || depth > 80 || !Object.hasOwn(raw, 'title') && !Object.hasOwn(raw, 'id')) {
          throw new Error('Xmind 主题无效，或数量与层级超过导入限制。')
        }
        const text = string(raw.title).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        const inherited = kind === 'callout' ? styles(asRecord(rawSheet.theme).calloutTopic) : {}
        const uid = crypto.randomUUID()
        const linkId = owner ? calloutTopicId(owner, uid) : uid
        const node: MapData = { data: { ...inherited, ...styles(raw.style), text, uid, expand: raw.branch !== 'folded' }, children: [] }
        const id = string(raw.id)
        if (id && !ids.has(id)) {
          ids.set(id, { node, linkId })
          topicTargets.set(id, topicTargets.has(id) ? null : { sheet: sheetId, topic: linkId })
        }
        const structure = layout(raw.structureClass)
        if (structure && depth) node.data.ymdStructure = structure
        if (!structure && raw.structureClass) unconverted.add('部分布局')
        if (kind === 'detached') {
          const position = asRecord(raw.position)
          node.data.ymdFloating = true
          node.data.customLeft = anchor + (Object.hasOwn(position, 'x') ? coordinate(position.x) : 300)
          node.data.customTop = anchor + (Object.hasOwn(position, 'y') ? coordinate(position.y) : -160 + 70 * floating)
          floating++
        } else if (kind === 'callout') {
          const position = asRecord(raw.position)
          if (typeof position.x === 'number' && Number.isFinite(position.x)) node.data.calloutX = position.x
          if (typeof position.y === 'number' && Number.isFinite(position.y)) node.data.calloutY = position.y
          const width = size(raw.width ?? raw.customWidth, 640)
          if (width) node.data.calloutWidth = width
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
        const markers = records(raw.markers).map(marker => string(marker.markerId))
        const icons = markers.flatMap(id => {
          if (/^priority-[1-9]$/.test(id)) return ['priority_' + id.at(-1)]
          const progress = progressMarkers.findIndex(markerId => markerId === id)
          if (progress > 0) return ['progress_' + progress]
          if (id) unconverted.add('部分标记')
          return []
        })
        if (icons.length) node.data.icon = icons
        const extensions = records(raw.extensions)
        const pitch = extensions.find(extension => extension.provider === pitchExtension)
        if (pitch) node.data.ymdPitch = readPitchTopic(pitch.content)
        const numbering = extensions.find(extension => extension.provider === numberingExtension)
        if (numbering) {
          const content = asRecord(numbering.content)
          const config = readNumbering(content)
          if (config) node.data.ymdNumbering = config
          if (content.pattern && content.pattern !== 'none' && !config?.pattern) unconverted.add('部分主题编号')
        } else if (inheritedNumbering && kind === 'attached') {
          node.data.ymdNumbering = inheritedNumbering.numbering
        }
        const legacy = asRecord(raw.numbering)
        const declaredNumbering = legacyNumbering(legacy)
        if (legacy.numberFormat && legacy.numberFormat !== 'org.xmind.numbering.none' && !declaredNumbering) unconverted.add('部分主题编号')
        const childNumbering = declaredNumbering ?? (
          !legacy.numberFormat && !numbering && inheritedNumbering && inheritedNumbering.depth > 1
            ? { ...inheritedNumbering, depth: inheritedNumbering.depth - 1 } : undefined)
        const taskData = extensions.find(extension => extension.provider === taskExtension)
          ?? extensions.find(extension => extension.provider === legacyTaskExtension)
        if (taskData) {
          const converted = importTaskExtension(string(taskData.provider), taskData.content, markers)
          if (converted?.task) {
            node.data.ymdTask = converted.task
            tasks.push({ uid, task: converted.task })
          } else if (converted?.todo) node.data.ymdTodo = converted.todo
          else unconverted.add('任务扩展属性')
        }
        if (extensions.some(extension => /task/i.test(string(extension.provider)) &&
          extension.provider !== taskExtension && extension.provider !== legacyTaskExtension)) unconverted.add('任务扩展属性')
        const image = asRecord(raw.image)
        const equation = extensions.find(extension => extension.provider === equationExtension)
        const equationData = asRecord(equation?.content)
        const latex = readEquation(equationData.content ?? records(equation?.content).find(field => field.name === 'content')?.content)
        if (latex) await addEquation(node, latex, { ...image, src: image.src ?? equationData.imageSource })
        else {
          if (equation) unconverted.add('部分公式')
          await addImage(node, image)
        }
        const href = string(raw.href)
        const extension = extensions.find(extension => extension.provider === topicLinkExtension)
        const supplemental = records(extension?.content)[0]
        const topicHref = href.startsWith('xmind:#') ? href : string(supplemental?.href)
        if (topicHref.startsWith('xmind:#')) {
          const reference = topicHref.slice('xmind:#'.length)
          let destination = reference
          try { destination = decodeURIComponent(reference) } catch {}
          links.push({ node, destination, localTopics: ids, origin: { sheet: sheetId, topic: linkId },
            bidirectional: supplemental?.bidirectional === true && supplemental.href === topicHref,
            generated: supplemental?.generated === true && supplemental.href === topicHref })
        }
        if (!href.startsWith('xmind:#')) await addAttachments(node, href)
        const documentLink = readTopicLink(supplemental?.href)
        if (!href.startsWith('xmind:#') && documentLink?.document) {
          node.data.hyperlink = topicLinkUrl(documentLink)
          node.data.hyperlinkTitle = '主题链接'
          crossDocumentLinks = true
        }
        if (node.data.attachmentUrl) addAddress(node, supplemental?.href)
        const children = asRecord(raw.children)
        const attached: MapData[] = []
        for (const child of records(children.attached)) attached.push(await topic(child, depth + 1, 'attached', undefined, childNumbering))
        node.children = [...attached]
        for (const child of records(children.detached)) node.children.push(await topic(child, depth + 1, 'detached'))
        const callouts: MapData[] = []
        for (const child of records(children.callout)) callouts.push(await topic(child, depth + 1, 'callout', uid))
        if (callouts.length) node.data.ymdCallouts = callouts
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
      const calendarExtension = records(rawSheet.extensions).find(extension => extension.provider === workCalendarExtension)
      const calendar = decodeXmindCalendar(calendarExtension?.content, rawSheet.nonWorkingDaysSkipping)
      if (calendar) tree.data.ymdWorkCalendar = calendar
      else if (calendarExtension || rawSheet.nonWorkingDaysSkipping === 'skip') unconverted.add('工作日历')
      for (const { uid, task } of tasks) {
        task.dependencies = task.dependencies.flatMap(item => {
          const target = ids.get(item.id)
          const targetId = target?.node.data.uid
          if (targetId && targetId === target?.linkId && targetId !== uid) return [{ ...item, id: targetId }]
          unconverted.add('失效的任务依赖')
          return []
        })
      }
      if (floating) {
        tree.data.customLeft = anchor
        tree.data.customTop = anchor
      }
      for (const line of records(rawSheet.relationships)) {
        const start = ids.get(string(line.end1Id))?.node
        const to = ids.get(string(line.end2Id))?.node.data.uid
        if (!start || !to || start.data.uid === to) continue
        const targets = Array.isArray(start.data.associativeLineTargets) ? start.data.associativeLineTargets : []
        if (!targets.includes(to)) start.data.associativeLineTargets = [...targets, to]
        const title = string(line.title)
        if (title) start.data.associativeLineText = { ...asRecord(start.data.associativeLineText), [to]: title }
      }
      const background = color(asRecord(asRecord(rawSheet.style).properties)['svg:fill'])
      const pitch = records(rawSheet.extensions).find(extension => extension.provider === pitchExtension)
      const settings = { ...defaultMapSettings, layout: layout(rawRoot.structureClass) ?? defaultMapSettings.layout,
        ...(background ? { background } : {}), ...(pitch ? { pitch: readPitchOptions(pitch.content) } : {}), colored: false }
      const title = string(rawSheet.title) || string(rawSheet.sheetTitle) || tree.data.text || '画布 ' + (sheets.length + 1)
      if (sheets.length && activeSheet && originalSheet === activeSheet) active = sheetId
      sheets.push({ id: sheetId, title, settings, tree })
    }
    const resolved = links.flatMap(({ node, origin, destination, localTopics, bidirectional, generated }) => {
      const local = localTopics.get(destination)
      const target = local ? { sheet: origin.sheet, topic: local.linkId } : topicTargets.get(destination) ?? sheetTargets.get(destination)
      if (target) return [{ node, origin, target, bidirectional, generated }]
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
    return { text, appearance, audios, crossDocumentLinks, unconverted: [...unconverted] }
  } finally {
    await reader.close()
  }
}
