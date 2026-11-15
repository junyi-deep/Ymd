import { decodeImportedTopic, loadMapAppearance, restoreFloating, restoreMapStyles, saveMapAppearance,
  type MapAppearance, type MapData, type MapSheet } from './mapAppearance'
import { readAudioNote } from './mapAudio'
import { projectList, type Block } from './listProjection'
import { listBacklinks, mainSheetId, type TopicLink } from './mapTopicLinks'
import type { DocumentFile } from '../../shared/contracts'

type MapDocument = Pick<DocumentFile, 'path' | 'name' | 'text'>
const registryKey = 'ymd.map-documents'

function registeredDocuments(): [id: string, path: string][] {
  try {
    const stored = JSON.parse(localStorage.getItem(registryKey) ?? '[]')
    if (Array.isArray(stored)) return stored.filter(entry => Array.isArray(entry) && entry.length === 2 &&
      entry.every(value => typeof value === 'string'))
  } catch {}
  return []
}

export function mapDocumentPath(id: string) {
  return registeredDocuments().find(entry => entry[0] === id)?.[1]
}

export function registeredMapPaths() {
  return registeredDocuments().map(entry => entry[1])
}

export function registerMapDocument(path: string) {
  const entries = registeredDocuments()
  const existing = entries.find(entry => entry[1] === path)
  if (existing) return existing[0]
  const id = crypto.randomUUID()
  localStorage.setItem(registryKey, JSON.stringify([...entries, [id, path]]))
  return id
}

export function relocateMapDocument(oldPath: string, newPath: string) {
  const entries = registeredDocuments()
  if (!entries.some(entry => entry[1] === oldPath)) return
  localStorage.setItem(registryKey, JSON.stringify(entries.filter(entry => entry[1] !== newPath)
    .map(([id, path]) => [id, path === oldPath ? newPath : path])))
}

export function removeMapDocument(path: string) {
  const entries = registeredDocuments()
  const remaining = entries.filter(entry => entry[1] !== path)
  if (remaining.length !== entries.length) localStorage.setItem(registryKey, JSON.stringify(remaining))
}

export const mapTitle = (name: string) => name.replace(/\.(?:md|markdown)$/i, '')

export function documentTopics(nodes: MapData[]): MapData[] {
  return nodes.flatMap(node => node.data.ymdFloating === true ? [] : readAudioNote(node.data.ymdAudio) ? documentTopics(node.children ?? []) : [node])
}

function markdownTopicId(block: Block) {
  // A different topic at the same Markdown offset must not inherit links to the old one.
  let hash = 2166136261
  for (let index = 0; index < block.text.length; index++) hash = Math.imul(hash ^ block.text.charCodeAt(index), 16777619)
  return 'md-' + block.id + '-' + (hash >>> 0).toString(36)
}

const toMap = (blocks: Block[]): MapData[] => blocks.map(block => ({
  data: { text: block.text, uid: markdownTopicId(block), ymdMarker: block.marker }, children: toMap(block.children),
}))

export function mainMap(name: string, blocks: Block[], appearance: MapAppearance) {
  const root: MapData = { data: { text: appearance.imported?.root ?? mapTitle(name), uid: mainSheetId }, children: toMap(blocks) }
  restoreMapStyles(root, appearance.styles)
  if (appearance.imported) {
    function decode(nodes: MapData[]) {
      for (const node of documentTopics(nodes)) {
        node.data.text = decodeImportedTopic(node.data.text ?? '')
        decode(node.children ?? [])
      }
    }
    decode(root.children ?? [])
  }
  restoreFloating(root, appearance.floating ?? [])
  return root
}

export function primaryMapSheet(file: MapDocument, appearance = loadMapAppearance(file.path)): MapSheet | undefined {
  const projection = projectList(file.text)
  if (!projection) return
  return { id: mainSheetId, title: appearance.imported?.title ?? '主画布', settings: appearance.settings,
    tree: mainMap(file.name, projection.blocks, appearance) }
}

export function mapDocumentSheets(file: MapDocument) {
  const appearance = loadMapAppearance(file.path)
  const main = primaryMapSheet(file, appearance)
  return [...(main ? [main] : []), ...(appearance.sheets ?? [])]
}

export function registerMapTarget(file: MapDocument) {
  const appearance = loadMapAppearance(file.path)
  if (!appearance.styles.length) {
    const main = primaryMapSheet(file, appearance)
    if (main) saveMapAppearance(file.path, main.settings, main.tree)
  }
  return registerMapDocument(file.path)
}

export function documentBacklinks(path: string, target: TopicLink) {
  const entries = registeredDocuments()
  const document = entries.find(entry => entry[1] === path)?.[0]
  if (!document) return []
  return entries.flatMap(([id, source]) => {
    if (source === path) return []
    const appearance = loadMapAppearance(source)
    // The primary canvas stores Markdown-backed topics as appearance records.
    const main: MapData = { data: {}, children: [
      ...appearance.styles.map(style => ({ data: { ...style.data, text: appearance.imported && style.address !== 'root'
        ? decodeImportedTopic(style.text) : style.text } } as MapData)),
      ...(appearance.floating ?? []),
    ] }
    const sheets = [{ id: mainSheetId, title: appearance.imported?.title ?? '主画布', tree: main }, ...(appearance.sheets ?? [])]
    const title = mapTitle(source.split(/[\\/]/).at(-1) ?? source)
    return listBacklinks(sheets, { ...target, document }).map(link => ({
      label: title + ' · ' + link.label, target: { ...link.target, document: id },
    }))
  })
}
