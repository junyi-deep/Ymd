import type MindMap from 'simple-mind-map'
import type { MapNode } from 'simple-mind-map'
import { calloutNumber, calloutStyle, readCallouts, type Callout, type CalloutTarget } from './mapCallouts'

type Events = {
  select(target?: CalloutTarget): void
  edit(target: CalloutTarget): void
  remove(target: CalloutTarget): void
  menu(target: CalloutTarget, x: number, y: number): void
  follow(url: string): void
  download(note: Callout): void
  change(target: CalloutTarget, patch: Record<string, number>): void
}

const ns = 'http://www.w3.org/2000/svg'
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}) {
  const node = document.createElementNS(ns, tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
  return node
}

const keyOf = ({ owner, id }: CalloutTarget) => owner + ':' + id
const stop = (event: Event) => event.stopPropagation()
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function wrapText(text: string, width: number, measure: CanvasRenderingContext2D | null) {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const { segment } of segments.segment(paragraph)) {
      const next = line + segment
      if (line && (measure?.measureText(next).width ?? next.length * 10) > width) {
        lines.push(line)
        line = ''
      }
      line += segment
    }
    lines.push(line)
  }
  return lines
}

function pointNearBox(dx: number, dy: number, width: number, height: number) {
  const distance = Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2))
  return distance ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 }
}

