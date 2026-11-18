export function markdownBlockFrame(content?: HTMLElement) {
  // CodeMirror measures the widget's border box, so its children's margins must stay inside it.
  const frame = document.createElement('div')
  frame.className = 'md-block-frame'
  if (content) frame.append(content)
  return frame
}
