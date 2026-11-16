export const outlineTextColors = [
  ['default', '默认'], ['red', '红色'], ['yellow', '黄色'], ['green', '绿色'], ['blue', '蓝色'], ['purple', '紫色'],
] as const

export type OutlineColor = (typeof outlineTextColors)[number][0]
export const colorOpening = /^<span class="ymd-text-(red|yellow|green|blue|purple)">/
const colorClosing = '</span>'

export function formatSelection(text: string, start: number, end: number, open: string, close = open) {
  const selected = text.slice(start, end)
  const leading = selected.match(/^\s*/)?.[0].length ?? 0
  const trailing = selected.match(/\s*$/)?.[0].length ?? 0
  if (leading + trailing >= selected.length) return
  start += leading
  end -= trailing
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return replaceStyle(text, start - open.length, end + close.length, text.slice(start, end))
  }
  return replaceStyle(text, start, end, text.slice(start, end), open, close)
}

export function colorSelection(text: string, start: number, end: number, color: OutlineColor) {
  const selected = text.slice(start, end)
  if (!selected.trim()) return
  const before = /<span class="ymd-text-(?:red|yellow|green|blue|purple)">$/.exec(text.slice(0, start))
  const open = color === 'default' ? '' : '<span class="ymd-text-' + color + '">'
  const close = open ? colorClosing : ''
  if (before && text.startsWith(colorClosing, end)) return replaceStyle(text, start - before[0].length, end + colorClosing.length, selected, open, close)
  const match = colorOpening.exec(selected)
  if (match && selected.endsWith(colorClosing)) return replaceStyle(text, start, end,
    selected.slice(match[0].length, -colorClosing.length), open, close)
  if (color !== 'default') return replaceStyle(text, start, end, selected, open, close)
}

function replaceStyle(text: string, start: number, end: number, selected: string, open = '', close = '') {
  return {
    text: text.slice(0, start) + open + selected + close + text.slice(end),
    start: start + open.length,
    end: start + open.length + selected.length,
  }
}

export function renderedSelection(source: string, preview: HTMLElement) {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return
  const range = selection.getRangeAt(0)
  if (!preview.contains(range.startContainer) || !preview.contains(range.endContainer)) return
  const selected = range.toString()
  if (!selected.trim()) return
  const prefix = range.cloneRange()
  prefix.selectNodeContents(preview)
  prefix.setEnd(range.startContainer, range.startOffset)
  const nearby = prefix.toString()
  let occurrence = 0
  for (let index = nearby.indexOf(selected); index >= 0; index = nearby.indexOf(selected, index + selected.length)) occurrence++
  let start = source.indexOf(selected)
  while (start >= 0 && occurrence-- > 0) start = source.indexOf(selected, start + selected.length)
  if (start >= 0) return [start, start + selected.length] as const
}
