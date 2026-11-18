import type { EditorView } from '@codemirror/view'

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))

export function mountMarkdownScrollbar(view: EditorView, host: HTMLElement) {
  const { scrollDOM, contentDOM } = view
  const track = document.createElement('div')
  const thumb = document.createElement('div')
  scrollDOM.id = 'markdown-document-scroll'
  track.className = 'markdown-scrollbar'
  track.tabIndex = 0
  track.setAttribute('role', 'scrollbar')
  track.setAttribute('aria-label', 'Markdown 正文滚动条')
  track.setAttribute('aria-controls', scrollDOM.id)
  track.setAttribute('aria-valuenow', '0')
  track.hidden = true
  thumb.className = 'markdown-scrollbar-thumb'
  track.append(thumb)
  host.append(track)

  let frame: number | undefined
  let drag: { id: number; y: number; grab: number } | undefined

  function measure() {
    const { clientHeight, scrollHeight } = scrollDOM
    return {
      height: clientHeight,
      limit: Math.max(0, scrollHeight - clientHeight),
      thumbSize: Math.min(clientHeight, Math.max(24, clientHeight * clientHeight / Math.max(1, scrollHeight))),
    }
  }

  function sync() {
    const { height, limit, thumbSize } = measure()
    track.hidden = !height || limit <= 1
    if (track.hidden) return
    const travel = height - thumbSize
    track.style.top = scrollDOM.offsetTop + 'px'
    track.style.height = height + 'px'
    let position = limit ? clamp(scrollDOM.scrollTop / limit, 1) * travel : 0
    if (drag && travel > 0) {
      // The height map changes as CodeMirror measures newly visible blocks.
      // Keep the same point on the thumb under the pointer while the range changes.
      const y = drag.y - track.getBoundingClientRect().top
      position = clamp(y - drag.grab * thumbSize, travel)
      const target = position / travel * limit
      if (Math.abs(scrollDOM.scrollTop - target) > .5) scrollDOM.scrollTop = target
    }
    thumb.style.height = thumbSize + 'px'
    thumb.style.transform = 'translateY(' + position + 'px)'
    track.setAttribute('aria-valuenow', String(Math.round(travel > 0 ? position / travel * 100 : 0)))
  }

  function schedule() {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      sync()
    })
  }

  const events = new AbortController()
  const options = { signal: events.signal }
  track.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || drag) return
    event.preventDefault()
    const rect = thumb.getBoundingClientRect()
    const grab = event.target === thumb && rect.height ? clamp((event.clientY - rect.top) / rect.height, 1) : .5
    drag = { id: event.pointerId, y: event.clientY, grab }
    track.setPointerCapture(event.pointerId)
    track.dataset.dragging = 'true'
    schedule()
  }, options)
  track.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return
    drag.y = event.clientY
    schedule()
  }, options)
  track.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return
    drag.y = event.clientY
    sync()
  }, options)
  track.addEventListener('lostpointercapture', () => {
    drag = undefined
    delete track.dataset.dragging
    schedule()
  }, options)
  track.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
    const { clientHeight, scrollHeight } = scrollDOM
    const steps: Record<string, number> = {
      ArrowUp: -40, ArrowDown: 40, PageUp: -clientHeight, PageDown: clientHeight,
      Home: -scrollHeight, End: scrollHeight,
    }
    if (!Object.hasOwn(steps, event.key)) return
    event.preventDefault()
    scrollDOM.scrollTop += steps[event.key]
  }, options)
  track.addEventListener('wheel', event => {
    if (event.ctrlKey) return
    event.preventDefault()
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scrollDOM.clientHeight : 1
    scrollDOM.scrollBy(event.deltaX * scale, event.deltaY * scale)
  }, { ...options, passive: false })
  scrollDOM.addEventListener('scroll', schedule, { ...options, passive: true })
  const observer = new ResizeObserver(schedule)
  observer.observe(scrollDOM)
  observer.observe(contentDOM)
  schedule()
  return () => {
    observer.disconnect()
    events.abort()
    if (frame !== undefined) cancelAnimationFrame(frame)
    track.remove()
  }
}
