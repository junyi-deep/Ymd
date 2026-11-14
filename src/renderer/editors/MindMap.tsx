import { useEffect, useRef, useState } from 'react'
import { ChevronsLeft, Crosshair, Download, Focus, GitBranch, GitFork, ImagePlus, ListTree, Map, Maximize, Minus, Paperclip, Plus, Redo2, Search, SlidersHorizontal, Square, Star, StickyNote, Tag, Trash2, Undo2, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import MindMap from 'simple-mind-map'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import ExportPDF from 'simple-mind-map/src/plugins/ExportPDF.js'
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import MiniMap from 'simple-mind-map/src/plugins/MiniMap.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import RainbowLines from 'simple-mind-map/src/plugins/RainbowLines.js'
import SearchPlugin from 'simple-mind-map/src/plugins/Search.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import { UnsupportedList } from './Outline'
import { projectList, writeList, type Block } from './listProjection'
import { MindMapFormat } from './MindMapFormat'
import { MarkdownMenu, type MenuItem } from './MarkdownMenu'
import { defaultMapSettings, loadMapAppearance, mapTheme, palettes, restoreFloating, restoreMapStyles, saveMapAppearance, saveMapSheets, type MapData, type MapSettings, type MapSheet } from './mapAppearance'

for (const plugin of [AssociativeLine, Drag, Export, ExportPDF, ExportXMind, KeyboardNavigation, MiniMap, OuterFrame, RainbowLines, SearchPlugin, Select]) MindMap.usePlugin(plugin)
MindMap.extendNodeDataNoStylePropList(['ymdMarker', 'ymdFloating'])

type MapNode = NonNullable<MindMap['renderer']['root']>
type TopicField = '备注' | '标签' | '链接'
const rootId = 'ymd-root'
const toMap = (blocks: Block[]): MapData[] => blocks.map(block => ({
  data: { text: block.text, uid: block.id, ymdMarker: block.marker }, children: toMap(block.children),
}))

function fromMap(nodes: MapData[]): Block[] {
  const branches = nodes.filter(node => node.data.ymdFloating !== true)
  const marker = branches.find(node => /^[-+*]$/.test(String(node.data.ymdMarker)))?.data.ymdMarker ?? '-'
  return branches.map((node, index) => ({
    id: node.data.uid ?? String(index), text: node.data.text ?? '', marker: String(marker),
    children: fromMap(node.children ?? []),
  }))
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

  function create() {
    flush.current?.()
    const id = crypto.randomUUID()
    let index = 2
    while (sheetsRef.current.some(item => item.title === '画布 ' + index)) index++
    const title = '画布 ' + index
    const created = updateSheets(current => [...current, {
      id, title, settings: defaultMapSettings, tree: { data: { text: title, uid: rootId }, children: [] },
    }])
    if (created) setActive(id)
  }

  function saveTitle() {
    if (!renaming || !newTitle.trim()) { setRenaming(undefined); return }
    const renamed = updateSheets(current => current.map(item => item.id === renaming
      ? { ...item, title: newTitle.trim(), tree: { ...item.tree, data: { ...item.tree.data, text: newTitle.trim() } } } : item))
    if (renamed) setRenaming(undefined)
  }

  return <div className="map-document">
    <MapCanvas key={sheet ? sheet.id + ':' + sheet.title : rootId} {...props} sheet={sheet} registerFlush={registerCanvas}
      updateSheet={(id, settings, tree) => {
        if (!updateSheets(current => current.map(item => item.id === id ? { ...item, settings, tree } : item))) {
          throw new Error('无法保存画布。')
        }
      }} />
    <nav className="map-sheets" aria-label="思维导图画布列表">
      <button className="map-sheet" data-active={!active} onClick={() => select()}>主画布</button>
      {sheets.map(item => <div className="map-sheet-item" key={item.id}>
        {renaming === item.id
          ? <input aria-label="画布名称" value={newTitle} autoFocus onFocus={event => event.currentTarget.select()}
              onChange={event => setNewTitle(event.target.value)} onBlur={() => setRenaming(undefined)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') saveTitle()
                if (event.key === 'Escape') { event.stopPropagation(); setRenaming(undefined) }
              }} />
          : <button className="map-sheet" data-active={active === item.id} title={item.title} onClick={() => select(item.id)}
              onDoubleClick={() => { setNewTitle(item.title); setRenaming(item.id) }}>{item.title}</button>}
        <button className="icon-button" aria-label={'删除画布 ' + item.title} onClick={() => setRemove(item)}><X size={13} /></button>
      </div>)}
      <button className="icon-button" aria-label="新建画布" title="新建画布" onClick={create}><Plus size={16} /></button>
      {storageError && <span className="map-storage-error" role="alert">无法保存画布</span>}
    </nav>
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

function MapCanvas({ text, name, path, dark, onChange, registerFlush, sheet, updateSheet }: MapEditorProps & {
  sheet?: MapSheet
  updateSheet: (id: string, settings: MapSettings, tree: MapData) => void
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
  const [menu, setMenu] = useState<'export' | 'insert' | { x: number; y: number }>()
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [overview, setOverview] = useState(false)
  const [miniMap, setMiniMap] = useState<{ markup: string; viewport: Record<string, string> }>()
  const [matches, setMatches] = useState({ total: 0, currentIndex: -1 })
  const [field, setField] = useState<{ key: TopicField; node: MapNode; value: string }>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const resourceInput = useRef<HTMLInputElement>(null)
  const resourceTarget = useRef<{ node: MapNode; image: boolean } | undefined>(undefined)
  const engine = useRef<MindMap | undefined>(undefined)
  const fieldDialog = useRef<HTMLDialogElement>(null)
  const change = useRef(onChange)
  const saveSheet = useRef(updateSheet)
  const currentSettings = useRef(settings)
  change.current = onChange
  saveSheet.current = updateSheet
  currentSettings.current = settings

  useEffect(() => {
    if ((!projection && !initialSheet) || !host.current) return
    const title = name.replace(/\.md$/i, '')
    const root: MapData = initialSheet ? structuredClone(initialSheet.tree)
      : { data: { text: title, uid: rootId }, children: toMap(projection!.blocks) }
    if (!initialSheet) {
      restoreMapStyles(root, appearance.styles)
      restoreFloating(root, appearance.floating ?? [])
    }
    const initialSettings = initialSheet?.settings ?? appearance.settings
    let previous = projection ? writeList(projection, projection.blocks) : ''
    let map: MindMap
    try {
      map = new MindMap({
        el: host.current, data: root, theme: 'default',
        layout: initialSettings.layout, themeConfig: mapTheme(initialSettings, dark),
        rainbowLinesConfig: { open: initialSettings.colored, colorsList: palettes[initialSettings.palette].colors },
        customHyperlinkJump: url => { void window.desktop.openExternal(url).catch(() => setNotice('无法打开链接。')) },
        customCheckEnableShortcut: event => !event.defaultPrevented && !event.isComposing && event.target instanceof HTMLElement &&
          (event.target === document.body || event.target.classList.contains('smm-node-edit-wrap') || !!host.current?.contains(event.target)),
        beforeAssociativeLineConnection: () => { setLinking(false); return false },
        beforeTextEdit: node => !!initialSheet || !node.isRoot, enableAutoEnterTextEditWhenKeydown: false, enableFreeDrag: true,
        defaultInsertSecondLevelNodeText: '新主题', defaultInsertBelowSecondLevelNodeText: '子主题',
      })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
      return
    }
    engine.current = map
    const onData = (node: MapData) => {
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
      map.execCommand('CLEAR_ACTIVE_NODE')
      map.execCommand('SET_NODE_ACTIVE', node, true)
      setMenu({ x: event.clientX, y: event.clientY })
    }
    const scale = (value: number) => setZoom(Math.round(value * 100))
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
    map.on('scale', scale)
    map.on('search_info_change', searchInfo)
    map.on('node_attachmentClick', download)
    registerFlush(flush)
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(host.current)
    return () => {
      resize.disconnect()
      registerFlush()
      map.off('afterExecCommand', sync)
      map.off('data_change', onData)
      map.off('node_active', select)
      map.off('node_contextmenu', context)
      map.off('scale', scale)
      map.off('search_info_change', searchInfo)
      map.off('node_attachmentClick', download)
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
    if (!zen && !linking && !searchOpen && !formatOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || field ||
          event.target instanceof HTMLElement && event.target.closest('.smm-node-edit-wrap, .document-menu')) return
      if (linking) { engine.current?.associativeLine.cancelCreateLine(); setLinking(false) }
      else if (searchOpen) { setQuery(''); setReplace(''); setSearchOpen(false); engine.current?.search.endSearch() }
      else if (zen) setZen(false)
      else setFormatOpen(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [zen, linking, searchOpen, formatOpen, field])

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
  const canRemove = selected.some(item => !item.isRoot)

  function add(sibling: boolean) {
    const map = engine.current
    if (!map) return
    if (sibling && node && !node.isRoot) { command('INSERT_NODE'); return }
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

  function fieldFor(key: TopicField) {
    if (!node) return
    const value = node.getData(key === '备注' ? 'note' : key === '链接' ? 'hyperlink' : 'tag')
    setField({ key, node, value: Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '' })
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
        if (selected()) command('SET_NODE_IMAGE', target.node, { url: source, width, height: width * image.naturalHeight / image.naturalWidth })
      }
      image.onerror = () => setNotice('无法读取图片。')
      image.src = source
    })
    reader.addEventListener('error', () => setNotice('无法读取附件。'))
    reader.readAsDataURL(file)
  }

  const insertItems: MenuItem[] = [
    { label: '浮动主题', icon: <Square size={16} />, run: addFloating },
    { label: '关联线', icon: <GitFork size={16} />, disabled: !node, run: () => {
      engine.current?.associativeLine.createLineFromActiveNode()
      setLinking(true)
    } },
    { label: '边界', icon: <Square size={16} />, disabled: !canRemove, run: () => command('ADD_OUTER_FRAME') },
    { label: '概要', icon: <ListTree size={16} />, disabled: !canRemove, run: () => command('ADD_GENERALIZATION') },
    { label: '备注', icon: <StickyNote size={16} />, disabled: !node, separator: true, run: () => fieldFor('备注') },
    { label: '标签', icon: <Tag size={16} />, disabled: !node, run: () => fieldFor('标签') },
    { label: '链接', disabled: !node, run: () => fieldFor('链接') },
    { label: '图片', icon: <ImagePlus size={16} />, disabled: !node, run: () => chooseResource(true) },
    { label: '附件', icon: <Paperclip size={16} />, disabled: !node, run: () => chooseResource(false) },
    { label: '标记', icon: <Star size={16} />, disabled: !node, children: [
      ...[1, 2, 3, 4, 5].map(level => ({ label: '优先级 ' + level, run: () => command('SET_NODE_ICON', node, ['priority_' + level]) })),
      { label: '已完成', run: () => command('SET_NODE_ICON', node, ['progress_8']) },
      { label: '移除标记', run: () => command('SET_NODE_ICON', node, []) },
    ] },
  ]
  const exportItems: MenuItem[] = [['png', 'PNG 图片'], ['svg', 'SVG 矢量图'], ['pdf', 'PDF'], ['xmind', 'Xmind 文件'], ['md', 'Markdown'], ['txt', '纯文本']].map(([format, label]) => ({
    label, run: () => { void engine.current?.export(format, true, name.replace(/\.md$/i, '')).catch(() => setNotice('导出失败。')) },
  }))
  const contextItems: MenuItem[] = [
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
        <button className="tool-button" onClick={() => add(false)}><GitBranch size={16} />子主题</button>
        <div className="menu-anchor">
          <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? undefined : 'insert')}><Plus size={16} />插入</button>
          {menu === 'insert' && <MarkdownMenu items={insertItems} close={closeMenu} />}
        </div>
        <button className="icon-button" aria-label="删除主题" disabled={!canRemove} onClick={() => command('REMOVE_NODE')}><Trash2 size={16} /></button>
      </div>
      <div className="map-toolbar-group map-toolbar-trailing">
        <button className="icon-button" title="查找主题" aria-label="查找主题" aria-expanded={searchOpen}
          onClick={() => searchOpen ? closeMapSearch() : setSearchOpen(true)}><Search size={17} /></button>
        <div className="menu-anchor">
          <button className="tool-button" aria-haspopup="menu" aria-expanded={menu === 'export'} onClick={() => setMenu(menu === 'export' ? undefined : 'export')}><Download size={16} />导出</button>
          {menu === 'export' && <MarkdownMenu items={exportItems} close={closeMenu} />}
        </div>
        <button className="icon-button" title="专注模式" aria-label="专注模式" onClick={() => setZen(true)}><Focus size={17} /></button>
        <button className="tool-button" aria-pressed={formatOpen} onClick={() => setFormatOpen(!formatOpen)}><SlidersHorizontal size={16} />格式</button>
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
          <button className="icon-button" aria-label="回到中心主题" title="回到中心主题" onClick={() => command('GO_TARGET_NODE', rootId)}><Crosshair size={16} /></button>
          <button className="icon-button" aria-label="适合窗口" title="适合窗口" onClick={() => engine.current?.view.fit()}><Maximize size={15} /></button>
          <button className="icon-button" aria-label="缩小" onClick={() => engine.current?.view.narrow()}><Minus size={16} /></button>
          <button className="tool-button" title="恢复为 100%" aria-label="恢复为 100%" onClick={() => engine.current?.view.reset()}>{zoom}%</button>
          <button className="icon-button" aria-label="放大" onClick={() => engine.current?.view.enlarge()}><Plus size={16} /></button>
        </div>
      </div>
      {!zen && formatOpen && <MindMapFormat {...{ tab, settings, node, version }} change={changeSettings} onTab={setTab}
        close={() => setFormatOpen(false)} style={(key, value) => {
          if (node) {
            if (key === 'reset') command('REMOVE_CUSTOM_STYLES', node)
            else command('SET_NODE_STYLE', node, key, value)
          }
        }} />}
    </div>
    {typeof menu === 'object' && <MarkdownMenu items={contextItems} close={closeMenu} point={menu} nativeStyle />}
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
