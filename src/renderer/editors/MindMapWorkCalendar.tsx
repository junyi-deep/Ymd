import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { calendarDays, dateDay, dayDate, dayMs, defaultWorkCalendar, firstDay, lastDay, readWorkCalendar, repetitions,
  todayDay, weekday, type DayException, type WorkCalendar } from './workCalendar'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const templateKey = 'ymd.work-calendar-templates'
type Template = { id: string; title: string; calendar: WorkCalendar }

function loadTemplates(): Template[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(templateKey) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
      const calendar = readWorkCalendar(item?.calendar)
      return calendar && typeof item.id === 'string' && typeof item.title === 'string' ? [{ id: item.id, title: item.title, calendar }] : []
    })
  } catch { return [] }
}

function monthStart(day: number, offset = 0) {
  const date = new Date(day * dayMs)
  date.setUTCMonth(date.getUTCMonth() + offset, 1)
  return date.valueOf() / dayMs
}

export function MindMapWorkCalendar({ initial, notice, save, close }: {
  initial?: WorkCalendar
  notice: string
  save: (calendar: WorkCalendar) => boolean
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [calendar, setCalendar] = useState(initial ?? defaultWorkCalendar)
  const [month, setMonth] = useState(() => monthStart(todayDay()))
  const [templates, setTemplates] = useState(loadTemplates)
  const [templateId, setTemplateId] = useState('')
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateError, setTemplateError] = useState('')
  const preview = useMemo(() => calendarDays(readWorkCalendar({ ...calendar, enabled: true })), [calendar])
  const leading = (weekday(month) + 6) % 7
  const monthLength = monthStart(month, 1) - month
  const valid = calendar.weekdays.length && readWorkCalendar(calendar)?.exceptions.length === calendar.exceptions.length
  const selectedTemplate = templates.find(item => item.id === templateId)

  useEffect(() => { dialog.current?.showModal() }, [])

  function saveTemplates(next: Template[]) {
    try {
      localStorage.setItem(templateKey, JSON.stringify(next))
      setTemplates(next)
      setTemplateError('')
      return true
    } catch { setTemplateError('无法保存日历模板。'); return false }
  }

  function addTemplate() {
    const title = templateTitle.trim()
    const snapshot = readWorkCalendar(calendar)
    if (!title || !snapshot || !valid) return
    const id = crypto.randomUUID()
    if (saveTemplates([...templates, { id, title, calendar: snapshot }])) {
      setTemplateId(id)
      setTemplateTitle('')
    }
  }

  function updateRule(index: number, patch?: Partial<DayException>) {
    setCalendar(current => ({
      ...current,
      exceptions: patch ? current.exceptions.map((rule, order) => order === index ? { ...rule, ...patch } : rule)
        : current.exceptions.filter((_, order) => order !== index),
    }))
    if (patch?.date) {
      const day = dateDay(patch.date)
      if (day !== undefined && day >= firstDay) setMonth(monthStart(day))
    }
  }

  return <dialog className="map-work-calendar" ref={dialog} aria-labelledby="map-calendar-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => {
      event.preventDefault()
      const next = readWorkCalendar(calendar)
      if (next && valid && save(next)) close()
    }}>
      <header className="map-calendar-heading"><h2 id="map-calendar-title">项目工作日</h2></header>
      <div className="map-calendar-content">
      <label className="map-calendar-switch"><input type="checkbox" checked={calendar.enabled}
        onChange={event => setCalendar({ ...calendar, enabled: event.target.checked })} />跳过非工作日</label>
      {notice && <p role="alert">{notice}</p>}
      <div className="map-calendar-workweek">
        <fieldset><legend>每周工作日</legend>
          <div className="map-calendar-weekdays">{weekdays.map((label, index) => {
            const day = (index + 1) % 7
            return <label key={label}><input type="checkbox" aria-label={'星期' + label}
              checked={calendar.weekdays.includes(day)} onChange={event => setCalendar({
                ...calendar, weekdays: event.target.checked ? [...calendar.weekdays, day] : calendar.weekdays.filter(value => value !== day),
              })} /><span>{label}</span></label>
          })}</div>
          {!calendar.weekdays.length && <p role="status">至少选择一个常规工作日。</p>}
        </fieldset>
        <section className="map-calendar-preview" aria-label="日历预览">
          <header>
            <button type="button" className="icon-button" aria-label="上个月" disabled={month <= firstDay}
              onClick={() => setMonth(monthStart(month, -1))}><ChevronLeft size={16} /></button>
            <span>{dayDate(month).slice(0, 7).replace('-', ' 年 ')} 月</span>
            <button type="button" className="icon-button" aria-label="下个月" disabled={monthStart(month, 1) > lastDay}
              onClick={() => setMonth(monthStart(month, 1))}><ChevronRight size={16} /></button>
          </header>
          <div className="map-calendar-days">
            {weekdays.map(label => <span key={label}>{label}</span>)}
            {Array.from({ length: leading }, (_, index) => <span aria-hidden="true" key={'lead-' + index} />)}
            {Array.from({ length: monthLength }, (_, index) => {
              const date = month + index
              const working = preview.working(date)
              return <time dateTime={dayDate(date)} data-off={!working} key={date}
                aria-label={dayDate(date) + (working ? ' 工作日' : ' 休息日')}>{index + 1}</time>
            })}
          </div>
        </section>
      </div>
      <section className="map-calendar-exceptions">
        <header><h3>例外日期</h3><button type="button" className="tool-button" onClick={() => {
          const date = monthStart(todayDay()) === month ? todayDay() : month
          setCalendar({ ...calendar, exceptions: [...calendar.exceptions, { title: '', date: dayDate(date), through: '', working: false, repeat: 'once' }] })
        }}><Plus size={15} />添加例外</button></header>
        {calendar.exceptions.map((rule, index) => <fieldset className="map-calendar-rule" key={index}>
          <legend className="sr-only">例外 {index + 1}</legend>
          <label>名称<input placeholder="选填" value={rule.title} maxLength={120} onChange={event => updateRule(index, { title: event.target.value })} /></label>
          <label>日期<input type="date" required min="0001-01-01" max="9999-12-31" value={rule.date}
            onChange={event => updateRule(index, { date: event.target.value })} /></label>
          <label>截至日期<input type="date" min={(rule.repeat === 'once' ? rule.date : rule.from ?? rule.date) || '0001-01-01'} max="9999-12-31" value={rule.through}
            onChange={event => updateRule(index, { through: event.target.value })} /></label>
          <label>类型<select value={rule.working ? 'working' : 'off'}
            onChange={event => updateRule(index, { working: event.target.value === 'working' })}>
            <option value="off">休息日</option><option value="working">工作日</option>
          </select></label>
          <label>重复<select value={rule.repeat} onChange={event => {
            const repeat = event.target.value as DayException['repeat']
            updateRule(index, repeat === 'once' ? { repeat, from: undefined, interval: undefined,
              through: rule.through < rule.date ? '' : rule.through } : { repeat })
          }}>
            {repetitions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {rule.repeat !== 'once' && <>
            <label>生效开始<input type="date" min="0001-01-01" max={rule.through || '9999-12-31'} value={rule.from ?? rule.date}
              onChange={event => updateRule(index, { from: event.target.value })} /></label>
            <label>重复间隔<input type="number" min="1" value={rule.interval ?? 1}
              onChange={event => updateRule(index, { interval: Number(event.target.value) || undefined })} /></label>
          </>}
          <button type="button" className="icon-button" aria-label={'删除例外 ' + (index + 1)}
            onClick={() => updateRule(index)}><Trash2 size={15} /></button>
        </fieldset>)}
      </section>
      <details className="map-calendar-templates">
        <summary>日历模板</summary>
        <div>
          <label>已有模板<select value={templateId} onChange={event => setTemplateId(event.target.value)}>
            <option value="">选择模板</option>
            {templates.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select></label>
          <button type="button" disabled={!selectedTemplate} onClick={() => {
            if (selectedTemplate) setCalendar({ ...selectedTemplate.calendar, enabled: true })
          }}>载入模板</button>
          <button type="button" disabled={!selectedTemplate} onClick={() => {
            if (saveTemplates(templates.filter(item => item.id !== templateId))) setTemplateId('')
          }}>删除模板</button>
          <label>模板名称<input value={templateTitle} maxLength={120} onChange={event => setTemplateTitle(event.target.value)} /></label>
          <button type="button" disabled={!templateTitle.trim() || !valid} onClick={addTemplate}>保存为模板</button>
        </div>
        {templateError && <p role="status">{templateError}</p>}
      </details>
      </div>
      <footer><button type="button" onClick={close}>取消</button><button className="primary" type="submit" disabled={!valid}>保存日历</button></footer>
    </form>
  </dialog>
}
