import { useEffect, useRef, useState } from 'react'
import { isExternalMapLink, listMapTopics, readTopicLink, topicLinkUrl } from './mapTopicLinks'

export type LinkType = 'web' | 'topic'
export interface LinkSheet { id: string; title: string; topics: ReturnType<typeof listMapTopics> }

export function MindMapLink({ initial, kind, current, source, sheets, close, save }: {
  initial: string; kind: LinkType; current: string; source: string; sheets: LinkSheet[]
  close: () => void; save: (value: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const previous = readTopicLink(initial)
  const [url, setUrl] = useState(previous ? '' : initial)
  const [sheetId, setSheetId] = useState(previous?.sheet ?? current)
  const [topic, setTopic] = useState(previous?.topic ?? '')
  const [bidirectional, setBidirectional] = useState(previous?.bidirectional ?? false)
  const [query, setQuery] = useState('')
  const sheet = sheets.find(item => item.id === sheetId)
  const available = sheet?.topics.filter(item => sheetId !== current || item.id !== source) ?? []
  const root = sheet?.topics[0]
  const allowSheet = !!root && (sheetId !== current || root.id !== source)
  const validTopic = topic ? available.some(item => item.id === topic) : allowSheet
  const filter = query.trim().toLowerCase()
  const matches = filter ? available.filter(item => item.id === topic || item.title.toLowerCase().includes(filter)) : available
  const validWeb = isExternalMapLink(url.trim())

  useEffect(() => { dialog.current?.showModal() }, [])

  return <dialog className="map-link-dialog" ref={dialog} aria-labelledby="map-link-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (kind === 'topic' && validTopic) save(topicLinkUrl({ sheet: sheetId, topic: topic || undefined, bidirectional }))
      if (kind === 'web' && validWeb) save(url.trim())
    }}>
      <h2 id="map-link-title">{kind === 'web' ? '网页链接' : '主题链接'}</h2>
      {kind === 'web'
        ? <label>网址<input type="url" placeholder="https://" value={url} autoFocus required onChange={event => setUrl(event.target.value)} /></label>
        : <>
          <label>链接到画布<select value={sheetId} onChange={event => {
            setSheetId(event.target.value)
            setTopic('')
            setQuery('')
          }}>
            {!sheet && <option value={sheetId} disabled>画布已删除</option>}
            {sheets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select></label>
          <label>筛选主题<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label>目标主题<select value={topic} size={Math.min(7, Math.max(3, matches.length + 1))}
            onChange={event => setTopic(event.target.value)}>
            <option value="" disabled={!allowSheet}>{allowSheet ? '整张画布（中心主题）' : '选择目标主题'}</option>
            {topic && !validTopic && <option value={topic} disabled>主题已删除</option>}
            {matches.map(item => <option key={item.id} value={item.id}>{'  '.repeat(Math.min(8, item.depth)) + item.title}</option>)}
          </select></label>
          <label className="map-link-choice"><input type="checkbox" checked={!!topic && bidirectional} disabled={!topic || !validTopic}
            onChange={event => setBidirectional(event.target.checked)} />双向链接</label>
        </>}
      <footer>
        {initial && <button className="map-link-remove" type="button" onClick={() => save('')}>移除链接</button>}
        <button type="button" onClick={close}>取消</button>
        <button type="submit" className="primary" disabled={kind === 'web' ? !validWeb : !validTopic}>保存</button>
      </footer>
    </form>
  </dialog>
}
