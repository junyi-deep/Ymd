import { useLayoutEffect, useRef, useState } from 'react'
import { paneWidths } from '../shared/contracts'

const panes = {
  sidebar: { variable: '--sidebar-user-width', selector: '.window', label: '调整文件栏宽度' },
  outline: { variable: '--outline-user-width', selector: '.document-editing', label: '调整文档目录宽度' },
  map: { variable: '--map-user-width', selector: '.map-body', label: '调整思维导图右栏宽度' },
}

export function PaneResize({ pane, side, apply }: { pane: keyof typeof paneWidths; side: 'left' | 'right'; apply: (width: number) => void }) {
  const handle = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ x: number; width: number; value: number; owner: HTMLElement; previous: string } | undefined>(undefined)
  const [measured, setMeasured] = useState<number>()
  const { min, max } = paneWidths[pane]
  const { variable, selector, label } = panes[pane]
  const direction = side === 'left' ? 1 : -1
  const clamp = (value: number, owner: HTMLElement) => Math.min(max, Math.max(min, Math.min(
    Math.round(owner.clientWidth * (pane === 'sidebar' ? .52 : .5)), Math.round(value),
  )))

  useLayoutEffect(() => {
    const parent = handle.current?.parentElement
    if (!parent) return
    const measure = () => setMeasured(Math.round(parent.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  function finish(save: boolean) {
    const current = gesture.current
    gesture.current = undefined
    if (!current) return
    current.owner.removeAttribute('data-resizing-pane')
    if (save && current.width !== current.value) apply(current.value)
    else current.owner.style.setProperty(variable, current.previous)
  }

  return <div ref={handle} className="pane-resize" data-side={side} role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={label}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={measured}
    onPointerDown={event => {
      const owner = event.currentTarget.closest<HTMLElement>(selector)
      const parent = event.currentTarget.parentElement
      if (event.button !== 0 || !event.isPrimary || !owner || !parent) return
      event.preventDefault()
      const width = Math.round(parent.getBoundingClientRect().width)
      gesture.current = { x: event.clientX, width, value: width, owner, previous: owner.style.getPropertyValue(variable) }
      event.currentTarget.setPointerCapture(event.pointerId)
      owner.setAttribute('data-resizing-pane', '')
    }} onPointerMove={event => {
      const current = gesture.current
      if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      current.value = clamp(current.width + (event.clientX - current.x) * direction, current.owner)
      current.owner.style.setProperty(variable, current.value + 'px')
    }} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const owner = event.currentTarget.closest<HTMLElement>(selector)
      if (!owner || measured === undefined) return
      event.preventDefault()
      const move = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 32 : 8) * direction
      const next = clamp(event.key === 'Home' ? min : event.key === 'End' ? max : measured + move, owner)
      if (next !== measured) apply(next)
    }} />
}
