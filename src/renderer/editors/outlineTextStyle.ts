export const outlineTextColors = [
  ['default', '默认'], ['red', '红色'], ['yellow', '黄色'], ['green', '绿色'], ['blue', '蓝色'], ['purple', '紫色'],
] as const

export type OutlineColor = (typeof outlineTextColors)[number][0]
export const outlineHighlights = [
  ['yellow', '黄色'], ['red', '粉红色'], ['gray', '灰色'], ['green', '浅绿色'],
  ['blue', '浅蓝色'], ['purple', '浅紫色'], ['mint', '薄荷绿'], ['default', '清除高亮'],
] as const
export type OutlineHighlight = (typeof outlineHighlights)[number][0]

export const colorOpening = /^<span class="ymd-text-(red|yellow|green|blue|purple)">/
export const numberOpening = /^<span class="ymd-outline-number">/
export const highlightOpening = /^<mark class="ymd-highlight-(yellow|red|gray|green|blue|purple|mint)">/
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
  return paintSelection(text, start, end, color === 'default' ? '' : '<span class="ymd-text-' + color + '">',
    colorOpening, colorClosing)
}

export function highlightSelection(text: string, start: number, end: number, color: OutlineHighlight) {
  return paintSelection(text, start, end, color === 'default' ? '' : '<mark class="ymd-highlight-' + color + '">',
    highlightOpening, '</mark>')
}

function paintSelection(text: string, start: number, end: number, open: string, opening: RegExp, closing: string) {
  const selected = text.slice(start, end)
  if (!selected.trim()) return
  const before = new RegExp(opening.source.slice(1) + '$').exec(text.slice(0, start))
  const close = open ? closing : ''
  if (before && text.startsWith(closing, end)) return replaceStyle(text, start - before[0].length, end + closing.length, selected, open, close)
  const match = opening.exec(selected)
  if (match && selected.endsWith(closing)) return replaceStyle(text, start, end,
    selected.slice(match[0].length, -closing.length), open, close)
  if (open) return replaceStyle(text, start, end, selected, open, close)
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
  const nativeRange = selection.getRangeAt(0)
  if (!nativeRange.intersectsNode(preview)) return
  const range = document.createRange()
  range.selectNodeContents(preview)
  if (preview.contains(nativeRange.startContainer)) range.setStart(nativeRange.startContainer, nativeRange.startOffset)
  if (preview.contains(nativeRange.endContainer)) range.setEnd(nativeRange.endContainer, nativeRange.endOffset)
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
  if (selected === preview.textContent) return [0, source.length] as const
}
