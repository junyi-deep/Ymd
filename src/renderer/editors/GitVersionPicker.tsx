import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { GitCommit, GitFileVersion } from '../../shared/contracts'

export const currentFile = 'current'
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

interface VersionOption {
  value: string
  label: string
  search: string
  hash?: string
  date?: string
  title?: string
}

export function GitVersionPicker({ side, value, commits, head, select, version }: {
  side: 'left' | 'right'; value: string; commits: GitCommit[]; head: string | null
  select: (value: string) => void; version?: GitFileVersion
}) {
  const label = side === 'left' ? '基准版本' : '比较版本'
  const picker = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const revisions = useMemo(() => {
    const options: VersionOption[] = []
    if (side === 'right') options.push({ value: currentFile, label: '当前文件', search: '当前文件 current' })
    if (!commits.length) options.push({ value: '', label: '空白基准', search: '空白基准' })
    for (const item of commits) {
      const date = dateFormat.format(new Date(item.committedAt))
      options.push({
        value: item.hash, label: item.subject || '无提交说明', hash: item.short, date,
        title: [item.hash, date, item.subject, item.body].filter(Boolean).join('\n'),
        search: `${item.hash} ${item.subject} ${item.body} ${item.committedAt} ${date} ${item.hash === head ? 'HEAD' : ''}`.toLowerCase(),
      })
    }
    return options
  }, [commits, head, side])
  const selected = revisions.find(option => option.value === value)
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const options = revisions.filter(option => words.every(word => option.search.includes(word)))

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [open])

  function show() {
    setQuery('')
    setActive(-1)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  function choose(value: string) {
    select(value)
    close()
  }

  return <div ref={picker} className="git-diff-version" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button ref={trigger} type="button" className="git-diff-version-label" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} data-ref={value}
      title={selected?.title ?? selected?.label} onClick={() => open ? close() : show()}
      onKeyDown={event => {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); show() }
      }}>
      {selected?.hash && <code>{selected.hash}</code>}<span>{selected?.label}</span><ChevronDown size={14} />
    </button>
    {value !== currentFile && version?.exists === false && <span className="git-diff-missing">该版本无此文件</span>}
    {open && <div className="git-version-popover">
      <div className="search-input"><Search size={16} /><input ref={input} type="search" role="combobox"
        aria-label={'搜索' + label} aria-controls={listId} aria-expanded={true} aria-autocomplete="list"
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        placeholder="搜索提交说明、哈希或日期" value={query} onChange={event => {
          setQuery(event.currentTarget.value)
          setActive(-1)
          if (list.current) list.current.scrollTop = 0
        }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) { event.stopPropagation(); return }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
          if (event.key === 'Enter' && options.length) { event.preventDefault(); choose(options[Math.max(0, active)].value); return }
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
            event.preventDefault()
            const next = event.key === 'ArrowDown' ? (active + 1) % options.length : (active <= 0 ? options.length - 1 : active - 1)
            setActive(next)
            list.current?.children[next]?.scrollIntoView({ block: 'nearest' })
          }
        }} /></div>
      <div ref={list} id={listId} className="search-results" role="listbox" aria-label={label}>
        {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
          aria-selected={active === index} className="git-version-option" title={option.title ?? option.label}
          onMouseMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}>
          {option.hash && <code>{option.hash}</code>}<span>{option.label}</span>
          {option.value === value && <Check size={14} />}
          {option.date && <small>{option.value === head && 'HEAD · '}{option.date}</small>}
        </div>)}
      </div>
      {!options.length && <p className="search-empty" role="status">没有匹配的提交</p>}
    </div>}
  </div>
}
