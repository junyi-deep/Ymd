import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronsLeft, ClipboardList, Crosshair, Download, Focus, GitBranch, GitFork, ImagePlus, ListTree, Map, Maximize, Mic, Minus, Paperclip, Plus, Redo2, Search, SlidersHorizontal, Square, Star, Sticker, StickyNote, Tag, Trash2, Undo2, X } from 'lucide-react'
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
import { MindMapFormat } from './MindMapFormat'
import { MindMapTask, readTask, taskBadge, taskTopics } from './MindMapTask'
import { MindMapRecorder } from './MindMapRecorder'
import { MindMapArt } from './MindMapArt'
import { addTopicImage, applyArt, imagePlacements, installTopicImageGestures, isTopicImage, placeTopicImage, removeTopicImage, resetTopicImage, topicAcceptsArt } from './mapTopicImages'
import { audioButton, audioTitle, createAudioPlayer, forgetAudio, loadAudio, readAudioNote, storeAudio, type AudioNote } from './mapAudio'
import { MarkdownMenu, type MenuItem } from './MarkdownMenu'
import { branchStructure, defaultMapSettings, loadMapAppearance, mapTheme, palettes, restoreFloating, restoreMapStyles, saveMapAppearance, saveMapSheets, type MapAppearance, type MapData, type MapSettings, type MapSheet } from './mapAppearance'
import { installBranchLayouts } from './mixedMapLayout'

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
MindMap.extendNodeDataNoStylePropList(['ymdMarker', 'ymdFloating', 'ymdTask', 'ymdStructure', 'ymdAudio', 'ymdOriginalImageSize'])

type MapNode = NonNullable<MindMap['renderer']['root']>
type TopicField = '备注' | '标签' | '链接'
const rootId = 'ymd-root'
const mapTitle = (name: string) => name.replace(/\.(?:md|markdown)$/i, '')
const toMap = (blocks: Block[]): MapData[] => blocks.map(block => ({
  data: { text: block.text, uid: block.id, ymdMarker: block.marker }, children: toMap(block.children),
}))

function documentTopics(nodes: MapData[]): MapData[] {
  return nodes.flatMap(node => node.data.ymdFloating === true ? [] : readAudioNote(node.data.ymdAudio) ? documentTopics(node.children ?? []) : [node])
}

function fromMap(nodes: MapData[]): Block[] {
  const branches = documentTopics(nodes)
  const marker = branches.find(node => /^[-+*]$/.test(String(node.data.ymdMarker)))?.data.ymdMarker ?? '-'
  return branches.map((node, index) => ({
    id: node.data.uid ?? String(index), text: node.data.text ?? '', marker: String(marker),
    children: fromMap(node.children ?? []),
  }))
}

function mainMap(name: string, blocks: Block[], appearance: MapAppearance) {
  const root: MapData = { data: { text: mapTitle(name), uid: rootId }, children: toMap(blocks) }
  restoreMapStyles(root, appearance.styles)
  restoreFloating(root, appearance.floating ?? [])
  return root
}

function findTopic(tree: MapData, uid: string): MapData | undefined {
  if (tree.data.uid === uid) return tree
  for (const child of tree.children ?? []) {
    const found = findTopic(child, uid)
    if (found) return found
  }
}

function hasAudio(tree: MapData, id: string): boolean {
  return readAudioNote(tree.data.ymdAudio)?.id === id || !!tree.children?.some(child => hasAudio(child, id))
}

interface MapEditorProps {
  text: string; name: string; path: string; dark: boolean; onChange: (text: string) => void
  registerFlush: (flush?: () => void) => void
}

