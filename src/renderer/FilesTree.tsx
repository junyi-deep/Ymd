import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { Check, ChevronDown, ChevronRight, Ellipsis, FileText, Folder, FolderOpen, Minus, Plus, Shapes, Trash2 } from 'lucide-react'
import type { Entry } from '../shared/contracts'

export const DocumentIcon = ({ kind }: { kind: Entry['kind'] }) => kind === 'drawing' ? <Shapes size={17} /> : <FileText size={17} />

type EntryAction = (entry: Entry, x: number, y: number) => void
export type TreeDrop = 'inside' | 'before' | 'after'
export interface TreeDrag {
  start: (entry: Entry, reorderable: boolean) => void
  end: () => void
  allowed: (target: Entry, place: TreeDrop) => boolean
  move: (target: Entry, place: TreeDrop) => void
}
const dragType = 'application/x-ymd-entry'
export interface TreeRename {
  path: string
  name: string
  busy: boolean
  change: (name: string) => void
  save: () => void
  cancel: () => void
}

export function FileTreeRow({ entry, depth, selected, open, onClick, onMenu, onCreate, checked, onCheck, rename, drag, onExpand, onDelete, onRemove, reorderable = false }: {
  entry: Entry
  depth: number
  selected?: boolean
  open?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onMenu: (x: number, y: number) => void
  onCreate?: (x: number, y: number) => void
  checked?: boolean
  onCheck?: () => void
  rename?: TreeRename
  drag?: TreeDrag
  onExpand?: () => void
  onDelete?: () => void
  onRemove?: () => void
  reorderable?: boolean
}) {
  const folder = entry.kind === 'directory'
  const [dropTarget, setDropTarget] = useState<TreeDrop>()
  const [confirm, setConfirm] = useState(false)
  function dropPlace(event: DragEvent): TreeDrop | undefined {
    if (!drag || !event.dataTransfer.types.includes(dragType)) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - bounds.top) / bounds.height
    const place = reorderable && (!folder || ratio < .25 || ratio > .75)
      ? ratio < .5 ? 'before' : 'after' : 'inside'
    if ((folder || place !== 'inside') && drag.allowed(entry, place)) return place
  }
  function anchor(event: MouseEvent<HTMLButtonElement>, action: (x: number, y: number) => void) {
    const bounds = event.currentTarget.getBoundingClientRect()
    action(bounds.left, bounds.bottom + 4)
  }

  const glyph = folder ? <span className="tree-folder-glyph">
    {open ? <FolderOpen size={17} /> : <Folder size={17} />}
    {open ? <ChevronDown className="tree-disclosure" size={17} /> : <ChevronRight className="tree-disclosure" size={17} />}
  </span> : <DocumentIcon kind={entry.kind} />
  return <div className="tree-item" data-selected={selected || checked} data-drop-target={dropTarget}
    style={{ paddingInlineStart: `min(${5 + depth * 17}px, max(5px, 100% - 99px))` }}
    onDragOver={event => {
      const place = dropPlace(event)
      setDropTarget(place)
      if (!place) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }}
    onDragLeave={event => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropTarget(undefined)
    }}
    onDrop={event => {
      setDropTarget(undefined)
      const place = dropPlace(event)
      if (!place) return
      event.preventDefault()
      drag?.move(entry, place)
    }}
    onContextMenu={event => {
      event.preventDefault()
      onMenu(event.clientX, event.clientY)
    }}>
    {checked !== undefined && <input type="checkbox" checked={checked} aria-label={'选择 ' + entry.name} onChange={onCheck} />}
    {checked !== undefined && folder && <button type="button" className="icon-button tree-batch-folder"
      aria-label={(open ? '收起 ' : '展开 ') + entry.name} aria-expanded={open} onClick={onExpand}>{glyph}</button>}
    {rename ? <div className="tree-row tree-rename">{glyph}<input type="text" aria-label="新名称" value={rename.name} readOnly={rename.busy}
      autoFocus onFocus={event => event.currentTarget.select()} onChange={event => rename.change(event.target.value)}
      onBlur={() => { if (!rename.busy) rename.cancel() }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || rename.busy) return
        if (event.key === 'Enter' && rename.name.trim()) { event.preventDefault(); rename.save() }
        if (event.key === 'Escape') { event.stopPropagation(); rename.cancel() }
      }} /></div> :
      <button className="tree-row" title={entry.name} aria-expanded={folder && checked === undefined ? open : undefined}
        draggable={!!drag} onDragStart={event => {
          if (!drag) return
          drag.start(entry, reorderable)
          event.dataTransfer.setData(dragType, entry.path)
          event.dataTransfer.effectAllowed = 'move'
        }} onDragEnd={() => drag?.end()} onClick={onClick}>
        {!(checked !== undefined && folder) && glyph}<span>{entry.name}</span>
      </button>}
    {checked === undefined && !rename && <div className="tree-row-actions">
      {onRemove && <button type="button" className="icon-button tree-row-action" aria-label={'移除 ' + entry.name} title="从本机文件移除"
        onClick={onRemove}><Minus size={15} /></button>}
      {onDelete && <button type="button" className="icon-button tree-row-action tree-delete" data-confirm={confirm}
        aria-label={(confirm ? '确认删除 ' : '删除 ') + entry.name} title={confirm ? '确认移到回收站' : '移到回收站'}
        onBlur={() => setConfirm(false)} onKeyDown={event => { if (event.key === 'Escape') setConfirm(false) }}
        onClick={() => { if (confirm) onDelete(); setConfirm(!confirm) }}>{confirm ? <Check size={15} /> : <Trash2 size={15} />}</button>}
      <button type="button" className="icon-button tree-row-action" aria-haspopup="menu"
        aria-label={'更多操作 ' + entry.name} title="更多操作" onClick={event => anchor(event, onMenu)}><Ellipsis size={15} /></button>
      {onCreate && <button type="button" className="icon-button tree-row-action" aria-haspopup="menu"
        aria-label={'新建于 ' + entry.name} title="新建" onClick={event => anchor(event, onCreate)}><Plus size={15} /></button>}
    </div>}
  </div>
}

