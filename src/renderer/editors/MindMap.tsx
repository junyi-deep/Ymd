import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import { UnsupportedList } from './Outline'
import { projectList, writeList, type Block } from './listProjection'

MindMap.usePlugin(Drag)

type MapData = ConstructorParameters<typeof MindMap>[0]['data']

function toMap(blocks: Block[]): MapData[] {
  return blocks.map(block => ({ data: { text: block.text, uid: block.id }, children: toMap(block.children) }))
}

function fromMap(nodes: MapData[], original: Map<string, string>, inherited?: string): Block[] {
  const marker = inherited ?? nodes.map(node => original.get(node.data.uid ?? '')).find(Boolean) ?? '-'
  return nodes.map((node, index) => ({
    id: node.data.uid ?? String(index), text: node.data.text ?? '', marker,
    children: fromMap(node.children ?? [], original),
  }))
}

function collectMarkers(blocks: Block[], markers = new Map<string, string>()) {
  for (const block of blocks) {
    markers.set(block.id, block.marker)
    collectMarkers(block.children, markers)
  }
  return markers
}

export default function MindMapEditor({ text, name, dark, onChange, registerFlush }: {
  text: string; name: string; dark: boolean; onChange: (text: string) => void
  registerFlush: (flush?: () => void) => void
}) {
  const [projection] = useState(() => projectList(text))
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<MindMap | undefined>(undefined)
  const change = useRef(onChange)
  const [error, setError] = useState('')
  change.current = onChange

  useEffect(() => {
    if (!projection || !host.current) return
    const markers = collectMarkers(projection.blocks)
    const root: MapData = { data: { text: name.replace(/\.md$/i, ''), uid: 'ymd-root' }, children: toMap(projection.blocks) }
    let previous = writeList(projection, projection.blocks)
    let map: MindMap
    try {
      map = new MindMap({ el: host.current, data: root, theme: dark ? 'dark' : 'default',
        beforeTextEdit: node => !node.isRoot, defaultInsertSecondLevelNodeText: '新节点', defaultInsertBelowSecondLevelNodeText: '新节点' })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return
    }
    engine.current = map
    const onData = (node: MapData) => {
      const next = writeList(projection, fromMap(node.children ?? [], markers))
      if (next !== previous) { previous = next; change.current(next) }
    }
    const sync = () => onData(map.getData())
    const flush = () => { map.renderer.textEdit.hideEditTextBox(); sync() }
    map.on('data_change', onData)
    map.on('afterExecCommand', sync)
    registerFlush(flush)
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(host.current)
    return () => {
      resize.disconnect()
      registerFlush()
      map.off('afterExecCommand', sync)
      map.off('data_change', onData)
      map.destroy()
      engine.current = undefined
    }
  }, [name, projection, registerFlush])

  useEffect(() => { engine.current?.setTheme(dark ? 'dark' : 'default') }, [dark])

  if (!projection) return <UnsupportedList />
  if (error) return <div className="editor-empty"><h2>无法加载思维导图</h2><p>{error}</p></div>
  function addChild() {
    const map = engine.current
    if (!map) return
    if (!map.getData().children?.length && map.renderer.root) {
      map.execCommand('INSERT_CHILD_NODE', true, [map.renderer.root])
    } else map.execCommand('INSERT_CHILD_NODE')
  }

  return <div className="map-editor">
    <div className="map-tools">
      <button className="tool-button" onClick={addChild}><Plus size={15} />子节点</button>
      <button className="tool-button" onClick={() => engine.current?.execCommand('INSERT_NODE')}><Plus size={15} />同级节点</button>
      <button className="tool-button" onClick={() => engine.current?.execCommand('REMOVE_NODE')}><Trash2 size={15} />删除节点</button>
    </div>
    <div className="map-canvas" ref={host} aria-label="思维导图画布" />
  </div>
}
