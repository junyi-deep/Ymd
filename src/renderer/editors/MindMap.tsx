import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ChevronDown, ClipboardList, CornerUpLeft, Crosshair, Download, Focus, FolderInput, GitBranch, GitFork, ImagePlus, ListTree, Map as MapIcon, Maximize, MessageSquare, Mic, Minus, Paperclip, Plus, Presentation, Redo2, Search, SlidersHorizontal, SquareFunction, Square, SquareCheck, Star, Sticker, StickyNote, Tag, Trash2, Undo2, X } from 'lucide-react'
import MindMap from 'simple-mind-map'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import ExportPDF from 'simple-mind-map/src/plugins/ExportPDF.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import NodeImgAdjust from 'simple-mind-map/src/plugins/NodeImgAdjust.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import RainbowLines from 'simple-mind-map/src/plugins/RainbowLines.js'
import SearchPlugin from 'simple-mind-map/src/plugins/Search.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import type { DocumentViewPosition } from './viewPosition'
import { PaneResize } from '../PaneResize'
import type { CSSProperties } from 'react'
import { DocumentRemainder } from './DocumentRemainder'
import { outlineReferences } from './OutlineMarkdown'
import { listMarker, projectList, projectionRemainder, writeList, type Block } from './listProjection'
import type { DocumentFile, Entry, MapCanvasSettings, Preferences } from '../../shared/contracts'
import { MindMapFormat } from './MindMapFormat'
import { MindMapTask, taskBadge, taskTopics, todoBadge } from './MindMapTask'
import { readTask, readTodo, type MapTask, type MapTodo } from './mapTasks'
import { MindMapRecorder } from './MindMapRecorder'
import { MindMapEquation } from './MindMapEquation'
import { readEquation } from './mapEquation'
import { MindMapArt } from './MindMapArt'
import { installMapOverview } from './mapOverview'
import { displayMapMarkdown } from './mapMarkdown'
import { MindMapLink, type LinkSheet } from './MindMapLink'
import { readLocalMapUrl } from '../../shared/localMapLinks'
import { readPitchOptions, readPitchTopic, type PitchMode, type PitchTopicOptions } from '../../shared/pitch'
import { inputChord, shortcutLabel, shortcutValue, ShortcutSequence, shortcutsFor, type ShortcutOverrides } from '../../shared/shortcuts'
import { addTopicImage, applyArt, imagePlacements, installTopicImageGestures, isTopicImage, placeTopicImage, removeTopicImage, resetTopicImage, topicAcceptsArt } from './mapTopicImages'
import { audioButton, audioTitle, createAudioPlayer, forgetAudio, loadAudio, readAudioNote, storeAudio, type AudioNote } from './mapAudio'
import { MarkdownMenu, type MenuItem } from './MarkdownMenu'
import { branchStructure, defaultMapSettings, encodeImportedTopic, loadMapAppearance, mapTheme, palettes, rememberImportedSheet, saveMapAppearance, saveMapSheets, type MapData, type MapSettings, type MapSheet } from './mapAppearance'
import { installBranchLayouts } from './mixedMapLayout'
import { findTopic, linkLabels, linkTypes, listBacklinks, listMapTopics, mainSheetId, mapLinkType, readTopicLink, remapCopiedLinks,
  type LinkType, type TopicLink } from './mapTopicLinks'
import { documentBacklinks, documentTopics, mainMap, mapDocumentPath, mapTitle, primaryMapSheet } from './mapDocumentLinks'
import { installCallouts } from './calloutLayer'
import { MindMapCalloutFormat, MindMapCalloutText } from './MindMapCallout'
import { calloutById, calloutTopicId, readCallouts, type Callout, type CalloutTarget } from './mapCallouts'
import { editNumbering, type NumberingEdit } from './mapNumbering'
import { installNumbering } from './mapNumberingLayer'
import { MindMapNavigation } from './MindMapNavigation'
import { MindMapShot } from './MindMapShot'
import { MindMapZenTools, zenAppearances, type ZenAppearance, type ZenTool } from './MindMapZenTools'
import { MindMapPitchFormat } from './MindMapPitchFormat'
import { pitchTopicFromMap } from './pitchDeck'
import { findBranch, installBranchView, setBranchDepth } from './mapBranchView'
import { exportMapTree, mapExportTitle, type MapExportFormat } from './mapBranchExport'
import { facetAt, highlightTopics, navigationTopics, taskStatusFacets, type Facet } from './mapNavigation'

class MapAssociativeLine extends AssociativeLine {
  protected checkOverlapNode(x: number, y: number) {
    // The library queues overlap checks that can run after the line is completed or canceled.
    if (this.isCreatingLine && this.creatingStartNode) super.checkOverlapNode(x, y)
  }

  cancelCreateLine() {
    if (this.isCreatingLine) super.cancelCreateLine()
  }
}

for (const plugin of [MapAssociativeLine, Drag, Export, ExportPDF, KeyboardNavigation, NodeImgAdjust, OuterFrame, RainbowLines, SearchPlugin, Select]) MindMap.usePlugin(plugin)
MindMap.extendNodeDataNoStylePropList(['ymdMarker', 'ymdFloating', 'ymdTask', 'ymdTodo', 'ymdStructure', 'ymdAudio', 'ymdOriginalImageSize', 'ymdCallouts', 'ymdNumbering', 'ymdPitch', 'ymdEquation'])

type MapNode = NonNullable<MindMap['renderer']['root']>
type TopicField = '备注' | '标签'

function downloadAttachment(source: unknown, name: unknown) {
  if (typeof source !== 'string' || !source.startsWith('data:application/octet-stream;base64,')) return
  const anchor = document.createElement('a')
  anchor.href = source
  anchor.download = typeof name === 'string' ? name : '附件'
  anchor.click()
}

function fromMap(nodes: MapData[], imported = false): Block[] {
  const branches = documentTopics(nodes)
  const marker = branches.find(node => listMarker.test(String(node.data.ymdMarker)))?.data.ymdMarker ?? '-'
  return branches.map((node, index) => ({
    id: node.data.uid ?? String(index), text: imported ? encodeImportedTopic(node.data.text ?? '') : node.data.text ?? '',
    marker: listMarker.test(String(node.data.ymdMarker)) ? String(node.data.ymdMarker) : String(marker),
    children: fromMap(node.children ?? [], imported),
  }))
}

function hasAudio(tree: MapData, id: string): boolean {
  return readAudioNote(tree.data.ymdAudio)?.id === id || !!tree.children?.some(child => hasAudio(child, id))
}

interface MapEditorProps {
  text: string; name: string; path: string; dark: boolean; onChange: (text: string) => void
  find: number
  position: DocumentViewPosition
  overviewPreferences: Preferences['mapOverview']
  panelWidth?: number
  resizePanel: (width: number) => void
  rememberSettings: (patch: Partial<MapCanvasSettings>) => void
  stickerDirectory?: string
  platform: string; keyOverrides: ShortcutOverrides; remoteImages: boolean
  remainderVisible: boolean; setRemainderVisible: (visible: boolean) => void
  registerFlush: (flush?: () => void) => void
  importWorkbook: () => void
  importing: boolean
  readMapDocument: (path: string) => Promise<DocumentFile>
  followMapDocument: (target: TopicLink) => Promise<boolean>
  linkDocuments: Pick<Entry, 'path' | 'name'>[]
  entryJump?: TopicLink
  consumedMapJump: (target: TopicLink) => void
}

