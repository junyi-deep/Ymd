import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, Ellipsis, FileText, Folder, FolderOpen, Plus, Shapes } from 'lucide-react'
import type { Entry } from '../shared/contracts'

export const DocumentIcon = ({ kind }: { kind: Entry['kind'] }) => kind === 'drawing' ? <Shapes size={17} /> : <FileText size={17} />

type EntryAction = (entry: Entry, x: number, y: number) => void
export interface TreeDrag {
  start: (entry: Entry) => void
  end: () => void
  allowed: (target: Entry) => boolean
  move: (target: Entry) => void
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

export function FileTreeRow({ entry, depth, selected, open, onClick, onMenu, onCreate, checked, onCheck, rename, drag, onExpand }: {
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
}) {
  const folder = entry.kind === 'directory'
  const [dropTarget, setDropTarget] = useState(false)
  function accepts(event: DragEvent) {
    return folder && drag?.allowed(entry) && event.dataTransfer.types.includes(dragType)
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
    style={{ paddingInlineStart: 5 + depth * 17 }}
    onDragOver={event => {
      if (!accepts(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (!dropTarget) setDropTarget(true)
    }}
    onDragLeave={event => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropTarget(false)
    }}
    onDrop={event => {
      setDropTarget(false)
      if (!accepts(event)) return
      event.preventDefault()
      drag?.move(entry)
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
          drag.start(entry)
          event.dataTransfer.setData(dragType, entry.path)
          event.dataTransfer.effectAllowed = 'move'
        }} onDragEnd={() => drag?.end()} onClick={onClick}>
        {!(checked !== undefined && folder) && glyph}<span>{entry.name}</span>
      </button>}
    {checked === undefined && !rename && <>
      <button type="button" className="icon-button tree-row-action" aria-haspopup="menu"
        aria-label={'更多操作 ' + entry.name} title="更多操作" onClick={event => anchor(event, onMenu)}><Ellipsis size={15} /></button>
      {onCreate && <button type="button" className="icon-button tree-row-action" aria-haspopup="menu"
        aria-label={'新建于 ' + entry.name} title="新建" onClick={event => anchor(event, onCreate)}><Plus size={15} /></button>}
    </>}
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
  onCreate?: EntryAction
  onMenu: EntryAction
  selection?: ReadonlyMap<string, Entry>
  rename?: TreeRename
  drag?: TreeDrag
  onSelect?: (entry: Entry) => void
}

export function FilesTree({ directory, active, revision, depth = 0, expanded = false, onOpen, onExpand, onCreate, onMenu, selection, onSelect, rename, drag }: Props) {
  const [open, setOpen] = useState(expanded)
  const [entries, setEntries] = useState<Entry[]>()
  const [error, setError] = useState(false)
  const toggleOpen = () => {
    if (!open) onExpand?.(directory)
    setOpen(!open)
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
      drag={selection ? undefined : drag} onExpand={toggleOpen}
      checked={selection?.has(directory.path)} onCheck={() => onSelect?.(directory)}
      onClick={event => selection || event.shiftKey && onSelect ? onSelect?.(directory) : toggleOpen()}
      onMenu={(x, y) => onMenu(directory, x, y)} onCreate={onCreate && ((x, y) => {
        setOpen(true)
        onCreate(directory, x, y)
      })} />}
    {open && (error ? <p className="tree-empty">无法读取目录</p> :
      !entries ? <p className="tree-empty">正在读取…</p> : !entries.length ? (
        expanded && <p className="tree-empty">还没有文档</p>
      ) : entries.map(entry => {
        const level = expanded ? depth : depth + 1
        return entry.kind === 'directory'
          ? <FilesTree key={entry.path} directory={entry} depth={level} {...{ active, revision, onOpen, onExpand, onCreate, onMenu, selection, onSelect, rename, drag }} />
          : <FileTreeRow key={entry.path} depth={level} entry={entry} selected={entry.path === active}
            drag={selection ? undefined : drag}
            rename={rename?.path === entry.path ? rename : undefined}
            checked={selection?.has(entry.path)} onCheck={() => onSelect?.(entry)}
            onClick={event => selection || event.shiftKey && onSelect ? onSelect?.(entry) : onOpen(entry)}
            onMenu={(x, y) => onMenu(entry, x, y)} />
      }))}
  </>
}
