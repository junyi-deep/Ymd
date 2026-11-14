import type { DelimiterType, MarkdownConfig } from '@lezer/markdown'

const highlight: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' }
const underline: DelimiterType = { resolve: 'Underline', mark: 'UnderlineMark' }

export const typoraMarkdown: MarkdownConfig = {
  defineNodes: ['Highlight', 'HighlightMark', 'Underline', 'UnderlineMark'],
  parseInline: [{
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
  }],
}