export default function MindMapEditor(props: MapEditorProps) {
  const { path } = props
  const [sheets, setSheets] = useState(() => loadMapAppearance(path).sheets ?? [])
  const [active, setActive] = useState<string>()
  const [renaming, setRenaming] = useState<string>()
  const [newTitle, setNewTitle] = useState('')
  const [remove, setRemove] = useState<MapSheet>()
  const [sheetMenu, setSheetMenu] = useState<{ id: string; x: number; y: number }>()
  const [storageError, setStorageError] = useState(false)
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

  useEffect(() => {
    if (remove) removeDialog.current?.showModal()
    else if (removeDialog.current?.open) removeDialog.current.close()
  }, [remove])

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

  function select(id?: string) {
    flush.current?.()
    setActive(id)
  }

  function createSheet(title: string, settings: MapSettings, tree: MapData) {
    flush.current?.()
    const id = crypto.randomUUID()
    const root = structuredClone(tree)
    root.data.isActive = false
    if (updateSheets(current => [...current, { id, title, settings: { ...settings }, tree: root }])) setActive(id)
  }

  function create() {
    let index = 2
    while (sheetsRef.current.some(item => item.title === '画布 ' + index)) index++
    const title = '画布 ' + index
    createSheet(title, defaultMapSettings, { data: { text: title, uid: rootId }, children: [] })
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
    createSheet(title, item.settings, item.tree)
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

  async function saveXmind(all: boolean, tree: MapData, settings: MapSettings) {
    const title = mapTitle(props.name)
    const current = { id: sheet?.id ?? rootId, title: sheet?.title ?? '主画布', settings, tree }
    let workbook = [current]
    if (all) {
      let main = current
      if (sheet) {
        const projection = projectList(props.text)
        if (!projection) throw new Error('主画布的 Markdown 结构无法转换。可单独导出当前画布。')
        const appearance = loadMapAppearance(path)
        main = { id: rootId, title: '主画布', settings: appearance.settings, tree: mainMap(props.name, projection.blocks, appearance) }
      }
      workbook = [main, ...sheetsRef.current.map(item => item.id === current.id ? current : item)]
    }
    const { exportXmind } = await import('./exportXmind')
    const data = await exportXmind(workbook, current.id, props.dark)
    await window.desktop.saveXmind(all || !sheet ? title : sheet.title, data)
  }

  const menuIndex = sheets.findIndex(item => item.id === sheetMenu?.id)
  const menuSheet = sheets[menuIndex]

  return <div className="map-document">
    <MapCanvas key={sheet ? sheet.id + ':' + sheet.title : rootId} {...props} sheet={sheet} registerFlush={registerCanvas}
      multipleSheets={sheets.length > 0} saveXmind={saveXmind} createSheet={createSheet}
      updateSheet={(id, settings, tree) => {
        if (!updateSheets(current => current.map(item => item.id === id ? { ...item, settings, tree } : item))) {
          throw new Error('无法保存画布。')
        }
      }} />
    <nav className="map-sheets" aria-label="思维导图画布列表">
      <button className="map-sheet" data-active={!active} onClick={() => select()}>主画布</button>
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
            if (remove.id === active) setActive(undefined)
            setRemove(undefined)
          }
        }}>删除</button></footer></div>}
    </dialog>
  </div>
}

