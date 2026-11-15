import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { calloutDefaults, calloutFonts, calloutShapes, calloutStyle, type Callout } from './mapCallouts'

export function MindMapCalloutText({ initial, add, close, save }: {
  initial: string; add: boolean; close: () => void; save: (text: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initial)
  useEffect(() => { dialog.current?.showModal(); input.current?.select() }, [])
  return <dialog ref={dialog} aria-labelledby="map-callout-text-title" onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => { event.preventDefault(); if (text.trim()) save(text) }}>
      <h2 id="map-callout-text-title">{add ? '添加标注' : '编辑标注'}</h2>
      <label>标注内容<textarea ref={input} autoFocus required maxLength={2000} value={text}
        onChange={event => setText(event.target.value)} /></label>
      <footer><button type="button" onClick={close}>取消</button>
        <button className="primary" type="submit" disabled={!text.trim()}>{add ? '添加' : '保存'}</button></footer>
    </form>
  </dialog>
}

const hex = (color: string, fallback: string) => /^#[\da-f]{6}$/i.test(color) ? color : fallback

export function MindMapCalloutFormat({ note, close, edit, change }: {
  note: Callout; close: () => void; edit: () => void; change: (data: Record<string, unknown>) => void
}) {
  const appearance = calloutStyle(note.data)
  return <aside className="map-format" aria-label="标注格式">
    <header><strong>标注格式</strong><button className="icon-button" aria-label="关闭格式面板" onClick={close}><X size={16} /></button></header>
    <section>
      <button className="tool-button" onClick={edit}>编辑标注内容</button>
      <label>形状<select value={appearance.shape} onChange={event => change({ shape: event.target.value })}>
        {calloutShapes.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>填充颜色<input type="color" value={hex(appearance.fill, calloutDefaults.fillColor)}
        onChange={event => change({ fillColor: event.target.value })} /></label>
      <label>宽度<input key={'width-' + appearance.width} type="number" min="72" max="640" defaultValue={appearance.width}
        onBlur={event => { if (event.currentTarget.validity.valid && event.currentTarget.value) change({ calloutWidth: Number(event.currentTarget.value) }) }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
    </section>
    <section>
      <h3>文字</h3>
      <label>字体<select value={appearance.font} onChange={event => change({ fontFamily: event.target.value })}>
        {!calloutFonts.some(([value]) => value === appearance.font) && <option value={appearance.font}>{appearance.font}</option>}
        {calloutFonts.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>字号<input key={'size-' + appearance.size} type="number" min="9" max="60" defaultValue={appearance.size}
        onBlur={event => { if (event.currentTarget.validity.valid && event.currentTarget.value) change({ fontSize: Number(event.currentTarget.value) }) }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
      <label>文字颜色<input type="color" value={hex(appearance.color, calloutDefaults.color)}
        onChange={event => change({ color: event.target.value })} /></label>
      <label>文字对齐<select value={appearance.align} onChange={event => change({ textAlign: event.target.value })}>
        <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
      </select></label>
      <label>加粗<input type="checkbox" checked={appearance.weight === 'bold'}
        onChange={event => change({ fontWeight: event.target.checked ? 'bold' : 'normal' })} /></label>
      <label>斜体<input type="checkbox" checked={appearance.italic}
        onChange={event => change({ fontStyle: event.target.checked ? 'italic' : 'normal' })} /></label>
      <label>下划线<input type="checkbox" checked={note.data.textDecoration === 'underline'}
        onChange={event => change({ textDecoration: event.target.checked ? 'underline' : 'none' })} /></label>
    </section>
    <section><button className="tool-button" onClick={() => change({ ...calloutDefaults, textDecoration: 'none' })}>重置标注样式</button></section>
  </aside>
}
