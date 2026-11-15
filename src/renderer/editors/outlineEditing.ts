import { locateBlock, newBlock, projectList, writeList, type Block, type Projection } from './listProjection'

export type OutlineCaret = { id: string; start: number; end: number }
export type OutlineFrame = { blocks: Block[]; caret?: OutlineCaret; selected: string[]; scope?: string }
export type OutlineSession = {
  projection: Projection
  text: string
  blocks: Block[]
  undo: OutlineFrame[]
  redo: OutlineFrame[]
  collapsed: Set<string>
  scope?: string
}

export function openOutline(session: OutlineSession | undefined, text: string): OutlineSession | undefined {
  if (session?.text === text) return session
  const projection = projectList(text)
  return projection && { projection, text, blocks: projection.blocks, undo: [], redo: [], collapsed: new Set() }
}

export function flattenBlocks(blocks: Block[], collapsed?: Set<string>): Block[] {
  return blocks.flatMap(block => [block, ...(collapsed?.has(block.id) ? [] : flattenBlocks(block.children, collapsed))])
}

export function blockPath(blocks: Block[], id: string): Block[] {
  for (const block of blocks) {
    if (block.id === id) return [block]
    const path = blockPath(block.children, id)
    if (path.length) return [block, ...path]
  }
  return []
}

export function selectedBranches(blocks: Block[], ids: Set<string>): Block[] {
  return blocks.flatMap(block => ids.has(block.id) ? [block] : selectedBranches(block.children, ids))
}

export function editBlockText(blocks: Block[], id: string, text: string): Block[] | undefined {
  for (const [index, block] of blocks.entries()) {
    const children = block.id === id ? undefined : editBlockText(block.children, id, text)
    if (block.id !== id && !children) continue
    const next = blocks.slice()
    next[index] = children ? { ...block, children } : { ...block, text }
    return next
  }
}

export function removeBranches(blocks: Block[], ids: Set<string>) {
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (ids.has(blocks[index].id)) blocks.splice(index, 1)
    else removeBranches(blocks[index].children, ids)
  }
}

export type OutlineDrop = { id: string; position: 'before' | 'child' | 'after' }

export function moveBranches(blocks: Block[], ids: Set<string>, target: OutlineDrop) {
  const branches = selectedBranches(blocks, ids)
  if (!branches.length || branches.some(block => locateBlock([block], target.id))) return false
  removeBranches(blocks, ids)
  const found = locateBlock(blocks, target.id)
  if (!found) return false
  const destination = found.siblings[found.index]
  const siblings = target.position === 'child' ? destination.children : found.siblings
  const marker = siblings[0]?.marker ?? destination.marker
  for (const block of branches) block.marker = marker
  if (target.position === 'child') siblings.unshift(...branches)
  else siblings.splice(found.index + Number(target.position === 'after'), 0, ...branches)
  return true
}

const clipboardProjection = { before: '', after: '', newline: '\n', blocks: [] }
export const writeBranches = (blocks: Block[]) => writeList(clipboardProjection, blocks)

export function readBranches(text: string): Block[] | undefined {
  const projected = projectList(text)
  if (!projected?.blocks.length || projected.before.trim() || projected.after.trim()) return
  const rekey = (block: Block): Block => ({ ...newBlock(block.text, block.marker), children: block.children.map(rekey) })
  return projected.blocks.map(rekey)
}
