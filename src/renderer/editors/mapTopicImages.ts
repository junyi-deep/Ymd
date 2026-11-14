import type MindMap from 'simple-mind-map'
import type { MapNode } from 'simple-mind-map'
import { artTransferType, findArt, type MapArt } from './mapStickers'

export const imagePlacements = [
  ['top', '上方'], ['bottom', '下方'], ['left', '左侧'], ['right', '右侧'],
] as const
type Placement = (typeof imagePlacements)[number][0]
interface Size { width: number; height: number }

export function topicAcceptsArt(node?: MapNode) {
  return !!node && !node.isGeneralization
}

export function isTopicImage(target: EventTarget | null) {
  return target instanceof SVGImageElement && !!target.closest('.smm-node')
}

export function addTopicImage(map: MindMap, node: MapNode, url: string, title: string, size: Size, custom = true) {
  map.renderer.setNodeDataRender(node, {
    image: url, imageTitle: title, imageSize: { ...size, custom },
    ymdOriginalImageSize: custom ? size : null,
  })
}

export function applyArt(map: MindMap, node: MapNode, art: MapArt) {
  if (!topicAcceptsArt(node)) return
  const side = art.kind === '贴纸' ? 48 : 88
  addTopicImage(map, node, art.source, art.label, { width: side, height: side })
}

export function removeTopicImage(map: MindMap, node: MapNode) {
  map.renderer.setNodeDataRender(node, { image: null, imageTitle: '', imageSize: null, ymdOriginalImageSize: null })
}

export async function resetTopicImage(map: MindMap, node: MapNode) {
  const url = node.getData('image')
  if (typeof url !== 'string' || !url) return
  const stored = node.getData('ymdOriginalImageSize') as Size | undefined
  let size = stored
  const custom = !!size && Number.isFinite(size.width) && Number.isFinite(size.height)
  if (!custom) {
    const decoded = new Image()
    decoded.src = url
    await decoded.decode()
    const gain = Math.min(1, 240 / decoded.naturalWidth)
    size = { width: decoded.naturalWidth * gain, height: decoded.naturalHeight * gain }
  }
  if (map.renderer.findNodeByUid(node.uid) !== node || node.getData('image') !== url) return
  if (size) addTopicImage(map, node, url, String(node.getData('imageTitle') ?? ''), size, custom)
}

export function placeTopicImage(map: MindMap, node: MapNode, position: Placement) {
  map.execCommand('SET_NODE_STYLE', node, 'imgPlacement', position)
}

function sideOf(group: Element, clientX: number, clientY: number): Placement {
  const box = group.getBoundingClientRect()
  const x = (clientX - box.x) / Math.max(1, box.width) - 0.5
  const y = (clientY - box.y) / Math.max(1, box.height) - 0.5
  return Math.abs(x) > Math.abs(y) ? x < 0 ? 'left' : 'right' : y < 0 ? 'top' : 'bottom'
}

export function installTopicImageGestures(map: MindMap, canvas: HTMLElement) {
  const groups = new WeakMap<Element, MapNode>()
  let highlighted: Element | undefined
  let selectedImage: MapNode | undefined
  let movement: { group: Element; node: MapNode; x: number; y: number; pointer: number; shifted: boolean } | undefined
  function indexNodes() {
    const visit = (node: MapNode) => {
      if (node.group?.node) groups.set(node.group.node, node)
      node.children.forEach(visit)
    }
    if (map.renderer.root) visit(map.renderer.root)
  }

  function target(event: Event) {
    const group = event.target instanceof Element ? event.target.closest('.smm-node') ?? undefined : undefined
    const node = group && groups.get(group)
    return group && node ? { group, node } : undefined
  }

  function highlight(group?: Element) {
    if (highlighted === group) return
    highlighted?.removeAttribute('data-ymd-art-target')
    highlighted = group
    highlighted?.setAttribute('data-ymd-art-target', '')
  }

  function dragover(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(artTransferType)) return
    const hit = target(event)
    const accepted = hit && topicAcceptsArt(hit.node)
    highlight(accepted ? hit.group : undefined)
    if (!accepted) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  function drop(event: DragEvent) {
    highlight()
    const id = event.dataTransfer?.getData(artTransferType)
    if (!id) return
    event.preventDefault()
    const hit = target(event)
    const art = findArt(id)
    if (!hit || !art || !topicAcceptsArt(hit.node)) return
    hit.node.active()
    applyArt(map, hit.node, art)
  }
  function dragleave(event: DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !canvas.contains(event.relatedTarget)) highlight()
  }

  function pointerdown(event: PointerEvent) {
    if (event.button !== 0) return
    const hit = target(event)
    if (!hit || !isTopicImage(event.target)) { selectedImage = undefined; return }
    selectedImage = hit.node
    movement = { ...hit, x: event.clientX, y: event.clientY, pointer: event.pointerId, shifted: false }
    event.preventDefault()
    event.stopPropagation()
    canvas.focus()
    hit.node.active()
  }
  function pointermove(event: PointerEvent) {
    if (!movement || movement.pointer !== event.pointerId) return
    if (Math.hypot(event.clientX - movement.x, event.clientY - movement.y) < 6 && !movement.shifted) return
    movement.shifted = true
    movement.group.setAttribute('data-ymd-image-placement', sideOf(movement.group, event.clientX, event.clientY))
    event.preventDefault()
  }
  function finishMovement() {
    movement?.group.removeAttribute('data-ymd-image-placement')
    movement = undefined
  }
  function pointerup(event: PointerEvent) {
    const drag = movement
    if (!drag || drag.pointer !== event.pointerId) return
    finishMovement()
    if (drag.shifted && drag.group.isConnected) {
      placeTopicImage(map, drag.node, sideOf(drag.group, event.clientX, event.clientY))
      event.preventDefault()
    }
  }
  function clearOnTopicClick(_node: MapNode, event: MouseEvent) {
    if (!isTopicImage(event.target) && !movement) selectedImage = undefined
  }
  function keydown(event: KeyboardEvent) {
    if (!selectedImage || event.isComposing || event.defaultPrevented ||
        !['Backspace', 'Delete'].includes(event.key) || event.target !== canvas ||
        !map.renderer.activeNodeList.includes(selectedImage) || !selectedImage.getData('image')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    removeTopicImage(map, selectedImage)
    selectedImage = undefined
  }

  map.on('node_tree_render_end', indexNodes)
  map.on('node_click', clearOnTopicClick)
  canvas.addEventListener('dragover', dragover)
  canvas.addEventListener('drop', drop)
  canvas.addEventListener('dragleave', dragleave)
  window.addEventListener('dragend', clearHighlight)
  canvas.addEventListener('pointerdown', pointerdown, true)
  window.addEventListener('pointermove', pointermove)
  window.addEventListener('pointerup', pointerup)
  window.addEventListener('pointercancel', finishMovement)
  window.addEventListener('keydown', keydown, true)
  function clearHighlight() { highlight() }

  return () => {
    finishMovement()
    highlight()
    map.off('node_tree_render_end', indexNodes)
    map.off('node_click', clearOnTopicClick)
    canvas.removeEventListener('dragover', dragover)
    canvas.removeEventListener('drop', drop)
    canvas.removeEventListener('dragleave', dragleave)
    window.removeEventListener('dragend', clearHighlight)
    canvas.removeEventListener('pointerdown', pointerdown, true)
    window.removeEventListener('pointermove', pointermove)
    window.removeEventListener('pointerup', pointerup)
    window.removeEventListener('pointercancel', finishMovement)
    window.removeEventListener('keydown', keydown, true)
  }
}
