import { replaceCodeLanguage } from './codeCard'

const openingFence = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/
const closingFence = /^( {0,3})(`{3,}|~{3,})([ \t]*)$/

export function completeCodeFence(text: string) {
  const open = openingFence.exec(text)
  if (!open || open[2][0] === '`' && open[3].includes('`')) return
  return text + '\n\n' + open[1] + open[2]
}

export function outlineCode(text: string) {
  if (!/^ {0,3}(?:`{3}|~{3})/.test(text)) return
  const lines = text.split('\n')
  const open = openingFence.exec(lines[0])
  if (!open || open[2][0] === '`' && open[3].includes('`')) return
  const suffix: string[] = []
  while (lines.length > 1 && !lines.at(-1)?.trim()) suffix.unshift(lines.pop()!)
  const close = lines.length >= 2 && closingFence.exec(lines.at(-1)!)
  if (!close || close[2][0] !== open[2][0] || close[2].length < open[2].length) return
  const selfClosing = lines.length === 2
  const code = lines.slice(1, -1).join('\n')
  return {
    code, info: open[3], offset: lines[0].length + 1,
    withLanguage(value: string) {
      return [open[1] + open[2] + replaceCodeLanguage(open[3], value), ...lines.slice(1), ...suffix].join('\n')
    },
    withCode(value: string) {
      const marker = open[2][0]
      let length = open[2].length
      for (const line of value.split('\n')) {
        const possibleClose = closingFence.exec(line)
        if (possibleClose?.[2][0] === marker) length = Math.max(length, possibleClose[2].length + 1)
      }
      const start = open[1] + marker.repeat(length) + open[3]
      const end = close[1] + marker.repeat(Math.max(close[2].length, length)) + close[3]
      return { text: [start, ...(value || !selfClosing ? [value] : []), end, ...suffix].join('\n'), offset: start.length + 1 }
    },
  }
}
export type OutlineCode = NonNullable<ReturnType<typeof outlineCode>>
