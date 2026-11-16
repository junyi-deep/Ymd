import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Search, Sticker, X } from 'lucide-react'
import { artTransferType, loadMapSticker, type MapArt } from './mapStickers'

function StickerTile({ name, apply }: { name: string; apply?: (art: MapArt) => void }) {
  const [art, setArt] = useState<MapArt>()
  const element = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!element.current) return
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void loadMapSticker(name).then(value => { if (active) setArt(value) }).catch(() => {})
    }, { rootMargin: '120px' })
    observer.observe(element.current)
    return () => { active = false; observer.disconnect() }
  }, [name])
  const label = art?.label ?? name
  return <button ref={element} type="button" className="map-art-tile" aria-label={label} title={label}
    aria-disabled={!art || !apply} draggable={!!art}
    onClick={() => { if (art) apply?.(art) }} onDragStart={event => {
      if (!art) return
      event.dataTransfer.setData(artTransferType, name)
      event.dataTransfer.effectAllowed = 'copy'
    }}>{art ? <img src={art.source} alt="" draggable={false} /> : <Sticker size={19} />}</button>
}

export function MindMapArt({ directory, target, close, apply }: {
  directory?: string
  target?: string
  close: () => void
  apply: (art: MapArt) => void
}) {
  const [names, setNames] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void window.desktop.listMapStickers().then(list => {
      if (active) { setNames(list); setNotice('') }
    }, () => { if (active) { setNames([]); setNotice('无法读取贴纸目录。') } })
    return () => { active = false }
  }, [directory, revision])

  const found = names.filter(name => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  async function add() {
    setBusy(true)
    try { setNames(await window.desktop.importMapStickers()); setNotice(''); setRevision(value => value + 1) }
    catch (error) { setNotice(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '无法添加贴纸。') }
    finally { setBusy(false) }
  }
  return <aside className="map-format map-art" aria-label="贴纸">
    <header><strong>贴纸</strong><div className="section-actions">
      <button className="icon-button" type="button" aria-label="添加贴纸" title="添加贴纸" disabled={busy} onClick={() => void add()}><Plus size={16} /></button>
      <button className="icon-button" type="button" aria-label="刷新贴纸" title="刷新贴纸" onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /></button>
      <button className="icon-button" type="button" aria-label="关闭贴纸" onClick={close}><X size={16} /></button>
    </div></header>
    <div className="map-art-search"><Search size={15} />
      <input type="search" value={query} placeholder="查找贴纸" aria-label="查找贴纸"
        onChange={event => setQuery(event.target.value)} /></div>
    {target && <p className="map-art-target" title={target}>插入到「{target}」</p>}
    <div className="map-art-grid">
      {found.map(name => <StickerTile key={(directory ?? '') + ':' + revision + ':' + name} name={name} apply={target ? apply : undefined} />)}
    </div>
    {notice ? <p className="map-format-empty" role="alert">{notice}</p> : !found.length &&
      <p className="map-format-empty">{names.length ? '未找到匹配的贴纸。' : '点击加号将图片添加到全局贴纸目录。'}</p>}
  </aside>
}
