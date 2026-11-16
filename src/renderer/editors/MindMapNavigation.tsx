import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { navigationGroups, type Facet, type NavigationTopic } from './mapNavigation'
import type MindMap from 'simple-mind-map'

type View = '主题' | '备注' | '标记与标签'
const views: View[] = ['主题', '备注', '标记与标签']

export function MindMapNavigation({ topics, titleMatches, currentTopic, initialFacet, search, count, close, highlight, locate, focusRequest, replaceTopics }: {
  topics: NavigationTopic[]
  titleMatches: string[]
  currentTopic?: string
  initialFacet?: string
  search: MindMap['search'] | undefined
  count: { total: number; currentIndex: number }
  close: () => void
  highlight: (ids: ReadonlySet<string> | null) => void
  locate: (id: string) => void
  focusRequest: number
  replaceTopics: (text: string, all: boolean) => void
}) {
  const [view, setView] = useState<View>(initialFacet ? '标记与标签' : '主题')
  const [queries, setQueries] = useState<Record<View, string>>({ 主题: '', 备注: '', 标记与标签: '' })
  const [replace, setReplace] = useState('')
  const [selected, setSelected] = useState(() => new Set(initialFacet ? [initialFacet] : []))
  const input = useRef<HTMLInputElement>(null)
  const inputValue = queries[view].trim()
  const query = inputValue.toLocaleLowerCase()
  const facets = useMemo(() => {
    const all = new Map<string, Facet & { count: number }>()
    for (const topic of topics) for (const facet of topic.facets) {
      const old = all.get(facet.id)
      if (old) old.count++
      else all.set(facet.id, { ...facet, count: 1 })
    }
    return [...all.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [topics])
  const topicQuery = view === '主题' ? inputValue : ''
  const results = useMemo(() => {
    if (view === '标记与标签') return selected.size ? topics.filter(topic => topic.facets.some(facet => selected.has(facet.id))) : []
    if (view === '备注') return topics.filter(topic => topic.note && topic.note.toLocaleLowerCase().includes(query))
    const byId = new Map(topics.map(topic => [topic.id, topic]))
    return topicQuery ? titleMatches.flatMap(id => byId.get(id) ?? []) : []
  }, [topics, view, query, topicQuery, selected, titleMatches])
  const active = view === '标记与标签' ? selected.size > 0 : !!query

  useEffect(() => { input.current?.focus() }, [view, focusRequest])
  useEffect(() => {
    if (topicQuery) search?.search(topicQuery)
    else search?.endSearch()
  }, [search, topicQuery])
  useEffect(() => () => search?.endSearch(), [search])
  useEffect(() => { highlight(active ? new Set(results.map(topic => topic.id)) : null) }, [active, results, highlight])
  useEffect(() => () => highlight(null), [highlight])

  return <aside className="map-format map-navigation" aria-label="导图导航">
    <header><strong>导航</strong><button className="icon-button" aria-label="关闭导图搜索" onClick={close}><X size={16} /></button></header>
    <div className="segments map-format-tabs" role="group" aria-label="导航类型">
      {views.map(item => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}
    </div>
    <div className="map-art-search" role="search"><Search size={15} />
      <input ref={input} aria-label={view === '主题' ? '查找主题内容' : view === '备注' ? '查找备注' : '查找筛选项'}
        placeholder={'查找' + view} value={queries[view]} onChange={event => setQueries({ ...queries, [view]: event.target.value })}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          if (view === '主题') search?.searchNext()
          else if (results[0]) locate(results[0].id)
        }} />
      {view === '主题' && topicQuery && <span>{count.total ? count.currentIndex + 1 : 0}/{count.total}</span>}
    </div>
    {view === '主题' && <div className="map-navigation-replace">
      <input aria-label="替换主题内容" placeholder="替换为" value={replace} onChange={event => setReplace(event.target.value)} />
      <button className="tool-button" disabled={!count.total} onClick={() => replaceTopics(replace, false)}>替换</button>
      <button className="tool-button" disabled={!count.total} onClick={() => replaceTopics(replace, true)}>全部</button>
    </div>}
    <div className="map-navigation-results">
    {view === '标记与标签' && <>
      {!!selected.size && <button className="map-navigation-clear tool-button" onClick={() => setSelected(new Set())}>清除筛选</button>}
      {navigationGroups.map(group => {
        const visible = facets.filter(facet => facet.group === group && facet.label.toLocaleLowerCase().includes(query))
        if (!visible.length) return null
        return <section key={group}><h3>{group}</h3>
          {visible.map(facet => <button key={facet.id} className="tree-row map-navigation-row" aria-pressed={selected.has(facet.id)}
            onClick={() => setSelected(current => {
              const next = new Set(current)
              if (next.has(facet.id)) next.delete(facet.id)
              else next.add(facet.id)
              return next
            })}><span>{facet.label}</span><small aria-hidden="true">{facet.count}</small></button>)}
        </section>
      })}
      {!facets.some(facet => facet.label.toLocaleLowerCase().includes(query)) && <p className="map-format-empty">{query ? '没有匹配的筛选项。' : '此画布还没有标记、标签或任务。'}</p>}
    </>}
    {(view === '备注' || active) && <section aria-label="匹配主题">
      {view !== '主题' && <h3>{view === '备注' && !query ? '所有备注' : '匹配主题'}</h3>}
      {results.map(topic => <button key={topic.id} className="tree-row map-navigation-row" aria-current={currentTopic === topic.id || undefined}
        onClick={() => {
          if (view === '主题') search?.jump(titleMatches.indexOf(topic.id))
          else locate(topic.id)
        }}>
        <span>{topic.title || '未命名主题'}</span>{view === '备注' && <small className="navigation-note">{topic.note}</small>}
      </button>)}
      {!results.length && <p className="map-format-empty">{view === '备注' && !query ? '此画布还没有备注。' : '没有匹配的主题。'}</p>}
    </section>}
    </div>
  </aside>
}
