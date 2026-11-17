import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Crop, Download, Maximize, Maximize2, Minimize2, Minus, Plus, RotateCcw, RotateCw, X } from 'lucide-react'
import type { MediaPreview } from './mediaPreview'

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type CropArea = { start: Point; end: Point }
const center = { x: .5, y: .5 }
const defaultThumbnail = { width: 134, height: 92 }
const clip = (value: number, from = 0, to = 1) => Math.min(to, Math.max(from, value))

function pixelCrop(area: CropArea | undefined, size: Size) {
  if (!area) return { x: 0, y: 0, ...size }
  const x = Math.floor(Math.min(area.start.x, area.end.x) * size.width)
  const y = Math.floor(Math.min(area.start.y, area.end.y) * size.height)
  return { x, y, width: Math.ceil(Math.max(area.start.x, area.end.x) * size.width) - x,
    height: Math.ceil(Math.max(area.start.y, area.end.y) * size.height) - y }
}

export function MediaViewer({ request, close }: { request: MediaPreview; close: () => void }) {
  const modal = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<Size>({ width: 1, height: 1 })
  const [size, setSize] = useState<Size>()
  const [source, setSource] = useState(request.src)
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [location, setLocation] = useState<Point>(center)
  const [cropping, setCropping] = useState(false)
  const [area, setArea] = useState<CropArea>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [thumbnail, setThumbnail] = useState<Size>(defaultThumbnail)
  const [thumbnailSide, setThumbnailSide] = useState<'left' | 'right'>('right')
  const thumbnailDrag = useRef<{ x: number; y: number; width: number; height: number } | undefined>(undefined)
  const drag = useRef<{ pointer: number; start: Point; location: Point; crop?: Point } | undefined>(undefined)
  const fit = size ? Math.min(request.type === 'diagram' ? 2 : 1, Math.max(1, frame.width - 48) / size.width, Math.max(1, frame.height - 48) / size.height) : 1
  const scale = fit * zoom
  const width = (size?.width ?? 1) * scale
  const height = (size?.height ?? 1) * scale
  const marginX = Math.min(.5, frame.width / (2 * width))
  const marginY = Math.min(.5, frame.height / (2 * height))
  const actual = { x: clip(location.x, marginX, 1 - marginX), y: clip(location.y, marginY, 1 - marginY) }
  const left = frame.width / 2 - width * actual.x
  const top = frame.height / 2 - height * actual.y

  useLayoutEffect(() => {
    modal.current?.showModal()
    const target = viewport.current!
    const measure = () => setFrame({ width: target.clientWidth, height: target.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    measure()
    return () => observer.disconnect()
  }, [])

  function resetView() { setZoom(1); setLocation(center) }
  function resize(factor: number) {
    setLocation(actual)
    setZoom(value => clip(value * factor, .3, 12))
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  function convert(event: Point) { return { x: clip((event.x - left) / width), y: clip((event.y - top) / height) } }
  function navigateThumb(event: PointerEvent<HTMLDivElement>) {
    const local = point(event)
    setLocation({ x: clip(local.x / event.currentTarget.clientWidth), y: clip(local.y / event.currentTarget.clientHeight) })
  }

  async function bitmap(crop?: CropArea, rotate = false) {
    const src = /^https?:/i.test(source) ? await window.desktop.readPreviewImage(source) : source
    const image = new Image()
    image.src = src
    await image.decode()
    const bounds = pixelCrop(crop, { width: image.naturalWidth, height: image.naturalHeight })
    if (bounds.width < 2 || bounds.height < 2) throw new Error('请选择更大的裁剪范围。')
    if (bounds.width * bounds.height > 36_000_000 || bounds.width > 16000 || bounds.height > 16000) throw new Error('图像尺寸太大，请裁剪后重试。')
    const canvas = document.createElement('canvas')
    canvas.width = rotate ? bounds.height : bounds.width
    canvas.height = rotate ? bounds.width : bounds.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成图片。')
    if (rotate) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2) }
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('无法生成图片。')), 'image/png'))
  }

  async function work(action: () => Promise<void>) {
    setBusy(true)
    setNotice('')
    try { await action() }
    catch (error) { setNotice(String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')) }
    finally { setBusy(false) }
  }

  function transform(crop?: CropArea, rotate = false) {
    void work(async () => {
      const blob = await bitmap(crop, rotate)
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      setSource(encoded)
      setArea(undefined)
      setCropping(false)
      resetView()
    })
  }

  const thumbBounds = {
    width: clip(thumbnail.width, 76, Math.max(76, Math.min(320, frame.width - 55))),
    height: clip(thumbnail.height, 54, Math.max(54, Math.min(240, frame.height - 55))),
  }
  const thumbScale = size ? Math.min(thumbBounds.width / size.width, thumbBounds.height / size.height) : 1
  const tw = Math.max(1, (size?.width ?? 1) * thumbScale)
  const th = Math.max(1, (size?.height ?? 1) * thumbScale)

  function resizeThumbnail(width: number, height: number) {
    setThumbnail({
      width: clip(width, 76, Math.max(76, Math.min(320, frame.width - 55))),
      height: clip(height, 54, Math.max(54, Math.min(240, frame.height - 55))),
    })
  }
  const selection = area && pixelCrop(area, { width, height })
  const edited = source !== request.src
  function download(format: 'svg' | 'png') {
    void work(async () => {
      const data = format === 'svg' ? new TextEncoder().encode(request.svg!).buffer : await (await bitmap()).arrayBuffer()
      await window.desktop.savePreviewImage(request.title + (edited ? ' 副本' : ''), format, data)
    })
  }

  return <dialog ref={modal} className="media-dialog" data-expanded={expanded} aria-label={request.type === 'diagram' ? '查看 Mermaid 图' : '查看图片'}
    onCancel={event => { event.preventDefault(); if (cropping) { setCropping(false); setArea(undefined) } else if (expanded) setExpanded(false); else close() }}>
    <header><h2>{request.title}</h2><button type="button" className="icon-button" aria-label="关闭查看器" onClick={close}><X size={19} /></button></header>
    <div className="media-toolbar" role="toolbar" aria-label="图片操作">
      <button type="button" className="icon-button" aria-label="缩小" onClick={() => resize(1 / 1.25)}><Minus size={16} /></button>
      <button type="button" className="tool-button" aria-label="恢复适合窗口" onClick={resetView}>{Math.round(scale * 100)}%</button>
      <button type="button" className="icon-button" aria-label="放大" onClick={() => resize(1.25)}><Plus size={16} /></button>
      <button type="button" className="icon-button" aria-label="适合窗口" onClick={resetView}><Maximize size={15} /></button>
      <button type="button" className="icon-button" aria-pressed={expanded} aria-label={expanded ? '退出应用内全屏' : '应用内全屏'}
        title={expanded ? '退出应用内全屏' : '应用内全屏'} onClick={() => setExpanded(value => !value)}>
        {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
      {request.type === 'image' && <>
        <button type="button" className="tool-button" aria-pressed={cropping} disabled={busy || !size} onClick={() => { setCropping(!cropping); setArea(undefined) }}><Crop size={15} />裁剪</button>
        <button type="button" className="icon-button" aria-label="顺时针旋转" disabled={busy || cropping || !size} onClick={() => transform(undefined, true)}><RotateCw size={15} /></button>
        {edited && <button type="button" className="icon-button" aria-label="恢复原图" onClick={() => { setSource(request.src); setArea(undefined); setCropping(false); resetView() }}><RotateCcw size={15} /></button>}
      </>}
      <span className="media-toolbar-spacer" />
      {cropping ? <button type="button" className="tool-button" disabled={busy || !area} onClick={() => transform(area)}>应用裁剪</button> : <>
        <button type="button" className="tool-button" disabled={busy || !size} onClick={() => download('png')}><Download size={15} />下载 PNG</button>
        {request.svg && <button type="button" className="tool-button" disabled={busy} onClick={() => download('svg')}>下载 SVG</button>}
      </>}
    </div>
    <div className="media-stage" ref={viewport} tabIndex={0} aria-label="图片画布" data-cropping={cropping}
      onWheel={event => resize(event.deltaY < 0 ? 1.18 : 1 / 1.18)}
      onKeyDown={event => {
        const moves: Record<string, Point> = { ArrowLeft: { x: -.06, y: 0 }, ArrowRight: { x: .06, y: 0 },
          ArrowUp: { x: 0, y: -.06 }, ArrowDown: { x: 0, y: .06 } }
        const move = moves[event.key]
        if (!move) return
        event.preventDefault()
        setLocation({ x: actual.x + move.x, y: actual.y + move.y })
      }}
      onPointerDown={event => {
        if (!size || event.button !== 0 || (event.target instanceof Element && event.target.closest('.media-thumb-frame'))) return
        const start = point(event)
        const crop = cropping ? convert(start) : undefined
        drag.current = { pointer: event.pointerId, start, location: actual, crop }
        if (crop) setArea({ start: crop, end: crop })
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const now = point(event)
        const current = drag.current
        if (!current || current.pointer !== event.pointerId) return
        if (current.crop) setArea({ start: current.crop, end: convert(now) })
        else setLocation({ x: current.location.x - (now.x - current.start.x) / width,
          y: current.location.y - (now.y - current.start.y) / height })
      }}
      onLostPointerCapture={() => { drag.current = undefined }}>
      <img className="media-image" src={source} alt={request.title} draggable={false}
        style={{ left, top, width, height, visibility: size ? undefined : 'hidden' }}
        onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => { setSize(undefined); setNotice('无法显示图片。') }} />
      {cropping && selection && <div className="media-crop-area"
        style={{ left: left + selection.x, top: top + selection.y, width: selection.width, height: selection.height }} />}
      {size && !cropping && <div className="media-thumb-frame" data-side={thumbnailSide} style={thumbBounds}>
        <div className="media-thumb" role="group" aria-label="缩略图导航" tabIndex={0}
          style={{ width: tw, height: th }}
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); navigateThumb(event) }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) navigateThumb(event) }}>
          <img src={source} alt="" draggable={false} />
          <span style={{ left: (actual.x - marginX) * tw, top: (actual.y - marginY) * th, width: 2 * marginX * tw, height: 2 * marginY * th }} />
        </div>
        <button type="button" className="icon-button media-thumb-switch"
          aria-label={thumbnailSide === 'right' ? '小地图移到左下角' : '小地图移到右下角'}
          title={thumbnailSide === 'right' ? '移到左下角' : '移到右下角'}
          onClick={() => setThumbnailSide(current => current === 'right' ? 'left' : 'right')}>
          {thumbnailSide === 'right' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
        </button>
        <button type="button" className="media-thumb-resize" aria-label="调整小地图宽高" title="调整小地图宽高"
          onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            thumbnailDrag.current = { x: event.clientX, y: event.clientY, ...thumbBounds }
          }} onPointerMove={event => {
            const start = thumbnailDrag.current
            if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            const dx = (event.clientX - start.x) * (thumbnailSide === 'right' ? -1 : 1)
            resizeThumbnail(start.width + dx, start.height + start.y - event.clientY)
          }} onLostPointerCapture={() => { thumbnailDrag.current = undefined }}
          onKeyDown={event => {
            const move: Record<string, [number, number]> = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }
            const delta = move[event.key]
            if (!delta) return
            event.preventDefault()
            event.stopPropagation()
            resizeThumbnail(thumbBounds.width + delta[0], thumbBounds.height + delta[1])
          }} />
      </div>}
    </div>
    {(notice || cropping) && <p className="media-notice" role={notice ? 'alert' : undefined}>{notice || '拖动选取裁剪范围，再点击应用裁剪。'}</p>}
  </dialog>
}
