import type MindMap from 'simple-mind-map'
import type { MapLayout, MapNode } from 'simple-mind-map'
import Fishbone from 'simple-mind-map/src/layouts/Fishbone.js'
import CatalogOrganization from 'simple-mind-map/src/layouts/CatalogOrganization.js'
import LogicalStructure from 'simple-mind-map/src/layouts/LogicalStructure.js'
import MindMapLayout from 'simple-mind-map/src/layouts/MindMap.js'
import OrganizationStructure from 'simple-mind-map/src/layouts/OrganizationStructure.js'
import Timeline from 'simple-mind-map/src/layouts/Timeline.js'
import VerticalTimeline from 'simple-mind-map/src/layouts/VerticalTimeline.js'
import { branchStructure, type Structure } from './mapAppearance'

const layouts = {
  mindMap: MindMapLayout, logicalStructure: LogicalStructure, logicalStructureLeft: LogicalStructure,
  organizationStructure: OrganizationStructure, catalogOrganization: CatalogOrganization,
  timeline: Timeline, verticalTimeline: VerticalTimeline, fishbone: Fishbone,
} satisfies Record<Structure, typeof MindMapLayout>

interface Box { left: number; top: number; width: number; height: number }

interface LayoutNode extends Box {
  source: MapNode
  parent?: LayoutNode
  children: LayoutNode[]
  layerIndex: number
  isRoot: boolean
  dir?: string
  nested?: Region
}

interface LayoutTree {
  instance: LayoutNode
  data: MapNode['nodeData']['data']
  children: LayoutTree[]
  _node?: LayoutNode
}

interface Region {
  layout: MapLayout
  root: LayoutNode
  envelope: Box
}

interface Drawing {
  layout: MapLayout
  node: MapNode
}

function hasBranchStructure(node: MapNode): boolean {
  return node.children.some(child =>
    (child.children.length > 0 && !!branchStructure(child.getData('ymdStructure'))) || hasBranchStructure(child))
}

function prepareRegion(map: MindMap, source: MapNode, structure: Structure): Region {
  function tree(node: MapNode, depth: number, parent?: LayoutNode): LayoutTree {
    const own = depth > 0 && node.children.length ? branchStructure(node.getData('ymdStructure')) : undefined
    const nested = own ? prepareRegion(map, node, own) : undefined
    const { width, height } = nested?.envelope ?? node
    const instance: LayoutNode = {
      source: node, nested, width, height, left: 0, top: 0, parent,
      isRoot: depth === 0, layerIndex: depth, children: [],
    }
    const children = nested ? [] : node.children.map(child => tree(child, depth + 1, instance))
    const data = { ...node.getData(), expand: children.length > 0 }
    instance.children = children.map(child => child.instance)
    return { instance, data, children }
  }

  const renderTree = tree(source, 0)
  const layout = new layouts[structure]({ mindMap: map, renderTree }, structure)
  // Measure each region with the existing layout engines, using boxes in place of SVG nodes.
  layout.createNode = raw => {
    const item = raw as LayoutTree
    const { instance } = item
    const { source, nested } = instance
    const input = Object.assign(instance, {
      uid: source.uid,
      nodeData: { data: item.data, children: item.children },
      getData: (key: string) => item.data[key],
      hasCustomPosition: () => false,
      checkHasGeneralization: () => !nested && source.checkHasGeneralization(),
      _generalizationNodeWidth: source._generalizationNodeWidth,
      _generalizationNodeHeight: source._generalizationNodeHeight,
      expandBtnSize: source.expandBtnSize,
    })
    item._node = input
    return input
  }
  layout.root = renderTree.instance
  layout.setNodeCenter = () => {}
  layout.computedBaseValue()
  if (structure === 'organizationStructure') {
    layout.computedLeftValue()
    layout.adjustLeftValue()
  } else if (structure === 'catalogOrganization' || structure === 'timeline' || structure === 'fishbone') {
    layout.computedLeftTopValue()
    layout.adjustLeftTopValue()
  } else if (structure === 'verticalTimeline') {
    layout.computedTopValue()
    layout.adjustLeftTopValue()
  } else {
    layout.computedTopValue()
    layout.adjustTopValue()
  }

  const bounds = { left: 0, top: 0, right: 0, bottom: 0 }
  function extend(node: LayoutNode) {
    bounds.left = Math.min(bounds.left, node.left)
    bounds.top = Math.min(bounds.top, node.top)
    bounds.right = Math.max(bounds.right, node.left + node.width)
    bounds.bottom = Math.max(bounds.bottom, node.top + node.height)
    node.children.forEach(extend)
  }
  extend(renderTree.instance)
  const { left, top, right, bottom } = bounds
  return { layout, root: renderTree.instance, envelope: { left, top, width: right - left, height: bottom - top } }
}

