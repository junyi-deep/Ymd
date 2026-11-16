import type MindMap from 'simple-mind-map'
import type { MapNode } from 'simple-mind-map'
import { readAudioNote } from './mapAudio'
import { readEquation } from './mapEquation'
import { artTransferType, loadMapSticker, type MapArt } from './mapStickers'

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

export function addTopicImage(map: MindMap, node: MapNode, url: string, title: string, size: Size, custom = true, formula?: { latex: string; original: Size }) {
  map.renderer.setNodeDataRender(node, {
    image: url, imageTitle: title, imageSize: { ...size, custom },
    ymdOriginalImageSize: formula?.original ?? (custom ? size : null), ymdEquation: formula?.latex ?? null,
  })
}

export function applyArt(map: MindMap, node: MapNode, art: MapArt) {
  if (!topicAcceptsArt(node)) return
  addTopicImage(map, node, art.source, art.label, { width: 56, height: 56 })
}

export function removeTopicImage(map: MindMap, node: MapNode) {
  const formula = readEquation(node.getData('ymdEquation'))
  if (formula) map.command.originAddHistory()
  map.renderer.setNodeDataRender(node, { image: null, imageTitle: '', imageSize: null, ymdOriginalImageSize: null, ymdEquation: null })
  if (formula) map.command.originAddHistory()
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
  const latex = readEquation(node.getData('ymdEquation'))
  if (size) addTopicImage(map, node, url, String(node.getData('imageTitle') ?? ''), size, custom, latex ? { latex, original: size } : undefined)
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

export function installTopicImageGestures(map: MindMap, canvas: HTMLElement, editEquation: (node: MapNode) => void) {
  const groups = new WeakMap<Element, MapNode>()
  let highlighted: Element | undefined
  let selectedImage: MapNode | undefined
  let movement: { group: Element; node: MapNode; x: number; y: number; pointer: number; shifted: boolean } | undefined
  function indexNodes() {
    const visit = (node: MapNode) => {
      if (node.group?.node) {
        groups.set(node.group.node, node)
        const image = node.group.node.querySelector('image')
        image?.toggleAttribute('data-ymd-equation', !!readEquation(node.getData('ymdEquation')))
      }
      node.children.forEach(visit)
    }
    if (map.renderer.root) visit(map.renderer.root)
  }

  function target(element: EventTarget | null) {
    const group = element instanceof Element ? element.closest('.smm-node') ?? undefined : undefined
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
    const hit = target(event.target)
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
    const hit = target(event.target)
    if (!hit || !topicAcceptsArt(hit.node)) return
    const uid = hit.node.uid
    void loadMapSticker(id).then(art => {
      if (!art || !canvas.isConnected) return
      const node = map.renderer.findNodeByUid(uid)
      if (!node || !topicAcceptsArt(node)) return
      node.active()
      applyArt(map, node, art)
    }).catch(() => {})
  }
  function dragleave(event: DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !canvas.contains(event.relatedTarget)) highlight()
  }

  function pointerdown(event: PointerEvent) {
    if (event.button !== 0) return
    const hit = target(event.target)
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
    const hit = target(document.elementFromPoint(event.clientX, event.clientY))
    if (readEquation(movement.node.getData('ymdEquation')) && hit?.node !== movement.node) {
      movement.group.removeAttribute('data-ymd-image-placement')
      highlight(canReceiveEquation(hit?.node) ? hit?.group : undefined)
    } else {
      highlight()
      movement.group.setAttribute('data-ymd-image-placement', sideOf(movement.group, event.clientX, event.clientY))
    }
    event.preventDefault()
  }
  function canReceiveEquation(node?: MapNode): node is MapNode {
    return !!node && !node.isGeneralization && !node.getData('image') &&
      !readEquation(node.getData('ymdEquation')) && !readAudioNote(node.getData('ymdAudio'))
  }

  function moveEquation(source: MapNode, destination: MapNode) {
    map.command.originAddHistory()
    map.command.pause()
    try {
      map.renderer.setNodeDataRender(destination, {
        image: source.getData('image'), imageSize: source.getData('imageSize'), imageTitle: source.getData('imageTitle'),
        ymdOriginalImageSize: source.getData('ymdOriginalImageSize'), ymdEquation: source.getData('ymdEquation'),
        imgPlacement: source.getData('imgPlacement') ?? 'top',
      })
      removeTopicImage(map, source)
    } finally { map.command.recovery() }
    map.command.originAddHistory()
    destination.active()
  }

  function finishMovement() {
    movement?.group.removeAttribute('data-ymd-image-placement')
    if (movement) highlight()
    movement = undefined
  }
  function pointerup(event: PointerEvent) {
    const drag = movement
    if (!drag || drag.pointer !== event.pointerId) return
    finishMovement()
    if (!drag.shifted || !drag.group.isConnected) return
    const hit = target(document.elementFromPoint(event.clientX, event.clientY))
    if (readEquation(drag.node.getData('ymdEquation')) && hit?.node !== drag.node) {
      if (canReceiveEquation(hit?.node)) moveEquation(drag.node, hit.node)
    } else {
      placeTopicImage(map, drag.node, sideOf(drag.group, event.clientX, event.clientY))
    }
    event.preventDefault()
  }
  function clearOnTopicClick(_node: MapNode, event: MouseEvent) {
    if (!isTopicImage(event.target) && !movement) selectedImage = undefined
  }
  function doubleClick(event: MouseEvent) {
    const hit = target(event.target)
    if (!hit || !isTopicImage(event.target) || !readEquation(hit.node.getData('ymdEquation'))) return
    event.preventDefault()
    event.stopImmediatePropagation()
    editEquation(hit.node)
  }
  function keydown(event: KeyboardEvent) {
    if (!selectedImage || event.isComposing || event.defaultPrevented ||
        event.target !== canvas ||
        !map.renderer.activeNodeList.includes(selectedImage) || !selectedImage.getData('image')) return
    if (event.key === 'Enter' && readEquation(selectedImage.getData('ymdEquation'))) {
      event.preventDefault()
      event.stopImmediatePropagation()
      editEquation(selectedImage)
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      event.stopImmediatePropagation()
      removeTopicImage(map, selectedImage)
      selectedImage = undefined
    }
  }

  map.on('node_tree_render_end', indexNodes)
  map.on('node_click', clearOnTopicClick)
  canvas.addEventListener('dragover', dragover)
  canvas.addEventListener('drop', drop)
  canvas.addEventListener('dragleave', dragleave)
  window.addEventListener('dragend', clearHighlight)
  canvas.addEventListener('pointerdown', pointerdown, true)
  canvas.addEventListener('dblclick', doubleClick, true)
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
    canvas.removeEventListener('dblclick', doubleClick, true)
    window.removeEventListener('pointermove', pointermove)
    window.removeEventListener('pointerup', pointerup)
    window.removeEventListener('pointercancel', finishMovement)
    window.removeEventListener('keydown', keydown, true)
  }
}
