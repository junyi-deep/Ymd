import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight, ListTree, Plus } from 'lucide-react'
import { markdownHtml } from './markdownHtml'
import { locateBlock, newBlock, projectList, writeList, type Block } from './listProjection'

export function UnsupportedList() {
  return <div className="editor-empty"><ListTree size={23} /><h2>此文档无法编辑为树</h2>
    <p>在 Markdown 模式中整理成一个顶层无序列表。标题和列表前后的正文可以保留。</p></div>
}

export function OutlineEditor({ text, platform, onChange }: { text: string; platform: string; onChange: (text: string) => void }) {
  const [projection] = useState(() => projectList(text))
  const [blocks, setBlocks] = useState(() => projection?.blocks ?? [])
  const [editing, setEditing] = useState<string>()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const focus = useRef<{ id: string; position?: number } | undefined>(undefined)
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())

  useLayoutEffect(() => {
    if (!focus.current || focus.current.id !== editing) return
    const { id, position } = focus.current
    const input = inputs.current.get(id)
    input?.focus()
    if (input && position !== undefined) input.setSelectionRange(position, position)
    focus.current = undefined
  }, [blocks, collapsed, editing])

  if (!projection) return <div className="outline-editor" onClick={event => {
    if (event.target instanceof HTMLElement && event.target.closest('a')) event.preventDefault()
  }}>
    <UnsupportedList />
    <div className="outline-content outline-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(text) }} />
  </div>

  function change(update: (next: Block[]) => boolean) {
    const next = structuredClone(blocks)
    if (update(next)) {
      setBlocks(next)
      if (focus.current) setEditing(focus.current.id)
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
    if (key === 'Escape' && !mod && !altKey) { event.stopPropagation(); currentTarget.blur(); return }
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

  function preview(event: React.MouseEvent, node: Block) {
    const checkbox = event.target instanceof HTMLInputElement && event.target.type === 'checkbox'
    if (checkbox) {
      event.preventDefault()
      const match = /^\[([ xX])\]/.exec(node.text)
      if (match) change(next => {
        const { siblings, index } = locateBlock(next, node.id)!
        siblings[index].text = `[${match[1] === ' ' ? 'x' : ' '}]` + node.text.slice(3)
        return true
      })
      return
    }
    if (event.target instanceof HTMLElement && event.target.closest('a')) event.preventDefault()
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) return
    focus.current = { id: node.id, position: node.text.length }
    setEditing(node.id)
  }

  function render(nodes: Block[]) {
    return <ul>{nodes.map(node => {
      const closed = collapsed.has(node.id)
      return <li key={node.id}>
        <div className="outline-row">
          <span className="outline-controls">
            {node.children.length > 0 && <button className="outline-toggle" aria-label={closed ? '展开子块' : '折叠子块'}
              aria-expanded={!closed} onClick={() => collapse(node.id, !closed)}><ChevronRight size={13} /></button>}
            <span className="outline-bullet" data-closed={closed} aria-hidden="true"><span /></span>
          </span>
          {editing === node.id
            ? <textarea aria-label="块内容" rows={Math.max(1, node.text.split('\n').length)} value={node.text}
                ref={element => { if (element) inputs.current.set(node.id, element); else inputs.current.delete(node.id) }}
                onBlur={() => { setEditing(current => current === node.id ? undefined : current) }}
                onKeyDown={event => key(event, node)}
                onChange={event => {
                  const value = event.target.value
                  change(next => {
                    const { siblings, index } = locateBlock(next, node.id)!
                    siblings[index].text = value
                    return true
                  })
                }} />
            : <div className="outline-markdown outline-preview" role="button" tabIndex={0} aria-label={'编辑块 ' + (node.text || '空块')}
                onClick={event => preview(event, node)} onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focus.current = { id: node.id }; setEditing(node.id) }
                }} dangerouslySetInnerHTML={{ __html: node.text
                  ? markdownHtml(/^\[[ xX]\]\s/.test(node.text) ? '- ' + node.text : node.text)
                  : '&nbsp;' }} />}
        </div>
        {node.children.length > 0 && !closed && <div className="outline-children">
          <button className="outline-guide" tabIndex={-1} aria-label="折叠此分支" onClick={() => collapse(node.id, true)} />
          {render(node.children)}
        </div>}
      </li>
    })}</ul>
  }
  return <div className="outline-editor" onClick={event => {
    if (event.target instanceof HTMLElement && event.target.closest('a')) event.preventDefault()
  }}>
    <div className="outline-content">
      {!!projection.before.trim() && <div className="outline-markdown outline-surrounding" dangerouslySetInnerHTML={{ __html: markdownHtml(projection.before) }} />}
      {render(blocks)}
      <button className="tool-button outline-add" onClick={() => change(next => {
        const node = newBlock('', next[0]?.marker)
        next.push(node)
        focus.current = { id: node.id }
        return true
      })}><Plus size={17} />新增块</button>
      {!!projection.after.trim() && <div className="outline-markdown outline-surrounding" dangerouslySetInnerHTML={{ __html: markdownHtml(projection.after) }} />}
    </div>
  </div>
}