export default function MindMapEditor(props: MapEditorProps) {
  const { path } = props
  const [initial] = useState(() => loadMapAppearance(path))
  const [sheets, setSheets] = useState(initial.sheets ?? [])
  const [active, setActive] = useState(() => {
    if (props.entryJump) return props.entryJump.sheet === mainSheetId ? undefined : props.entryJump.sheet
    return (initial.sheets ?? []).some(sheet => sheet.id === initial.imported?.active) ? initial.imported?.active : undefined
  })
  const [renaming, setRenaming] = useState<string>()
  const [newTitle, setNewTitle] = useState('')
  const [remove, setRemove] = useState<MapSheet>()
  const [sheetMenu, setSheetMenu] = useState<{ id: string; x: number; y: number }>()
  const [storageError, setStorageError] = useState(false)
  const [jump, setJump] = useState<TopicLink | undefined>(props.entryJump)
  const sheetsRef = useRef(sheets)
  const removeDialog = useRef<HTMLDialogElement>(null)
  const flush = useRef<(() => void) | undefined>(undefined)
  const register = useRef(props.registerFlush)
  register.current = props.registerFlush
  const registerCanvas = useRef((callback?: () => void) => {
    flush.current = callback
    register.current(callback)
  }).current
  const sheet = sheets.find(current => current.id === active)
  const mainTitle = initial.imported?.title ?? '主画布'

  useEffect(() => {
    if (remove) removeDialog.current?.showModal()
    else if (removeDialog.current?.open) removeDialog.current.close()
  }, [remove])

  useEffect(() => {
    if (!props.entryJump) return
    try { rememberImportedSheet(path, props.entryJump.sheet === mainSheetId ? undefined : props.entryJump.sheet) }
    catch { setStorageError(true) }
    props.consumedMapJump(props.entryJump)
  }, [path, props.entryJump, props.consumedMapJump])

  function updateSheets(change: (current: MapSheet[]) => MapSheet[]) {
    const next = change(sheetsRef.current)
    try {
      saveMapSheets(path, next)
      setStorageError(false)
    } catch {
      setStorageError(true)
      return false
    }
    sheetsRef.current = next
    setSheets(next)
    return true
  }

  function activate(id?: string) {
    try { rememberImportedSheet(path, id) } catch { setStorageError(true) }
    setActive(id)
  }

  function select(id?: string) {
    flush.current?.()
    setJump(undefined)
    activate(id)
  }

  function createSheet(title: string, settings: MapSettings, tree: MapData, copy?: { source: string; wholeSheet: boolean }) {
    flush.current?.()
    const id = crypto.randomUUID()
    const root = structuredClone(tree)
    root.data.isActive = false
    if (copy) remapCopiedLinks(root, copy.source, id, copy.wholeSheet)
    if (updateSheets(current => [...current, { id, title, settings: { ...settings }, tree: root }])) activate(id)
  }

  function create() {
    let index = 2
    while (sheetsRef.current.some(item => item.title === '画布 ' + index)) index++
    const title = '画布 ' + index
    createSheet(title, defaultMapSettings, { data: { text: title, uid: mainSheetId }, children: [] })
  }

  function renameSheet(item: MapSheet) {
    setNewTitle(item.title)
    setRenaming(item.id)
  }

  function duplicateSheet(id: string) {
    flush.current?.()
    const item = sheetsRef.current.find(sheet => sheet.id === id)
    if (!item) return
    const base = item.title + ' 副本'
    let title = base
    let suffix = 2
    while (sheetsRef.current.some(sheet => sheet.title === title)) title = base + ' ' + suffix++
    createSheet(title, item.settings, item.tree, { source: id, wholeSheet: true })
  }

  function moveSheet(id: string, offset: number) {
    updateSheets(current => {
      const index = current.findIndex(item => item.id === id)
      const target = index + offset
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function saveTitle() {
    const title = newTitle.trim()
    if (!renaming || !title) { setRenaming(undefined); return }
    flush.current?.()
    const renamed = updateSheets(current => current.map(item => item.id === renaming
      ? { ...item, title, tree: item.tree.data.text === item.title ? { ...item.tree, data: { ...item.tree.data, text: title } } : item.tree } : item))
    if (renamed) setRenaming(undefined)
  }

  function primarySheet(): MapSheet | undefined {
    return primaryMapSheet(props)
  }

  function linkWorkbook(tree: MapData) {
    const main = sheet ? primarySheet() : { id: mainSheetId, title: mainTitle, tree }
    return [...(main ? [main] : []), ...sheetsRef.current.map(item => item.id === sheet?.id ? { ...item, tree } : item)]
  }

  function followTopicLink(target: TopicLink) {
    if (target.document && mapDocumentPath(target.document) !== path) return props.followMapDocument(target)
    const destination = target.sheet === mainSheetId ? undefined : target.sheet
    if (destination !== active) {
      const targetSheet = destination ? sheetsRef.current.find(item => item.id === destination) : primarySheet()
      if (!targetSheet || target.topic && !findTopic(targetSheet.tree, target.topic)) return false
      flush.current?.()
      activate(destination)
    }
    setJump({ ...target })
    return true
  }

  async function saveXmind(all: boolean, tree: MapData, settings: MapSettings) {
    const title = mapTitle(props.name)
    const current = { id: sheet?.id ?? mainSheetId, title: sheet?.title ?? mainTitle, settings, tree }
    let workbook = [current]
    if (all) {
      const main = sheet ? primarySheet() : current
      if (!main) throw new Error('主画布的 Markdown 结构无法转换。可单独导出当前画布。')
      workbook = [main, ...sheetsRef.current.map(item => item.id === current.id ? current : item)]
    }
    const { exportXmind } = await import('./exportXmind')
    const data = await exportXmind(workbook, current.id, props.dark)
    await window.desktop.saveXmind(all || !sheet ? title : sheet.title, data)
  }

  const menuIndex = sheets.findIndex(item => item.id === sheetMenu?.id)
  const menuSheet = sheets[menuIndex]

  return <div className="map-document">
    <MapCanvas key={sheet ? sheet.id + ':' + sheet.title : mainSheetId} {...props} sheet={sheet} registerFlush={registerCanvas}
      multipleSheets={sheets.length > 0} saveXmind={saveXmind} createSheet={createSheet} linkWorkbook={linkWorkbook}
      jump={jump?.sheet === (sheet?.id ?? mainSheetId) ? jump : undefined} followTopicLink={followTopicLink}
      updateSheet={(id, settings, tree) => {
        if (!updateSheets(current => current.map(item => item.id === id ? { ...item, settings, tree } : item))) {
          throw new Error('无法保存画布。')
        }
      }} />
    <nav className="map-sheets" aria-label="思维导图画布列表">
      <button className="map-sheet" data-active={!active} onClick={() => select()}>{mainTitle}</button>
      {sheets.map(item => <div className="map-sheet-item" key={item.id} onContextMenu={event => {
        event.preventDefault()
        setSheetMenu({ id: item.id, x: event.clientX, y: event.clientY })
      }}>
        {renaming === item.id
          ? <input aria-label="画布名称" value={newTitle} autoFocus onFocus={event => event.currentTarget.select()}
              onChange={event => setNewTitle(event.target.value)} onBlur={() => setRenaming(undefined)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') saveTitle()
                if (event.key === 'Escape') { event.stopPropagation(); setRenaming(undefined) }
              }} />
          : <button className="map-sheet" data-active={active === item.id} title={item.title} onClick={() => select(item.id)}
              onDoubleClick={() => renameSheet(item)}>{item.title}</button>}
        <button className="icon-button" aria-label={'画布操作 ' + item.title} aria-haspopup="menu" aria-expanded={sheetMenu?.id === item.id}
          onPointerDown={event => event.stopPropagation()} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          setSheetMenu(sheetMenu?.id === item.id ? undefined : { id: item.id, x: rect.left, y: rect.top })
        }}><ChevronDown size={13} /></button>
      </div>)}
      <button className="icon-button" aria-label="新建画布" title="新建画布" onClick={create}><Plus size={16} /></button>
      <button className="icon-button" aria-label="导入 Xmind" title="导入 Xmind" disabled={props.importing} onClick={props.importWorkbook}><FolderInput size={16} /></button>
      {storageError && <span className="map-storage-error" role="alert">无法保存画布</span>}
    </nav>
    {sheetMenu && menuSheet && <MarkdownMenu point={sheetMenu} close={() => setSheetMenu(undefined)} items={[
      { label: '重命名画布', run: () => renameSheet(menuSheet) },
      { label: '复制画布', run: () => duplicateSheet(menuSheet.id) },
      { label: '向左移动', disabled: menuIndex < 1, run: () => moveSheet(menuSheet.id, -1) },
      { label: '向右移动', disabled: menuIndex >= sheets.length - 1, run: () => moveSheet(menuSheet.id, 1) },
      { label: '删除画布', separator: true, run: () => setRemove(menuSheet) },
    ]} />}
    <dialog ref={removeDialog} onCancel={event => { event.preventDefault(); setRemove(undefined) }}>
      {remove && <div><h2>删除画布</h2><p>删除「{remove.title}」和它的全部主题？</p>
        <footer><button onClick={() => setRemove(undefined)}>取消</button><button className="primary" onClick={() => {
          if (updateSheets(current => current.filter(item => item.id !== remove.id))) {
            if (remove.id === active) activate()
            setRemove(undefined)
          }
        }}>删除</button></footer></div>}
    </dialog>
  </div>
}

