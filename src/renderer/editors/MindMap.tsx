import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarRange, ChevronDown, ChevronsLeft, ClipboardList, CornerUpLeft, Crosshair, Download, Focus, FolderInput, GitBranch, GitFork, ImagePlus, ListTree, Map as MapIcon, Maximize, MessageSquare, Mic, Minus, Paperclip, Plus, Redo2, Search, SlidersHorizontal, Square, SquareCheck, Star, Sticker, StickyNote, Tag, Trash2, Undo2, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import MindMap from 'simple-mind-map'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import ExportPDF from 'simple-mind-map/src/plugins/ExportPDF.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import MiniMap from 'simple-mind-map/src/plugins/MiniMap.js'
import NodeImgAdjust from 'simple-mind-map/src/plugins/NodeImgAdjust.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import RainbowLines from 'simple-mind-map/src/plugins/RainbowLines.js'
import SearchPlugin from 'simple-mind-map/src/plugins/Search.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import { UnsupportedList } from './Outline'
import { projectList, writeList, type Block } from './listProjection'
import type { DocumentFile, Entry } from '../../shared/contracts'
import { MindMapFormat } from './MindMapFormat'
import { MindMapTask, taskBadge, taskTopics, todoBadge } from './MindMapTask'
import { MindMapGantt } from './MindMapGantt'
import { MindMapWorkCalendar } from './MindMapWorkCalendar'
import { calendarSchedule, editWorkDates, orderSchedule, scheduledTopics } from './mapSchedule'
import { calendarDays, readWorkCalendar, type WorkCalendar } from './workCalendar'
import { readTask, readTodo, type MapTask, type MapTodo } from './mapTasks'
import { MindMapRecorder } from './MindMapRecorder'
import { MindMapArt } from './MindMapArt'
import { MindMapLink, type LinkSheet } from './MindMapLink'
import { readLocalMapUrl } from '../../shared/localMapLinks'
import { inputChord, ShortcutSequence, shortcutsFor, type ShortcutOverrides } from '../../shared/shortcuts'
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

class MapAssociativeLine extends AssociativeLine {
  protected checkOverlapNode(x: number, y: number) {
    // The library queues overlap checks that can run after the line is completed or canceled.
    if (this.isCreatingLine && this.creatingStartNode) super.checkOverlapNode(x, y)
  }

  cancelCreateLine() {
    if (this.isCreatingLine) super.cancelCreateLine()
  }
}

for (const plugin of [MapAssociativeLine, Drag, Export, ExportPDF, KeyboardNavigation, MiniMap, NodeImgAdjust, OuterFrame, RainbowLines, SearchPlugin, Select]) MindMap.usePlugin(plugin)
MindMap.extendNodeDataNoStylePropList(['ymdMarker', 'ymdFloating', 'ymdTask', 'ymdTodo', 'ymdStructure', 'ymdAudio', 'ymdOriginalImageSize', 'ymdCallouts', 'ymdWorkCalendar'])

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
  const marker = branches.find(node => /^[-+*]$/.test(String(node.data.ymdMarker)))?.data.ymdMarker ?? '-'
  return branches.map((node, index) => ({
    id: node.data.uid ?? String(index), text: imported ? encodeImportedTopic(node.data.text ?? '') : node.data.text ?? '', marker: String(marker),
    children: fromMap(node.children ?? [], imported),
  }))
}

function hasAudio(tree: MapData, id: string): boolean {
  return readAudioNote(tree.data.ymdAudio)?.id === id || !!tree.children?.some(child => hasAudio(child, id))
}

