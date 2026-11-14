import { GFM, parser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'

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
}

const markdown = parser.configure(GFM)
export const newBlock = (text = '', marker = '-'): Block => ({ id: crypto.randomUUID(), text, marker, children: [] })

export function projectList(text: string): Projection | undefined {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const raw = text.slice(bom.length)
  const newline = raw.match(/\r\n|\n|\r/)?.[0] ?? '\n'
  const source = raw.replace(/\r\n|\r/g, '\n')
  const tree = markdown.parse(source)
  let list: SyntaxNode | null = null
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'BulletList' && node.name !== 'OrderedList') continue
    if (list || node.name !== 'BulletList') return
    list = node
  }
  if (!list) {
    const last = tree.topNode.lastChild
    if (last?.name === 'FencedCode' || last?.name === 'HTMLBlock' || last?.name === 'CommentBlock') return
    const separator = source.trim() ? newline.repeat(source.endsWith('\n\n') ? 0 : source.endsWith('\n') ? 1 : 2) : ''
    return { before: text, after: '', newline, blocks: [], separator }
  }

  const readList = (node: SyntaxNode): Block[] | undefined => {
    const blocks: Block[] = []
    for (let item = node.firstChild; item; item = item.nextSibling) {
      if (item.name !== 'ListItem') return
      const mark = item.getChild('ListMark')
      if (!mark || !/^[-+*]$/.test(source.slice(mark.from, mark.to))) return
      const indent = mark.from - Math.max(source.lastIndexOf('\n', mark.from - 1), source.lastIndexOf('\r', mark.from - 1)) - 1
      const sublist = item.getChild('BulletList')
      const body = item.getChild('Task') ?? item.getChild('Paragraph')
      const expected = 1 + Number(!!body) + Number(!!sublist)
      let count = 0
      for (let part = item.firstChild; part; part = part.nextSibling) count++
      if (count !== expected || (body && sublist && body.to > sublist.from)) return
      const limit = body?.to ?? mark.to
      const bodyLines = source.slice(mark.to, limit).split(/\r\n|\n|\r/)
      if (bodyLines[0] && !bodyLines[0].startsWith(' ')) return
      if (bodyLines.slice(1).some(line => !line.startsWith(' '.repeat(indent + 2)) || !line.trim())) return
      const continuation = bodyLines.slice(1).map(line => line.slice(indent + 2))
      if (sublist && !/^\r?\n *$|^\r *$/.test(source.slice(limit, sublist.from))) return
      if (item.nextSibling && !/^\r?\n *$|^\r *$/.test(source.slice(item.to, item.nextSibling.from))) return
      const children = sublist ? readList(sublist) : []
      if (!children) return
      blocks.push({
        id: String(mark.from), marker: source.slice(mark.from, mark.to),
        text: [bodyLines[0].slice(1), ...continuation].join('\n'), children,
      })
    }
    return blocks
  }
  const blocks = readList(list)
  if (!blocks) return
  const projection = {
    before: bom + source.slice(0, list.from).replaceAll('\n', newline),
    after: source.slice(list.to).replaceAll('\n', newline),
    newline,
    blocks,
  }
  if (writeList(projection, blocks) === text) return projection
}

export function writeList(projection: Projection, blocks: Block[]) {
  const { before, after, newline } = projection
  const write = (nodes: Block[], depth: number): string[] => nodes.flatMap(node => {
    const indent = '  '.repeat(depth)
    const [first, ...rest] = node.text.split('\n')
    return [indent + node.marker + (first ? ' ' + first : ''), ...rest.map(line => indent + '  ' + line), ...write(node.children, depth + 1)]
  })
  return before + (blocks.length ? (projection.separator ?? '') + write(blocks, 0).join(newline) : '') + after
}

export function locateBlock(blocks: Block[], id: string, parent?: Block): { siblings: Block[]; index: number; parent?: Block } | undefined {
  const index = blocks.findIndex(block => block.id === id)
  if (index >= 0) return { siblings: blocks, index, parent }
  for (const block of blocks) {
    const result = locateBlock(block.children, id, block)
    if (result) return result
  }
}
