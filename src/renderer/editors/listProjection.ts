import { GFM, parser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import { markdownBody, typoraMarkdown } from './markdownExtras'
import { markdownImageTags } from './markdownImageSyntax'
import { diagramKind } from './diagramSyntax'

export interface Block {
  id: string
  text: string
  marker: string
  children: Block[]
}

export interface Projection {
  before: string
  after: string
  newline: string
  blocks: Block[]
  separator?: string
  afterSeparator?: string
  original?: { source: string; signature: string }
}

const markdown = parser.configure([GFM, markdownImageTags, typoraMarkdown])
const isList = (node: SyntaxNode) => node.name === 'BulletList' || node.name === 'OrderedList'
export const listMarker = /^([-+*]|\d{1,9}[.)])$/
export const newBlock = (text = '', marker = '-'): Block => ({ id: crypto.randomUUID(), text, marker, children: [] })

function signature(blocks: Block[]): string {
  return JSON.stringify(blocks, (key, value) => key === 'id' ? undefined : value)
}

export function projectList(text: string): Projection {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const raw = text.slice(bom.length)
  const newline = raw.match(/\r\n|\n|\r/)?.[0] ?? '\n'
  const source = raw.replace(/\r\n?/g, '\n')
  const body = markdownBody(source)
  const offset = source.length - body.length
  const tree = markdown.parse(body)
  let list = tree.topNode.firstChild
  while (list && !isList(list)) list = list.nextSibling
  if (!list) {
    const last = tree.topNode.lastChild
    const unfinished = last?.name === 'FencedCode' && last.getChildren('CodeMark').length < 2 ||
      last?.name === 'CommentBlock' || last?.name === 'HTMLBlock'
    if (unfinished && last) {
      const start = rawPosition(offset + last.from)
      const before = text.slice(0, start)
      const separator = before.slice(bom.length).trim() && !before.endsWith(newline.repeat(2)) ? newline : ''
      return { before, after: text.slice(start), newline, blocks: [], separator, afterSeparator: newline.repeat(2) }
    }
    const separator = source ? newline.repeat(source.endsWith('\n\n') ? 0 : source.endsWith('\n') ? 1 : 2) : ''
    return { before: text, after: '', newline, blocks: [], separator }
  }

  function takeIndent(line: string, width: number) {
    let column = 0
    let index = 0
    while (column < width && (line[index] === ' ' || line[index] === '\t')) {
      column += line[index++] === '\t' ? 4 - column % 4 : 1
    }
    return ' '.repeat(Math.max(0, column - width)) + line.slice(index)
  }

  const readList = (node: SyntaxNode, until: number): { blocks: Block[]; end: number } => {
    const blocks: Block[] = []
    let end = node.to
    for (let item = node.firstChild; item; item = item.nextSibling) {
      const mark = item.getChild('ListMark')
      if (!mark) continue
      const marker = body.slice(mark.from, mark.to)
      const lineStart = body.lastIndexOf('\n', mark.from - 1) + 1
      const gap = /^[ \t]+/.exec(body.slice(mark.to, Math.min(item.to, mark.to + 5)))?.[0] ?? ''
      const padding = gap.length > 4 ? gap.slice(0, 1) : gap
      const prefix = body.slice(lineStart, mark.to) + padding
      let width = 0
      for (const char of prefix) width += char === '\t' ? 4 - width % 4 : 1
      if (!padding) width++

      const lists: SyntaxNode[] = []
      for (let part = item.lastChild; part && isList(part); part = part.prevSibling) lists.unshift(part)
      const next = item.nextSibling?.from ?? until
      let bodyEnd = lists[0] ? Math.max(mark.to, body.lastIndexOf('\n', lists[0].from - 1)) : item.to
      // Keep continuation lines containing the item's exact indentation, including trailing blanks.
      if (!lists.length) {
        while (body[bodyEnd] === '\n' && bodyEnd < next) {
          const lineEnd = body.indexOf('\n', bodyEnd + 1)
          const blankEnd = lineEnd < 0 ? body.length : lineEnd
          if (blankEnd > next || body.slice(bodyEnd + 1, blankEnd) !== ' '.repeat(width)) break
          bodyEnd = blankEnd
        }
      }
      const [first, ...rest] = body.slice(mark.to, bodyEnd).split('\n')
      const content = first.slice(padding.length)
      const children = lists.map((part, index) => readList(part, lists[index + 1]?.from ?? next))
      end = children.at(-1)?.end ?? bodyEnd
      blocks.push({
        id: String(mark.from + offset), marker,
        text: [content, ...rest.map(line => takeIndent(line, width))].join('\n'),
        children: children.flatMap(part => part.blocks),
      })
    }
    return { blocks, end }
  }

  const { blocks, end } = readList(list, list.nextSibling?.from ?? body.length)
  const from = rawPosition(list.from + offset)
  const to = rawPosition(end + offset)
  return { before: text.slice(0, from), after: text.slice(to), newline, blocks,
    original: { source: text.slice(from, to), signature: signature(blocks) } }

  function rawPosition(position: number) {
    let result = position
    let pair = raw.indexOf('\r\n')
    while (pair >= 0 && pair < result) {
      result++
      pair = raw.indexOf('\r\n', pair + 2)
    }
    return result + bom.length
  }
}

export function projectionRemainder(projection: Projection) {
  return [projection.before, projection.after].map(part => part.replace(/^\uFEFF/, '').replace(/^(?:[ \t]*\r?\n)+|[\r\n]+$/g, '')).filter(part => part.trim()).join('\n\n')
}

export function diagramBodyLines(text: string) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const body = markdownBody(source)
  const offset = source.length - body.length
  const lines: number[] = []
  markdown.parse(body).iterate({ enter({ name, node, from }) {
    if (name !== 'FencedCode') return
    const info = node.getChild('CodeInfo')
    if (info && diagramKind(body.slice(info.from, info.to)) &&
        node.getChildren('CodeText').some(part => body.slice(part.from, part.to).trim())) {
      lines.push(source.slice(0, offset + from).split('\n').length + 1)
    }
    return false
  } })
  return lines
}

export function writeList(projection: Projection, blocks: Block[]) {
  const { before, after, newline, original } = projection
  if (!blocks.length && !original) return before + after
  if (original && signature(blocks) === original.signature) return before + original.source + after
  const firstMarker = projection.blocks[0]?.marker ?? blocks[0]?.marker
  const write = (nodes: Block[], indent: string): string[] => nodes.flatMap(node => {
    // A moved topic must remain in the same first top-level list when reopened.
    const marker = !indent && firstMarker && firstMarker.at(-1) !== node.marker.at(-1) ? firstMarker : node.marker
    const left = indent + ' '.repeat(marker.length + 1)
    const [first, ...rest] = node.text.split('\n')
    return [indent + marker + (first ? ' ' + first : ''), ...rest.map(line => left + line), ...write(node.children, left)]
  })
  const list = blocks.length ? (projection.separator ?? '') + write(blocks, '').join(newline) : ''
  return before + list + (blocks.length ? (projection.afterSeparator ?? '') : '') + after
}

export function locateBlock(blocks: Block[], id: string, parent?: Block): { siblings: Block[]; index: number; parent?: Block } | undefined {
  const index = blocks.findIndex(block => block.id === id)
  if (index >= 0) return { siblings: blocks, index, parent }
  for (const block of blocks) {
    const result = locateBlock(block.children, id, block)
    if (result) return result
  }
}
