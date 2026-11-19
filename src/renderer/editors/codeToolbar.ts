import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArrowRightToLine, Check, Copy, List, ListOrdered, WrapText, type LucideIcon } from 'lucide-react'
import type { CodeBlockPreferences } from '../../shared/contracts'

export type CodeDisplayOption = keyof CodeBlockPreferences

export const codeDisplayControls = [
  { option: 'lineNumbers', label: '显示行号', on: ListOrdered, off: List },
  { option: 'wrap', label: '自动换行', on: WrapText, off: ArrowRightToLine },
] as const

export function codeButton(label: string, icon: LucideIcon, onClick: (button: HTMLButtonElement) => void) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'icon-button'
  element.title = element.ariaLabel = label
  element.innerHTML = renderToStaticMarkup(createElement(icon, { size: 15, 'aria-hidden': true }))
  element.addEventListener('click', () => onClick(element))
  return element
}

export function codeDisplayButtons(options: CodeBlockPreferences, toggle: (option: CodeDisplayOption) => void) {
  return codeDisplayControls.map(({ option, label, on, off }) => {
    const active = options[option]
    const button = codeButton(label, active ? on : off, () => toggle(option))
    button.ariaPressed = String(active)
    button.dataset.codeOption = option
    return button
  })
}

export function copyCodeButton(read: () => string | undefined) {
  let reset: number | undefined
  const copyIcon = renderToStaticMarkup(createElement(Copy, { size: 15, 'aria-hidden': true }))
  return codeButton('复制代码', Copy, element => {
    const code = read()
    if (code === undefined) return
    void navigator.clipboard.writeText(code).then(() => {
      if (!element.isConnected) return
      window.clearTimeout(reset)
      element.innerHTML = renderToStaticMarkup(createElement(Check, { size: 15, 'aria-hidden': true }))
      element.ariaLabel = element.title = '已复制代码'
      reset = window.setTimeout(() => { element.innerHTML = copyIcon; element.ariaLabel = element.title = '复制代码' }, 1100)
    }).catch(() => { if (element.isConnected) element.title = '复制失败' })
  })
}
