import { useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowLeft, ArrowRight, BetweenHorizontalStart, ChevronRight, Plus, Redo2, Undo2 } from 'lucide-react'
import type { Links } from 'marked'
import { markdownPageWidths, type MarkdownPageWidth } from '../../shared/contracts'
import { DocumentRemainder } from './DocumentRemainder'
import { MarkdownMenu } from './MarkdownMenu'
import { OutlineMarkdown, outlineReferences } from './OutlineMarkdown'
import { locateBlock, newBlock, projectionRemainder, writeList, type Block } from './listProjection'
import { blockPath, editBlockText, flattenBlocks, moveBranches, openOutline, readBranches, removeBranches, selectedBranches, writeBranches,
  type OutlineCaret, type OutlineDrop, type OutlineFrame, type OutlineSession } from './outlineEditing'

const historyLimit = 100
const typingTypes = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward'])
const blockTitle = (node: Block) => node.text.split('\n')[0].trim() || '空块'
const cursor = (id: string, start: number, end = start): OutlineCaret => ({ id, start, end })

export function OutlineEditor({ text, name, path, platform, remoteImages, sessions, width, setWidth, remainderVisible, setRemainderVisible, onChange }: {
  text: string; name: string; path: string; platform: string; remoteImages: boolean; sessions: Map<string, OutlineSession>
  width: MarkdownPageWidth; setWidth: (value: MarkdownPageWidth) => void
  remainderVisible: boolean; setRemainderVisible: (visible: boolean) => void; onChange: (text: string) => void
}) {
  const [session] = useState(() => openOutline(sessions.get(path), text))
  const [blocks, setBlocks] = useState(() => session.blocks)
  const [editing, setEditing] = useState<string>()
  const [selected, setSelected] = useState<string[]>([])
  const [scope, setScope] = useState(session.scope)
  const [collapsed, setCollapsed] = useState(() => session.collapsed)
  const [drop, setDrop] = useState<OutlineDrop>()
  const [widthMenu, setWidthMenu] = useState(false)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>()
  const references = useMemo(() => outlineReferences(text), [text])
  const links = useMemo<Links | undefined>(() => references ? JSON.parse(references) : undefined, [references])
  const focus = useRef<OutlineCaret | undefined>(undefined)
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | undefined>(undefined)
  const rangeEnd = useRef<string | undefined>(undefined)
  const drag = useRef<Set<string> | undefined>(undefined)
  const inputBefore = useRef<OutlineCaret | undefined>(undefined)
  const historyAction = useRef(restore)
  historyAction.current = restore
  const typing = useRef<{ id: string; type: string; time: number; end: number } | undefined>(undefined)
  const composition = useRef<{ id: string; before: OutlineCaret; recorded: boolean } | undefined>(undefined)

  useLayoutEffect(() => {
    sessions.delete(path)
    sessions.set(path, session)
    if (sessions.size > 12) sessions.delete(sessions.keys().next().value!)
  }, [path, session, sessions])

  useLayoutEffect(() => {
    const view = root.current
    if (!view) return
    const before = (event: InputEvent) => {
      const input = event.target
      if (!(input instanceof HTMLTextAreaElement) || !input.dataset.block) return
      if (event.cancelable && (event.inputType === 'historyUndo' || event.inputType === 'historyRedo')) {
        event.preventDefault()
        historyAction.current(event.inputType === 'historyRedo')
        return
      }
      inputBefore.current = cursor(input.dataset.block, input.selectionStart, input.selectionEnd)
    }
    view.addEventListener('beforeinput', before)
    return () => view.removeEventListener('beforeinput', before)
  }, [])

  useLayoutEffect(() => {
    if (!focus.current || focus.current.id !== editing) return
    const { id, start, end } = focus.current
    const input = inputs.current.get(id)
    if (!input) return
    input.focus()
    input.setSelectionRange(start, end)
    focus.current = undefined
  }, [blocks, collapsed, editing, scope])

  const breadcrumb = scope ? blockPath(blocks, scope) : []
  const focused = breadcrumb.at(-1)
  const visible = flattenBlocks(focused ? [focused] : blocks, collapsed)
  const selectedSet = new Set(selected)

  function caret() {
    if (!editing) return
    const input = inputs.current.get(editing)
    if (input && document.activeElement === input) return cursor(editing, input.selectionStart, input.selectionEnd)
  }

  function frame(at = caret()): OutlineFrame {
    return { blocks: session!.blocks, caret: at, selected, scope }
  }

  function cursorTo(next: OutlineCaret) {
    focus.current = next
    setEditing(next.id)
    setSelected([])
    const input = inputs.current.get(next.id)
    if (input && editing === next.id) {
      input.focus()
      input.setSelectionRange(next.start, next.end)
    }
  }

  function reflect(next: Block[], text = writeList(session!.projection, next)) {
    session!.blocks = next
    session!.text = text
    setBlocks(next)
    onChange(session!.text)
  }

  function change(update: Block[] | ((next: Block[]) => boolean), options?: {
    before?: OutlineCaret; after?: OutlineCaret; coalesce?: boolean; selection?: string[]; keepGroup?: boolean
  }) {
    const next = typeof update === 'function' ? structuredClone(session!.blocks) : update
    if (typeof update === 'function' && !update(next)) return false
    const text = writeList(session!.projection, next)
    if (text === session!.text) return false
    if (!options?.coalesce) {
      session!.undo.push(frame(options?.before))
      if (session!.undo.length > historyLimit) session!.undo.shift()
    }
    session!.redo.length = 0
    if (!options?.keepGroup) typing.current = undefined
    if (options?.selection) setSelected(options.selection)
    if (options?.after) cursorTo(options.after)
    else if (editing && !locateBlock(next, editing)) setEditing(undefined)
    if (scope && !locateBlock(next, scope)) setBranch(undefined)
    reflect(next, text)
    return true
  }

  function restore(redo: boolean) {
    const source = redo ? session!.redo : session!.undo
    const destination = redo ? session!.undo : session!.redo
    const saved = source.pop()
    if (!saved) return
    destination.push(frame())
    typing.current = undefined
    composition.current = undefined
    setBranch(saved.scope, false)
    if (saved.caret) {
      const hidden = new Set(collapsed)
      for (const parent of blockPath(saved.blocks, saved.caret.id).slice(0, -1)) hidden.delete(parent.id)
      syncCollapsed(hidden)
      cursorTo(saved.caret)
    } else {
      setEditing(undefined)
      setSelected(saved.selected)
      anchor.current = saved.selected[0]
      rangeEnd.current = saved.selected.at(-1)
      root.current?.focus({ preventScroll: true })
    }
    reflect(saved.blocks)
  }

  function syncCollapsed(next: Set<string>) {
    session!.collapsed = next
    setCollapsed(next)
  }

  function collapse(id: string, value: boolean) {
    const next = new Set(collapsed)
    if (value) next.add(id)
    else next.delete(id)
    syncCollapsed(next)
  }

  function setBranch(id?: string, clear = true, remember = clear) {
    if (remember && session.scope !== id) {
      session.branchBack.push(session.scope)
      if (session.branchBack.length > historyLimit) session.branchBack.shift()
      session.branchForward.length = 0
    }
    session.scope = id
    setScope(id)
    if (clear) {
      typing.current = undefined
      anchor.current = undefined
      rangeEnd.current = undefined
      setEditing(undefined)
      setSelected([])
      if (id && collapsed.has(id)) collapse(id, false)
      root.current?.scrollTo({ top: 0 })
      root.current?.focus({ preventScroll: true })
    }
  }

  function validBranch(id?: string) {
    return id !== scope && (id === undefined || !!locateBlock(blocks, id))
  }

  function navigateBranch(forward: boolean) {
    const source = forward ? session.branchForward : session.branchBack
    const destination = forward ? session.branchBack : session.branchForward
    while (source.length) {
      const next = source.pop()
      if (!validBranch(next)) continue
      destination.push(scope)
      setBranch(next, true, false)
      return
    }
  }

  function select(id: string, range = false, toggle = false) {
    typing.current = undefined
    setEditing(undefined)
    document.getSelection()?.removeAllRanges()
    rangeEnd.current = id
    if (range) {
      const start = visible.findIndex(node => node.id === anchor.current)
      const to = visible.findIndex(node => node.id === id)
      const from = start < 0 ? to : start
      if (to >= 0) {
        anchor.current = visible[from].id
        setSelected(visible.slice(Math.min(from, to), Math.max(from, to) + 1).map(node => node.id))
      }
    } else if (toggle) {
      anchor.current = id
      setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    } else {
      anchor.current = id
      setSelected([id])
    }
    root.current?.focus({ preventScroll: true })
  }

  function remove(ids: string[]) {
    const keys = new Set(ids)
    if (!keys.size) return
    const hidden = new Set(flattenBlocks(selectedBranches(blocks, keys)).map(node => node.id))
    const from = visible.findIndex(node => hidden.has(node.id))
    const next = visible.slice(from).find(node => !hidden.has(node.id)) ?? visible.slice(0, Math.max(0, from)).at(-1)
    if (change(nodes => { removeBranches(nodes, keys); return true }, { selection: next ? [next.id] : [] })) {
      anchor.current = next?.id
      rangeEnd.current = next?.id
    }
    root.current?.focus({ preventScroll: true })
  }

  function structure(event: KeyboardEvent<HTMLTextAreaElement>, block: Block) {
    const { key, shiftKey, metaKey, ctrlKey, altKey, currentTarget } = event
    const mod = platform === 'darwin' ? metaKey : ctrlKey
    const move = (platform === 'darwin' ? metaKey : altKey) && shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')
    const at = cursor(block.id, currentTarget.selectionStart, currentTarget.selectionEnd)
    if (key === 'Escape' && !mod && !altKey) {
      event.preventDefault()
      event.stopPropagation()
      select(block.id)
      return
    }
    if (mod && !shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      if (block.children.length) { event.preventDefault(); collapse(block.id, key === 'ArrowUp') }
      return
    }
    if (!mod && !shiftKey && !altKey && at.start === at.end && (key === 'ArrowUp' || key === 'ArrowDown')) {
      const style = getComputedStyle(currentTarget)
      const lineHeight = parseFloat(style.lineHeight)
      const naturalHeight = lineHeight * block.text.split('\n').length + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      if (currentTarget.scrollHeight > naturalHeight + 1) return
      const firstLine = !block.text.slice(0, at.start).includes('\n')
      const lastLine = !block.text.slice(at.start).includes('\n')
      if (key === 'ArrowUp' ? firstLine : lastLine) {
        const index = visible.findIndex(node => node.id === block.id)
        const adjacent = visible[index + (key === 'ArrowUp' ? -1 : 1)]
        if (adjacent) {
          event.preventDefault()
          typing.current = undefined
          cursorTo(cursor(adjacent.id, key === 'ArrowUp' ? adjacent.text.length : 0))
        }
      }
      return
    }
    if (key === 'Enter' && (shiftKey || mod || altKey)) return
    const merge = key === 'Backspace' && !at.start && !at.end && !mod && !shiftKey && !altKey
    if (!move && key !== 'Enter' && key !== 'Tab' && !merge) return

    const next = structuredClone(session!.blocks)
    const found = locateBlock(next, block.id)
    if (!found) return
    const { siblings, index, parent } = found
    const node = siblings[index]
    let after: OutlineCaret | undefined
    if (move) {
      const target = index + (key === 'ArrowUp' ? -1 : 1)
      if (target < 0 || target >= siblings.length || node.id === scope) { event.preventDefault(); return }
      siblings.splice(index, 1)
      siblings.splice(target, 0, node)
      after = at
    } else if (key === 'Enter') {
      if (at.start === 0 && at.end === 0 && node.text && node.id !== scope) {
        const newNode = newBlock('', node.marker)
        siblings.splice(index, 0, newNode)
        after = cursor(newNode.id, 0)
      } else {
        const child = node.id === scope || node.children.length > 0 && !collapsed.has(node.id) && at.start === node.text.length
        const atStartOfScope = node.id === scope && at.start === 0 && at.end === 0
        const newNode = newBlock(atStartOfScope ? '' : node.text.slice(at.end), child ? node.children[0]?.marker ?? node.marker : node.marker)
        if (!atStartOfScope) node.text = node.text.slice(0, at.start)
        if (child) { node.children.unshift(newNode); collapse(node.id, false) }
        else siblings.splice(index + 1, 0, newNode)
        after = cursor(newNode.id, 0)
      }
    } else if (key === 'Tab' && !shiftKey) {
      const previous = siblings[index - 1]
      if (!previous || node.id === scope) { event.preventDefault(); return }
      node.marker = previous.children[0]?.marker ?? node.marker
      previous.children.push(...siblings.splice(index, 1))
      collapse(previous.id, false)
      after = at
    } else if (key === 'Tab') {
      if (!parent || parent.id === scope) { event.preventDefault(); return }
      const outer = locateBlock(next, parent.id)!
      siblings.splice(index, 1)
      node.marker = parent.marker
      outer.siblings.splice(outer.index + 1, 0, node)
      after = at
    } else if (node.id === scope) {
      return
    } else if (siblings[index - 1]) {
      const previous = siblings[index - 1]
      after = cursor(previous.id, previous.text.length)
      previous.text += node.text
      for (const child of node.children) child.marker = previous.children[0]?.marker ?? child.marker
      previous.children.push(...node.children)
      siblings.splice(index, 1)
    } else if (!node.text && !node.children.length) {
      const adjacent = siblings[index + 1] ?? parent
      siblings.splice(index, 1)
      if (adjacent) after = cursor(adjacent.id, 0)
    } else return
    event.preventDefault()
    change(next, { before: at, after })
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 ||
        event.target instanceof Element && event.target.closest('.document-menu')) return
    const { key, shiftKey, altKey, metaKey, ctrlKey } = event
    const mod = platform === 'darwin' ? metaKey : ctrlKey
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-outline-block]') : null
    const id = editing ?? selected.at(-1) ?? target?.dataset.outlineBlock
    if (mod && !altKey && ['z', 'y'].includes(key.toLowerCase())) {
      event.preventDefault()
      event.stopPropagation()
      restore(shiftKey || key.toLowerCase() === 'y')
    } else if (platform === 'darwin' ? mod && ['.', '>'].includes(key) : altKey && key === 'ArrowRight') {
      if (!id) return
      event.preventDefault()
      setBranch(id)
    } else if ((platform === 'darwin' ? mod && key === ',' : altKey && key === 'ArrowLeft') || key === 'Escape') {
      if (!scope && !selected.length) return
      event.preventDefault()
      event.stopPropagation()
      if (selected.length && key === 'Escape') setSelected([])
      else setBranch(breadcrumb.at(-2)?.id)
    } else if (altKey && !mod && !shiftKey && (key === 'ArrowUp' || key === 'ArrowDown') && visible.length) {
      event.preventDefault()
      const edge = selected.length ? rangeEnd.current ?? id : id
      const index = visible.findIndex(block => block.id === edge)
      if (!selected.length) anchor.current = id
      const next = index < 0 ? 0 : index + (key === 'ArrowUp' ? -1 : 1)
      const adjacent = visible[Math.max(0, Math.min(visible.length - 1, next))]
      select(adjacent.id, !!id)
    } else if (mod && shiftKey && key.toLowerCase() === 'a') {
      event.preventDefault()
      document.getSelection()?.removeAllRanges()
      setEditing(undefined)
      setSelected(visible.map(node => node.id))
      anchor.current = visible[0]?.id
      rangeEnd.current = visible.at(-1)?.id
      root.current?.focus({ preventScroll: true })
    } else if (!editing && selected.length && (key === 'Backspace' || key === 'Delete')) {
      event.preventDefault()
      remove(selected)
    } else if (!editing && id && key === 'Enter' && event.target === root.current) {
      event.preventDefault()
      cursorTo(cursor(id, 0))
    }
  }

  function type(event: React.ChangeEvent<HTMLTextAreaElement>, block: Block) {
    const input = event.currentTarget
    const native = event.nativeEvent as InputEvent
    const value = input.value
    const before = inputBefore.current?.id === block.id ? inputBefore.current : cursor(block.id, block.text.length)
    inputBefore.current = undefined
    const composing = composition.current?.id === block.id ? composition.current : undefined
    const now = performance.now()
    const group = typing.current
    const groupable = typingTypes.has(native.inputType) && before.start === before.end
    const coalesce = composing?.recorded || groupable && group?.id === block.id && group.type === native.inputType &&
      group.end === before.start && now - group.time < 750
    const next = editBlockText(session!.blocks, block.id, value)
    const changed = next && change(next, { before: composing?.before ?? before, coalesce: !!coalesce, keepGroup: true })
    if (changed && composing) composing.recorded = true
    typing.current = groupable ? { id: block.id, type: native.inputType, time: now, end: input.selectionStart } : undefined
  }

  function preview(event: MouseEvent, node: Block) {
    if (event.target instanceof Element && event.target.closest('.md-image button')) return
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault()
      select(node.id, event.shiftKey, !event.shiftKey)
      return
    }
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
    if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) return
    cursorTo(cursor(node.id, node.text.length))
  }

  function copy(event: ClipboardEvent<HTMLDivElement>, cut: boolean) {
    if (!selected.length || event.target instanceof HTMLTextAreaElement || document.getSelection()?.isCollapsed === false) return
    const branches = selectedBranches(blocks, selectedSet)
    if (!branches.length) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', writeBranches(branches))
    if (cut) remove(selected)
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const raw = event.clipboardData.getData('text/plain')
    if (!raw) return
    const branches = readBranches(raw)
    if (event.target instanceof HTMLTextAreaElement && !branches) return
    event.preventDefault()
    const pasted = branches ?? [newBlock(raw.replace(/\r\n?/g, '\n'))]
    const id = editing ?? selectedBranches(blocks, selectedSet).at(-1)?.id
    change(nodes => {
      const target = id && locateBlock(nodes, id)
      const subtree = scope ? locateBlock(nodes, scope) : undefined
      const scoped = subtree?.siblings[subtree.index]
      const list = target && id !== scope ? target.siblings : scoped?.children ?? nodes
      const index = target && id !== scope ? target.index + 1 : list.length
      const marker = list[0]?.marker ?? scoped?.marker ?? '-'
      for (const node of pasted) node.marker = marker
      list.splice(index, 0, ...pasted)
      if (scope && id === scope) collapse(scope, false)
      return true
    }, { selection: pasted.map(node => node.id) })
    setEditing(undefined)
    root.current?.focus({ preventScroll: true })
  }

  function dropTarget(event: DragEvent<HTMLDivElement>, id: string): OutlineDrop | undefined {
    const moving = drag.current
    if (!moving || blockPath(blocks, id).some(block => moving.has(block.id))) return
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - box.top) / box.height
    return { id, position: id === scope || fraction >= .28 && fraction <= .72 ? 'child' : fraction < .28 ? 'before' : 'after' }
  }

  function addBlock(parent?: string) {
    const list = parent ? locateBlock(blocks, parent) : undefined
    const source = list?.siblings[list.index]
    const node = newBlock('', source?.children[0]?.marker ?? source?.marker ?? blocks[0]?.marker)
    change(next => {
      const found = parent ? locateBlock(next, parent) : undefined
      const children = found ? found.siblings[found.index].children : next
      children.push(node)
      if (parent) collapse(parent, false)
      return true
    }, { after: cursor(node.id, 0) })
  }

  function render(nodes: Block[]) {
    return <ul>{nodes.map(node => {
      const closed = collapsed.has(node.id)
      return <li key={node.id} data-outline-block={node.id}>
        <div className="outline-row" data-selected={selectedSet.has(node.id)}
          data-drop={drop?.id === node.id ? drop.position : undefined}
          onDragOver={event => {
            const target = dropTarget(event, node.id)
            if (!target) { setDrop(undefined); return }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            if (drop?.id !== target.id || drop.position !== target.position) setDrop(target)
          }}
          onDragLeave={event => {
            if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDrop(undefined)
          }}
          onDrop={event => {
            const target = dropTarget(event, node.id)
            const ids = drag.current
            drag.current = undefined
            setDrop(undefined)
            if (!target || !ids) return
            event.preventDefault()
            if (change(next => moveBranches(next, ids, target), { selection: [...ids] }) && target.position === 'child') collapse(target.id, false)
          }}>
          <span className="outline-controls">
            {node.children.length > 0 && <button className="outline-toggle" aria-label={closed ? '展开子块' : '折叠子块'}
              aria-expanded={!closed} onClick={() => collapse(node.id, !closed)}><ChevronRight size={13} /></button>}
            <button className="outline-bullet" type="button" data-closed={closed} aria-label={'聚焦块 ' + blockTitle(node)}
              draggable={node.id !== scope} onClick={event => {
                if (event.shiftKey || event.metaKey || event.ctrlKey) select(node.id, event.shiftKey, !event.shiftKey)
                else setBranch(node.id)
              }} onContextMenu={event => {
                event.preventDefault()
                if (!selectedSet.has(node.id)) select(node.id)
                setMenu({ id: node.id, x: event.clientX, y: event.clientY })
              }} onDragStart={event => {
                const ids = selectedSet.has(node.id) ? selectedSet : new Set([node.id])
                if (scope && ids.has(scope)) { event.preventDefault(); return }
                drag.current = ids
                event.dataTransfer.setData('text/plain', writeBranches(selectedBranches(blocks, ids)))
                event.dataTransfer.effectAllowed = 'move'
              }} onDragEnd={() => { drag.current = undefined; setDrop(undefined) }}><span /></button>
          </span>
          {editing === node.id
            ? <textarea aria-label="块内容" data-block={node.id} rows={Math.max(1, node.text.split('\n').length)} value={node.text}
                ref={element => { if (element) inputs.current.set(node.id, element); else inputs.current.delete(node.id) }}
                onBlur={() => { typing.current = undefined; setEditing(current => current === node.id ? undefined : current) }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return
                  if (/^(?:Arrow|Home|End|Page)/.test(event.key)) typing.current = undefined
                  structure(event, node)
                }}
                onPointerDown={() => { typing.current = undefined }}
                onCompositionStart={event => {
                  typing.current = undefined
                  composition.current = { id: node.id, before: cursor(node.id, event.currentTarget.selectionStart, event.currentTarget.selectionEnd), recorded: false }
                }}
                onCompositionEnd={() => { composition.current = undefined }}
                onChange={event => type(event, node)} />
            : <div className="outline-markdown outline-preview" role="button" tabIndex={0} aria-label={'编辑块 ' + blockTitle(node)}
                onMouseDown={event => { if (event.shiftKey || event.metaKey || event.ctrlKey) event.preventDefault() }}
                onClick={event => preview(event, node)} onKeyDown={event => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    cursorTo(cursor(node.id, 0))
                  }
                }}><OutlineMarkdown block text={node.text} {...{ path, remoteImages, links }} /></div>}
        </div>
        {node.children.length > 0 && !closed && <div className="outline-children">
          <button className="outline-guide" tabIndex={-1} aria-label="折叠此分支" onClick={() => collapse(node.id, true)} />
          {render(node.children)}
        </div>}
      </li>
    })}</ul>
  }

  const remainder = !focused && projectionRemainder(session.projection)
  return <div ref={root} className="outline-editor" data-width={width} tabIndex={-1} onKeyDown={handleKeys}
    onCopy={event => copy(event, false)} onCut={event => copy(event, true)} onPaste={paste}
    onClick={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault() }}>
    <div className="outline-content">
      <div className="outline-toolbar" role="toolbar" aria-label="大纲工具栏">
        <button className="icon-button" aria-label="后退" title="返回上一个分支" disabled={!session.branchBack.some(validBranch)}
          onClick={() => navigateBranch(false)}><ArrowLeft size={16} /></button>
        <button className="icon-button" aria-label="前进" title="前往下一个分支" disabled={!session.branchForward.some(validBranch)}
          onClick={() => navigateBranch(true)}><ArrowRight size={16} /></button>
        <nav aria-label="大纲路径">
          {focused && <>
            <button className="tool-button" onClick={() => setBranch()}>{name.replace(/\.(?:md|markdown)$/i, '')}</button>
            {breadcrumb.map(node => <span key={node.id}><ChevronRight size={13} />
              {focused.id === node.id ? <span aria-current="page">{blockTitle(node)}</span>
                : <button className="tool-button" onClick={() => setBranch(node.id)}>{blockTitle(node)}</button>}</span>)}
          </>}
        </nav>
        <button className="icon-button" aria-label="撤销块编辑" title="撤销" disabled={!session.undo.length}
          onMouseDown={event => event.preventDefault()} onClick={() => restore(false)}><Undo2 size={16} /></button>
        <button className="icon-button" aria-label="重做块编辑" title="重做" disabled={!session.redo.length}
          onMouseDown={event => event.preventDefault()} onClick={() => restore(true)}><Redo2 size={16} /></button>
        <div className="menu-anchor">
          <button type="button" className="icon-button" title="页宽设置" aria-label="页宽设置" aria-haspopup="menu" aria-expanded={widthMenu}
            onClick={() => setWidthMenu(!widthMenu)}><BetweenHorizontalStart size={16} /></button>
          {widthMenu && <MarkdownMenu close={() => setWidthMenu(false)} items={markdownPageWidths.map(([value, label]) => ({
            label, selected: width === value, run: () => setWidth(value),
          }))} />}
        </div>
      </div>
      {render(focused ? [focused] : blocks)}
      <button className="tool-button outline-add" onClick={() => addBlock(focused?.id)}><Plus size={17} />新增块</button>
      {remainder && <DocumentRemainder text={remainder} className="outline-surrounding" {...{ path, remoteImages, links }}
        visible={remainderVisible} onToggle={setRemainderVisible} />}
    </div>
    {menu && <MarkdownMenu point={menu} nativeStyle close={() => setMenu(undefined)} items={[
      { label: '聚焦此分支', run: () => setBranch(menu.id) },
      { label: '新增子块', run: () => addBlock(menu.id) },
      { label: '删除所选块', separator: true, run: () => remove(selected) },
    ]} />}
  </div>
}