function positionRegion(region: Region, left: number, top: number, drawingMaps: {
  outgoing: WeakMap<MapNode, Drawing>; incoming: WeakMap<MapNode, Drawing>; originals: WeakMap<MapNode, MapNode>
}) {
  const { outgoing, incoming, originals } = drawingMaps
  function placeTopic(place: LayoutNode, x: number, y: number, parent: MapNode | null): MapNode {
    const node = place.source
    const anchorX = place.left - (place.nested?.envelope.left ?? 0)
    const anchorY = place.top - (place.nested?.envelope.top ?? 0)
    const baseX = x + anchorX
    const baseY = y + anchorY
    const dragged = node.hasCustomPosition()
    const shiftX = dragged ? node.left - baseX : 0
    const shiftY = dragged ? node.top - baseY : 0
    node.left = baseX
    node.top = baseY
    if (parent) node.dir = place.dir
    const view: MapNode = Object.create(node, {
      isRoot: { value: place.isRoot },
      layerIndex: { value: place.layerIndex },
      parent: { value: parent },
      dir: { value: place.dir },
      children: { value: [] as MapNode[] },
    })
    originals.set(view, node)
    const drawing = { layout: region.layout, node: view }
    if (parent) incoming.set(node, drawing)
    if (place.nested) positionRegion(place.nested, node.left, node.top, drawingMaps)
    else {
      outgoing.set(node, drawing)
      for (const child of place.children) view.children.push(placeTopic(child, x + shiftX, y + shiftY, view))
    }
    return view
  }
  placeTopic(region.root, left, top, null)
}

export function installBranchLayouts(map: MindMap, hasProjectedRoot = () => false) {
  const initialized = new WeakSet<MapLayout>()
  const setup = () => {
    const native = map.renderer.layout
    if (initialized.has(native)) return
    initialized.add(native)
    let outgoing = new WeakMap<MapNode, Drawing>()
    let incoming = new WeakMap<MapNode, Drawing>()
    let originals = new WeakMap<MapNode, MapNode>()
    const doLayout = native.doLayout.bind(native)
    const renderLine = native.renderLine.bind(native)
    const renderExpandBtn = native.renderExpandBtn.bind(native)
    const renderExpandBtnRect = native.renderExpandBtnRect.bind(native)
    const renderGeneralization = native.renderGeneralization.bind(native)
    const removeLines = native.nodeIsRemoveAllLines?.bind(native)

    native.doLayout = callback => doLayout(root => {
      outgoing = new WeakMap()
      incoming = new WeakMap()
      originals = new WeakMap()
      const rootStructure = hasProjectedRoot() ? branchStructure(root.getData('ymdStructure')) : undefined
      const structure = rootStructure ?? branchStructure(map.getLayout())
      if (structure && (rootStructure || hasBranchStructure(root))) {
        const region = prepareRegion(map, root, structure)
        positionRegion(region, root.left, root.top, { outgoing, incoming, originals })
      }
      callback(root)
    })
    native.renderLine = (node, lines, applyStyle, lineStyle) => {
      const drawing = outgoing.get(node)
      if (!drawing) { renderLine(node, lines, applyStyle, lineStyle); return }
      const style = typeof applyStyle === 'function'
        ? (line: unknown, child: MapNode, ...args: unknown[]) => applyStyle(line, originals.get(child) ?? child, ...args)
        : applyStyle
      drawing.layout.renderLine(drawing.node, lines, style, lineStyle)
    }
    native.nodeIsRemoveAllLines = node => {
      const drawing = outgoing.get(node)
      return drawing ? !!drawing.layout.nodeIsRemoveAllLines?.(drawing.node) : !!removeLines?.(node)
    }
    native.renderExpandBtn = (node, ...args) => {
      const drawing = incoming.get(node) ?? outgoing.get(node)
      if (drawing) drawing.layout.renderExpandBtn(drawing.node, ...args)
      else renderExpandBtn(node, ...args)
    }
    native.renderExpandBtnRect = (rect, size, width, height, node) => {
      const drawing = incoming.get(node) ?? outgoing.get(node)
      if (drawing) drawing.layout.renderExpandBtnRect(rect, size, width, height, drawing.node)
      else renderExpandBtnRect(rect, size, width, height, node)
    }
    native.renderGeneralization = items => {
      const drawing = items[0] && outgoing.get(items[0].node)
      if (drawing) drawing.layout.renderGeneralization(items)
      else renderGeneralization(items)
    }
  }
  map.on('node_tree_render_start', setup)
  return () => map.off('node_tree_render_start', setup)
}
