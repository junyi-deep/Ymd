export function atVisualBoundary(input: HTMLTextAreaElement, first: boolean) {
  const offset = input.selectionStart
  const text = input.value
  if (first ? offset === 0 : offset === text.length) return true
  if (first ? text.lastIndexOf('\n', offset - 1) >= 0 : text.indexOf('\n', offset) >= 0) return false

  const style = getComputedStyle(input)
  const lineHeight = parseFloat(style.lineHeight)
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  if (input.scrollHeight <= lineHeight * (text.split('\n').length) + padding + 1) return true

  // Measure the visual line in a mirror with the textarea's wrapping and font.
  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', left: '0', top: '0', pointerEvents: 'none',
    boxSizing: 'content-box', width: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 'px',
    font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing,
    tabSize: style.tabSize, direction: style.direction, whiteSpace: 'pre-wrap', overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
  })
  const content = document.createTextNode(text + '\u200b')
  mirror.append(content)
  document.body.append(mirror)
  try {
    const range = document.createRange()
    const topAt = (position: number) => {
      range.setStart(content, position)
      range.setEnd(content, position + 1)
      return range.getClientRects()[0]?.top
    }
    const boundary = topAt(first ? 0 : text.length)
    const current = topAt(offset)
    return boundary !== undefined && current !== undefined && Math.abs(boundary - current) < 1
  } finally { mirror.remove() }
}
