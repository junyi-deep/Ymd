import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { artTransferType, mapArt, type ArtKind, type MapArt } from './mapStickers'

const kinds: ArtKind[] = ['贴纸', '插图']

export function MindMapArt({ target, close, apply }: {
  target?: string
  close: () => void
  apply: (art: MapArt) => void
}) {
  const [kind, setKind] = useState<ArtKind>('贴纸')
  const [query, setQuery] = useState('')
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = mapArt.filter(item => {
    const text = item.label + ' ' + item.keywords
    return terms.length ? terms.every(term => text.includes(term)) : item.kind === kind
  })

  return <aside className="map-format map-art" aria-label="贴纸与插图">
    <header><strong>贴纸与插图</strong>
      <button className="icon-button" aria-label="关闭贴纸与插图" onClick={close}><X size={16} /></button>
    </header>
    <div className="map-art-search">
      <Search size={15} />
      <input type="search" value={query} placeholder="查找贴纸或插图" aria-label="查找贴纸或插图"
        autoFocus onChange={event => setQuery(event.target.value)} />
    </div>
    <div className="segments map-format-tabs">
      {kinds.map(value => <button key={value} type="button" aria-pressed={kind === value && !terms.length}
        onClick={() => { setKind(value); setQuery('') }}>{value}</button>)}
    </div>
    {target && <p className="map-art-target" title={target}>插入到「{target}」</p>}
    <div className="map-art-grid">
      {found.map(art => <button key={art.id} type="button" className="map-art-tile"
        aria-label={art.label} title={art.label + (target ? '' : ' · 拖到主题')} aria-disabled={!target} draggable
        onClick={() => { if (target) apply(art) }} onDragStart={event => {
          event.dataTransfer.setData(artTransferType, art.id)
          event.dataTransfer.effectAllowed = 'copy'
        }}><img src={art.source} alt="" draggable={false} /></button>)}
    </div>
    {!found.length && <p className="map-format-empty">未找到匹配的素材。</p>}
    {!target && <p className="map-format-empty">选中一个主题，或把素材拖到主题上。</p>}
  </aside>
}
