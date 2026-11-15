import type { MapData } from './mapAppearance'

export const mainSheetId = 'ymd-root'
export interface TopicLink { sheet: string; topic?: string; bidirectional?: boolean }

const prefix = 'ymd-topic:'
const returnSuffix = '?return=1'

export function isExternalMapLink(value: unknown): value is string {
  return typeof value === 'string' && /^(https?:\/\/|mailto:)/i.test(value)
}

export function topicLinkUrl(link: TopicLink) {
  return prefix + encodeURIComponent(link.sheet) + (link.topic
    ? '#' + encodeURIComponent(link.topic) + (link.bidirectional ? returnSuffix : '') : '')
}

export function readTopicLink(value: unknown): TopicLink | undefined {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return
  const bidirectional = value.endsWith(returnSuffix)
  const address = bidirectional ? value.slice(prefix.length, -returnSuffix.length) : value.slice(prefix.length)
  const [sheet, topic, ...extra] = address.split('#')
  if (!sheet || extra.length) return
  try {
    return { sheet: decodeURIComponent(sheet), ...(topic ? { topic: decodeURIComponent(topic), ...(bidirectional ? { bidirectional } : {}) } : {}) }
  } catch {}
}

export function findTopic(tree: MapData, uid: string): MapData | undefined {
  if (tree.data.uid === uid) return tree
  for (const child of tree.children ?? []) {
    const found = findTopic(child, uid)
    if (found) return found
  }
}

export function listMapTopics(tree: MapData) {
  const topics: { id: string; title: string; depth: number }[] = []
  function visit(node: MapData, depth: number) {
    if (node.data.uid) topics.push({ id: node.data.uid, title: node.data.text?.replace(/\s+/g, ' ').trim() || '未命名主题', depth })
    node.children?.forEach(child => visit(child, depth + 1))
  }
  visit(tree, 0)
  return topics
}

export function remapCopiedLinks(tree: MapData, source: string, destination: string, wholeSheet: boolean) {
  const copied = new Set(listMapTopics(tree).map(topic => topic.id))
  function visit(node: MapData) {
    const link = readTopicLink(node.data.hyperlink)
    if (link?.sheet === source && (link.topic ? copied.has(link.topic) : wholeSheet)) {
      node.data.hyperlink = topicLinkUrl({ ...link, sheet: destination })
    }
    node.children?.forEach(visit)
  }
  visit(tree)
}

export function listBacklinks(sheets: { id: string; title: string; tree: MapData }[], target: TopicLink) {
  const links: { label: string; target: TopicLink }[] = []
  for (const sheet of sheets) {
    function visit(node: MapData) {
      const link = readTopicLink(node.data.hyperlink)
      if (node.data.uid && link?.bidirectional && link.sheet === target.sheet && link.topic === target.topic) {
        links.push({ label: sheet.title + ' · ' + (node.data.text?.replace(/\s+/g, ' ').trim() || '未命名主题'),
          target: { sheet: sheet.id, topic: node.data.uid } })
      }
      node.children?.forEach(visit)
    }
    visit(sheet.tree)
  }
  return links
}