export function installCallouts(map: MindMap, events: Events) {
  const layer = svg('g', { class: 'ymd-callout-layer' })
  map.draw.node.append(layer)
  const measure = document.createElement('canvas').getContext('2d')
  const groups = new Map<string, SVGGElement>()
  const entries = new Map<string, { node: MapNode; note: Callout; index: number }>()
  let selected: string | undefined
  let showControls = true
  let pressed: { key: string; pointer: number; resize: boolean; x: number; y: number; width: number;
    startX: number; startY: number; patch?: Record<string, number> } | undefined

  function paint(key: string) {
    const entry = entries.get(key)
    const group = groups.get(key)
    if (!entry || !group) return
    const { node, note, index } = entry
    const data = { ...note.data, ...(pressed?.key === key ? pressed.patch : undefined) }
    const appearance = calloutStyle(data)
    const width = appearance.width
    const offsetX = calloutNumber(data.calloutX, node.width / 2 + width / 2 + 26, -12000, 12000)
    const offsetY = calloutNumber(data.calloutY, -node.height / 2 - 44 - index * 74, -12000, 12000)
    const ownerX = node.left + node.width / 2
    const ownerY = node.top + node.height / 2
    const x = ownerX + offsetX
    const y = ownerY + offsetY
    const padding = appearance.shape === 'ellipse' ? Math.max(20, width * .16) : 12
    if (measure) measure.font = (appearance.italic ? 'italic ' : '') + appearance.weight + ' ' + appearance.size + 'px ' + appearance.font
    const lines = wrapText(note.data.text, Math.max(24, width - padding * 2), measure)
    const actions: { label: string; run: () => void }[] = []
    const href = note.data.hyperlink
    if (typeof href === 'string' && href) actions.push({ label: '打开链接', run: () => events.follow(href) })
    if (note.data.attachmentUrl) actions.push({ label: '下载附件', run: () => events.download(note) })
    const lineHeight = appearance.size * 1.35
    const vertical = appearance.shape === 'ellipse' ? 17 : 9
    const height = vertical * 2 + lines.length * lineHeight + actions.length * 17
    const body = appearance.shape === 'ellipse' ? svg('ellipse', { cx: 0, cy: 0, rx: width / 2, ry: height / 2 })
      : svg('rect', { x: -width / 2, y: -height / 2, width, height, rx: appearance.shape === 'rectangle' ? 0 : 9 })
    body.setAttribute('fill', appearance.fill)
    body.setAttribute('stroke', appearance.color)
    body.setAttribute('stroke-opacity', '.3')
    body.setAttribute('data-callout-body', '')

    const radius = appearance.shape === 'ellipse' ? Math.hypot(offsetX / (width / 2), offsetY / (height / 2)) : 0
    const anchor = radius ? { x: -offsetX / radius, y: -offsetY / radius } : pointNearBox(-offsetX, -offsetY, width, height)
    const owner = pointNearBox(offsetX, offsetY, node.width, node.height)
    const endX = ownerX + owner.x - x
    const endY = ownerY + owner.y - y
    const leader = svg('line', { x1: anchor.x, y1: anchor.y, x2: endX, y2: endY, stroke: appearance.color,
      'stroke-opacity': '.58', 'stroke-width': 1.5, 'pointer-events': 'none' })
    const needle = Math.hypot(endX - anchor.x, endY - anchor.y)
    const parts: SVGElement[] = [leader, body]
    if (needle >= 9) {
      const dx = (endX - anchor.x) / needle
      const dy = (endY - anchor.y) / needle
      const ax = anchor.x - dx * 4
      const ay = anchor.y - dy * 4
      parts.push(svg('polygon', { points: [ax + dy * 6, ay - dx * 6, anchor.x + dx * 10, anchor.y + dy * 10, ax - dy * 6, ay + dx * 6].join(' '),
        fill: appearance.fill, 'pointer-events': 'none' }))
    }
    const align = appearance.align === 'center' ? 'middle' : appearance.align === 'right' ? 'end' : 'start'
    const textX = appearance.align === 'center' ? 0 : appearance.align === 'right' ? width / 2 - padding : -width / 2 + padding
    const text = svg('text', { 'text-anchor': align, fill: appearance.color, 'font-size': appearance.size,
      'font-family': appearance.font, 'font-weight': appearance.weight, 'font-style': appearance.italic ? 'italic' : 'normal',
      'text-decoration': data.textDecoration === 'underline' ? 'underline' : 'none', 'pointer-events': 'none',
      'xml:space': 'preserve' })
    lines.forEach((line, index) => {
      const span = svg('tspan', { x: textX, y: -height / 2 + vertical + appearance.size + lineHeight * index })
      span.textContent = line
      text.append(span)
    })
    parts.push(text)
    for (const [index, action] of actions.entries()) {
      const control = svg('text', { x: -width / 2 + padding, y: -height / 2 + vertical + lineHeight * lines.length + 13 + index * 17,
        fill: appearance.color, 'text-decoration': 'underline', 'font-size': 12, 'font-family': 'system-ui',
        role: 'link', tabindex: 0, 'data-callout-action': '', 'aria-label': action.label })
      control.textContent = action.label
      control.addEventListener('click', event => { stop(event); action.run() })
      control.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); stop(event); action.run() }
      })
      parts.push(control)
    }
    if (selected === key && showControls) {
      parts.push(svg('rect', { x: -width / 2 - 2, y: -height / 2 - 2, width: width + 4, height: height + 4,
        rx: 5, fill: 'none', stroke: '#597bee', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }))
      parts.push(svg('rect', { x: width / 2 - 6, y: height / 2 - 6, width: 12, height: 12, rx: 2,
        fill: '#597bee', stroke: '#fff', 'data-callout-resize': '', 'aria-label': '调整标注宽度' }))
    }
    group.setAttribute('transform', 'translate(' + x + ' ' + y + ')')
    group.setAttribute('aria-label', '标注 ' + note.data.text)
    group.setAttribute('aria-pressed', String(selected === key))
    group.replaceChildren(...parts)
  }

  function pointerPosition(event: PointerEvent) {
    const matrix = layer.getScreenCTM()
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : undefined
  }

  function select(target?: CalloutTarget, focus = false) {
    const old = selected
    selected = target ? keyOf(target) : undefined
    if (old && old !== selected) paint(old)
    if (selected) {
      if (old !== selected) paint(selected)
      if (focus) groups.get(selected)?.focus()
    }
  }

  function build(target: CalloutTarget) {
    const key = keyOf(target)
    const group = svg('g', { class: 'ymd-callout', role: 'button', tabindex: 0, 'data-ymd-callout': target.id })
    const choose = () => { events.select(target); select(target, true) }
    group.addEventListener('focus', () => { if (selected !== key) choose() })
    for (const type of ['mousedown', 'mouseup', 'click']) group.addEventListener(type, stop)
    group.addEventListener('dblclick', event => {
      stop(event)
      if (!(event.target instanceof Element && event.target.closest('[data-callout-action]'))) events.edit(target)
    })
    group.addEventListener('contextmenu', event => {
      event.preventDefault(); stop(event)
      choose()
      events.menu(target, event.clientX, event.clientY)
    })
    group.addEventListener('pointerdown', event => {
      stop(event)
      const element = event.target
      if (event.button !== 0 || !(element instanceof Element) || element.closest('[data-callout-action]')) return
      const entry = entries.get(key)
      const point = pointerPosition(event)
      if (!entry || !point) return
      event.preventDefault()
      const resize = element.hasAttribute('data-callout-resize')
      const { node, note, index } = entry
      const { width } = calloutStyle(note.data)
      pressed = { key, pointer: event.pointerId, resize, width, startX: point.x, startY: point.y,
        x: calloutNumber(note.data.calloutX, node.width / 2 + width / 2 + 26, -12000, 12000),
        y: calloutNumber(note.data.calloutY, -node.height / 2 - 44 - index * 74, -12000, 12000) }
      choose()
      group.setPointerCapture(event.pointerId)
    })
    group.addEventListener('pointermove', event => {
      if (!pressed || pressed.key !== key || pressed.pointer !== event.pointerId) return
      stop(event)
      const point = pointerPosition(event)
      if (!point) return
      const deltaX = Math.round(point.x - pressed.startX)
      const deltaY = Math.round(point.y - pressed.startY)
      if (!pressed.patch && Math.abs(deltaX) + Math.abs(deltaY) < 3) return
      const width = calloutNumber(pressed.width + deltaX, pressed.width, 72, 640)
      pressed.patch = pressed.resize ? { calloutWidth: width, calloutX: pressed.x + (width - pressed.width) / 2, calloutY: pressed.y }
        : { calloutX: calloutNumber(pressed.x + deltaX, pressed.x, -12000, 12000),
          calloutY: calloutNumber(pressed.y + deltaY, pressed.y, -12000, 12000) }
      paint(key)
    })
    function cancel() {
      if (pressed?.key !== key) return
      pressed = undefined
      paint(key)
    }
    group.addEventListener('pointerup', event => {
      if (!pressed || pressed.key !== key || pressed.pointer !== event.pointerId) return
      stop(event)
      const patch = pressed.patch
      pressed = undefined
      if (patch) {
        events.change(target, patch)
        paint(key)
      }
    })
    group.addEventListener('pointercancel', cancel)
    group.addEventListener('lostpointercapture', cancel)
    group.addEventListener('keydown', event => {
      if (event.isComposing) return
      const command = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (command === 'z' || command === 'y')) {
        event.preventDefault(); stop(event)
        map.execCommand(command === 'y' || event.shiftKey ? 'FORWARD' : 'BACK')
        return
      }
      if (!['Enter', ' ', 'Escape', 'Backspace', 'Delete'].includes(event.key)) return
      event.preventDefault(); stop(event)
      if (event.key === 'Escape') { cancel(); events.select(); select() }
      else if (event.key === 'Enter' || event.key === ' ') events.edit(target)
      else events.remove(target)
    })
    layer.append(group)
    groups.set(key, group)
  }

  function update() {
    entries.clear()
    function visit(node: MapNode) {
      if (!node.group?.node.isConnected) return
      readCallouts(node.getData('ymdCallouts')).forEach((note, index) => {
        const target = { owner: node.uid, id: note.data.uid }
        const key = keyOf(target)
        entries.set(key, { node, note, index })
        if (!groups.has(key)) build(target)
        paint(key)
      })
      if (node.getData('expand') !== false) node.children.forEach(visit)
    }
    if (map.renderer.root) visit(map.renderer.root)
    for (const [key, group] of groups) {
      if (entries.has(key)) continue
      group.remove()
      groups.delete(key)
    }
  }

  map.on('node_tree_render_end', update)
  update()
  return {
    update,
    select,
    reveal(target: CalloutTarget) {
      const body = groups.get(keyOf(target))?.querySelector('[data-callout-body]')?.getBoundingClientRect()
      const viewport = layer.ownerSVGElement?.getBoundingClientRect()
      if (body && viewport) {
        map.view.translateXY(viewport.left + viewport.width / 2 - body.left - body.width / 2,
          viewport.top + viewport.height / 2 - body.top - body.height / 2)
      }
      select(target, true)
    },
    controls(visible: boolean) { showControls = visible; if (selected) paint(selected) },
    dispose() { map.off('node_tree_render_end', update); layer.remove() },
  }
}
