import { Text } from '@svgdotjs/svg.js'
import type MindMap from 'simple-mind-map'
import type { MapData } from './mapAppearance'
import { numberingLabels } from './mapNumbering'

export function installNumbering(map: MindMap, originalTree?: MapData) {
  let labels: ReturnType<typeof numberingLabels>
  const originalLabels = originalTree && new Map([...numberingLabels(originalTree)].map(([topic, label]) => [topic.data.uid, label]))
  // Recalculate before layout so cached nodes are resized when a sibling's order changes.
  const refresh = () => { labels = numberingLabels(map.renderer.renderTree) }
  refresh()
  map.on('node_tree_render_start', refresh)
  map.nodeInnerPrefixList.push({
    name: 'ymdNumbering',
    createNodeData: ({ data }) => ['ymdNumberText', originalLabels?.get(data.data.uid) ?? labels.get(data)],
    updateNodeData: (node, { ymdNumberText }) => {
      const changed = node.opt.ymdNumberText !== ymdNumberText
      node.opt.ymdNumberText = ymdNumberText
      return changed
    },
    createContent: node => {
      const label = node.opt.ymdNumberText
      if (!label) return
      const text = new Text().text(label)
        .addClass('map-topic-number')
        .attr({ 'xml:space': 'preserve', 'pointer-events': 'none' })
      node.style.text(text)
      const { width, height } = text.bbox()
      return { node: text, width, height }
    },
  })
  return () => map.off('node_tree_render_start', refresh)
}
