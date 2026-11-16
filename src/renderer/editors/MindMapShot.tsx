import { ArrowLeft, Camera, Copy, Download, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { MapShotRect as Rect } from '../../shared/contracts'

type Size = Pick<Rect, 'width' | 'height'>
type Point = { x: number; y: number }
const corners = ['nw', 'ne', 'sw', 'se'] as const
type DragMode = 'draw' | 'move' | (typeof corners)[number]
type Drag = { pointer: number; mode: DragMode; start: Point; box: Rect }
const minSide = 12
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function fit(box: Rect, bounds: Size, square: boolean): Rect {
  let width = Math.min(box.width, bounds.width)
  let height = Math.min(box.height, bounds.height)
  if (square) width = height = Math.min(width, height)
  return { x: clamp(Math.round(box.x + (box.width - width) / 2), 0, bounds.width - width),
    y: clamp(Math.round(box.y + (box.height - height) / 2), 0, bounds.height - height), width, height }
}

function between(a: Point, b: Point, bounds: Size, square: boolean): Rect {
  if (square) {
    const sx = b.x < a.x ? -1 : 1
    const sy = b.y < a.y ? -1 : 1
    const side = Math.min(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)),
      sx < 0 ? a.x : bounds.width - a.x, sy < 0 ? a.y : bounds.height - a.y)
    b = { x: a.x + sx * side, y: a.y + sy * side }
  }
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

function compose(canvas: HTMLCanvasElement, image: ImageBitmap, scale: number, border: number, color: string, shadow: boolean, watermark: boolean) {
  const frame = Math.round(border * scale)
  const margin = shadow ? Math.ceil(24 * scale) : 0
  const width = image.width + frame * 2
  const height = image.height + frame * 2
  canvas.width = width + margin * 2
  canvas.height = height + margin * 2
  const context = canvas.getContext('2d')!
  if (shadow || frame) {
    context.save()
    context.fillStyle = frame ? color : '#fff'
    if (shadow) {
      context.shadowColor = '#10162955'
      context.shadowBlur = 14 * scale
      context.shadowOffsetY = 6 * scale
    }
    context.fillRect(margin, margin, width, height)
    context.restore()
  }
  context.drawImage(image, margin + frame, margin + frame)
  if (!watermark) return
  const label = '由 Ymd 生成'
  const inset = Math.round(8 * scale)
  const badgeHeight = Math.round(22 * scale)
  context.font = '600 ' + Math.round(11 * scale) + 'px system-ui'
  const badgeWidth = Math.ceil(context.measureText(label).width + inset * 2)
  if (badgeWidth + inset * 2 > width || badgeHeight + inset * 2 > height) return
  const x = margin + width - badgeWidth - inset
  const y = margin + height - badgeHeight - inset
  context.fillStyle = '#1d2639d9'
  context.beginPath()
  context.roundRect(x, y, badgeWidth, badgeHeight, Math.round(4 * scale))
  context.fill()
  context.fillStyle = 'white'
  context.textBaseline = 'middle'
  context.fillText(label, x + inset, y + badgeHeight / 2)
}

