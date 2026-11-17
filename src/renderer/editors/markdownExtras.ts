import type { DelimiterType, MarkdownConfig } from '@lezer/markdown'
import { colorOpening, highlightOpening, numberOpening } from './outlineTextStyle'

const highlight: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' }
const underline: DelimiterType = { resolve: 'Underline', mark: 'UnderlineMark' }
const highlightColor: DelimiterType = { resolve: 'HighlightColor', mark: 'HighlightColorMark' }
const textColor: DelimiterType = { resolve: 'TextColor', mark: 'TextColorMark' }

export const footnoteDefinition = /^\[\^([^\]\s]+)\]:[ \t]*/
const footnoteReference = /^\[\^([^\]\s]+)\](?![:[(])/
export const metadataOpening = '---\n'
export const metadataClosing = /^---$/m

export function markdownBody(source: string) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const close = text.startsWith(metadataOpening) ? metadataClosing.exec(text.slice(metadataOpening.length)) : null
  return close ? text.slice(metadataOpening.length + close.index + close[0].length + 1) : text
}

export const typoraMarkdown: MarkdownConfig = {
  defineNodes: ['Highlight', 'HighlightMark', 'Underline', 'UnderlineMark', 'TextColor', 'TextColorMark', 'HighlightColor', 'HighlightColorMark', 'FootnoteReference',
    { name: 'FootnoteDefinition', block: true }],
  parseBlock: [{
    name: 'FootnoteDefinition',
    after: 'IndentedCode',
    endLeaf(context, line) {
      return context.depth === 1 && line.indent < 4 && footnoteDefinition.test(line.text.slice(line.pos))
    },
    parse(context, line) {
      if (context.depth !== 1 || !footnoteDefinition.test(line.text.slice(line.pos))) return false
      const from = context.lineStart + line.pos
      let to = context.lineStart + line.text.length
      while (context.nextLine()) {
        if (line.pos === line.text.length && /^(?: {4}| {0,3}\t)[ \t]*\S/.test(context.peekLine())) continue
        if (line.indent < 4 || line.pos === line.text.length) break
        to = context.lineStart + line.text.length
      }
      context.addElement(context.elt('FootnoteDefinition', from, to))
      return true
    },
  }],
  parseInline: [{
    name: 'FootnoteReference',
    before: 'Link',
    parse(context, next, pos) {
      if (next !== 91 || context.char(pos + 1) !== 94 || context.hasOpenLink) return -1
      const match = footnoteReference.exec(context.slice(pos, context.end))
      return match ? context.addElement(context.elt('FootnoteReference', pos, pos + match[0].length)) : -1
    },
  }, {
    name: 'Highlight',
    after: 'Emphasis',
    parse(context, next, pos) {
      if (next !== 61 || context.char(pos + 1) !== 61 || context.char(pos - 1) === 61 || context.char(pos + 2) === 61) return -1
      return context.addDelimiter(highlight, pos, pos + 2, !/\s/.test(context.slice(pos + 2, pos + 3)), !/\s/.test(context.slice(pos - 1, pos)))
    },
  }, {
    name: 'Underline',
    before: 'HTMLTag',
    parse(context, next, pos) {
      if (next !== 60) return -1
      if (context.slice(pos, pos + 3).toLowerCase() === '<u>') return context.addDelimiter(underline, pos, pos + 3, true, false)
      if (context.slice(pos, pos + 4).toLowerCase() === '</u>') return context.addDelimiter(underline, pos, pos + 4, false, true)
      return -1
    },
  }, {
    name: 'TextColor',
    before: 'HTMLTag',
    parse(context, next, pos) {
      if (next !== 60) return -1
      const tag = context.slice(pos, Math.min(context.end, pos + 40))
      const color = colorOpening.exec(tag) ?? numberOpening.exec(tag)
      if (color) return context.addDelimiter(textColor, pos, pos + color[0].length, true, false)
      if (tag.startsWith('</span>')) return context.addDelimiter(textColor, pos, pos + 7, false, true)
      const mark = highlightOpening.exec(tag)
      if (mark) return context.addDelimiter(highlightColor, pos, pos + mark[0].length, true, false)
      if (tag.startsWith('</mark>')) return context.addDelimiter(highlightColor, pos, pos + 7, false, true)
      return -1
    },
  }],
}
