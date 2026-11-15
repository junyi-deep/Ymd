import type { MapData } from './mapAppearance'
import { calloutTopicId, readCallouts } from './mapCallouts'

export const mainSheetId = 'ymd-root'
export interface TopicLink { document?: string; sheet: string; topic?: string; bidirectional?: boolean }

const prefix = 'ymd-topic:'
const returnSuffix = '?return=1'
const documentId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

export function isExternalMapLink(value: unknown): value is string {
  return typeof value === 'string' && /^(https?:\/\/|mailto:)/i.test(value)
}

export function topicLinkUrl(link: TopicLink) {
  return prefix + (link.document ? link.document + '/' : '') + encodeURIComponent(link.sheet) + (link.topic
    ? '#' + encodeURIComponent(link.topic) + (link.bidirectional ? returnSuffix : '') : '')
}

export function readTopicLink(value: unknown): TopicLink | undefined {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return
  const bidirectional = value.endsWith(returnSuffix)
  const address = bidirectional ? value.slice(prefix.length, -returnSuffix.length) : value.slice(prefix.length)
  const [location, topic, ...extra] = address.split('#')
  const [first, last, ...parts] = location.split('/')
  const document = last === undefined ? undefined : first
  const sheet = last ?? first
  if (!sheet || extra.length || parts.length || document !== undefined && !documentId.test(document)) return
  try {
    return { document, sheet: decodeURIComponent(sheet), ...(topic ? { topic: decodeURIComponent(topic), ...(bidirectional ? { bidirectional } : {}) } : {}) }
  } catch {}
}

export function findTopic(tree: MapData, uid: string): MapData | undefined {
  if (tree.data.uid === uid) return tree
  const owner = tree.data.uid
  const callout = owner && readCallouts(tree.data.ymdCallouts).find(note => calloutTopicId(owner, note.data.uid) === uid)
  if (callout) return callout
  for (const child of tree.children ?? []) {
    const found = findTopic(child, uid)
    if (found) return found
  }
}

export function listMapTopics(tree: MapData) {
  const topics: { id: string; title: string; depth: number }[] = []
  function visit(node: MapData, depth: number) {
    const { uid, text } = node.data
    if (uid) {
      topics.push({ id: uid, title: text?.replace(/\s+/g, ' ').trim() || '未命名主题', depth })
      for (const { data } of readCallouts(node.data.ymdCallouts)) {
        topics.push({ id: calloutTopicId(uid, data.uid), title: '标注 · ' + data.text.replace(/\s+/g, ' ').trim(), depth: depth + 1 })
      }
    }
    node.children?.forEach(child => visit(child, depth + 1))
  }
  visit(tree, 0)
  return topics
}

export function remapCopiedLinks(tree: MapData, source: string, destination: string, wholeSheet: boolean) {
  const copied = new Set(listMapTopics(tree).map(topic => topic.id))
  function visit(node: MapData) {
    const link = readTopicLink(node.data.hyperlink)
    if (link && !link.document && link.sheet === source && (link.topic ? copied.has(link.topic) : wholeSheet)) {
      node.data.hyperlink = topicLinkUrl({ ...link, sheet: destination })
    }
    readCallouts(node.data.ymdCallouts).forEach(visit)
    node.children?.forEach(visit)
  }
  visit(tree)
}

export function listBacklinks(sheets: { id: string; title: string; tree: MapData }[], target: TopicLink) {
  const links: { label: string; target: TopicLink }[] = []
  for (const sheet of sheets) {
    function add(data: MapData['data'], uid: string) {
      const link = readTopicLink(data.hyperlink)
      if (link?.bidirectional && link.document === target.document && link.sheet === target.sheet && link.topic === target.topic) {
        links.push({ label: sheet.title + ' · ' + (data.text?.replace(/\s+/g, ' ').trim() || '未命名主题'),
          target: { sheet: sheet.id, topic: uid } })
      }
    }
    function visit(node: MapData) {
      const { uid } = node.data
      if (uid) {
        add(node.data, uid)
        for (const { data } of readCallouts(node.data.ymdCallouts)) add(data, calloutTopicId(uid, data.uid))
      }
      node.children?.forEach(visit)
    }
    visit(sheet.tree)
  }
  return links
}
