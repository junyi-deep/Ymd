import { Bold, CheckSquare, Code2, Copy, Heading1, Heading2, Heading3, Highlighter, Italic, ListOrdered, Strikethrough, Type, Underline } from 'lucide-react'
import { MarkdownMenu, type MenuItem } from './MarkdownMenu'
import { formatNumber } from './mapNumbering'
import { colorSelection, formatSelection, highlightSelection, outlineHighlights, outlineTextColors } from './outlineTextStyle'

export type OutlineStyle = (text: string, start: number, end: number, index: number) => ReturnType<typeof formatSelection>

const numbering = [
  ['numeral-arabic', '1', '数字'], ['chinese', '一', '中文数字'],
  ['numeral-roman', 'Ⅲ', '罗马数字'], ['alphabet-uppercase', 'A', '英文字母'],
] as const
const chineseDigits = '零一二三四五六七八九'
const chineseUnits = ['', '十', '百', '千', '万']

function chineseNumber(value: number) {
  const digits = String(value)
  if (value >= 100_000) return [...digits].map(digit => chineseDigits[Number(digit)]).join('')
  return [...digits].map((digit, index) => {
    const place = digits.length - index - 1
    if (digit === '0') return /[1-9]/.test(digits.slice(index + 1)) && digits[index - 1] !== '0' ? '零' : ''
    const glyph = value >= 10 && value <= 19 && place === 1 ? '' : chineseDigits[Number(digit)]
    return glyph + chineseUnits[place]
  }).join('')
}
const heading = /^#{1,6}(?:[ \t]+|$)/
const todo = /^\[[ xX]\][ \t]+/
const existingNumber = /^<span class="ymd-outline-number">[^<>]*<\/span>[ \t]+/

export function OutlineSelectionMenu({ point, close, apply, copy, blockActions }: {
  point: { x: number; y: number }
  close: () => void
  apply: (style: OutlineStyle) => void
  copy: () => void
  blockActions?: MenuItem[]
}) {
  return <MarkdownMenu point={point} formatting close={close} items={[
    ...([
      ['一级标题', Heading1, '# '], ['二级标题', Heading2, '## '], ['三级标题', Heading3, '### '], ['正文', Type, ''],
    ] as const).map(([label, Icon, marker]) => ({
      label, icon: <Icon size={18} />, run: () => apply((text, start, end) => {
        const removed = heading.exec(text)?.[0].length ?? 0
        return {
          text: marker + text.slice(removed),
          start: Math.max(0, start - removed) + marker.length,
          end: Math.max(0, end - removed) + marker.length,
        }
      }),
    })),
    ...([
      ['加粗', Bold, '**', '**'], ['斜体', Italic, '*', '*'], ['下划线', Underline, '<u>', '</u>'],
      ['删除线', Strikethrough, '~~', '~~'],
    ] as const).map(([label, Icon, open, close]) => ({
      label, icon: <Icon size={17} />, run: () => apply((text, start, end) => formatSelection(text,
        Math.max(start, /^(?:(?:\[[ xX]\]|#{1,6})[ \t]+)?/.exec(text)![0].length), end, open, close)),
    })),
    { label: '字体颜色', icon: <Type size={17} className="ymd-text-red" />, separator: true, swatches: true, children: [
      ...outlineTextColors.slice(1), outlineTextColors[0],
    ].map(([value, label]) => ({
      label, icon: <span className={'menu-swatch ymd-text-' + value}>A</span>,
      run: () => apply((text, start, end) => colorSelection(text, start, end, value)),
    })) },
    { label: '荧光笔', icon: <Highlighter size={17} />, swatches: true, children: outlineHighlights.map(([value, label]) => ({
      label, icon: <span className={'menu-swatch ' + (value === 'default' ? 'menu-swatch-clear' : 'ymd-highlight-' + value)}>{value === 'default' ? '／' : ''}</span>,
      run: () => apply((text, start, end) => highlightSelection(text, start, end, value)),
    })) },
    { label: '添加待办', icon: <CheckSquare size={17} />, run: () => apply((text, start, end) => {
      if (todo.test(text)) return
      return { text: '[ ] ' + text, start: start + 4, end: end + 4 }
    }) },
    { label: '添加编号', icon: <ListOrdered size={17} />, children: numbering.map(([pattern, glyph, label]) => ({
      label, icon: <span className="menu-swatch" aria-hidden="true">{glyph}</span>, run: () => apply((text, start, end, index) => {
        const offset = (todo.exec(text) ?? heading.exec(text))?.[0].length ?? 0
        const suffix = text.slice(offset)
        const removed = existingNumber.exec(suffix)?.[0].length ?? 0
        const sequence = index + 1
        const number = pattern === 'chinese'
          ? chineseNumber(sequence) + '、'
          : formatNumber(pattern, sequence) + '.'
        const prefix = '<span class="ymd-outline-number">' + number + '</span> '
        return { text: text.slice(0, offset) + prefix + suffix.slice(removed),
          start: Math.max(offset, start - removed) + prefix.length,
          end: Math.max(offset, end - removed) + prefix.length }
      }),
    })) },
    { label: '行内代码', icon: <Code2 size={17} />, run: () => apply((text, start, end) => formatSelection(text, start, end, '`')) },
    { label: '复制', icon: <Copy size={17} />, run: copy },
    ...(blockActions ? [{ label: '块操作', separator: true, children: blockActions }] : []),
  ]} />
}
