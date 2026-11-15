import { useEffect, useRef, useState } from 'react'
import type { DocumentFile, Entry } from '../../shared/contracts'
import { mapDocumentPath, mapDocumentSheets, registerMapDocument, registerMapTarget } from './mapDocumentLinks'
import { isExternalMapLink, listMapTopics, mainSheetId, readTopicLink, topicLinkUrl } from './mapTopicLinks'

export type LinkType = 'web' | 'topic'
export interface LinkSheet { id: string; title: string; topics: ReturnType<typeof listMapTopics> }

export function MindMapLink({ initial, kind, current, currentPath, source, sheets, documents, readDocument, close, save }: {
  initial: string; kind: LinkType; current: string; source: string; sheets: LinkSheet[]
  currentPath: string; documents: Pick<Entry, 'path' | 'name'>[]; readDocument: (path: string) => Promise<DocumentFile>
  close: () => void; save: (value: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const previous = readTopicLink(initial)
  const [initialDocument] = useState(() => previous?.document ? mapDocumentPath(previous.document) ?? 'unavailable' : '')
  const [destination, setDestination] = useState(initialDocument === currentPath ? '' : initialDocument)
  const [target, setTarget] = useState<{ file: DocumentFile; sheets: LinkSheet[] }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialDocument === 'unavailable' ? '目标文档未关联。请选择文档。' : '')
  const request = useRef(0)
  const [url, setUrl] = useState(previous ? '' : initial)
  const [sheetId, setSheetId] = useState(previous?.sheet ?? current)
  const [topic, setTopic] = useState(previous?.topic ?? '')
  const [bidirectional, setBidirectional] = useState(previous?.bidirectional ?? false)
  const [query, setQuery] = useState('')
  const candidates = destination ? target?.sheets ?? [] : sheets
  const sheet = candidates.find(item => item.id === sheetId)
  const sameCanvas = !destination && sheetId === current
  const available = sheet?.topics.filter(item => !sameCanvas || item.id !== source) ?? []
  const root = sheet?.topics[0]
  const allowSheet = !!root && (!sameCanvas || root.id !== source)
  const validTopic = topic ? available.some(item => item.id === topic) : allowSheet
  const filter = query.trim().toLowerCase()
  const matches = filter ? available.filter(item => item.id === topic || item.title.toLowerCase().includes(filter)) : available
  const validWeb = isExternalMapLink(url.trim())

  function selectDocument(file: DocumentFile, keepTopic: boolean) {
    if (file.path === currentPath) { selectCurrentDocument(); return }
    const next = mapDocumentSheets(file).map(item => ({ id: item.id, title: item.title, topics: listMapTopics(item.tree) }))
    setDestination(file.path)
    setTarget({ file, sheets: next })
    setError(next.length ? '' : '该文档的 Markdown 结构无法显示为导图。')
    if (!keepTopic) {
      setSheetId(next[0]?.id ?? mainSheetId)
      setTopic('')
      setQuery('')
    }
  }

  function selectCurrentDocument() {
    request.current++
    setDestination('')
    setTarget(undefined)
    setSheetId(current)
    setTopic('')
    setQuery('')
    setError('')
    setBusy(false)
  }

  async function loadDocument(path: string, keepTopic = false) {
    const id = ++request.current
    setDestination(path)
    setTarget(undefined)
    setBusy(true)
    setError('')
    try {
      const file = await readDocument(path)
      if (id === request.current) selectDocument(file, keepTopic)
    } catch {
      if (id === request.current) setError('无法读取目标文档。请通过「浏览」重新选择。')
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  async function browseDocuments() {
    const id = ++request.current
    setBusy(true)
    try {
      const file = await window.desktop.chooseFile('markdown')
      if (!file || id !== request.current) return
      const latest = documents.some(document => document.path === file.path) ? await readDocument(file.path) : file
      if (id === request.current) selectDocument(latest, latest.path === destination)
    } catch {
      if (id === request.current) setError('无法打开所选文档。')
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  useEffect(() => {
    dialog.current?.showModal()
    if (kind === 'topic' && initialDocument && initialDocument !== 'unavailable' && initialDocument !== currentPath) {
      void loadDocument(initialDocument, true)
    }
    return () => { request.current++ }
  }, [])

  function saveTopic() {
    try {
      const document = destination && target ? registerMapTarget(target.file) : undefined
      if (document) registerMapDocument(currentPath)
      save(topicLinkUrl({ document, sheet: sheetId, topic: topic || undefined, bidirectional }))
    } catch { setError('无法保存链接的文档信息。') }
  }

  return <dialog className="map-link-dialog" ref={dialog} aria-labelledby="map-link-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (kind === 'topic' && validTopic && !busy) saveTopic()
      if (kind === 'web' && validWeb) save(url.trim())
    }}>
      <h2 id="map-link-title">{kind === 'web' ? '网页链接' : '主题链接'}</h2>
      {kind === 'web'
        ? <label>网址<input type="url" placeholder="https://" value={url} autoFocus required onChange={event => setUrl(event.target.value)} /></label>
        : <>
          <div className="map-link-document">
            <label>链接到文档<select value={destination} onChange={event => {
              if (event.target.value) void loadDocument(event.target.value)
              else selectCurrentDocument()
            }}>
              <option value="">当前文档</option>
              {destination && !documents.some(file => file.path === destination) && <option value={destination}>
                {target?.file.name ?? (destination === 'unavailable' ? '未关联的文档' : destination.split(/[\\/]/).at(-1))}
              </option>}
              {documents.map(file => <option key={file.path} value={file.path} title={file.path}>{file.name}</option>)}
            </select></label>
            <button type="button" className="tool-button" disabled={busy} onClick={() => void browseDocuments()}>浏览…</button>
          </div>
          {busy && <p className="map-link-status" role="status">正在读取文档…</p>}
          {error && <p className="map-link-status" role="alert">{error}</p>}
          <label>链接到画布<select value={sheetId} disabled={busy || !candidates.length} onChange={event => {
            setSheetId(event.target.value)
            setTopic('')
            setQuery('')
          }}>
            {!sheet && <option value={sheetId} disabled>{candidates.length ? '画布已删除' : '选择目标文档'}</option>}
            {candidates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select></label>
          <label>筛选主题<input type="search" value={query} disabled={busy || !sheet} onChange={event => setQuery(event.target.value)} /></label>
          <label>目标主题<select value={topic} disabled={busy || !sheet} size={Math.min(7, Math.max(3, matches.length + 1))}
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
        <button type="submit" className="primary" disabled={kind === 'web' ? !validWeb : busy || !validTopic}>保存</button>
      </footer>
    </form>
  </dialog>
}