export function MindMapShot({ title, close }: { title: string; close: (message?: string) => void }) {
  const surface = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | undefined>(undefined)
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const mounted = useRef(false)
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 })
  const [selection, setSelection] = useState<Rect>()
  const [square, setSquare] = useState(true)
  const [preview, setPreview] = useState<{ image: ImageBitmap; scale: number }>()
  const [border, setBorder] = useState(0)
  const [color, setColor] = useState('#c5d7eb')
  const [shadow, setShadow] = useState(false)
  const [watermark, setWatermark] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = selection && fit(selection, bounds, square)
  const valid = !!box && box.width >= minSide && box.height >= minSide

  useEffect(() => {
    const element = surface.current
    if (!element) return
    mounted.current = true
    const resize = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      setBounds({ width, height })
      const side = Math.floor(Math.min(width, height) * .68)
      if (side >= minSide) setSelection(current => current ?? {
        x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side,
      })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => { mounted.current = false; observer.disconnect() }
  }, [])
  useEffect(() => { area.current?.focus() }, [valid])
  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal()
    return () => { preview?.image.close() }
  }, [preview])
  useEffect(() => {
    if (preview && canvas.current) compose(canvas.current, preview.image, preview.scale, border, color, shadow, watermark)
  }, [preview, border, color, shadow, watermark])
  useEffect(() => {
    if (preview) return
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return
      event.preventDefault()
      if (!busy) close()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [preview, busy, close])

  function point(event: PointerEvent): Point {
    const origin = surface.current!.getBoundingClientRect()
    return { x: clamp(Math.round(event.clientX - origin.left), 0, bounds.width),
      y: clamp(Math.round(event.clientY - origin.top), 0, bounds.height) }
  }

  function move(event: PointerEvent) {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const now = point(event)
    const { start, mode, box } = current
    if (mode === 'move') {
      setSelection(fit({ ...box, x: box.x + now.x - start.x, y: box.y + now.y - start.y }, bounds, square))
      return
    }
    const anchor = mode === 'draw' ? start : {
      x: box.x + (mode.endsWith('w') ? box.width : 0),
      y: box.y + (mode.startsWith('n') ? box.height : 0),
    }
    const next = between(anchor, now, bounds, square)
    if (next.width >= minSide && next.height >= minSide) setSelection(next)
  }

  async function capture() {
    const element = surface.current
    const stage = element?.parentElement
    if (!element || !stage || !valid || !box || busy) return
    const origin = element.getBoundingClientRect()
    const rect = { ...box, x: Math.round(origin.left) + box.x, y: Math.round(origin.top) + box.y }
    setBusy(true)
    setError('')
    stage.dataset.shotCapturing = 'true'
    try {
      // Wait for the canvas to paint without the selection and editing controls.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const data = await window.desktop.captureMapShot(rect)
      const image = await createImageBitmap(new Blob([data], { type: 'image/png' }))
      if (mounted.current) setPreview({ image, scale: image.width / rect.width })
      else image.close()
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : '无法截取导图。')
    } finally {
      delete stage.dataset.shotCapturing
      if (mounted.current) setBusy(false)
    }
  }

  function back() {
    if (busy) return
    dialog.current?.close()
    setPreview(undefined)
    setError('')
    area.current?.focus()
  }

  async function output(save: boolean) {
    const element = canvas.current
    if (!element || busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await new Promise<Blob | null>(resolve => element.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('无法生成 PNG 截图。')
      const completed = await window.desktop.outputMapShot(await blob.arrayBuffer(), save ? title : undefined)
      if (completed && mounted.current) close(save ? '截图已复制并保存。' : '截图已复制。')
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : '无法输出截图。')
    } finally { if (mounted.current) setBusy(false) }
  }

  return <>
    <div ref={surface} className="map-shot-overlay" role="group" aria-label="导图截图框选"
      onPointerDown={event => {
        if (busy || event.button !== 0 || !box || !(event.target instanceof Element) || event.target.closest('.map-shot-toolbar')) return
        const corner = event.target.getAttribute('data-corner') as DragMode | null
        const mode = corner ?? (event.target.closest('.map-shot-area') ? 'move' : 'draw')
        area.current?.focus()
        drag.current = { pointer: event.pointerId, start: point(event), mode, box }
        event.currentTarget.setPointerCapture(event.pointerId)
      }} onPointerMove={move}
      onPointerUp={event => { move(event); drag.current = undefined }}
      onLostPointerCapture={() => { drag.current = undefined }}
      onPointerCancel={() => { drag.current = undefined }}
      onContextMenu={event => event.preventDefault()}>
      {valid && box && <div ref={area} className="map-shot-area" tabIndex={0} role="group" aria-label="截图选区"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        onKeyDown={event => {
          if (busy || event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); void capture(); return }
          const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key]
          if (!delta) return
          event.preventDefault()
          const [x, y] = delta
          if (event.shiftKey) {
            const next = between(box, { x: clamp(box.x + box.width + x * 8, box.x + minSide, bounds.width),
              y: clamp(box.y + box.height + y * 8, box.y + minSide, bounds.height) }, bounds, square)
            if (square) {
              const side = clamp(box.width + (x || y) * 8, minSide, Math.min(bounds.width - box.x, bounds.height - box.y))
              setSelection({ ...box, width: side, height: side })
            } else setSelection(next)
          } else setSelection(fit({ ...box, x: box.x + x * 8, y: box.y + y * 8 }, bounds, square))
        }}>
        {corners.map(corner => <span key={corner} className="map-shot-handle" data-corner={corner} />)}
      </div>}
      <div className="map-shot-toolbar">
        <div className="segments" role="group" aria-label="截图比例">
          <button type="button" aria-pressed={square} disabled={busy} onClick={() => setSquare(true)}>1:1</button>
          <button type="button" aria-pressed={!square} disabled={busy} onClick={() => {
            if (box) setSelection(box)
            setSquare(false)
          }}>自定义</button>
        </div>
        {valid && box && <output aria-label="截图尺寸">{box.width} × {box.height}</output>}
        <button type="button" className="icon-button" title="截取选区" aria-label="截取选区" disabled={!valid || busy}
          onClick={() => void capture()}><Camera size={17} /></button>
        <button type="button" className="icon-button" title="取消截图" aria-label="取消截图" disabled={busy}
          onClick={() => close()}><X size={17} /></button>
      </div>
      {!preview && error && <p role="alert" className="map-shot-error">{error}</p>}
    </div>
    <dialog ref={dialog} className="map-shot-preview" aria-labelledby="map-shot-title" onCancel={event => { event.preventDefault(); back() }}>
      {preview && <>
        <h2 id="map-shot-title">导图截图</h2>
        <div className="map-shot-image"><canvas ref={canvas} aria-label="截图预览" /></div>
        <div className="map-shot-options">
          <label>边框 <input type="range" min={0} max={48} value={border} aria-label="边框宽度" onChange={event => setBorder(event.target.valueAsNumber)} />
            <output>{border} px</output></label>
          <input type="color" value={color} aria-label="边框颜色" onChange={event => { setColor(event.target.value); if (!border) setBorder(12) }} />
          <label><input type="checkbox" checked={shadow} onChange={event => setShadow(event.target.checked)} />阴影</label>
          <label><input type="checkbox" checked={watermark} onChange={event => setWatermark(event.target.checked)} />Ymd 标记</label>
        </div>
        {error && <p role="alert" className="map-shot-preview-error">{error}</p>}
        <footer>
          <button type="button" onClick={back} disabled={busy}><ArrowLeft size={15} />返回框选</button>
          <button type="button" onClick={() => void output(false)} disabled={busy}><Copy size={15} />复制</button>
          <button type="button" className="primary" onClick={() => void output(true)} disabled={busy}><Download size={15} />复制并保存</button>
        </footer>
      </>}
    </dialog>
  </>
}
