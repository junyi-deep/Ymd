import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Circle, ListTree, Plus } from 'lucide-react'
import { locateBlock, newBlock, projectList, writeList, type Block } from './listProjection'

export function UnsupportedList() {
  return <div className="editor-empty"><ListTree size={23} /><h2>此文档无法编辑为树</h2>
    <p>在 Markdown 模式中整理成一个顶层无序列表。标题和列表前后的正文可以保留。</p></div>
}

export function OutlineEditor({ text, platform, onChange }: { text: string; platform: string; onChange: (text: string) => void }) {
  const [projection] = useState(() => projectList(text))
  const [blocks, setBlocks] = useState(() => projection?.blocks ?? [])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const focus = useRef<{ id: string; position?: number } | undefined>(undefined)
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())

  useLayoutEffect(() => {
    if (!focus.current) return
    const { id, position } = focus.current
    const input = inputs.current.get(id)
    input?.focus()
    if (input && position !== undefined) input.setSelectionRange(position, position)
    focus.current = undefined
  }, [blocks, collapsed])

  if (!projection) return <UnsupportedList />

  function change(update: (next: Block[]) => boolean) {
    const next = structuredClone(blocks)
    if (update(next)) {
      setBlocks(next)
      onChange(writeList(projection!, next))
    }
  }

  function collapse(id: string, value: boolean) {
    setCollapsed(current => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function key(event: KeyboardEvent<HTMLTextAreaElement>, block: Block) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const { key, shiftKey, metaKey, ctrlKey, altKey, currentTarget } = event
    const mod = platform === 'darwin' ? metaKey : ctrlKey
    const move = (platform === 'darwin' ? metaKey : altKey) && shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')
    const position = currentTarget.selectionStart
    const selectionEnd = currentTarget.selectionEnd
    if (mod && !shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      if (block.children.length) { event.preventDefault(); collapse(block.id, key === 'ArrowUp') }
      return
    }
    if (key === 'Enter' && shiftKey) return
    if (!move && key !== 'Enter' && key !== 'Tab' && !(key === 'Backspace' && !block.text && !block.children.length)) return
    event.preventDefault()
    change(next => {
      const found = locateBlock(next, block.id)!
      const { siblings, index, parent } = found
      const node = siblings[index]
      if (move) {
        const target = index + (key === 'ArrowUp' ? -1 : 1)
        if (target < 0 || target >= siblings.length) return false
        siblings.splice(index, 1)
        siblings.splice(target, 0, node)
        focus.current = { id: node.id, position }
      } else if (key === 'Enter') {
        const sibling = newBlock(node.text.slice(selectionEnd), node.marker)
        node.text = node.text.slice(0, position)
        siblings.splice(index + 1, 0, sibling)
        focus.current = { id: sibling.id, position: 0 }
      } else if (key === 'Tab' && !shiftKey) {
        const previous = siblings[index - 1]
        if (!previous) return false
        if (previous.children.length) node.marker = previous.children[0].marker
        previous.children.push(...siblings.splice(index, 1))
        collapse(previous.id, false)
        focus.current = { id: node.id, position }
      } else if (key === 'Tab') {
        if (!parent) return false
        const outer = locateBlock(next, parent.id)!
        siblings.splice(index, 1)
        node.marker = parent.marker
        outer.siblings.splice(outer.index + 1, 0, node)
        focus.current = { id: node.id, position }
      } else {
        const alternate = siblings[index - 1] ?? siblings[index + 1] ?? parent
        siblings.splice(index, 1)
        if (alternate) focus.current = { id: alternate.id, position: alternate.text.length }
      }
      return true
    })
  }

  function render(nodes: Block[]) {
    return <ul>{nodes.map(node => <li key={node.id}>
      <div className="outline-row">
        <button className="outline-toggle" aria-label={collapsed.has(node.id) ? '展开子块' : '折叠子块'}
          aria-expanded={node.children.length ? !collapsed.has(node.id) : undefined} disabled={!node.children.length}
          onClick={() => collapse(node.id, !collapsed.has(node.id))}>
          {node.children.length ? (collapsed.has(node.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />) : <Circle size={6} fill="currentColor" />}
        </button>
        <textarea aria-label="块内容" rows={Math.max(1, node.text.split('\n').length)} value={node.text}
          ref={element => { if (element) inputs.current.set(node.id, element); else inputs.current.delete(node.id) }}
          onKeyDown={event => key(event, node)}
          onChange={event => {
            const value = event.target.value
            change(next => {
              const { siblings, index } = locateBlock(next, node.id)!
              siblings[index].text = value
              return true
            })
          }} />
      </div>
      {node.children.length > 0 && !collapsed.has(node.id) && render(node.children)}
    </li>)}</ul>
  }

  return <div className="outline-editor">
    <div className="outline-content">{render(blocks)}
      <button className="tool-button outline-add" onClick={() => change(next => {
        const node = newBlock('', next[0]?.marker)
        next.push(node)
        focus.current = { id: node.id }
        return true
      })}><Plus size={17} />新增块</button>
    </div>
  </div>
}
