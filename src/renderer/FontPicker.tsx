import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'

const builtIn = [['system-ui', '系统默认'], ['serif', '系统衬线'], ['monospace', '系统等宽']] as const
let systemFonts: readonly string[] | undefined

export function FontPicker({ label, value, change, inline = false }: { label: string; value: string; change: (value: string) => void; inline?: boolean }) {
  const picker = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [fonts, setFonts] = useState(systemFonts)
  const [failed, setFailed] = useState(false)
  const shown = builtIn.find(([font]) => font === value)?.[1] ?? value
  const matches = [...builtIn, ...(fonts ?? []).map(name => [name, name] as const)]
    .filter(([font, name]) => (font + ' ' + name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 80)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [open])

  async function toggle() {
    setOpen(!open)
    setQuery('')
    if (open || fonts) return
    try {
      if (!window.queryLocalFonts) throw new Error()
      const local = await window.queryLocalFonts()
      systemFonts = [...new Set(local.map(font => font.family).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
      setFonts(systemFonts)
      setFailed(false)
    } catch { setFailed(true) }
  }

  return <div ref={picker} className={inline ? "map-font-picker interface-font-picker" : "map-font-picker"} onKeyDown={event => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    setOpen(false)
  }}>
    <label>{!inline && label}<button type="button" className="tool-button" aria-label={label + ' ' + shown} aria-expanded={open}
      onClick={() => void toggle()}><span>{shown}</span><ArrowUpDown size={13} /></button></label>
    {open && <div className="map-font-options">
      <input type="search" autoFocus aria-label={'搜索' + label} value={query} placeholder="搜索系统字体"
        onChange={event => setQuery(event.currentTarget.value)} />
      {!fonts && <p>{failed ? '无法读取系统字体。' : '正在读取系统字体…'}</p>}
      {fonts && !matches.length && <p>没有匹配的字体</p>}
      <div>{matches.map(([font, name]) => <button className="tree-row" key={font} type="button" aria-pressed={font === value}
        title={name} onClick={() => { change(font); setOpen(false) }}>{name}</button>)}</div>
    </div>}
  </div>
}
