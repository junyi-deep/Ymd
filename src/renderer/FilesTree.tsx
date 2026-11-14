import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Shapes } from 'lucide-react'
import type { Entry } from '../shared/contracts'

export const DocumentIcon = ({ kind }: { kind: Entry['kind'] }) => kind === 'drawing' ? <Shapes size={17} /> : <FileText size={17} />

interface Props {
  directory: Entry
  active?: string
  revision: number
  depth?: number
  expanded?: boolean
  onOpen: (entry: Entry) => void
  onCreate: (entry: Entry) => void
}

export function FilesTree({ directory, active, revision, depth = 0, expanded = false, onOpen, onCreate }: Props) {
  const [open, setOpen] = useState(expanded || depth === 0)
  const [entries, setEntries] = useState<Entry[]>()
  const [error, setError] = useState(false)

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
    {(!expanded || depth > 0) && <button className="tree-row" style={{ paddingLeft: 9 + depth * 13 }}
      aria-expanded={open} title={directory.name}
      onClick={() => setOpen(!open)} onContextMenu={event => { event.preventDefault(); onCreate(directory) }}>
      {open ? <ChevronDown className="tree-caret" /> : <ChevronRight className="tree-caret" />}
      {open ? <FolderOpen size={17} /> : <Folder size={17} />}
      <span>{directory.name}</span>
    </button>}
    {(open) && (error ? <p className="tree-empty">无法读取目录</p> :
      !entries ? <p className="tree-empty">正在读取…</p> :
      !entries.length ? (depth === 0 && expanded && <p className="tree-empty">还没有文档</p>) :
      entries.map(entry => entry.kind === 'directory'
        ? <FilesTree key={entry.path} {...{ active, revision, onOpen, onCreate }} directory={entry} depth={depth + 1} />
        : <button key={entry.path} className="tree-row"
          style={{ paddingLeft: 9 + (expanded ? depth : depth + 1) * 13 }} data-selected={entry.path === active} title={entry.name}
          onClick={() => onOpen(entry)}>
          <DocumentIcon kind={entry.kind} /><span>{entry.name}</span>
        </button>))}
  </>
}