function MapCanvas({ text, name, path, dark, onChange, registerFlush, sheet, updateSheet, multipleSheets, saveXmind, createSheet }: MapEditorProps & {
  sheet?: MapSheet
  updateSheet: (id: string, settings: MapSettings, tree: MapData) => void
  multipleSheets: boolean
  saveXmind: (all: boolean, tree: MapData, settings: MapSettings) => Promise<void>
  createSheet: (title: string, settings: MapSettings, tree: MapData) => void
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
  const [menu, setMenu] = useState<'export' | 'insert' | { x: number; y: number; image?: boolean }>()
  const [artOpen, setArtOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [overview, setOverview] = useState(false)
  const [miniMap, setMiniMap] = useState<{ markup: string; viewport: Record<string, string> }>()
  const [matches, setMatches] = useState({ total: 0, currentIndex: -1 })
  const [field, setField] = useState<{ key: TopicField; node: MapNode; value: string }>()
  const [taskNode, setTaskNode] = useState<MapNode>()
  const [audioParent, setAudioParent] = useState<MapNode>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const artTrigger = useRef<HTMLButtonElement>(null)
  const resourceInput = useRef<HTMLInputElement>(null)
  const resourceTarget = useRef<{ node: MapNode; image: boolean } | undefined>(undefined)
  const engine = useRef<MindMap | undefined>(undefined)
  const exporting = useRef(false)
  const fieldDialog = useRef<HTMLDialogElement>(null)
  const change = useRef(onChange)
  const saveSheet = useRef(updateSheet)
  const currentSettings = useRef(settings)
  change.current = onChange
  saveSheet.current = updateSheet
  currentSettings.current = settings

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
        el: host.current, data: root, theme: 'default',
        layout: initialSettings.layout, themeConfig: mapTheme(initialSettings, dark),
        rainbowLinesConfig: { open: initialSettings.colored, colorsList: palettes[initialSettings.palette].colors },
        customHyperlinkJump: url => { void window.desktop.openExternal(url).catch(() => setNotice('无法打开链接。')) },
        createNodePostfixContent: node => {
          const note = readAudioNote(node.getData('ymdAudio'))
          if (note) {
            const button = audioButton(note, () => void audio.toggle(note))
            audio.decorate(button.el, note)
            return button
          }
          const task = readTask(node.getData('ymdTask'))
          if (task) return taskBadge(task, () => setTaskNode(node))
        },
        customCheckEnableShortcut: event => !event.defaultPrevented && !event.isComposing && event.target instanceof HTMLElement &&
          !(map?.renderer.activeNodeList.some(node => readAudioNote(node.getData('ymdAudio'))) &&
            (event.key === 'Tab' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v')) &&
          (event.target === document.body || event.target.classList.contains('smm-node-edit-wrap') || !!host.current?.contains(event.target)),
        beforeAssociativeLineConnection: () => { setLinking(false); return false },
        beforeTextEdit: node => !readAudioNote(node.getData('ymdAudio')) && (!!initialSheet || !node.isRoot),
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
    const removeBranchLayouts = installBranchLayouts(map)
    const removeImageGestures = installTopicImageGestures(map, host.current)
    const onData = (node: MapData) => {
      const audioId = audio.activeId
      if (audioId && !hasAudio(node, audioId)) audio.stop()
      if (!initialSheet && projection) {
        const next = writeList(projection, fromMap(node.children ?? []))
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
      select(node, map.renderer.activeNodeList)
      setMenu({ x: event.clientX, y: event.clientY, image: isTopicImage(event.target) })
    }
    const scale = (value: number) => setZoom(Math.round(value * 100))
    const syncLinkMode = () => setLinking(map.associativeLine.isCreatingLine)
    const searchInfo = (info: typeof matches) => setMatches(info)
    const download = (node: MapNode) => {
      const source = node.getData('attachmentUrl')
      if (typeof source !== 'string' || !source.startsWith('data:application/octet-stream;base64,')) return
      const anchor = document.createElement('a')
      anchor.href = source
      anchor.download = String(node.getData('attachmentName') ?? '附件')
      anchor.click()
    }
    map.on('data_change', onData)
    map.on('afterExecCommand', sync)
    map.on('node_active', select)
    map.on('node_contextmenu', context)
    map.on('node_click', syncLinkMode)
    map.on('draw_click', syncLinkMode)
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
      removeImageGestures()
      removeBranchLayouts()
      registerFlush()
      map.off('afterExecCommand', sync)
      map.off('data_change', onData)
      map.off('node_active', select)
      map.off('node_contextmenu', context)
      map.off('node_click', syncLinkMode)
      map.off('draw_click', syncLinkMode)
      map.off('contextmenu', syncLinkMode)
      map.off('scale', scale)
      map.off('search_info_change', searchInfo)
      map.off('node_attachmentClick', download)
      map.associativeLine.cancelCreateLine()
      map.destroy()
      engine.current = undefined
    }
  }, [name, path, projection, registerFlush, appearance, initialSheet])

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
    if (!zen && !linking && !searchOpen && !formatOpen && !artOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || field || taskNode || audioParent ||
          event.target instanceof HTMLElement && event.target.closest('.smm-node-edit-wrap, .document-menu')) return
      if (linking) { engine.current?.associativeLine.cancelCreateLine(); setLinking(false) }
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
  }, [zen, linking, searchOpen, formatOpen, artOpen, field, taskNode, audioParent])

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
  const node = selected[0]
  const audioNote = readAudioNote(node?.getData('ymdAudio'))
  const canRemove = selected.some(item => !item.isRoot)

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
    createSheet(data.text?.trim() || '新画布', settings, { ...topic, data: { ...data, expand: true } })
  }

  function fieldFor(key: TopicField) {
    if (!node) return
    const value = node.getData(key === '备注' ? 'note' : key === '链接' ? 'hyperlink' : 'tag')
    setField({ key, node, value: Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '' })
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

  function chooseResource(image: boolean) {
    if (!node || !resourceInput.current) return
    resourceTarget.current = { node, image }
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
      if (!selected()) return
      const source = String(reader.result)
      if (!target.image) {
        const safeName = file.name.replace(/[<>:"/\\|?*]/g, '_').replace(/&/g, '与')
        command('SET_NODE_ATTACHMENT', target.node, source.replace(/^data:[^;]*;/, 'data:application/octet-stream;'), safeName)
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
    { label: '任务', icon: <ClipboardList size={16} />, disabled: !node, separator: true, run: () => setTaskNode(node) },
    { label: '备注', icon: <StickyNote size={16} />, disabled: !node, separator: true, run: () => fieldFor('备注') },
    { label: audioTitle, icon: <Mic size={16} />, disabled: !node || !!audioNote || !!node.isGeneralization || selected.length !== 1,
      run: () => setAudioParent(node) },
    { label: '标签', icon: <Tag size={16} />, disabled: !node, run: () => fieldFor('标签') },
    { label: '链接', disabled: !node || !!audioNote, run: () => fieldFor('链接') },
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

  const exportItems: MenuItem[] = [
    multipleSheets ? { label: 'Xmind 文件', children: [
      { label: '全部画布', run: () => void exportWorkbook(true) },
      { label: '当前画布', run: () => void exportWorkbook(false) },
    ] } : { label: 'Xmind 文件', run: () => void exportWorkbook(false) },
    ...[['png', 'PNG 图片'], ['svg', 'SVG 矢量图'], ['pdf', 'PDF'], ['md', 'Markdown'], ['txt', '纯文本']].map(([format, label]) => ({
      label, run: () => { void engine.current?.export(format, true, sheet?.title ?? mapTitle(name)).catch(() => setNotice('导出失败。')) },
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
  const contextItems: MenuItem[] = typeof menu === 'object' && menu.image && imageItems.length ? imageItems : audioNote ? [
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
    ...(imageItems.length ? [{ label: '图片', children: imageItems }] : []),
    { label: '删除主题', icon: <Trash2 size={16} />, disabled: !canRemove, run: () => command('REMOVE_NODE') },
  ]
  const closeMenu = () => setMenu(undefined)
  const closeMapSearch = () => { setQuery(''); setReplace(''); setSearchOpen(false); engine.current?.search.endSearch() }

  return <div className="map-editor xmind-workspace" data-zen={zen}>
    {!zen && <div className="map-toolbar" aria-label="思维导图工具栏">
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
        <button className="icon-button" aria-label="删除主题" disabled={!canRemove} onClick={() => command('REMOVE_NODE')}><Trash2 size={16} /></button>
      </div>
      <div className="map-toolbar-group map-toolbar-trailing">
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
        }}><SlidersHorizontal size={16} />格式</button>
      </div>
    </div>}
    <input ref={resourceInput} type="file" hidden onChange={event => attach(event.target.files?.[0])} />
    <div className="map-body">
      <div className="map-stage">
        <div className="map-canvas" ref={host} tabIndex={0} aria-label="思维导图画布"
          onPointerDown={event => { if (event.target instanceof SVGElement) event.currentTarget.focus() }}
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
          {zen && <button className="tool-button" onClick={() => setZen(false)}><ChevronsLeft size={15} />退出专注</button>}
          <button className="icon-button" aria-label="导图概览" aria-pressed={overview} onClick={() => setOverview(!overview)}><Map size={16} /></button>
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
      {!zen && !artOpen && formatOpen && <MindMapFormat {...{ tab, settings, node, version }} change={changeSettings} onTab={setTab}
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
        }} />}
    </div>
    {typeof menu === 'object' && <MarkdownMenu items={contextItems} close={closeMenu} point={menu} nativeStyle />}
    {audioParent && <MindMapRecorder title={String(audioParent.getData('text') ?? '')}
      close={() => setAudioParent(undefined)} save={(audio, duration) => addRecordedAudio(audioParent, audio, duration)} />}
    {taskNode && <MindMapTask initial={readTask(taskNode.getData('ymdTask'))}
      title={String(taskNode.getData('text') ?? '')} topics={taskTopics(engine.current?.getData(), taskNode.uid)}
      close={() => setTaskNode(undefined)} save={task => {
        engine.current?.renderer.setNodeDataRender(taskNode, { ymdTask: task })
        setTaskNode(undefined)
      }} />}
    <dialog ref={fieldDialog} onCancel={event => { event.preventDefault(); setField(undefined) }}>
      {field && <form onSubmit={event => {
        event.preventDefault()
        if (field.key === '备注') command('SET_NODE_NOTE', field.node, field.value)
        if (field.key === '标签') command('SET_NODE_TAG', field.node, field.value.split(/[,，]/).map(value => value.trim()).filter(Boolean))
        if (field.key === '链接') command('SET_NODE_HYPERLINK', field.node, field.value)
        setField(undefined)
      }}>
        <h2>{field.key}</h2>
        <label>{field.key}
          {field.key === '备注'
            ? <textarea value={field.value} autoFocus onChange={event => setField({ ...field, value: event.target.value })} />
            : <input type={field.key === '链接' ? 'url' : 'text'} placeholder={field.key === '标签' ? '用逗号分隔标签' : 'https://'}
                value={field.value} autoFocus onChange={event => setField({ ...field, value: event.target.value })} />}
        </label>
        <footer><button type="button" onClick={() => setField(undefined)}>取消</button><button type="submit" className="primary">保存</button></footer>
      </form>}
    </dialog>
  </div>
}