function MapCanvas({ text, name, path, dark, platform, keyOverrides, remoteImages, remainderVisible, setRemainderVisible, onChange, registerFlush, sheet, updateSheet, multipleSheets, saveXmind, createSheet,
  linkWorkbook, jump, followTopicLink, readMapDocument, linkDocuments, find, position, overviewPreferences, panelWidth, resizePanel, rememberSettings, stickerDirectory }: MapEditorProps & {
  sheet?: MapSheet
  updateSheet: (id: string, settings: MapSettings, tree: MapData) => void
  multipleSheets: boolean
  saveXmind: (all: boolean, tree: MapData, settings: MapSettings) => Promise<void>
  createSheet: (title: string, settings: MapSettings, tree: MapData, copy?: { source: string; wholeSheet: boolean }) => void
  linkWorkbook: (tree: MapData) => Pick<MapSheet, 'id' | 'title' | 'tree'>[]
  jump?: TopicLink
  followTopicLink: (link: TopicLink) => boolean | Promise<boolean>
}) {
  const [{ projection, remainder, remainderLinks }] = useState(() => {
    const projection = projectList(text)
    const remainder = sheet ? '' : projectionRemainder(projection)
    const references = remainder && outlineReferences(text)
    return { projection, remainder, remainderLinks: references ? JSON.parse(references) : undefined }
  })
  const [appearance] = useState(() => loadMapAppearance(path))
  const [initialSheet] = useState(sheet)
  const [settings, setSettings] = useState(sheet?.settings ?? appearance.settings)
  const [selected, setSelected] = useState<MapNode[]>([])
  const [formatOpen, setFormatOpen] = useState(true)
  const [tab, setTab] = useState<'theme' | 'style'>('theme')
  const [zoom, setZoom] = useState(100)
  const [version, setVersion] = useState(0)
  const [zen, setZen] = useState(false)
  const [zenAppearance, setZenAppearance] = useState<ZenAppearance>()
  const [zenTool, setZenTool] = useState<ZenTool>()
  const [linking, setLinking] = useState(false)
  const [menu, setMenu] = useState<'export' | 'insert' | 'backlinks' | 'pitch' | { x: number; y: number; image?: boolean; link?: boolean; callout?: CalloutTarget; facet?: Facet }>()
  const [pitchPanel, setPitchPanel] = useState(false)
  const [artOpen, setArtOpen] = useState(false)
  const [navigation, setNavigation] = useState<{ key: number; facet?: string }>()
  const previousFind = useRef(find)
  const [overview, setOverview] = useState(overviewPreferences.visible)
  const overviewElement = useRef<HTMLDivElement>(null)
  const [matches, setMatches] = useState({ total: 0, currentIndex: -1 })
  const [titleMatches, setTitleMatches] = useState<string[]>([])
  const [field, setField] = useState<{ key: TopicField; node: MapNode; value: string }>()
  const [linkEditor, setLinkEditor] = useState<{ node: MapNode; kind: LinkType; callout?: CalloutTarget }>()
  const [selectedCallout, setSelectedCallout] = useState<CalloutTarget>()
  const [calloutText, setCalloutText] = useState<{ target: CalloutTarget; note: Callout; add: boolean }>()
  const [taskTopic, setTaskTopic] = useState<string>()
  const [equationNode, setEquationNode] = useState<MapNode>()
  const [audioParent, setAudioParent] = useState<MapNode>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [shotOpen, setShotOpen] = useState(false)
  const [branch, setBranch] = useState<{ uid: string; depth: number }>()
  const branchView = useRef<ReturnType<typeof installBranchView> | undefined>(undefined)
  const viewBeforeBranch = useRef<ReturnType<MindMap['view']['getTransformData']> | undefined>(undefined)
  const host = useRef<HTMLDivElement>(null)
  const navigationTrigger = useRef<HTMLButtonElement>(null)
  const shotTrigger = useRef<HTMLButtonElement>(null)
  const zenTrigger = useRef<HTMLButtonElement>(null)
  const viewBeforeZen = useRef<ReturnType<MindMap['view']['getTransformData']> | undefined>(undefined)
  const formatBeforeZen = useRef(false)
  const artTrigger = useRef<HTMLButtonElement>(null)
  const resourceInput = useRef<HTMLInputElement>(null)
  const resourceTarget = useRef<{ node: MapNode; image: boolean; callout?: CalloutTarget } | undefined>(undefined)
  const engine = useRef<MindMap | undefined>(undefined)
  const highlighted = useRef<ReadonlySet<string> | null>(null)
  const calloutLayer = useRef<ReturnType<typeof installCallouts> | undefined>(undefined)
  const exporting = useRef(false)
  const fieldDialog = useRef<HTMLDialogElement>(null)
  const change = useRef(onChange)
  const saveSheet = useRef(updateSheet)
  const followLink = useRef(followTopicLink)
  const currentSettings = useRef(settings)
  const sheetId = sheet?.id ?? mainSheetId
  change.current = onChange
  saveSheet.current = updateSheet
  followLink.current = followTopicLink
  currentSettings.current = settings
  const searchOpen = navigation !== undefined
  const zenDark = zenAppearance ? zenAppearance.endsWith('dark') : dark
  const topics = useMemo(() => searchOpen && engine.current
    ? navigationTopics(branchView.current?.branch()?.tree ?? engine.current.renderer.renderTree) : [], [searchOpen, version, branch])
  const highlight = useCallback((ids: ReadonlySet<string> | null) => {
    highlighted.current = ids
    if (engine.current) highlightTopics(engine.current, ids)
  }, [])
  const closeNavigation = () => {
    highlight(null)
    setNavigation(undefined)
    ;(navigationTrigger.current ?? host.current)?.focus()
  }
  const openNavigation = (facet?: string) => {
    setArtOpen(false)
    setPitchPanel(false)
    setZenTool(undefined)
    setNavigation(current => facet ? { key: (current?.key ?? 0) + 1, facet } : current ?? { key: 0 })
  }
  const toggleArt = () => {
    setPitchPanel(false)
    setNavigation(undefined)
    setZenTool(undefined)
    setArtOpen(!artOpen)
  }
  const toggleFormat = () => {
    setZenTool(undefined)
    if (artOpen || searchOpen || pitchPanel) {
      setArtOpen(false)
      setNavigation(undefined)
      setPitchPanel(false)
      setFormatOpen(true)
    } else setFormatOpen(!formatOpen)
  }
  function toggleZen(enabled: boolean) {
    if (enabled) {
      engine.current?.renderer.textEdit.hideEditTextBox()
      engine.current?.associativeLine.cancelCreateLine()
      viewBeforeZen.current = engine.current?.view.getTransformData()
      formatBeforeZen.current = formatOpen
      setLinking(false)
      setMenu(undefined)
    }
    setZenTool(undefined)
    setPitchPanel(false)
    setArtOpen(false)
    setNavigation(undefined)
    setFormatOpen(enabled ? false : formatBeforeZen.current)
    setZen(enabled)
  }
  const openShot = useCallback(() => {
    if (!engine.current) return
    engine.current.renderer.textEdit.hideEditTextBox()
    engine.current.associativeLine.cancelCreateLine()
    setLinking(false)
    setMenu(undefined)
    setNotice('')
    setShotOpen(true)
  }, [])
  const closeShot = (message?: string) => {
    setShotOpen(false)
    if (message) setNotice(message)
    requestAnimationFrame(() => (shotTrigger.current ?? host.current)?.focus())
  }
  const openPitch = useCallback((mode: PitchMode, start?: string) => {
    const map = engine.current
    if (!map) return
    map.renderer.textEdit.hideEditTextBox()
    map.associativeLine.cancelCreateLine()
    setLinking(false)
    setMenu(undefined)
    setNotice('')
    const full = map.getData()
    const uid = branchView.current?.uid
    const source = uid ? findBranch(full, uid)?.tree ?? full : full
    const title = sheet?.title ?? mapTitle(name)
    void window.desktop.openPitch({
      title, root: pitchTopicFromMap(source), start, mode, options: readPitchOptions(currentSettings.current.pitch),
    }).catch(error => setNotice(error instanceof Error ? error.message : '无法启动演示。'))
  }, [name, sheet?.title])
  const changeBranch = useCallback((uid?: string, restoreFocus = true) => {
    const map = engine.current
    const scope = branchView.current
    if (!map || !scope || scope.uid === uid) return
    map.renderer.textEdit.hideEditTextBox()
    const next = uid ? findBranch(map.renderer.renderTree, uid) : undefined
    if (uid && !next?.depth) return
    if (uid && !scope.uid) viewBeforeBranch.current = map.view.getTransformData()
    const previousView = viewBeforeBranch.current
    if (!uid) viewBeforeBranch.current = undefined
    map.search.endSearch()
    highlight(null)
    map.associativeLine.cancelCreateLine()
    setLinking(false)
    setSelectedCallout(undefined)
    setNavigation(undefined)
    setMenu(undefined)
    scope.set(uid)
    setBranch(uid && next ? { uid, depth: next.depth } : undefined)
    map.reRender(() => queueMicrotask(() => {
      if (engine.current !== map || scope.uid !== uid) return
      if (restoreFocus) {
        if (uid) {
          map.view.fit()
          map.renderer.root?.active()
        } else if (previousView) map.view.setTransformData(previousView)
        host.current?.focus()
      }
    }))
  }, [highlight])

  function foldBranches(levels: number, normalCommand: string, ...args: unknown[]) {
    const map = engine.current
    const tree = branchView.current?.branch()?.tree
    if (!map) return
    if (!tree) { map.execCommand(normalCommand, ...args); return }
    map.command.originAddHistory()
    setBranchDepth(tree, levels)
    map.command.originAddHistory()
    map.render()
  }
  function replaceTopics(text: string, all: boolean) {
    const map = engine.current
    if (!map) return
    map.command.originAddHistory()
    if (all) map.search.replaceAll(text)
    else map.search.replace(text, true)
    map.command.originAddHistory()
  }

  const backlinkTopic = selectedCallout ? calloutTopicId(selectedCallout.owner, selectedCallout.id)
    : selected.length === 1 ? selected[0].uid : undefined
  const externalBacklinks = useMemo(() => backlinkTopic ? documentBacklinks(path, { sheet: sheetId, topic: backlinkTopic }) : [],
    [path, sheetId, backlinkTopic])
  const backlinks = useMemo(() => {
    const map = engine.current
    if (!map || !backlinkTopic) return []
    return [...listBacklinks(linkWorkbook(map.getData()), { sheet: sheetId, topic: backlinkTopic }), ...externalBacklinks]
  }, [backlinkTopic, externalBacklinks, linkWorkbook, sheetId, version])

  function readCallout(target: CalloutTarget) {
    const owner = engine.current?.renderer.findNodeByUid(target.owner)
    const note = owner && readCallouts(owner.getData('ymdCallouts')).find(item => item.data.uid === target.id)
    return owner && note ? { owner, note } : undefined
  }

  function writeCallouts(owner: MapNode, list: Callout[]) {
    const map = engine.current
    if (!map) return
    map.command.originAddHistory()
    map.execCommand('SET_NODE_DATA', owner, { ymdCallouts: list.length ? list : null })
    map.command.originAddHistory()
    calloutLayer.current?.update()
  }

  function changeCallout(target: CalloutTarget, patch: Record<string, unknown>) {
    const current = readCallout(target)
    if (!current || !Object.entries(patch).some(([key, value]) => current.note.data[key] !== value)) return
    const { owner, note } = current
    writeCallouts(owner, readCallouts(owner.getData('ymdCallouts')).map(item =>
      item.data.uid === target.id ? { ...note, data: { ...note.data, ...patch } } : item))
  }

  function editCallout(target: CalloutTarget) {
    const current = readCallout(target)
    if (current) setCalloutText({ target, note: current.note, add: false })
  }

  function removeCallout(target: CalloutTarget) {
    const current = readCallout(target)
    if (!current) return
    writeCallouts(current.owner, readCallouts(current.owner.getData('ymdCallouts')).filter(item => item.data.uid !== target.id))
    setSelectedCallout(undefined)
    host.current?.focus()
  }

  function writeTask(node: MapNode, task: MapTask | null, todo: MapTodo | null) {
    const map = engine.current
    const current = map?.renderer.findNodeByUid(node.uid)
    if (!map || !current) return
    map.command.originAddHistory()
    map.renderer.setNodeDataRender(current, { ymdTask: task, ymdTodo: todo })
    map.command.originAddHistory()
  }

  function updateNumbering(edit: NumberingEdit) {
    const map = engine.current
    if (!map) return
    map.renderer.textEdit.hideEditTextBox()
    const selection = new Set(map.renderer.activeNodeList.filter(topic => !topic.isGeneralization).map(topic => topic.uid))
    map.command.originAddHistory()
    if (!editNumbering(map.renderer.renderTree, selection, edit)) return
    map.command.originAddHistory()
    map.render()
  }

  function openTask(id?: string) {
    setNotice('')
    setTaskTopic(id)
  }

  async function followLinkWithNotice(target: TopicLink, message: string) {
    try {
      if (await followLink.current(target)) return
    } catch {}
    setNotice(target.document ? '无法定位链接文档或主题。请先打开该文档，或在链接设置中选择新目标。' : message)
  }

  function openHyperlink(url: string) {
    const target = readTopicLink(url)
    if (target) void followLinkWithNotice(target, '链接指向的画布或主题已删除，或无法定位。')
    else if (readLocalMapUrl(url)) {
      setNotice('')
      void window.desktop.openLocalMapLocation(url).catch(error => {
        setNotice(String(error).replace(/^Error(?: invoking remote method '[^']+': Error)?: /, ''))
      })
    }
    else void window.desktop.openExternal(url).catch(() => setNotice('无法打开链接。'))
  }

  useEffect(() => {
    if (!host.current) return
    const root: MapData = initialSheet ? structuredClone(initialSheet.tree)
      : mainMap(name, projection.blocks, appearance)
    const initialSettings = initialSheet?.settings ?? appearance.settings
    let previous = text
    const audio = createAudioPlayer(host.current, setNotice)
    let map: MindMap
    try {
      map = new MindMap({
        el: host.current, data: root, theme: 'default', fit: !!appearance.imported,
        layout: initialSettings.layout, themeConfig: mapTheme(initialSettings, dark),
        rainbowLinesConfig: { open: initialSettings.colored, colorsList: palettes[initialSettings.palette].colors },
        customHyperlinkJump: openHyperlink,
        openRealtimeRenderOnNodeTextEdit: true,
        createNodePrefixContent: node => {
          if (!node.isRoot || initialSheet || appearance.imported) displayMapMarkdown(node)
        },
        createNodePostfixContent: node => {
          const note = readAudioNote(node.getData('ymdAudio'))
          if (note) {
            const button = audioButton(note, () => void audio.toggle(note))
            audio.decorate(button.el, note)
            return button
          }
          const task = readTask(node.getData('ymdTask'))
          if (task) return taskBadge(task, () => openTask(node.uid))
          const todo = readTodo(node.getData('ymdTodo'))
          if (todo) return todoBadge(todo, () => writeTask(node, null, todo === 'todo' ? 'done' : 'todo'))
        },
        customCheckEnableShortcut: event => !event.defaultPrevented && !event.isComposing && event.target instanceof HTMLElement &&
          !(map?.renderer.activeNodeList.some(node => readAudioNote(node.getData('ymdAudio'))) &&
            (event.key === 'Tab' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v')) &&
          (event.target === document.body || event.target.classList.contains('smm-node-edit-wrap') || !!host.current?.contains(event.target)),
        beforeAssociativeLineConnection: () => { setLinking(false); return false },
        beforeTextEdit: node => !readAudioNote(node.getData('ymdAudio')) && (!!initialSheet || !!appearance.imported ||
          !node.isRoot || branchView.current?.uid === node.uid),
        beforeDragEnd: ({ overlapNodeUid }) => !!readAudioNote(map?.renderer.findNodeByUid(overlapNodeUid)?.getData('ymdAudio')),
        beforeDeleteNodeImg: node => { removeTopicImage(map, node); return true },
        maxImgResizeWidthInheritTheme: false,
        maxImgResizeWidth: 480, maxImgResizeHeight: 480,
        enableAutoEnterTextEditWhenKeydown: false, enableFreeDrag: true,
        defaultInsertSecondLevelNodeText: '新主题', defaultInsertBelowSecondLevelNodeText: '子主题',
      })
    } catch (problem) {
      audio.stop()
      setError(problem instanceof Error ? problem.message : String(problem))
      return
    }
    engine.current = map
    const focusBranch = installBranchView(map)
    branchView.current = focusBranch
    const removeNumbering = installNumbering(map)
    const callouts = installCallouts(map, {
      select: target => {
        setSelectedCallout(target)
        setMenu(undefined)
        if (!target) host.current?.focus()
      },
      edit: editCallout, remove: removeCallout, change: changeCallout, follow: openHyperlink,
      menu: (callout, x, y) => setMenu({ x, y, callout }),
      download: note => downloadAttachment(note.data.attachmentUrl, note.data.attachmentName),
    })
    calloutLayer.current = callouts
    const removeBranchLayouts = installBranchLayouts(map, () => !!focusBranch.uid)
    const removeImageGestures = installTopicImageGestures(map, host.current, setEquationNode)
    const onData = (node: MapData | undefined) => {
      if (!node) return
      const audioId = audio.activeId
      if (audioId && !hasAudio(node, audioId)) audio.stop()
      if (!initialSheet) {
        const next = writeList(projection, fromMap(node.children ?? [], !!appearance.imported))
        if (next !== previous) { previous = next; change.current(next) }
      }
      try {
        if (initialSheet) saveSheet.current(initialSheet.id, currentSettings.current, node)
        else saveMapAppearance(path, currentSettings.current, node)
      } catch { setNotice('无法保存导图样式。') }
      setVersion(value => value + 1)
    }
    const sync = () => onData(map.getData())
    const flush = () => { map.renderer.textEdit.hideEditTextBox(); sync() }
    const select = (_node: MapNode | null, nodes: MapNode[]) => {
      setSelected([...nodes])
      if (nodes.length && !nodes[0].isRoot) setTab('style')
    }
    const context = (event: MouseEvent, node: MapNode) => {
      event.preventDefault()
      setSelectedCallout(undefined)
      select(node, map.renderer.activeNodeList)
      setMenu({ x: event.clientX, y: event.clientY, image: isTopicImage(event.target),
        link: event.target instanceof Element && !!event.target.closest('a') && !!node.getData('hyperlink'), facet: facetAt(node, event.target) })
    }
    const scale = (value: number) => setZoom(Math.round(value * 100))
    const syncLinkMode = () => setLinking(map.associativeLine.isCreatingLine)
    const clearCalloutSelection = () => { setSelectedCallout(undefined); syncLinkMode() }
    const searchInfo = (info: typeof matches) => setMatches(info)
    const searchNodes = (nodes: (MapNode | MapData)[]) => setTitleMatches(nodes.map(item =>
      ('getData' in item ? item.getData() : item.data).uid ?? ''))
    const reapplyFilter = () => {
      if (focusBranch.uid) {
        const focused = focusBranch.branch()
        if (!focused) queueMicrotask(() => changeBranch())
        else setBranch(current => current && current.uid === focusBranch.uid && current.depth !== focused.depth
          ? { ...current, depth: focused.depth } : current)
      }
      highlightTopics(map, highlighted.current)
    }
    const download = (node: MapNode) => downloadAttachment(node.getData('attachmentUrl'), node.getData('attachmentName'))
    const textEditor = map.renderer.textEdit
    textEditor.textNodePaddingX = 0
    textEditor.textNodePaddingY = 0
    const fitTopicEditor = () => queueMicrotask(() => {
      if (engine.current === map && textEditor.isShowTextEdit()) textEditor.emitTextChangeEvent()
    })
    map.on('before_show_text_edit', fitTopicEditor)
    map.on('data_change', onData)
    map.on('afterExecCommand', sync)
    map.on('node_active', select)
    map.on('node_contextmenu', context)
    map.on('node_click', clearCalloutSelection)
    map.on('draw_click', clearCalloutSelection)
    map.on('contextmenu', syncLinkMode)
    map.on('scale', scale)
    map.on('search_info_change', searchInfo)
    map.on('search_match_node_list_change', searchNodes)
    map.on('node_tree_render_end', reapplyFilter)
    map.on('node_attachmentClick', download)
    registerFlush(flush)
    const shouldFit = () => !!focusBranch.uid || !!host.current?.closest('[data-zen="true"]')
    const resize = new ResizeObserver(() => {
      map.resize()
      if (shouldFit()) {
        map.render(() => { if (shouldFit()) map.view.fit() })
      }
    })
    resize.observe(host.current)
    const lastView = position.map?.get(sheetId)
    if (lastView) map.render(() => { if (engine.current === map) map.view.setTransformData(lastView) })
    return () => {
      const views = position.map ??= new Map()
      views.set(sheetId, viewBeforeBranch.current ?? viewBeforeZen.current ?? map.view.getTransformData())
      resize.disconnect()
      removeNumbering()
      audio.stop()
      callouts.dispose()
      calloutLayer.current = undefined
      removeImageGestures()
      removeBranchLayouts()
      focusBranch.dispose()
      branchView.current = undefined
      registerFlush()
      map.off('afterExecCommand', sync)
      map.off('before_show_text_edit', fitTopicEditor)
      map.off('data_change', onData)
      map.off('node_active', select)
      map.off('node_contextmenu', context)
      map.off('node_click', clearCalloutSelection)
      map.off('draw_click', clearCalloutSelection)
      map.off('contextmenu', syncLinkMode)
      map.off('scale', scale)
      map.off('search_info_change', searchInfo)
      map.off('search_match_node_list_change', searchNodes)
      map.off('node_tree_render_end', reapplyFilter)
      map.off('node_attachmentClick', download)
      map.associativeLine.cancelCreateLine()
      map.destroy()
      engine.current = undefined
    }
  }, [name, path, projection, registerFlush, appearance, initialSheet, changeBranch])

  useEffect(() => { calloutLayer.current?.select(selectedCallout) }, [selectedCallout])

  useEffect(() => {
    const map = engine.current
    if (!jump || !map) return
    let canceled = false
    const branchTree = branchView.current?.branch()?.tree
    if (branchTree && (!jump.topic || !findTopic(branchTree, jump.topic))) changeBranch(undefined, false)
    // Expanding a folded branch enqueues another render. Wait for the first render to clear its callbacks.
    map.render(() => queueMicrotask(() => {
      if (canceled || engine.current !== map) return
      const tree = map.getData()
      const callout = jump.topic ? calloutById(tree, jump.topic) : undefined
      const uid = callout?.owner ?? jump.topic ?? tree.data.uid
      if (!uid || !findTopic(tree, uid)) {
        setNotice('链接指向的主题已删除或无法定位。')
        return
      }
      map.renderer.expandToNodeUid(uid, () => {
        if (canceled || engine.current !== map) return
        const target = map.renderer.findNodeByUid(uid)
        if (target) {
          target.active()
          setSelectedCallout(callout)
          if (callout) {
            calloutLayer.current?.update()
            calloutLayer.current?.reveal(callout)
          } else map.renderer.moveNodeToCenter(target, false)
        }
      })
    }))
    return () => { canceled = true }
  }, [jump, changeBranch])

  useEffect(() => {
    const map = engine.current
    if (!map) return
    const palette = palettes[settings.palette]
    map.updateConfig({ rainbowLinesConfig: { open: settings.colored, colorsList: palette.colors } })
    const appearance = zen && zenAppearance ? zenAppearances[zenAppearance] : undefined
    map.setThemeConfig(mapTheme(appearance ? { ...settings, background: appearance.background } : settings,
      zen ? zenDark : dark, branch?.depth))
    setZoom(Math.round(map.view.scale * 100))
  }, [dark, settings, zen, zenAppearance, zenDark, branch])
  useEffect(() => {
    const map = engine.current
    if (!map || !zen && !viewBeforeZen.current) return
    let canceled = false
    const frame = requestAnimationFrame(() => {
      map.resize()
      map.render(() => {
        if (canceled || engine.current !== map) return
        if (zen) {
          map.view.fit()
          host.current?.focus()
        } else {
          if (viewBeforeZen.current) map.view.setTransformData(viewBeforeZen.current)
          viewBeforeZen.current = undefined
          zenTrigger.current?.focus()
        }
      })
    })
    return () => { canceled = true; cancelAnimationFrame(frame) }
  }, [zen])
  useEffect(() => {
    if (field) fieldDialog.current?.showModal()
    else if (fieldDialog.current?.open) fieldDialog.current.close()
  }, [field?.key, field?.node])
  useEffect(() => {
    if (find === previousFind.current) return
    previousFind.current = find
    if (shotOpen) return
    openNavigation()
  }, [find, shotOpen])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || event.defaultPrevented ||
          field || linkEditor || taskTopic || audioParent || equationNode || calloutText || shotOpen) return
      if (event.target instanceof HTMLElement && event.target.closest('.document-menu')) return
      if (event.target instanceof HTMLElement && event.target.closest('.smm-node-edit-wrap')) {
        event.preventDefault()
        engine.current?.renderer.textEdit.hideEditTextBox()
        host.current?.focus()
        return
      }
      if (linking) { engine.current?.associativeLine.cancelCreateLine(); setLinking(false) }
      else if (searchOpen) { event.preventDefault(); closeNavigation() }
      else if (artOpen) {
        event.preventDefault()
        setArtOpen(false)
        ;(artTrigger.current ?? host.current)?.focus()
      }
      else if (pitchPanel) {
        event.preventDefault()
        setPitchPanel(false)
        host.current?.focus()
      }
      else if (zen && zenTool) {
        event.preventDefault()
        setZenTool(undefined)
      }
      else if (zen && formatOpen) {
        event.preventDefault()
        setFormatOpen(false)
        host.current?.focus()
      }
      else if (branch) {
        event.preventDefault()
        changeBranch()
      }
      else if (zen) {
        event.preventDefault()
        toggleZen(false)
      }
      else if (formatOpen) setFormatOpen(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [zen, zenTool, linking, searchOpen, formatOpen, artOpen, field, linkEditor, taskTopic, audioParent, equationNode, calloutText, shotOpen,
    branch, changeBranch, pitchPanel])

  useEffect(() => {
    const current = selectedCallout && readCallout(selectedCallout)
    const source = current?.owner ?? (selected.length === 1 ? selected[0] : undefined)
    if (linkEditor || field || taskTopic || audioParent || equationNode || calloutText || shotOpen) return
    const linkable = source && !source.isGeneralization && !readAudioNote(source.getData('ymdAudio'))
    const focusableBranch = selected.length === 1 && source && !source.isRoot && linkable && !current
    const bindings = shortcutsFor('map', keyOverrides, platform)
    const sequence = new ShortcutSequence()
    const mapShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          !(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable], dialog, .document-menu')) return
      if (event.key === 'Escape') { sequence.reset(); return }
      const onCanvas = event.target === document.body || host.current?.contains(event.target)
      if (event.code === 'Space' && onCanvas && !current &&
          !event.target.closest('button, a') && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        const map = engine.current
        if (!map || map.renderer.activeNodeList.length !== 1) return
        const [topic] = map.renderer.activeNodeList
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        const editor = map.renderer.textEdit
        void editor.show({ node: topic, isFromKeyDown: true }).then(() => {
          if (engine.current !== map || editor.getCurrentEditNode() !== topic || !editor.textEditNode) return
          const input = editor.textEditNode
          input.focus({ preventScroll: true })
          const range = document.createRange()
          range.selectNodeContents(input)
          range.collapse(false)
          document.getSelection()?.removeAllRanges()
          document.getSelection()?.addRange(range)
        })
        return
      }
      const chord = inputChord({ key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey }, platform)
      const match = chord && sequence.take(chord, bindings.filter(item => item.id === 'map-shot' || item.id === 'map-pitch' ||
        (item.id === 'map-branch' ? !!branch || focusableBranch && onCanvas : linkable && onCanvas)), event.repeat)
      if (!match) return
      event.preventDefault()
      event.stopPropagation()
      if (match === 'pending') return
      if (match === 'map-shot') { openShot(); return }
      if (match === 'map-pitch') { openPitch('fullscreen'); return }
      if (match === 'map-branch') { changeBranch(branch ? undefined : source?.uid); return }
      if (!source) return
      const href = current ? current.note.data.hyperlink : source.getData('hyperlink')
      setLinkEditor({ node: source, callout: current ? selectedCallout : undefined, kind: mapLinkType(href) })
    }
    window.addEventListener('keydown', mapShortcut, true)
    return () => window.removeEventListener('keydown', mapShortcut, true)
  }, [selected, selectedCallout, linkEditor, field, taskTopic, audioParent, equationNode, calloutText, shotOpen, keyOverrides, platform, openShot,
    branch, changeBranch, openPitch])

  useEffect(() => {
    const map = engine.current
    const canvas = host.current
    const element = overviewElement.current
    if (overview && map && canvas && element) return installMapOverview(map, canvas, element)
  }, [overview, path, name, projection, appearance, initialSheet, changeBranch])

  if (error) return <div className="editor-empty"><h2>无法加载思维导图</h2><p>{error}</p></div>

  function changeSettings(patch: Partial<MapSettings>) {
    const next = { ...currentSettings.current, ...patch }
    currentSettings.current = next
    setSettings(next)
    const map = engine.current
    if (!map) return
    if (patch.layout && patch.layout !== settings.layout) map.setLayout(patch.layout)
    const { pitch: _pitch, ...canvas } = patch
    if (Object.keys(canvas).length) rememberSettings(canvas)
    try {
      if (initialSheet) saveSheet.current(initialSheet.id, next, map.getData())
      else saveMapAppearance(path, next, map.getData())
    } catch { setNotice('无法保存导图样式。') }
  }

  const command = (name: string, ...args: unknown[]) => engine.current?.execCommand(name, ...args)
  const activeCallout = selectedCallout && readCallout(selectedCallout)
  const contextCallout = typeof menu === 'object' ? menu.callout : undefined
  const menuCallout = contextCallout && readCallout(contextCallout)
  const dialogCallout = linkEditor?.callout && readCallout(linkEditor.callout)
  const node = activeCallout ? undefined : selected[0]
  const pitchNode = node && !node.isGeneralization ? node : engine.current?.renderer.root
  const pitchTopic = pitchPanel && pitchNode ? pitchTopicFromMap(pitchNode.nodeData) : undefined
  const changePitchTopic = (patch: Partial<PitchTopicOptions>) => {
    const map = engine.current
    if (!map || !pitchNode) return
    map.command.originAddHistory()
    map.execCommand('SET_NODE_DATA', pitchNode, { ymdPitch: { ...readPitchTopic(pitchNode.getData('ymdPitch')), ...patch } })
    map.command.originAddHistory()
  }
  const audioNote = readAudioNote(node?.getData('ymdAudio'))
  const canRemove = !!node && selected.some(item => !item.isRoot)
  const canLink = selected.length === 1 && !!node && !node.isGeneralization && !audioNote
  const currentLink = node?.getData('hyperlink')
  const selectedTodo = readTodo(node?.getData('ymdTodo'))
  const taskItem: MenuItem = { label: selectedTodo ? '转换为任务' : '任务',
    icon: <ClipboardList size={16} />, disabled: !canLink, separator: true, run: () => openTask(node?.uid) }
  const todoItem: MenuItem = selectedTodo && node ? { label: '待办事项', icon: <SquareCheck size={16} />, children: [
    { label: selectedTodo === 'todo' ? '标记为完成' : '标记为未完成',
      run: () => writeTask(node, null, selectedTodo === 'todo' ? 'done' : 'todo') },
    { label: '移除待办事项', run: () => writeTask(node, null, null) },
  ] } : { label: readTask(node?.getData('ymdTask')) ? '转换为待办事项' : '待办事项',
    icon: <SquareCheck size={16} />, disabled: !canLink, run: () => { if (node) writeTask(node, null, 'todo') } }

  function addCallout() {
    if (!canLink || !node) return
    const target = { owner: node.uid, id: crypto.randomUUID() }
    setCalloutText({ target, note: { data: { uid: target.id, text: '标注' } }, add: true })
  }

  function saveCalloutText(text: string) {
    if (!calloutText) return
    const { target, note, add } = calloutText
    if (add) {
      const owner = engine.current?.renderer.findNodeByUid(target.owner)
      if (owner) writeCallouts(owner, [...readCallouts(owner.getData('ymdCallouts')), { data: { ...note.data, text } }])
    } else changeCallout(target, { text })
    setCalloutText(undefined)
    setSelectedCallout(target)
    requestAnimationFrame(() => calloutLayer.current?.select(target, true))
  }

  function add(sibling: boolean) {
    const map = engine.current
    if (!map) return
    if (sibling && node && !node.isRoot) { command('INSERT_NODE'); return }
    if (audioNote) return
    const parent = node ?? map.renderer.root
    if (parent) command('INSERT_CHILD_NODE', true, [parent])
  }

  function addFloating() {
    const root = engine.current?.renderer.root
    if (!root) return
    command('INSERT_CHILD_NODE', true, [root], {
      text: '浮动主题', ymdFloating: true, customLeft: root.left + root.width + 76, customTop: root.top - 120,
      fillColor: '#e8edf5', color: '#273343', borderWidth: 1, borderColor: '#aab7cc', lineColor: 'transparent',
    })
  }

  function sheetFromTopic() {
    const map = engine.current
    if (!map || selected.length !== 1 || !node || node.isRoot) return
    map.renderer.textEdit.hideEditTextBox()
    const topic = findTopic(map.getData(), node.uid)
    if (!topic) return
    const { ymdFloating: _float, customLeft: _left, customTop: _top, ymdStructure, ...data } = topic.data
    const settings = { ...currentSettings.current, layout: branchStructure(ymdStructure) ?? currentSettings.current.layout }
    createSheet(data.text?.trim() || '新画布', settings, { ...topic, data: { ...data, expand: true } }, { source: sheetId, wholeSheet: false })
  }

  function fieldFor(key: TopicField) {
    if (!node) return
    const value = node.getData(key === '备注' ? 'note' : 'tag')
    setField({ key, node, value: Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '' })
  }

  function editLink(kind: LinkType) {
    if (!canLink || !node) return
    setLinkEditor({ node, kind })
  }

  function availableLinkSheets(): LinkSheet[] {
    const map = engine.current
    if (!map) return []
    return linkWorkbook(map.getData()).map(item => ({ id: item.id, title: item.title, topics: listMapTopics(item.tree) }))
  }

  function setNodeLink(source: MapNode, value: string) {
    const map = engine.current
    const current = map?.renderer.findNodeByUid(source.uid)
    if (!map || !current || String(current.getData('hyperlink') ?? '') === value) return
    const title = linkLabels[mapLinkType(value)]
    // Link editing is a single history step, even before the library's queued snapshot runs.
    map.command.originAddHistory()
    map.execCommand('SET_NODE_HYPERLINK', current, value, value ? title : '')
    map.command.originAddHistory()
  }

  async function addRecordedAudio(parent: MapNode, audio: Blob, duration: number) {
    const map = engine.current
    if (!map) throw new Error('录音所属的画布已关闭。')
    const note: AudioNote = { id: crypto.randomUUID(), duration }
    await storeAudio(note.id, audio)
    const newTopic = { uid: crypto.randomUUID(), text: audioTitle, ymdAudio: note, expand: true, isActive: false, richText: false }
    let current: MapNode
    try {
      if (engine.current !== map) throw new Error('录音所属的画布已关闭。')
      const snapshot = map.getData()
      const target = findTopic(snapshot, parent.uid)
      const topic = map.renderer.findNodeByUid(parent.uid)
      if (!target || !topic || topic.isGeneralization) throw new Error('录音所属的主题已关闭。')
      current = topic
      target.data.expand = true
      target.children = [...(target.children ?? []), { data: newTopic, children: [] }]
      if (initialSheet) saveSheet.current(initialSheet.id, currentSettings.current, snapshot)
      else saveMapAppearance(path, currentSettings.current, snapshot)
    } catch (problem) {
      await forgetAudio(note.id).catch(() => {})
      throw problem
    }
    command('INSERT_CHILD_NODE', false, [current], newTopic)
    map.render(() => {
      if (engine.current !== map || !host.current) return
      const recorded = map.renderer.findNodeByUid(newTopic.uid)
      const control = host.current.querySelector('[data-audio-note="' + note.id + '"]')?.getBoundingClientRect()
      const canvas = host.current.getBoundingClientRect()
      if (recorded && (!control || control.left < canvas.left || control.right > canvas.right ||
          control.top < canvas.top || control.bottom > canvas.bottom)) {
        map.renderer.moveNodeToCenter(recorded, false)
      }
    })
    setAudioParent(undefined)
  }

  function saveAudioToFile(note: AudioNote) {
    void loadAudio(note.id).then(audio => audio.arrayBuffer()).then(data => window.desktop.saveAudioNote(data))
      .catch(error => setNotice(error instanceof Error ? error.message : '无法另存录音。'))
  }

  function closeEquation() {
    setEquationNode(undefined)
    requestAnimationFrame(() => host.current?.focus())
  }

  function saveEquation(latex: string, source: string, size: { width: number; height: number }) {
    const map = engine.current
    const current = equationNode && map?.renderer.findNodeByUid(equationNode.uid)
    if (!map || !current) { closeEquation(); return }
    const previousWidth = Number((current.getData('imageSize') as { width?: number } | undefined)?.width)
    const original = readEquation(current.getData('ymdEquation'))
    if (original === latex && current.getData('image')) { closeEquation(); return }
    const width = original && Number.isFinite(previousWidth) && previousWidth > 0 ? previousWidth : size.width
    const height = width * size.height / size.width
    const scale = Math.min(1, 480 / Math.max(width, height))
    map.command.originAddHistory()
    addTopicImage(map, current, source, 'LaTeX 公式', { width: width * scale, height: height * scale }, true, { latex, original: size })
    map.command.originAddHistory()
    closeEquation()
  }

  function chooseResource(image: boolean, callout?: CalloutTarget) {
    const owner = callout ? readCallout(callout)?.owner : node
    if (!owner || !resourceInput.current) return
    resourceTarget.current = { node: owner, image, callout }
    resourceInput.current.accept = image ? 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp' : ''
    resourceInput.current.value = ''
    resourceInput.current.click()
  }

  function attach(file?: File) {
    const target = resourceTarget.current
    if (!file || !target) return
    if (file.size > 2 * 1024 * 1024) { setNotice('每个导图附件最大 2 MB。'); return }
    const selected = () => engine.current?.renderer.activeNodeList.includes(target.node)
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (!target.callout && !selected()) return
      const source = String(reader.result)
      if (!target.image) {
        const safeName = file.name.replace(/[<>:"/\\|?*]/g, '_').replace(/&/g, '与')
        const attachmentUrl = source.replace(/^data:[^;]*;/, 'data:application/octet-stream;')
        if (target.callout) changeCallout(target.callout, { attachmentUrl, attachmentName: safeName })
        else command('SET_NODE_ATTACHMENT', target.node, attachmentUrl, safeName)
        return
      }
      if (!/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(source)) { setNotice('图片格式不受支持。'); return }
      const image = new Image()
      image.onload = () => {
        const width = Math.min(image.naturalWidth, 240)
        const map = engine.current
        if (selected() && map) addTopicImage(map, target.node, source, file.name, { width, height: width * image.naturalHeight / image.naturalWidth }, false)
      }
      image.onerror = () => setNotice('无法读取图片。')
      image.src = source
    })
    reader.addEventListener('error', () => setNotice('无法读取附件。'))
    reader.readAsDataURL(file)
  }

  const insertItems: MenuItem[] = [
    { label: '由主题新建画布', disabled: !node || node.isRoot || !!audioNote || selected.length !== 1, run: sheetFromTopic },
    { label: '浮动主题', icon: <Square size={16} />, run: addFloating },
    { label: '关联线', icon: <GitFork size={16} />, disabled: !node, run: () => {
      engine.current?.associativeLine.createLineFromActiveNode()
      setLinking(true)
    } },
    { label: '边界', icon: <Square size={16} />, disabled: !canRemove, run: () => command('ADD_OUTER_FRAME') },
    { label: '概要', icon: <ListTree size={16} />, disabled: !canRemove, run: () => command('ADD_GENERALIZATION') },
    taskItem, todoItem,
    { label: '备注', icon: <StickyNote size={16} />, disabled: !node, separator: true, run: () => fieldFor('备注') },
    { label: '标注', icon: <MessageSquare size={16} />, disabled: !canLink, run: addCallout },
    { label: audioTitle, icon: <Mic size={16} />, disabled: !node || !!audioNote || !!node.isGeneralization || selected.length !== 1,
      run: () => setAudioParent(node) },
    { label: '标签', icon: <Tag size={16} />, disabled: !node, run: () => fieldFor('标签') },
    { label: '链接', disabled: !canLink, children: linkTypes.map(kind => ({ label: linkLabels[kind], run: () => editLink(kind) })) },
    { label: node && readEquation(node.getData('ymdEquation')) ? '编辑公式' : '公式',
      icon: <SquareFunction size={16} />, disabled: !canLink, run: () => setEquationNode(node) },
    { label: '图片', icon: <ImagePlus size={16} />, disabled: !node, run: () => chooseResource(true) },
    { label: '贴纸', icon: <Sticker size={16} />, run: () => setArtOpen(true) },
    { label: '附件', icon: <Paperclip size={16} />, disabled: !node, run: () => chooseResource(false) },
    { label: '标记', icon: <Star size={16} />, disabled: !node, children: [
      ...[1, 2, 3, 4, 5].map(level => ({ label: '优先级 ' + level, run: () => command('SET_NODE_ICON', node, ['priority_' + level]) })),
      { label: '已完成', run: () => command('SET_NODE_ICON', node, ['progress_8']) },
      { label: '移除标记', run: () => command('SET_NODE_ICON', node, []) },
      { label: '贴纸', separator: true, run: () => setArtOpen(true) },
    ] },
  ]
  async function exportWorkbook(all: boolean) {
    const map = engine.current
    if (!map || exporting.current) return
    exporting.current = true
    try {
      map.renderer.textEdit.hideEditTextBox()
      await saveXmind(all, map.getData(), currentSettings.current)
    } catch (problem) {
      setNotice(problem instanceof Error ? problem.message : '无法导出 Xmind 文件。')
    } finally { exporting.current = false }
  }

  async function exportDocument(format: MapExportFormat, uid?: string) {
    const map = engine.current
    if (!map || exporting.current) return
    exporting.current = true
    const callouts = calloutLayer.current
    try {
      map.renderer.textEdit.hideEditTextBox()
      const title = mapExportTitle(sheet?.title ?? mapTitle(name))
      if (uid || branchView.current?.uid) {
        const full = map.getData()
        const target = uid ? findBranch(full, uid) : { tree: full, depth: 0 }
        if (!target) throw new Error('分支已删除，无法导出。')
        await exportMapTree(target.tree, currentSettings.current, dark, target.depth, format,
          uid ? mapExportTitle(target.tree.data.text ?? '') : title, uid ? full : undefined)
      } else {
        callouts?.controls(false)
        await map.export(format, true, title)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : '导出失败。') }
    finally { callouts?.controls(true); exporting.current = false }
  }

  const shotKey = shortcutValue(keyOverrides, 'map-shot', platform)
  const pitchKey = shortcutValue(keyOverrides, 'map-pitch', platform)
  const shotShortcut = shotKey ? shortcutLabel(shotKey, platform) : undefined
  const branchKey = shortcutValue(keyOverrides, 'map-branch', platform)
  const branchShortcut = branchKey ? shortcutLabel(branchKey, platform) : undefined
  const branchFormats = [['png', 'PNG 图片'], ['svg', 'SVG 矢量图'], ['pdf', 'PDF'], ['md', 'Markdown']] as const
  const exportItems: MenuItem[] = [
    { label: '导图截图…', icon: <Camera size={16} />, shortcut: shotShortcut, run: openShot },
    multipleSheets ? { label: 'Xmind 文件', children: [
      { label: '全部画布', run: () => void exportWorkbook(true) },
      { label: '当前画布', run: () => void exportWorkbook(false) },
    ] } : { label: 'Xmind 文件', run: () => void exportWorkbook(false) },
    ...[...branchFormats, ['txt', '纯文本'] as const].map(([format, label]) => ({
      label, run: () => { void exportDocument(format) },
    })),
  ]
  const hasEquation = !!node && !!readEquation(node.getData('ymdEquation'))
  const imageItems: MenuItem[] = node?.getData('image') && engine.current ? [
    ...(hasEquation ? [{ label: '编辑公式', icon: <SquareFunction size={16} />, run: () => setEquationNode(node) }] : []),
    { label: hasEquation ? '公式位置' : '图片位置', children: imagePlacements.map(([value, label]) => ({
      label, selected: (node.getData('imgPlacement') ?? 'top') === value,
      run: () => { if (engine.current) placeTopicImage(engine.current, node, value) },
    })) },
    { label: '重置大小', run: () => {
      if (engine.current) void resetTopicImage(engine.current, node).catch(() => setNotice('无法读取图片的原始尺寸。'))
    } },
    { label: hasEquation ? '删除公式' : '删除图片', icon: <Trash2 size={16} />, run: () => { if (engine.current) removeTopicImage(engine.current, node) } },
  ] : []
  const linkItems: MenuItem[] = node && typeof currentLink === 'string' && currentLink ? [
    { label: '打开链接', run: () => openHyperlink(currentLink) },
    { label: '编辑链接', disabled: !canLink, run: () => editLink(mapLinkType(currentLink)) },
    { label: '移除链接', icon: <Trash2 size={16} />, disabled: !canLink, run: () => setNodeLink(node, '') },
  ] : []
  const backlinkItems: MenuItem[] = backlinks.map(({ label, target }) => ({
    label, run: () => { void followLinkWithNotice(target, '反向链接的来源已删除，或无法定位。') },
  }))
  const branchTarget = node && selected.length === 1 && !node.isGeneralization && (!node.isRoot || branch)
  const contextItems: MenuItem[] = contextCallout && menuCallout ? [
    { label: '编辑标注', run: () => editCallout(contextCallout) },
    { label: '标注格式', run: () => { setArtOpen(false); setFormatOpen(true) } },
    { label: '链接', children: [
      ...linkTypes.map(kind => ({ label: linkLabels[kind],
        run: () => setLinkEditor({ node: menuCallout.owner, kind, callout: contextCallout }) })),
      ...(menuCallout.note.data.hyperlink ? [{ label: '移除链接', run: () => changeCallout(contextCallout, { hyperlink: '' }) }] : []),
    ] },
    { label: '附件', icon: <Paperclip size={16} />, run: () => chooseResource(false, contextCallout) },
    ...(menuCallout.note.data.attachmentUrl ? [{ label: '移除附件',
      run: () => changeCallout(contextCallout, { attachmentUrl: '', attachmentName: '' }) }] : []),
    ...(backlinks.length ? [{ label: '反向链接', children: backlinkItems }] : []),
    { label: '恢复位置', run: () => changeCallout(contextCallout, { calloutX: null, calloutY: null }) },
    { label: '删除标注', icon: <Trash2 size={16} />, separator: true, run: () => removeCallout(contextCallout) },
  ] : typeof menu === 'object' && menu.image && imageItems.length ? imageItems
    : typeof menu === 'object' && menu.link && linkItems.length ? linkItems : audioNote ? [
    { label: '另存录音…', icon: <Download size={16} />, run: () => saveAudioToFile(audioNote) },
    { label: '删除录音', icon: <Trash2 size={16} />, run: () => command('REMOVE_NODE') },
  ] : [
    ...(typeof menu === 'object' && menu.facet ? (menu.facet.group === '任务状态' ? taskStatusFacets : [menu.facet]).map(facet => ({
      label: facet.group === '任务状态' ? '高亮' + facet.label + '任务' : '高亮相关主题',
      icon: <Search size={16} />, run: () => openNavigation(facet.id),
    })) : []),
    { label: '添加同级主题', shortcut: 'Enter', run: () => add(true) },
    { label: '添加子主题', shortcut: 'Tab', run: () => add(false) },
    { label: '收起子主题', run: () => { if (node) command('SET_NODE_EXPAND', node, false) } },
    { label: '展开子主题', run: () => { if (node) command('SET_NODE_EXPAND', node, true) } },
    { label: '折叠级别', children: [
      { label: '全部展开', run: () => foldBranches(Infinity, 'EXPAND_ALL') },
      { label: '全部收起', run: () => foldBranches(1, 'UNEXPAND_ALL') },
      ...[1, 2, 3, 4].map(level => ({ label: '展开至第 ' + level + ' 层', run: () => foldBranches(level, 'UNEXPAND_TO_LEVEL', level) })),
    ] },
    ...(branchTarget && node ? [
      ...(!node.isRoot ? [{ label: '仅显示分支', icon: <Focus size={16} />, shortcut: branch ? undefined : branchShortcut, run: () => changeBranch(node.uid) }] : []),
      ...(branch ? [{ label: '显示全部内容', shortcut: branchShortcut, run: () => changeBranch() }] : []),
      { label: '导出分支为', icon: <Download size={16} />, children: branchFormats.map(([format, label]) => ({
        label, run: () => void exportDocument(format, node.uid),
      })) },
      { label: '打印分支…', run: () => void exportDocument('print', node.uid) },
    ] : []),
    { label: '插入', separator: true, children: insertItems },
    taskItem, todoItem,
    ...(imageItems.length ? [{ label: hasEquation ? '公式' : '图片', children: imageItems }] : []),
    ...(linkItems.length ? [{ label: '链接', children: linkItems }] : []),
    ...(backlinks.length ? [{ label: '反向链接', children: backlinkItems }] : []),
    { label: '删除主题', icon: <Trash2 size={16} />, disabled: !canRemove, run: () => command('REMOVE_NODE') },
  ]
  const taskTree = taskTopic ? engine.current?.getData() : undefined
  const taskSource = taskTree && taskTopic ? findTopic(taskTree, taskTopic) : undefined
  const initialTask = readTask(taskSource?.data.ymdTask)
  const closeMenu = () => setMenu(undefined)

  return <div className="map-editor xmind-workspace" data-zen={zen} data-zen-tone={zen ? zenDark ? 'dark' : 'light' : undefined}
    data-shot-open={shotOpen || undefined} data-glass={settings.background === 'transparent' && !zen || undefined}>
    {!zen && <div className="map-toolbar" aria-label="思维导图工具栏" ref={element => { element?.toggleAttribute('inert', shotOpen) }}>
      <div className="map-toolbar-group">
        <button className="icon-button" title="撤销" aria-label="撤销" onClick={() => command('BACK')}><Undo2 size={17} /></button>
        <button className="icon-button" title="重做" aria-label="重做" onClick={() => command('FORWARD')}><Redo2 size={17} /></button>
      </div>
      <div className="map-toolbar-group">
        <button className="tool-button" onClick={() => add(true)}><Plus size={16} />主题</button>
        <button className="tool-button" disabled={!!audioNote} onClick={() => add(false)}><GitBranch size={16} />子主题</button>
        <div className="menu-anchor">
          <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? undefined : 'insert')}><Plus size={16} />插入</button>
          {menu === 'insert' && <MarkdownMenu items={insertItems} close={closeMenu} />}
        </div>
        <button className="icon-button" aria-label={activeCallout ? '删除标注' : '删除主题'} disabled={!activeCallout && !canRemove}
          onClick={() => activeCallout && selectedCallout ? removeCallout(selectedCallout) : command('REMOVE_NODE')}><Trash2 size={16} /></button>
      </div>
      <div className="map-toolbar-group map-toolbar-trailing">
        <div className="menu-anchor map-pitch-trigger">
          <button type="button" className="icon-button" aria-label="开始演示"
            title={pitchKey ? '开始演示 (' + shortcutLabel(pitchKey, platform) + ')' : '开始演示'}
            onClick={() => openPitch('fullscreen')}><Presentation size={17} /></button>
          <button type="button" className="icon-button map-pitch-more" aria-label="演示选项" aria-haspopup="menu"
            aria-expanded={menu === 'pitch'} onClick={() => setMenu(menu === 'pitch' ? undefined : 'pitch')}><ChevronDown size={13} /></button>
          {menu === 'pitch' && <MarkdownMenu close={closeMenu} items={[
            { label: '在窗口中播放', run: () => openPitch('window') },
            { label: '演讲者视图', run: () => openPitch('presenter') },
            { label: '从当前主题播放', disabled: !node || !!node.isGeneralization, run: () => openPitch('fullscreen', node?.uid) },
            { label: '演示格式', separator: true, run: () => { setNavigation(undefined); setArtOpen(false); setPitchPanel(!pitchPanel) } },
          ]} />}
        </div>
        <button ref={artTrigger} className="icon-button" title="贴纸" aria-label="贴纸" aria-expanded={artOpen}
          onClick={toggleArt}><Sticker size={17} /></button>
        <button ref={navigationTrigger} className="icon-button" title="查找主题" aria-label="查找主题" aria-expanded={searchOpen}
          onClick={() => searchOpen ? closeNavigation() : openNavigation()}><Search size={17} /></button>
        <button ref={shotTrigger} className="icon-button" aria-label="导图截图"
          title={shotShortcut ? '导图截图 (' + shotShortcut + ')' : '导图截图'} onClick={openShot}><Camera size={17} /></button>
        <div className="menu-anchor">
          <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'export'} onClick={() => setMenu(menu === 'export' ? undefined : 'export')}><Download size={16} />导出</button>
          {menu === 'export' && <MarkdownMenu items={exportItems} close={closeMenu} />}
        </div>
        <button ref={zenTrigger} className="icon-button" title="专注模式" aria-label="专注模式" onClick={() => toggleZen(true)}><Focus size={17} /></button>
        <button className="tool-button" aria-pressed={formatOpen && !artOpen && !searchOpen && !pitchPanel} onClick={toggleFormat}>
          <SlidersHorizontal size={16} />格式</button>
      </div>
    </div>}
    <input ref={resourceInput} type="file" hidden onChange={event => attach(event.target.files?.[0])} />
    <div className="map-view">
    <div className="map-body" style={{ '--map-user-width': panelWidth === undefined ? undefined : panelWidth + 'px' } as CSSProperties}>
      <div className="map-stage">
        <div className="map-canvas" ref={host} tabIndex={0} aria-label="思维导图画布"
          onPointerDown={event => {
            if (event.target instanceof Element &&
                (event.target instanceof SVGElement || event.target.closest('.smm-node')) &&
                !event.target.closest('button, input, textarea, [contenteditable]')) event.currentTarget.focus()
          }}
          onContextMenu={event => event.preventDefault()} />
        {branch && <button className="tool-button map-restore-branch" onClick={() => changeBranch()} title={branchShortcut}>
          <CornerUpLeft size={15} />显示全部内容
        </button>}
        {zen && <MindMapZenTools platform={platform} overrides={keyOverrides} tool={zenTool}
          onTool={setZenTool} appearance={zenAppearance ?? (dark ? 'dark' : 'light')}
          onAppearance={value => { setZenAppearance(value); setZenTool(undefined) }}
          artOpen={artOpen} formatOpen={formatOpen && !artOpen && !searchOpen}
          onArt={toggleArt} onFormat={toggleFormat}
          exit={() => toggleZen(false)} />}
        {linking && <div className="map-action-status" role="status">选择关联线的目标主题 <kbd>Esc 取消</kbd></div>}
        {notice && <div className="map-action-status" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
        {overview && <div ref={overviewElement} className="map-minimap" data-position={overviewPreferences.position} aria-label="导图概览">
          <svg aria-hidden="true" /><i />
        </div>}
        <div className="map-status" role="group" aria-label="画布视图" ref={element => { element?.toggleAttribute('inert', shotOpen) }}>
          {!!backlinks.length && <div className="menu-anchor">
            <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'backlinks'}
              onClick={() => setMenu(menu === 'backlinks' ? undefined : 'backlinks')}><CornerUpLeft size={15} />反向链接</button>
            {menu === 'backlinks' && <MarkdownMenu items={backlinkItems} close={closeMenu} upward />}
          </div>}
          <button className="icon-button" aria-label="导图概览" aria-pressed={overview} onClick={() => setOverview(!overview)}><MapIcon size={16} /></button>
          <button className="icon-button" aria-label="回到中心主题" title="回到中心主题" onClick={() => {
            const root = engine.current?.renderer.root
            if (root) command('GO_TARGET_NODE', root.uid)
          }}><Crosshair size={16} /></button>
          <button className="icon-button" aria-label="适合窗口" title="适合窗口" onClick={() => engine.current?.view.fit()}><Maximize size={15} /></button>
          <button className="icon-button" aria-label="缩小" onClick={() => engine.current?.view.narrow()}><Minus size={16} /></button>
          <button className="tool-button" title="恢复为 100%" aria-label="恢复为 100%" onClick={() => engine.current?.view.reset()}>{zoom}%</button>
          <button className="icon-button" aria-label="放大" onClick={() => engine.current?.view.enlarge()}><Plus size={16} /></button>
        </div>
        {shotOpen && <MindMapShot title={sheet?.title ?? mapTitle(name)} close={closeShot} />}
      </div>
      {(navigation || artOpen || pitchPanel || formatOpen) && <div className="map-side">
      <PaneResize pane="map" side="right" apply={resizePanel} />
      {navigation && <MindMapNavigation key={navigation.key} topics={topics} initialFacet={navigation.facet}
        titleMatches={titleMatches} currentTopic={selected.length === 1 ? selected[0].getData().uid : undefined}
        search={engine.current?.search} count={matches} close={closeNavigation} highlight={highlight}
        locate={id => command('GO_TARGET_NODE', id)} focusRequest={find} replaceTopics={replaceTopics} />}
      {artOpen && <MindMapArt directory={stickerDirectory}
        target={topicAcceptsArt(node) ? String(node?.getData('text') || '未命名主题') : undefined}
        apply={art => { if (engine.current && node) applyArt(engine.current, node, art) }}
        close={() => { setArtOpen(false); (artTrigger.current ?? host.current)?.focus() }} />}
      {pitchPanel && <MindMapPitchFormat options={readPitchOptions(settings.pitch)} topic={pitchTopic} root={!!pitchNode?.isRoot}
        change={patch => changeSettings({ pitch: { ...readPitchOptions(currentSettings.current.pitch), ...patch } })}
        changeTopic={changePitchTopic} close={() => { setPitchPanel(false); host.current?.focus() }} />}
      {!artOpen && !searchOpen && !pitchPanel && formatOpen && (activeCallout && selectedCallout ? <MindMapCalloutFormat
        key={selectedCallout.id} note={activeCallout.note} close={() => setFormatOpen(false)}
        edit={() => editCallout(selectedCallout)} change={patch => changeCallout(selectedCallout, patch)} />
        : <MindMapFormat {...{ tab, settings, node, selected, version }} dark={zen ? zenDark : dark} branchDepth={branch?.depth}
        change={changeSettings} onTab={setTab} editNumbering={updateNumbering}
        structure={value => {
          if (node && branchStructure(node.getData('ymdStructure')) !== value) {
            const map = engine.current
            const { left, top } = node
            command('SET_NODE_DATA', node, { ymdStructure: value ?? null })
            map?.render(() => {
              if (engine.current !== map || !map.renderer.activeNodeList.includes(node)) return
              const scale = map.view.scale
              map.view.translateXY((left - node.left) * scale, (top - node.top) * scale)
            })
          }
        }}
        close={() => setFormatOpen(false)} style={(key, value) => {
          if (node) {
            if (key === 'reset') command('REMOVE_CUSTOM_STYLES', node)
            else command('SET_NODE_STYLE', node, key, value)
          }
        }} />)}
      </div>}
    </div>
    </div>
    {remainder && !zen && !branch && <DocumentRemainder text={remainder} className="map-remainder"
      links={remainderLinks} visible={remainderVisible} onToggle={setRemainderVisible} {...{ path, remoteImages }} />}
    {typeof menu === 'object' && <MarkdownMenu items={contextItems} close={closeMenu} point={menu} nativeStyle />}
    {equationNode && <MindMapEquation initial={readEquation(equationNode.getData('ymdEquation'))}
      hasImage={!!equationNode.getData('image')} close={closeEquation} save={saveEquation} />}
    {audioParent && <MindMapRecorder title={String(audioParent.getData('text') ?? '')}
      close={() => setAudioParent(undefined)} save={(audio, duration) => addRecordedAudio(audioParent, audio, duration)} />}
    {taskTopic && taskSource && <MindMapTask initial={initialTask} notice={notice}
      title={taskSource.data.text ?? ''} topics={taskTopics(taskTree, taskTopic)}
      close={() => openTask()} save={task => {
        const target = engine.current?.renderer.findNodeByUid(taskTopic)
        if (target) writeTask(target, task, null)
        setTaskTopic(undefined)
      }} />}
    {calloutText && <MindMapCalloutText initial={calloutText.note.data.text} add={calloutText.add}
      close={() => setCalloutText(undefined)} save={saveCalloutText} />}
    {linkEditor && <MindMapLink
      initial={String((linkEditor.callout ? dialogCallout?.note.data.hyperlink : linkEditor.node.getData('hyperlink')) ?? '')} kind={linkEditor.kind}
      current={sheetId} source={linkEditor.callout ? calloutTopicId(linkEditor.callout.owner, linkEditor.callout.id) : linkEditor.node.uid}
      currentPath={path} documents={linkDocuments} readDocument={readMapDocument}
      sheets={linkEditor.kind === 'topic' ? availableLinkSheets() : []}
      close={() => setLinkEditor(undefined)} save={value => {
        if (linkEditor.callout) changeCallout(linkEditor.callout, { hyperlink: value })
        else setNodeLink(linkEditor.node, value)
        setLinkEditor(undefined)
      }} />}
    <dialog ref={fieldDialog} onCancel={event => { event.preventDefault(); setField(undefined) }}>
      {field && <form onSubmit={event => {
        event.preventDefault()
        if (field.key === '备注') command('SET_NODE_NOTE', field.node, field.value)
        if (field.key === '标签') command('SET_NODE_TAG', field.node, field.value.split(/[,，]/).map(value => value.trim()).filter(Boolean))
        setField(undefined)
      }}>
        <h2>{field.key}</h2>
        <label>{field.key}
          {field.key === '备注'
            ? <textarea value={field.value} autoFocus onChange={event => setField({ ...field, value: event.target.value })} />
            : <input type="text" placeholder="用逗号分隔标签"
                value={field.value} autoFocus onChange={event => setField({ ...field, value: event.target.value })} />}
        </label>
        <footer><button type="button" onClick={() => setField(undefined)}>取消</button><button type="submit" className="primary">保存</button></footer>
      </form>}
    </dialog>
  </div>
}
