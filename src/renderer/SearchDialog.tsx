import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Search, X } from 'lucide-react'
import type { SearchHit } from '../shared/contracts'
import type { Session } from './documents'
import { DocumentIcon } from './FilesTree'

function highlight(text: string, query: string): ReactNode {
  const needle = query.toLowerCase()
  if (!needle) return text
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  let start = 0
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, start)) {
    parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>)
    start = index + needle.length
  }
  return [...parts, text.slice(start)]
}

function draftResult(document: Session, needle: string): SearchHit | undefined {
  const { path, name, kind, modified, opened, text } = document
  const index = kind === 'markdown' ? text.toLowerCase().indexOf(needle) : -1
  if (index < 0 && !name.toLowerCase().includes(needle)) return
  const offset = Math.max(0, index - 24)
  const line = index >= 0 ? text.slice(0, index).split(/\r\n|\n|\r/).length : undefined
  return { path, name, kind, location: path.slice(0, path.length - name.length - 1), modified, opened, line,
    snippet: index < 0 ? undefined : text.slice(offset, index + needle.length + 100).replace(/\s+/g, ' ').trim() }
}

const timeFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function SearchDialog({ documents, onOpen, onClose }: {
  documents: Session[]
  onOpen: (hit: SearchHit) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [remote, setRemote] = useState<{ query: string; hits: SearchHit[]; error?: boolean }>()
  const needle = query.trim().toLowerCase()
  useEffect(() => {
    dialog.current?.showModal()
    input.current?.focus()
  }, [])
  useEffect(() => {
    if (!needle) return
    let current = true
    const timer = window.setTimeout(() => {
      window.desktop.search(needle).then(
        hits => { if (current) setRemote({ query: needle, hits }) },
        () => { if (current) setRemote({ query: needle, hits: [], error: true }) },
      )
    }, 130)
    return () => {
      current = false
      window.clearTimeout(timer)
      void window.desktop.cancelSearch()
    }
  }, [needle])
  const recent = [...documents].sort((a, b) => Math.max(b.opened, b.modified) - Math.max(a.opened, a.modified))
  const disk = remote?.query === needle ? remote.hits : []
  const hits = needle ? [
    ...documents.flatMap(document => {
      const match = draftResult(document, needle)
      return match ? [match] : []
    }),
    ...disk.filter(hit => !documents.some(document => document.path === hit.path && document.text !== document.saved)),
  ].filter((hit, index, matches) => matches.findIndex(match => match.path === hit.path) === index)
    .sort((a, b) => Number(b.name.toLowerCase().includes(needle)) - Number(a.name.toLowerCase().includes(needle)) || (b.modified ?? 0) - (a.modified ?? 0))
    .slice(0, 100)
    : recent.slice(0, 20).map(document => ({ ...document, location: document.path.slice(0, -document.name.length - 1) }))
  useEffect(() => { options.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])
  return <dialog ref={dialog} className="search-dialog" aria-label="搜索文档"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className="search-input"><Search size={19} /><input ref={input} aria-label="搜索文件名或正文" role="combobox"
      aria-controls="search-results" aria-expanded="true" aria-autocomplete="list"
      aria-activedescendant={hits[active] ? 'search-row-' + active : undefined} placeholder="搜索" value={query}
      onChange={event => { setQuery(event.target.value); setActive(0) }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && hits[active]) { event.preventDefault(); onOpen(hits[active]) }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && hits.length) {
          event.preventDefault()
          setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length)
        }
      }} />
      {query && <button className="icon-button" aria-label="清空搜索" onClick={() => { setQuery(''); setActive(0); input.current?.focus() }}><X size={16} /></button>}
    </div>
    <div id="search-results" ref={options} className="search-results" role="listbox" aria-label={needle ? '搜索结果' : '最近浏览'}>
      {!needle && <p className="search-label">最近浏览</p>}
      {hits.map((hit: SearchHit, index) => <div key={hit.path} id={`search-row-${index}`} role="option" aria-selected={active === index}
        className="search-result" onMouseMove={() => setActive(index)} onClick={() => onOpen(hit)}>
        <DocumentIcon kind={hit.kind} />
        <div className="min-w-0">
          <strong>{highlight(hit.name, needle)}</strong>
          {hit.snippet && <p className="search-snippet">{highlight(hit.snippet, needle)}</p>}
          <small title={hit.path}>{hit.location}{hit.opened ? ` · ${timeFormat.format(hit.opened)} 打开` : ''}
            {hit.modified ? ` · ${timeFormat.format(hit.modified)} 修改` : ''}</small>
        </div>
      </div>)}
      {!hits.length && <p className="search-empty" role="status">{!needle ? '还没有浏览记录' : remote?.query !== needle
        ? '正在搜索…' : remote.error ? '无法完成磁盘搜索' : '没有匹配的文档'}</p>}
    </div>
    <div className="search-footer"><span><ArrowUp size={13} /><ArrowDown size={13} /> 选择</span><span><CornerDownLeft size={13} /> 打开</span><kbd>Esc 关闭</kbd></div>
  </dialog>
}
