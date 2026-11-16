import { useEffect, useRef } from 'react'
import MindMap, { type MapNode } from 'simple-mind-map'
import type { PitchTopic } from '../../shared/pitch'
import { defaultMapSettings, mapTheme, type MapData } from './mapAppearance'

function asMap(topic: PitchTopic): MapData {
  return { data: { uid: topic.id, text: topic.title, expand: true, isActive: false }, children: topic.children.map(asMap) }
}

export function PitchNavigator({ root, active, jump }: { root: PitchTopic; active: string; jump: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  const jumpRef = useRef(jump)
  activeRef.current = active
  jumpRef.current = jump
  useEffect(() => {
    if (!host.current) return
    const area = host.current
    const map = new MindMap({
      el: area, data: asMap(root), readonly: true, fit: true, layout: 'logicalStructure',
      theme: 'default', themeConfig: mapTheme({ ...defaultMapSettings, background: '#24262d', compact: true }, true),
      customCheckEnableShortcut: () => false,
    })
    const hit = (node: MapNode) => jumpRef.current(node.uid)
    const label = () => {
      const visit = (node: MapNode) => {
        const group = node.group?.node
        if (group) {
          group.setAttribute('data-pitch-topic', node.uid)
          group.setAttribute('data-active', String(node.uid === activeRef.current))
          group.setAttribute('tabindex', '0')
          group.setAttribute('role', 'button')
          group.setAttribute('aria-label', String(node.getData('text') ?? ''))
        }
        node.children.forEach(visit)
      }
      if (map.renderer.root) visit(map.renderer.root)
    }
    const resize = new ResizeObserver(() => {
      if (!area.clientWidth || !area.clientHeight) return
      map.resize()
      map.render(() => map.view.fit())
    })
    resize.observe(area)
    map.on('node_click', hit)
    map.on('node_tree_render_end', label)
    return () => {
      resize.disconnect()
      map.off('node_click', hit)
      map.off('node_tree_render_end', label)
      map.destroy()
    }
  }, [root])
  useEffect(() => {
    for (const node of host.current?.querySelectorAll('[data-pitch-topic]') ?? []) {
      node.setAttribute('data-active', String(node.getAttribute('data-pitch-topic') === active))
    }
  }, [active])
  return <div className="pitch-navigator" ref={host} aria-label="演讲者导图" onKeyDown={event => {
    if (!(event.target instanceof Element) || !['Enter', ' '].includes(event.key)) return
    const id = event.target.getAttribute('data-pitch-topic')
    if (id) { event.preventDefault(); event.stopPropagation(); jump(id) }
  }} />
}
