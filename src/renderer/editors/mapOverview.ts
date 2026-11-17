import type MindMap from 'simple-mind-map'
import type { MapNode } from 'simple-mind-map'

const svgNS = 'http://www.w3.org/2000/svg'

function addPath(groups: Map<string, string[]>, color: string, path: string) {
  const commands = groups.get(color)
  if (commands) commands.push(path)
  else groups.set(color, [path])
}

function paths(groups: Map<string, string[]>, stroke = false) {
  return [...groups].map(([color, commands]) => {
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', commands.join(' '))
    path.setAttribute('fill', stroke ? 'none' : color)
    if (stroke) {
      path.setAttribute('stroke', color)
      path.setAttribute('vector-effect', 'non-scaling-stroke')
      path.setAttribute('stroke-width', '1')
    }
    return path
  })
}

export function installMapOverview(map: MindMap, canvas: HTMLElement, element: HTMLDivElement) {
  const svg = element.querySelector('svg')!
  const viewport = element.querySelector('i')!
  let geometry: { scale: number; x: number; y: number } | undefined
  let drag: { pointer: number; x: number; y: number } | undefined
  let sceneNeedsUpdate = false
  let sceneFrame = 0
  let viewFrame = 0

  const transform = () => map.draw.node.getScreenCTM()

  function updateViewport() {
    const matrix = transform()
    if (!matrix || !geometry) return
    const bounds = canvas.getBoundingClientRect()
    const { scale, x, y } = geometry
    const left = ((bounds.left - matrix.e) / matrix.a - x) * scale
    const top = ((bounds.top - matrix.f) / matrix.d - y) * scale
    viewport.style.transform = `translate(${left}px, ${top}px)`
    viewport.style.width = bounds.width * scale / matrix.a + 'px'
    viewport.style.height = bounds.height * scale / matrix.d + 'px'
  }

  function drawScene() {
    if (drag) { sceneNeedsUpdate = true; return }
    sceneNeedsUpdate = false
    const root = map.renderer.root
    if (!root || !element.clientWidth || !element.clientHeight) return
    const fills = new Map<string, string[]>()
    const strokes = new Map<string, string[]>()
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    const stack: MapNode[] = [root]
    while (stack.length) {
      const node = stack.pop()!
      const { left: x, top: y, width, height } = node
      const color = node.style.merge('fillColor')
      addPath(fills, typeof color === 'string' && color !== 'transparent' && CSS.supports('color', color) ? color : '#8491a6',
        `M${x},${y}h${width}v${height}h${-width}z`)
      left = Math.min(left, x); right = Math.max(right, x + width)
      top = Math.min(top, y); bottom = Math.max(bottom, y + height)
      if (node.getData('expand') === false) continue
      for (const [index, child] of node.children.entries()) {
        const line = node._lines?.[index]?.node
        const stroke = line?.getAttribute('stroke')
        addPath(strokes, stroke && CSS.supports('color', stroke) ? stroke : '#8491a6',
          line?.getAttribute('d') || `M${x + width / 2},${y + height / 2}L${child.left + child.width / 2},${child.top + child.height / 2}`)
        stack.push(child)
      }
    }
    const width = Math.max(right - left, canvas.clientWidth, 1) * 1.12
    const height = Math.max(bottom - top, canvas.clientHeight, 1) * 1.12
    const scale = Math.min(element.clientWidth / width, element.clientHeight / height)
    const worldWidth = element.clientWidth / scale
    const worldHeight = element.clientHeight / scale
    const x = (left + right - worldWidth) / 2
    const y = (top + bottom - worldHeight) / 2
    geometry = { x, y, scale }
    svg.setAttribute('viewBox', `${x} ${y} ${worldWidth} ${worldHeight}`)
    svg.replaceChildren(...paths(strokes, true), ...paths(fills))
    updateViewport()
  }

  const queueScene = () => {
    cancelAnimationFrame(sceneFrame)
    sceneFrame = requestAnimationFrame(drawScene)
  }
  const queueViewport = () => {
    if (viewFrame) return
    viewFrame = requestAnimationFrame(() => { viewFrame = 0; updateViewport() })
  }
  const start = (event: PointerEvent) => {
    if (!geometry || event.button !== 0) return
    element.setPointerCapture(event.pointerId)
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const move = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId || !geometry) return
    const matrix = transform()
    if (!matrix) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.x = event.clientX
    drag.y = event.clientY
    map.view.translateXY(-dx * matrix.a / geometry.scale, -dy * matrix.d / geometry.scale)
    updateViewport()
  }
  const stop = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return
    drag = undefined
    if (sceneNeedsUpdate) queueScene()
  }
  const resize = new ResizeObserver(queueScene)
  resize.observe(canvas)
  map.on('node_tree_render_end', queueScene)
  map.on('view_data_change', queueViewport)
  element.addEventListener('pointerdown', start)
  element.addEventListener('pointermove', move)
  element.addEventListener('lostpointercapture', stop)
  queueScene()
  return () => {
    cancelAnimationFrame(sceneFrame)
    cancelAnimationFrame(viewFrame)
    resize.disconnect()
    map.off('node_tree_render_end', queueScene)
    map.off('view_data_change', queueViewport)
    element.removeEventListener('pointerdown', start)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('lostpointercapture', stop)
  }
}