interface Props {
  directory: Entry
  active?: string
  revision: number
  depth?: number
  expanded?: boolean
  onOpen: (entry: Entry) => void
  onExpand?: (entry: Entry) => void
  expandedPaths: ReadonlySet<string>
  hiddenPaths?: ReadonlySet<string>
  onToggle: (entry: Entry, open: boolean) => void
  onDelete?: (entry: Entry) => void
  onRemove?: (entry: Entry) => void
  reorderable?: boolean
  onCreate?: EntryAction
  onMenu: EntryAction
  selection?: ReadonlyMap<string, Entry>
  rename?: TreeRename
  drag?: TreeDrag
  onSelect?: (entry: Entry) => void
}

export function FilesTree({ directory, active, revision, depth = 0, expanded = false, expandedPaths, hiddenPaths, onToggle,
  onOpen, onExpand, onCreate, onMenu, selection, onSelect, rename, drag, onDelete, onRemove, reorderable }: Props) {
  const open = expanded || expandedPaths.has(directory.path)
  const [entries, setEntries] = useState<Entry[]>()
  const [error, setError] = useState(false)
  const toggleOpen = () => {
    if (!open) onExpand?.(directory)
    onToggle(directory, !open)
  }

  useEffect(() => {
    if (!open) return
    let alive = true
    window.desktop.list(directory.path).then(result => {
      if (alive) {
        setEntries(result)
        setError(false)
      }
    }, () => { if (alive) setError(true) })
    return () => { alive = false }
  }, [directory.path, open, revision])

  return <>
    {!expanded && <FileTreeRow entry={directory} depth={depth} open={open}
      rename={rename?.path === directory.path ? rename : undefined}
      drag={selection ? undefined : drag} onExpand={toggleOpen} reorderable={reorderable}
      onDelete={onDelete && (() => onDelete(directory))} onRemove={onRemove && (() => onRemove(directory))}
      checked={selection?.has(directory.path)} onCheck={() => onSelect?.(directory)}
      onClick={event => selection || event.shiftKey && onSelect ? onSelect?.(directory) : toggleOpen()}
      onMenu={(x, y) => onMenu(directory, x, y)} onCreate={onCreate && ((x, y) => {
        if (!open) onToggle(directory, true)
        onCreate(directory, x, y)
      })} />}
    {open && (error ? <p className="tree-empty">无法读取目录</p> :
      !entries ? <p className="tree-empty">正在读取…</p> : !entries.length ? (
        expanded && <p className="tree-empty">还没有文档</p>
      ) : entries.filter(entry => !hiddenPaths?.has(entry.path)).map(entry => {
        const level = expanded ? depth : depth + 1
        return entry.kind === 'directory'
          ? <FilesTree key={entry.path} directory={entry} depth={level}
            {...{ active, revision, expandedPaths, hiddenPaths, onToggle, onOpen, onExpand, onCreate, onMenu, selection, onSelect, rename, drag, onDelete, onRemove }} />
          : <FileTreeRow key={entry.path} depth={level} entry={entry} selected={entry.path === active}
            drag={selection ? undefined : drag}
            onDelete={onDelete && (() => onDelete(entry))} onRemove={onRemove && (() => onRemove(entry))}
            rename={rename?.path === entry.path ? rename : undefined}
            checked={selection?.has(entry.path)} onCheck={() => onSelect?.(entry)}
            onClick={event => selection || event.shiftKey && onSelect ? onSelect?.(entry) : onOpen(entry)}
            onMenu={(x, y) => onMenu(entry, x, y)} />
      }))}
  </>
}
