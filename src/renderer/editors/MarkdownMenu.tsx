import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  shortcut?: string
  selected?: boolean
  disabled?: boolean
  separator?: boolean
  children?: MenuItem[]
  swatches?: boolean
  run?: () => void
}

export function MarkdownMenu({ items, close, point, anchor, upward = false, nativeStyle = false, formatting = false }: {
  items: MenuItem[]
  close: () => void
  point?: { x: number; y: number }
  anchor?: HTMLElement
  upward?: boolean
  nativeStyle?: boolean
  formatting?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [stack, setStack] = useState<MenuItem[]>([])
  const visible = stack.at(-1)?.children ?? items
  const swatches = stack.at(-1)?.swatches
  const grid = formatting && !stack.length
  useLayoutEffect(() => {
    const menu = root.current
    menu?.focus({ preventScroll: true })
    if (point && menu) {
      const box = menu.getBoundingClientRect()
      menu.style.left = Math.max(5, Math.min(point.x, window.innerWidth - box.width - 5)) + 'px'
      menu.style.top = Math.max(5, Math.min(point.y, window.innerHeight - box.height - 5)) + 'px'
    }
  }, [stack, point])

  useEffect(() => {
    const outer = (event: PointerEvent) => {
      const target = event.target as Node
      const menu = root.current
      if (!menu || menu.contains(target)) return
      const trigger = anchor || menu.parentElement?.matches('.menu-anchor') && menu.parentElement.querySelector(':scope > button[aria-expanded="true"]')
      if (!trigger || !trigger.contains(target)) close()
    }
    window.addEventListener('pointerdown', outer)
    return () => window.removeEventListener('pointerdown', outer)
  }, [anchor, close])

  const renderItem = (item: MenuItem, iconOnly = false) => <div key={item.label} className={item.separator ? 'menu-divider' : undefined}>
    <button type="button" role="menuitem" aria-label={iconOnly ? item.label : undefined}
      title={iconOnly ? item.label : undefined} aria-haspopup={item.children ? 'menu' : undefined}
      data-selected={item.selected} disabled={item.disabled} onClick={() => {
        if (item.children) setStack(current => [...current, item])
        else { close(); item.run?.() }
      }}>
      {item.icon}{!iconOnly && <span>{item.label}</span>}{item.shortcut && <kbd>{item.shortcut}</kbd>}
      {item.children && <ChevronRight size={14} />}
    </button>
  </div>

  return <div ref={root} className={`document-menu${point ? ' position-fixed' : ''}${upward ? ' upward' : ''}${nativeStyle ? ' native-context' : ''}${formatting ? ' formatting-menu' : ''}`}
    role="menu" tabIndex={-1} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        if (stack.length) setStack(current => current.slice(0, -1))
        else {
          const trigger = anchor ?? root.current?.parentElement?.querySelector<HTMLButtonElement>(':scope > button')
          trigger?.focus()
          close()
        }
        return
      }
      if (event.key === 'ArrowLeft' && stack.length) {
        event.preventDefault()
        setStack(current => current.slice(0, -1))
      }
      if (event.key === 'ArrowRight' && document.activeElement instanceof HTMLButtonElement &&
          document.activeElement.getAttribute('aria-haspopup') === 'menu') {
        event.preventDefault()
        document.activeElement.click()
        return
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (!buttons.length) return
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
        : (index + buttons.length + (event.key === 'ArrowDown' ? 1 : -1)) % buttons.length
      buttons[next]?.focus()
    }}>
    {stack.length > 0 && <button type="button" className="menu-back" onClick={() => setStack(current => current.slice(0, -1))}>
      <ChevronRight size={14} />{stack.at(-1)?.label}
    </button>}
    {swatches ? <div className="menu-swatches">{visible.map(item => renderItem(item, true))}</div>
      : grid ? <><div className="menu-format-grid">{visible.slice(0, 8).map(item => renderItem(item, true))}</div>
        {visible.slice(8).map(item => renderItem(item))}</>
      : visible.map(item => renderItem(item))}
  </div>
}
