import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { defaultShortcut, inputChord, normalizeShortcut, setShortcut, shortcutCatalog, shortcutConflicts, shortcutLabel, shortcutValue,
  type ShortcutId, type ShortcutOverrides } from '../shared/shortcuts'

const titles = { app: '应用', markdown: 'Markdown 编辑', map: '思维导图' }

export function ShortcutSettings({ platform, overrides, onChange }: {
  platform: string; overrides: ShortcutOverrides; onChange: (value: ShortcutOverrides) => void
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ShortcutId>()
  const [strokes, setStrokes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const keycap = useRef<HTMLButtonElement>(null)
  const keys = strokes.join(' ')
  const text = (value: string) => shortcutLabel(value, platform)
  const conflicts = editing ? shortcutConflicts(overrides, editing, keys, platform) : []
  const filter = query.trim().toLowerCase()
  const rows = shortcutCatalog.filter(item => item.id === editing || !filter ||
    [item.label, item.id, shortcutValue(overrides, item.id, platform), text(shortcutValue(overrides, item.id, platform))]
      .some(value => value.toLowerCase().includes(filter)))

  useEffect(() => {
    if (!editing) return
    let active = true
    keycap.current?.focus()
    void window.desktop.setShortcutRecording(true).then(() => { if (active) setReady(true) }, () => {
      if (active) setError('无法启动快捷键录制。')
    })
    return () => { active = false; void window.desktop.setShortcutRecording(false).catch(() => {}) }
  }, [editing])

  function begin(id: ShortcutId, value = '') {
    setReady(editing === id && ready)
    setError('')
    setStrokes(value ? value.split(' ') : [])
    setEditing(id)
  }

  function finish(id: ShortcutId, value: string) {
    onChange(setShortcut(overrides, id, value, platform))
    setEditing(undefined)
  }

  function capture(event: KeyboardEvent<HTMLButtonElement>) {
    if (!editing || event.nativeEvent.isComposing || event.keyCode === 229) return
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    if (!ready || event.repeat) return
    if (plain && event.key === 'Enter') { if (keys) finish(editing, keys); return }
    if (plain && event.key === 'Backspace') { setStrokes(current => current.slice(0, -1)); setError(''); return }
    if (['Meta', 'Control', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) return
    const chord = inputChord({ key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey,
      shift: event.shiftKey }, platform)
    const next = chord && normalizeShortcut([...strokes, chord].join(' '), platform)
    if (next) { setStrokes(next.split(' ')); setError('') }
    else setError(strokes.length === 4 ? '已录制四组。按退格键可以修改。' : '请以组合键开头，并避开系统和编辑保留的按键。')
  }

  return <div className="shortcut-settings" onKeyDownCapture={event => {
    if (editing && event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.stopPropagation()
      setEditing(undefined)
    }
  }}>
    <div className="shortcut-heading">
      <h1>快捷键</h1>
      <div className="shortcut-toolbar">
        {Object.keys(overrides).length > 0 && <button className="tool-button" onClick={() => { setEditing(undefined); onChange({}) }}>全部恢复默认</button>}
        <label className="shortcut-search"><Search size={15} aria-hidden="true" />
          <input type="search" aria-label="搜索快捷键" placeholder="搜索快捷键" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
      </div>
    </div>
    {!rows.length && <p className="shortcut-empty">没有匹配的快捷键</p>}
    {Object.entries(titles).map(([scope, title]) => {
      const actions = rows.filter(item => item.scope === scope)
      if (!actions.length) return null
      return <section key={scope} className="shortcut-group">
        <h2>{title}</h2>
        <div className="settings-group">{actions.map(item => {
          const value = shortcutValue(overrides, item.id, platform)
          const original = defaultShortcut(item.id, platform)
          const recording = editing === item.id
          const label = item.label
          return <div className="shortcut-row" key={item.id}>
            <div className="settings-row">
              <span>{label}</span>
              <div className="shortcut-actions">
                {!recording && Object.hasOwn(overrides, item.id) && <button className="tool-button" aria-label={'恢复快捷键 ' + label}
                  onClick={() => shortcutConflicts(overrides, item.id, original, platform).length
                    ? begin(item.id, original) : finish(item.id, original)}>恢复默认</button>}
                {!recording && value && <button className="tool-button shortcut-remove" aria-label={'移除快捷键 ' + label}
                  onClick={() => finish(item.id, '')}>移除</button>}
                <button className="shortcut-keycap" aria-label={'编辑快捷键 ' + label} data-recording={recording}
                  ref={recording ? keycap : undefined} onClick={() => { if (!recording) begin(item.id) }} onKeyDown={recording ? capture : undefined}>
                  {recording && !keys ? '按下组合键…' : <kbd>{text(recording ? keys : value) || '未设置'}</kbd>}
                </button>
              </div>
            </div>
            {recording && <div className="shortcut-recorder">
              <p>最多四组。Enter 保存，Esc 取消，退格键修改。</p>
              {!!conflicts.length && <p role="status">保存后将解除以下绑定：{conflicts.map(item => item.label).join('、')}</p>}
              {error && <p role="alert">{error}</p>}
              <div className="shortcut-actions">
                <button className="tool-button" onClick={() => setEditing(undefined)}>取消</button>
                <button className="tool-button shortcut-save" disabled={!ready || !keys} onClick={() => finish(item.id, keys)}>保存</button>
              </div>
            </div>}
          </div>
        })}</div>
      </section>
    })}
  </div>
}