interface MapEditorProps {
  text: string; name: string; path: string; dark: boolean; onChange: (text: string) => void
  platform: string; keyOverrides: ShortcutOverrides
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

function MapCanvas({ text, name, path, dark, platform, keyOverrides, onChange, registerFlush, sheet, updateSheet, multipleSheets, saveXmind, createSheet,
  linkWorkbook, jump, followTopicLink, readMapDocument, linkDocuments }: MapEditorProps & {
  sheet?: MapSheet
  updateSheet: (id: string, settings: MapSettings, tree: MapData) => void
  multipleSheets: boolean
  saveXmind: (all: boolean, tree: MapData, settings: MapSettings) => Promise<void>
  createSheet: (title: string, settings: MapSettings, tree: MapData, copy?: { source: string; wholeSheet: boolean }) => void
  linkWorkbook: (tree: MapData) => Pick<MapSheet, 'id' | 'title' | 'tree'>[]
  jump?: TopicLink
  followTopicLink: (link: TopicLink) => boolean | Promise<boolean>
}) {
  const [projection] = useState(() => projectList(text))
  const [appearance] = useState(() => loadMapAppearance(path))
  const [initialSheet] = useState(sheet)
  const [settings, setSettings] = useState(sheet?.settings ?? appearance.settings)
  const [selected, setSelected] = useState<MapNode[]>([])
  const [formatOpen, setFormatOpen] = useState(true)
  const [tab, setTab] = useState<'map' | 'topic'>('map')
  const [zoom, setZoom] = useState(100)
  const [version, setVersion] = useState(0)
  const [zen, setZen] = useState(false)
  const [linking, setLinking] = useState(false)
  const [menu, setMenu] = useState<'export' | 'insert' | 'backlinks' | { x: number; y: number; image?: boolean; link?: boolean; callout?: CalloutTarget }>()
  const [artOpen, setArtOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [overview, setOverview] = useState(false)
  const [miniMap, setMiniMap] = useState<{ markup: string; viewport: Record<string, string> }>()
  const [matches, setMatches] = useState({ total: 0, currentIndex: -1 })
  const [field, setField] = useState<{ key: TopicField; node: MapNode; value: string }>()
  const [linkEditor, setLinkEditor] = useState<{ node: MapNode; kind: LinkType; callout?: CalloutTarget }>()
  const [selectedCallout, setSelectedCallout] = useState<CalloutTarget>()
  const [calloutText, setCalloutText] = useState<{ target: CalloutTarget; note: Callout; add: boolean }>()
  const [taskTopic, setTaskTopic] = useState<string>()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendar, setCalendar] = useState(() => readWorkCalendar(sheet?.tree.data.ymdWorkCalendar ??
    (!sheet ? appearance.styles.find(style => style.address === 'root')?.data.ymdWorkCalendar : undefined)))
  const [gantt, setGantt] = useState(false)
  const [audioParent, setAudioParent] = useState<MapNode>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const artTrigger = useRef<HTMLButtonElement>(null)
  const ganttTrigger = useRef<HTMLButtonElement>(null)
  const resourceInput = useRef<HTMLInputElement>(null)
  const resourceTarget = useRef<{ node: MapNode; image: boolean; callout?: CalloutTarget } | undefined>(undefined)
  const engine = useRef<MindMap | undefined>(undefined)
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

  const backlinkTopic = selectedCallout ? calloutTopicId(selectedCallout.owner, selectedCallout.id)
    : selected.length === 1 ? selected[0].uid : undefined
  const externalBacklinks = useMemo(() => backlinkTopic ? documentBacklinks(path, { sheet: sheetId, topic: backlinkTopic }) : [],
    [path, sheetId, backlinkTopic])
  const backlinks = useMemo(() => {
    const map = engine.current
    if (!map || !backlinkTopic) return []
    return [...listBacklinks(linkWorkbook(map.getData()), { sheet: sheetId, topic: backlinkTopic }), ...externalBacklinks]
  }, [backlinkTopic, externalBacklinks, linkWorkbook, sheetId, version])

  const ganttRows = useMemo(() => gantt ? scheduledTopics(engine.current?.getData()) : [], [gantt, version])
  const days = useMemo(() => calendarDays(calendar), [calendar])

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

  function updateTasks(edits: Map<string, MapTask | null>, schedule: boolean) {
    const map = engine.current
    if (!map) return false
    const tree = map.getData()
    const rows = scheduledTopics(tree)
    const replacements = schedule ? orderSchedule(rows, new Map([...edits].flatMap(([id, task]) => task ? [[id, task] as const] : [])), days) : edits
    return commitTaskChanges(tree, replacements, edits)
  }

  function commitTaskChanges(tree: MapData, replacements: Map<string, MapTask | null> | 'cycle' | 'dates', direct?: Map<string, MapTask | null>) {
    if (replacements === 'cycle' || replacements === 'dates') {
      setNotice(replacements === 'cycle' ? '这些任务的依赖形成了循环。请先移除其中一条依赖。' : '当前规则下没有可用日期。请检查工作日和任务依赖。')
      return false
    }
    const map = engine.current
    if (!map) return false
    const updates = replacements
    function write(node: MapData) {
      const id = node.data.uid
      if (id && updates.has(id)) {
        node.data.ymdTask = updates.get(id)
        if (direct?.has(id)) node.data.ymdTodo = null
      }
      node.children?.forEach(write)
    }
    write(tree)
    map.command.originAddHistory()
    map.updateData(tree)
    map.command.originAddHistory()
    setNotice('')
    return true
  }

  function saveCalendar(next: WorkCalendar) {
    const tree = engine.current?.getData()
    if (!tree) return false
    if (JSON.stringify(next) === JSON.stringify(calendar)) return true
    const replacements = next.enabled || calendar?.enabled
      ? calendarSchedule(scheduledTopics(tree), days, calendarDays(next)) : new Map<string, MapTask>()
    tree.data.ymdWorkCalendar = next
    return commitTaskChanges(tree, replacements)
  }

  function openCalendar() {
    setNotice('')
    setCalendarOpen(true)
  }

  function toggleGantt(visible: boolean) {
    if (visible) {
      engine.current?.renderer.textEdit.hideEditTextBox()
      engine.current?.associativeLine.cancelCreateLine()
      setLinking(false)
      setMenu(undefined)
    }
    setGantt(visible)
    if (!visible) ganttTrigger.current?.focus()
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
    if ((!projection && !initialSheet) || !host.current) return
    const root: MapData = initialSheet ? structuredClone(initialSheet.tree)
      : mainMap(name, projection!.blocks, appearance)
    const initialSettings = initialSheet?.settings ?? appearance.settings
    let previous = projection ? writeList(projection, projection.blocks) : ''
    const audio = createAudioPlayer(host.current, setNotice)
    let map: MindMap
    try {
      map = new MindMap({
        el: host.current, data: root, theme: 'default', fit: !!appearance.imported,
        layout: initialSettings.layout, themeConfig: mapTheme(initialSettings, dark),
        rainbowLinesConfig: { open: initialSettings.colored, colorsList: palettes[initialSettings.palette].colors },
        customHyperlinkJump: openHyperlink,
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
        beforeTextEdit: node => !readAudioNote(node.getData('ymdAudio')) && (!!initialSheet || !!appearance.imported || !node.isRoot),
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
    const removeBranchLayouts = installBranchLayouts(map)
    const removeImageGestures = installTopicImageGestures(map, host.current)
    const onData = (node: MapData) => {
      setCalendar(readWorkCalendar(node.data.ymdWorkCalendar))
      const audioId = audio.activeId
      if (audioId && !hasAudio(node, audioId)) audio.stop()
      if (!initialSheet && projection) {
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
      setTab(nodes.length ? 'topic' : 'map')
    }
    const context = (event: MouseEvent, node: MapNode) => {
      event.preventDefault()
      setSelectedCallout(undefined)
      select(node, map.renderer.activeNodeList)
      setMenu({ x: event.clientX, y: event.clientY, image: isTopicImage(event.target),
        link: event.target instanceof Element && !!event.target.closest('a') && !!node.getData('hyperlink') })
    }
    const scale = (value: number) => setZoom(Math.round(value * 100))
    const syncLinkMode = () => setLinking(map.associativeLine.isCreatingLine)
    const clearCalloutSelection = () => { setSelectedCallout(undefined); syncLinkMode() }
    const searchInfo = (info: typeof matches) => setMatches(info)
    const download = (node: MapNode) => downloadAttachment(node.getData('attachmentUrl'), node.getData('attachmentName'))
    map.on('data_change', onData)
    map.on('afterExecCommand', sync)
    map.on('node_active', select)
    map.on('node_contextmenu', context)
    map.on('node_click', clearCalloutSelection)
    map.on('draw_click', clearCalloutSelection)
    map.on('contextmenu', syncLinkMode)
    map.on('scale', scale)
    map.on('search_info_change', searchInfo)
    map.on('node_attachmentClick', download)
    registerFlush(flush)
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(host.current)
    return () => {
      resize.disconnect()
      audio.stop()
      callouts.dispose()
      calloutLayer.current = undefined
      removeImageGestures()
      removeBranchLayouts()
      registerFlush()
      map.off('afterExecCommand', sync)
      map.off('data_change', onData)
      map.off('node_active', select)
      map.off('node_contextmenu', context)
      map.off('node_click', clearCalloutSelection)
      map.off('draw_click', clearCalloutSelection)
      map.off('contextmenu', syncLinkMode)
      map.off('scale', scale)
      map.off('search_info_change', searchInfo)
      map.off('node_attachmentClick', download)
      map.associativeLine.cancelCreateLine()
      map.destroy()
      engine.current = undefined
    }
  }, [name, path, projection, registerFlush, appearance, initialSheet])

  useEffect(() => { calloutLayer.current?.select(selectedCallout) }, [selectedCallout])

  useEffect(() => {
    const map = engine.current
    if (!jump || !map) return
    let canceled = false
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
  }, [jump])

  useEffect(() => {
    const map = engine.current
    if (!map) return
    const palette = palettes[settings.palette]
    map.updateConfig({ rainbowLinesConfig: { open: settings.colored, colorsList: palette.colors } })
    map.setThemeConfig(mapTheme(settings, dark))
    setZoom(Math.round(map.view.scale * 100))
  }, [dark, settings])
  useEffect(() => {
    if (field) fieldDialog.current?.showModal()
    else if (fieldDialog.current?.open) fieldDialog.current.close()
  }, [field?.key, field?.node])
  useEffect(() => {
    if (!searchOpen) return
    const map = engine.current
    if (query.trim()) map?.search.search(query.trim())
    else map?.search.endSearch()
  }, [searchOpen, query])

  useEffect(() => {
    if (!gantt && !zen && !linking && !searchOpen && !formatOpen && !artOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || calendarOpen || field || linkEditor || taskTopic || audioParent || calloutText ||
          event.target instanceof HTMLElement && event.target.closest('.smm-node-edit-wrap, .document-menu')) return
      if (gantt) { event.preventDefault(); toggleGantt(false) }
      else if (linking) { engine.current?.associativeLine.cancelCreateLine(); setLinking(false) }
      else if (searchOpen) { setQuery(''); setReplace(''); setSearchOpen(false); engine.current?.search.endSearch() }
      else if (artOpen) {
        event.preventDefault()
        setArtOpen(false)
        artTrigger.current?.focus()
      }
      else if (zen) setZen(false)
      else setFormatOpen(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [gantt, zen, linking, searchOpen, formatOpen, artOpen, calendarOpen, field, linkEditor, taskTopic, audioParent, calloutText])

  useEffect(() => {
    const current = selectedCallout && readCallout(selectedCallout)
    const source = current?.owner ?? (selected.length === 1 ? selected[0] : undefined)
    if (gantt || !source || source.isGeneralization || readAudioNote(source.getData('ymdAudio')) || linkEditor || field || taskTopic || audioParent || calloutText) return
    const bindings = shortcutsFor('map', keyOverrides, platform)
    const sequence = new ShortcutSequence()
    const editLink = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          !(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable], dialog, .document-menu') ||
          (event.target !== document.body && !host.current?.contains(event.target))) return
      if (event.key === 'Escape') { sequence.reset(); return }
      const chord = inputChord({ key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey }, platform)
      const match = chord && sequence.take(chord, bindings, event.repeat)
      if (!match) return
      event.preventDefault()
      event.stopPropagation()
      if (match === 'pending') return
      const href = current ? current.note.data.hyperlink : source.getData('hyperlink')
      setLinkEditor({ node: source, callout: current ? selectedCallout : undefined, kind: mapLinkType(href) })
    }
    window.addEventListener('keydown', editLink, true)
    return () => window.removeEventListener('keydown', editLink, true)
  }, [gantt, selected, selectedCallout, linkEditor, field, taskTopic, audioParent, calloutText, keyOverrides, platform])

  useEffect(() => {
    const map = engine.current
    if (!overview || !map) return
    let pending = 0
    const update = () => {
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => {
        try {
          const { svgHTML, viewBoxStyle } = map.miniMap.calculationMiniMap(160, 100)
          const markup = DOMPurify.sanitize(svgHTML, {
            USE_PROFILES: { svg: true },
            FORBID_TAGS: ['a', 'foreignObject', 'image', 'style'],
          })
          setMiniMap({ markup, viewport: viewBoxStyle })
        } catch {}
      })
    }
    map.on('node_tree_render_end', update)
    map.on('view_data_change', update)
    update()
    return () => {
      cancelAnimationFrame(pending)
      map.off('node_tree_render_end', update)
      map.off('view_data_change', update)
    }
  }, [overview])

  if (!projection && !initialSheet) return <UnsupportedList />
  if (error) return <div className="editor-empty"><h2>无法加载思维导图</h2><p>{error}</p></div>

  function changeSettings(patch: Partial<MapSettings>) {
    const next = { ...currentSettings.current, ...patch }
    currentSettings.current = next
    setSettings(next)
    const map = engine.current
    if (!map) return
    if (patch.layout && patch.layout !== settings.layout) map.setLayout(patch.layout)
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
    { label: '图片', icon: <ImagePlus size={16} />, disabled: !node, run: () => chooseResource(true) },
    { label: '贴纸与插图', icon: <Sticker size={16} />, run: () => setArtOpen(true) },
    { label: '附件', icon: <Paperclip size={16} />, disabled: !node, run: () => chooseResource(false) },
    { label: '标记', icon: <Star size={16} />, disabled: !node, children: [
      ...[1, 2, 3, 4, 5].map(level => ({ label: '优先级 ' + level, run: () => command('SET_NODE_ICON', node, ['priority_' + level]) })),
      { label: '已完成', run: () => command('SET_NODE_ICON', node, ['progress_8']) },
      { label: '移除标记', run: () => command('SET_NODE_ICON', node, []) },
      { label: '贴纸与插图', separator: true, run: () => setArtOpen(true) },
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

  async function exportDocument(format: string) {
    const map = engine.current
    if (!map || exporting.current) return
    exporting.current = true
    const callouts = calloutLayer.current
    try {
      callouts?.controls(false)
      await map.export(format, true, sheet?.title ?? mapTitle(name))
    } catch { setNotice('导出失败。') }
    finally { callouts?.controls(true); exporting.current = false }
  }

  const exportItems: MenuItem[] = [
    multipleSheets ? { label: 'Xmind 文件', children: [
      { label: '全部画布', run: () => void exportWorkbook(true) },
      { label: '当前画布', run: () => void exportWorkbook(false) },
    ] } : { label: 'Xmind 文件', run: () => void exportWorkbook(false) },
    ...[['png', 'PNG 图片'], ['svg', 'SVG 矢量图'], ['pdf', 'PDF'], ['md', 'Markdown'], ['txt', '纯文本']].map(([format, label]) => ({
      label, run: () => { void exportDocument(format) },
    })),
  ]
  const imageItems: MenuItem[] = node?.getData('image') && engine.current ? [
    { label: '图片位置', children: imagePlacements.map(([value, label]) => ({
      label, selected: (node.getData('imgPlacement') ?? 'top') === value,
      run: () => { if (engine.current) placeTopicImage(engine.current, node, value) },
    })) },
    { label: '重置大小', run: () => {
      if (engine.current) void resetTopicImage(engine.current, node).catch(() => setNotice('无法读取图片的原始尺寸。'))
    } },
    { label: '删除图片', icon: <Trash2 size={16} />, run: () => { if (engine.current) removeTopicImage(engine.current, node) } },
  ] : []
  const linkItems: MenuItem[] = node && typeof currentLink === 'string' && currentLink ? [
    { label: '打开链接', run: () => openHyperlink(currentLink) },
    { label: '编辑链接', disabled: !canLink, run: () => editLink(mapLinkType(currentLink)) },
    { label: '移除链接', icon: <Trash2 size={16} />, disabled: !canLink, run: () => setNodeLink(node, '') },
  ] : []
  const backlinkItems: MenuItem[] = backlinks.map(({ label, target }) => ({
    label, run: () => { void followLinkWithNotice(target, '反向链接的来源已删除，或无法定位。') },
  }))
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
    { label: '添加同级主题', shortcut: 'Enter', run: () => add(true) },
    { label: '添加子主题', shortcut: 'Tab', run: () => add(false) },
    { label: '收起子主题', run: () => { if (node) command('SET_NODE_EXPAND', node, false) } },
    { label: '展开子主题', run: () => { if (node) command('SET_NODE_EXPAND', node, true) } },
    { label: '折叠级别', children: [
      { label: '全部展开', run: () => command('EXPAND_ALL') },
      { label: '全部收起', run: () => command('UNEXPAND_ALL') },
      ...[1, 2, 3, 4].map(level => ({ label: '展开至第 ' + level + ' 层', run: () => command('UNEXPAND_TO_LEVEL', level) })),
    ] },
    { label: '插入', separator: true, children: insertItems },
    taskItem, todoItem,
    ...(imageItems.length ? [{ label: '图片', children: imageItems }] : []),
    ...(linkItems.length ? [{ label: '链接', children: linkItems }] : []),
    ...(backlinks.length ? [{ label: '反向链接', children: backlinkItems }] : []),
    { label: '删除主题', icon: <Trash2 size={16} />, disabled: !canRemove, run: () => command('REMOVE_NODE') },
  ]
  const taskTree = taskTopic ? engine.current?.getData() : undefined
  const taskSource = taskTree && taskTopic ? findTopic(taskTree, taskTopic) : undefined
  const initialTask = readTask(taskSource?.data.ymdTask)
  const closeMenu = () => setMenu(undefined)
  const closeMapSearch = () => { setQuery(''); setReplace(''); setSearchOpen(false); engine.current?.search.endSearch() }

  return <div className="map-editor xmind-workspace" data-zen={zen}>
    {!zen && <div className="map-toolbar" aria-label="思维导图工具栏">
      <div className="map-toolbar-group">
        <button className="icon-button" title="撤销" aria-label="撤销" onClick={() => command('BACK')}><Undo2 size={17} /></button>
        <button className="icon-button" title="重做" aria-label="重做" onClick={() => command('FORWARD')}><Redo2 size={17} /></button>
      </div>
      {!gantt && <div className="map-toolbar-group">
        <button className="tool-button" onClick={() => add(true)}><Plus size={16} />主题</button>
        <button className="tool-button" disabled={!!audioNote} onClick={() => add(false)}><GitBranch size={16} />子主题</button>
        <div className="menu-anchor">
          <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? undefined : 'insert')}><Plus size={16} />插入</button>
          {menu === 'insert' && <MarkdownMenu items={insertItems} close={closeMenu} />}
        </div>
        <button className="icon-button" aria-label={activeCallout ? '删除标注' : '删除主题'} disabled={!activeCallout && !canRemove}
          onClick={() => activeCallout && selectedCallout ? removeCallout(selectedCallout) : command('REMOVE_NODE')}><Trash2 size={16} /></button>
      </div>}
      <div className="map-toolbar-group map-toolbar-trailing">
        <button ref={ganttTrigger} className="tool-button" aria-pressed={gantt} onClick={() => toggleGantt(!gantt)}>
          <CalendarRange size={16} />甘特图</button>
        {!gantt && <>
        <button ref={artTrigger} className="icon-button" title="贴纸与插图" aria-label="贴纸与插图" aria-expanded={artOpen}
          onClick={() => setArtOpen(!artOpen)}><Sticker size={17} /></button>
        <button className="icon-button" title="查找主题" aria-label="查找主题" aria-expanded={searchOpen}
          onClick={() => searchOpen ? closeMapSearch() : setSearchOpen(true)}><Search size={17} /></button>
        <div className="menu-anchor">
          <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'export'} onClick={() => setMenu(menu === 'export' ? undefined : 'export')}><Download size={16} />导出</button>
          {menu === 'export' && <MarkdownMenu items={exportItems} close={closeMenu} />}
        </div>
        <button className="icon-button" title="专注模式" aria-label="专注模式" onClick={() => setZen(true)}><Focus size={17} /></button>
        <button className="tool-button" aria-pressed={formatOpen && !artOpen} onClick={() => {
          if (artOpen) { setArtOpen(false); setFormatOpen(true) } else setFormatOpen(!formatOpen)
        }}><SlidersHorizontal size={16} />格式</button></>}
      </div>
    </div>}
    <input ref={resourceInput} type="file" hidden onChange={event => attach(event.target.files?.[0])} />
    <div className="map-view">
    {gantt && <MindMapGantt title={sheet?.title ?? mapTitle(name)} rows={ganttRows} edit={openTask} change={updateTasks} report={setNotice}
      days={days} skipClosed={calendar?.enabled === true} openCalendar={openCalendar}
      undo={() => command('BACK')} redo={() => command('FORWARD')} notice={notice} clearNotice={() => setNotice('')} />}
    <div className="map-body" data-show-gantt={gantt} aria-hidden={gantt || undefined}>
      <div className="map-stage">
        <div className="map-canvas" ref={host} tabIndex={0} aria-label="思维导图画布"
          onPointerDown={event => {
            if (event.target instanceof Element &&
                (event.target instanceof SVGElement || event.target.closest('.smm-node')) &&
                !event.target.closest('button, input, textarea, [contenteditable]')) event.currentTarget.focus()
          }}
          onContextMenu={event => event.preventDefault()} />
        {linking && <div className="map-action-status" role="status">选择关联线的目标主题 <kbd>Esc 取消</kbd></div>}
        {notice && <div className="map-action-status" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
        {searchOpen && <div className="map-search" role="search">
          <div><Search size={15} /><input aria-label="查找主题内容" placeholder="查找" autoFocus value={query}
            onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') engine.current?.search.searchNext() }} />
            <span>{matches.total ? matches.currentIndex + 1 : 0}/{matches.total}</span>
            <button className="icon-button" aria-label="关闭导图搜索" onClick={closeMapSearch}><X size={15} /></button></div>
          <div><input aria-label="替换主题内容" placeholder="替换为" value={replace} onChange={event => setReplace(event.target.value)} />
            <button className="tool-button" disabled={!matches.total} onClick={() => engine.current?.search.replace(replace, true)}>替换</button>
            <button className="tool-button" disabled={!matches.total} onClick={() => engine.current?.search.replaceAll(replace)}>全部</button></div>
        </div>}
        {overview && miniMap && <div className="map-minimap" aria-label="导图概览"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId)
            engine.current?.miniMap.onViewBoxMousedown(event)
          }}
          onPointerMove={event => engine.current?.miniMap.onViewBoxMousemove(event)}
          onPointerUp={() => engine.current?.miniMap.onMouseup()}
          onPointerCancel={() => engine.current?.miniMap.onMouseup()}>
          <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: miniMap.markup }} />
          <i style={miniMap.viewport} />
        </div>}
        <div className="map-status" role="group" aria-label="画布视图">
          {!!backlinks.length && <div className="menu-anchor">
            <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'backlinks'}
              onClick={() => setMenu(menu === 'backlinks' ? undefined : 'backlinks')}><CornerUpLeft size={15} />反向链接</button>
            {menu === 'backlinks' && <MarkdownMenu items={backlinkItems} close={closeMenu} upward />}
          </div>}
          {zen && <button className="tool-button" onClick={() => setZen(false)}><ChevronsLeft size={15} />退出专注</button>}
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
      </div>
      {!zen && artOpen && <MindMapArt
        target={topicAcceptsArt(node) ? String(node?.getData('text') || '未命名主题') : undefined}
        apply={art => { if (engine.current && node) applyArt(engine.current, node, art) }}
        close={() => { setArtOpen(false); artTrigger.current?.focus() }} />}
      {!zen && !artOpen && formatOpen && (activeCallout && selectedCallout ? <MindMapCalloutFormat
        key={selectedCallout.id} note={activeCallout.note} close={() => setFormatOpen(false)}
        edit={() => editCallout(selectedCallout)} change={patch => changeCallout(selectedCallout, patch)} />
        : <MindMapFormat {...{ tab, settings, node, version }} change={changeSettings} onTab={setTab}
        structure={value => {
          if (node?.isRoot && value) changeSettings({ layout: value })
          else if (node && branchStructure(node.getData('ymdStructure')) !== value) {
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
    </div>
    </div>
    {typeof menu === 'object' && <MarkdownMenu items={contextItems} close={closeMenu} point={menu} nativeStyle />}
    {audioParent && <MindMapRecorder title={String(audioParent.getData('text') ?? '')}
      close={() => setAudioParent(undefined)} save={(audio, duration) => addRecordedAudio(audioParent, audio, duration)} />}
    {taskTopic && taskSource && <MindMapTask initial={initialTask} notice={notice}
      skipClosed={calendar?.enabled === true} openCalendar={openCalendar}
      title={taskSource.data.text ?? ''} topics={taskTopics(taskTree, taskTopic)}
      close={() => openTask()} save={task => {
        const dateChanged = !!task && (task.start !== initialTask?.start || task.due !== initialTask?.due || task.duration !== initialTask?.duration)
        const next = task && dateChanged && calendar?.enabled ? editWorkDates(task, initialTask, days) : task
        if (next === undefined) { setNotice('所选日期范围内没有可用的工作日。'); return }
        const schedule = !!next && (dateChanged || JSON.stringify(next.dependencies) !== JSON.stringify(initialTask?.dependencies))
        if (updateTasks(new Map([[taskTopic, next]]), schedule)) setTaskTopic(undefined)
      }} />}
    {calendarOpen && <MindMapWorkCalendar initial={calendar} notice={notice} save={saveCalendar}
      close={() => { setNotice(''); setCalendarOpen(false) }} />}
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
