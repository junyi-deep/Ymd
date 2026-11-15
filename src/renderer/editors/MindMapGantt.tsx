import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { CalendarDays, CalendarRange, Download, Link2, Minus, Plus, Printer, X } from 'lucide-react'
import { MarkdownMenu } from './MarkdownMenu'
import { dayDate, dayMs, firstDay, lastDay, setTaskRange, taskRange, todayDay, type ScheduledTopic, type TaskRange } from './mapSchedule'
import type { MapTask } from './mapTasks'
import { ganttExport, type GanttFile } from './ganttExport'
import type { Workdays } from './workCalendar'

const rowHeight = 38
const scaleWidths = [6, 13, 30, 48]
const scaleLabels = ['月', '周', '日', '日 · 放大']
type DragKind = 'move' | 'start' | 'end' | 'progress'
type Drag = {
  id: string; kind: DragKind; pointer: number; origin: number; scrolled: number; left: number; width: number
  range: TaskRange; progress: number; preview?: { range: TaskRange; progress: number }
}

function translate(range: TaskRange, kind: DragKind, difference: number, days: Workdays): TaskRange {
  if (!difference) return range
  const { start, end } = range
  const direction = difference > 0 ? 1 : -1
  const length = Math.max(1, days.count(start, end))
  const target = kind === 'end' ? end + difference : start + difference
  const moved = days.seek(Math.max(firstDay, Math.min(lastDay, target)), direction)
  if (moved === undefined) return range
  if (kind === 'start') return { start: Math.min(end, moved), end }
  if (kind === 'end') return { start, end: Math.max(start, moved) }
  const last = days.shift(moved, length - 1)
  return last === undefined ? range : { start: moved, end: last }
}

export function MindMapGantt({ title, rows, edit, change, undo, redo, notice, clearNotice, report, days, skipClosed, openCalendar }: {
  title: string
  rows: ScheduledTopic[]
  edit: (id: string) => void
  change: (tasks: Map<string, MapTask>, schedule: boolean) => void
  undo: () => void
  redo: () => void
  notice: string
  clearNotice: () => void
  report: (error: string) => void
  days: Workdays
  skipClosed: boolean
  openCalendar: () => void
}) {
  const [scale, setScale] = useState(2)
  const [selection, setSelection] = useState<string[]>([])
  const [preview, setPreview] = useState<Drag>()
  const [exportMenu, setExportMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [windowPixels, setWindowPixels] = useState({ left: 0, width: 1000 })
  const scroll = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | undefined>(undefined)
  const zoomAnchor = useRef<number | undefined>(undefined)
  const marker = useId()
  const today = todayDay()
  const ranges = new Map(rows.flatMap(({ id, task }) => {
    const range = taskRange(task, days)
    return range ? [[id, range]] : []
  }))
  const dates = [...ranges.values()]
  const scheduledStart = dates.length ? Math.min(...dates.map(range => range.start)) : today
  const scheduledEnd = dates.length ? Math.max(...dates.map(range => range.end)) : today + 20
  const includeToday = today >= scheduledStart - 31 && today <= scheduledEnd + 31
  const start = Math.max(firstDay, Math.min(scheduledStart, includeToday ? today : scheduledStart) - 3)
  const end = Math.min(lastDay, Math.max(scheduledEnd, includeToday ? today : scheduledEnd) + 13)
  const dayWidth = scaleWidths[scale]
  const width = (end - start + 1) * dayWidth
  const step = Math.max(scale < 2 ? 7 : 1, Math.ceil((end - start + 1) / 500))
  const labels = Array.from({ length: Math.ceil((end - start + 1) / step) }, (_, index) => start + index * step)
  const monthLabels = labels.filter((day, index) => index === 0 || dayDate(day).slice(0, 7) !== dayDate(labels[index - 1]).slice(0, 7))
  const dateLabel = (day: number) => dayDate(day).slice(5).replace('-', '/')
  const chosen = selection.filter(id => rows.some(row => row.id === id))
  const position = (day: number) => (day - start) * dayWidth
  const rangeFor = (id: string) => preview?.id === id && preview.preview ? preview.preview.range : ranges.get(id)
  const rowIndexes = new Map(rows.map((row, index) => [row.id, index]))
  const offDays: number[] = []
  if (skipClosed) {
    const first = Math.max(start, start + Math.floor(windowPixels.left / dayWidth) - 2)
    const last = Math.min(end, start + Math.ceil((windowPixels.left + windowPixels.width) / dayWidth) + 2)
    for (let day = first; day <= last; day++) if (!days.working(day)) offDays.push(day)
  }

  useLayoutEffect(() => {
    scroll.current?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    const viewport = scroll.current
    if (!viewport || !skipClosed) return
    const update = () => setWindowPixels({ left: viewport.scrollLeft, width: viewport.clientWidth })
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    viewport.addEventListener('scroll', update, { passive: true })
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', update) }
  }, [skipClosed, rows.length > 0])

  useLayoutEffect(() => {
    if (zoomAnchor.current !== undefined && scroll.current) scroll.current.scrollLeft = position(zoomAnchor.current)
    zoomAnchor.current = undefined
  }, [scale, start])

  function zoom(next: number) {
    zoomAnchor.current = start + (scroll.current?.scrollLeft ?? 0) / dayWidth
    setScale(next)
  }

  function select(id: string, multiple = false) {
    setSelection(current => multiple ? current.includes(id) ? current.filter(item => item !== id) : [...current, id] : [id])
  }

  function selectRow(id: string, multiple: boolean) {
    select(id, multiple)
    const range = ranges.get(id)
    const viewport = scroll.current
    if (!range || multiple || !viewport) return
    const listWidth = viewport.querySelector('.map-gantt-columns')?.getBoundingClientRect().width ?? 0
    const x = position(range.start)
    const visibleWidth = viewport.clientWidth - listWidth
    if (x < viewport.scrollLeft || x >= viewport.scrollLeft + visibleWidth) viewport.scrollLeft = Math.max(0, x - dayWidth)
  }

  async function exportFile(format: GanttFile) {
    if (!rows.length || exporting) return
    setExporting(true)
    clearNotice()
    try { await ganttExport(title, rows, format, days) }
    catch (error) { report(error instanceof Error ? error.message : '无法导出甘特图。') }
    finally { setExporting(false) }
  }

  function link() {
    const edits = new Map<string, MapTask>()
    for (const [index, id] of chosen.entries()) {
      if (!index) continue
      const task = rows[rowIndexes.get(id)!].task
      const predecessor = chosen[index - 1]
      if (!task.dependencies.some(item => item.id === predecessor)) {
        edits.set(id, { ...task, dependencies: [...task.dependencies, { id: predecessor, type: 'FS' }] })
      }
    }
    if (edits.size) change(edits, true)
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, row: ScheduledTopic, range: TaskRange) {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const grip = event.target.closest<HTMLElement>('[data-gantt-drag]')
    if (!grip) return
    const kind = grip.dataset.ganttDrag as DragKind
    const bar = event.currentTarget.getBoundingClientRect()
    drag.current = { id: row.id, kind, pointer: event.pointerId, origin: event.clientX,
      scrolled: scroll.current?.scrollLeft ?? 0, left: bar.left, width: bar.width, range, progress: row.task.progress }
    event.currentTarget.setPointerCapture(event.pointerId)
    select(row.id, event.shiftKey)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const scrollOffset = (scroll.current?.scrollLeft ?? 0) - current.scrolled
    const delta = event.clientX - current.origin + scrollOffset
    if (!current.preview && Math.abs(delta) < 3) return
    const range = current.kind === 'progress' ? current.range : translate(current.range, current.kind, Math.round(delta / dayWidth), days)
    const progress = current.kind === 'progress'
      ? Math.max(0, Math.min(100, Math.round((event.clientX - current.left + scrollOffset) * 100 / current.width)))
      : current.progress
    current.preview = { range, progress }
    setPreview({ ...current })
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, row: ScheduledTopic, cancel = false) {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = undefined
    setPreview(undefined)
    if (!current.preview || cancel) return
    const { range, progress } = current.preview
    if (current.kind === 'progress') {
      if (progress !== row.task.progress) change(new Map([[row.id, { ...row.task, progress, nativeProgress: undefined }]]), false)
    } else if (range.start !== current.range.start || range.end !== current.range.end) {
      change(new Map([[row.id, setTaskRange(row.task, range, current.kind !== 'move', days)]]), true)
    }
  }

  function adjust(event: KeyboardEvent<HTMLButtonElement>, kind: DragKind, row: ScheduledTopic, range: TaskRange) {
    if (event.metaKey || event.ctrlKey || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return
    event.preventDefault()
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 7 : 1)
    if (kind === 'progress') {
      const progress = Math.max(0, Math.min(100, row.task.progress + delta))
      if (progress !== row.task.progress) change(new Map([[row.id, { ...row.task, progress, nativeProgress: undefined }]]), false)
    } else {
      const next = translate(range, kind, delta, days)
      if (next.start !== range.start || next.end !== range.end) {
        change(new Map([[row.id, setTaskRange(row.task, next, kind !== 'move', days)]]), true)
      }
    }
  }

  return <section className="map-gantt" aria-label="甘特图" onKeyDown={event => {
    if (event.key === 'Escape' && drag.current) {
      event.stopPropagation()
      drag.current = undefined
      setPreview(undefined)
    }
    if (!(event.metaKey || event.ctrlKey) || !['z', 'y'].includes(event.key.toLowerCase())) return
    event.preventDefault()
    if (event.shiftKey || event.key.toLowerCase() === 'y') redo()
    else undo()
  }}>
    <div className="map-gantt-toolbar" aria-label="甘特图工具栏">
      <button className="tool-button" disabled={chosen.length < 2} onClick={link} title="按选择顺序添加完成到开始的依赖">
        <Link2 size={15} />建立依赖</button>
      <button className="tool-button" disabled={chosen.length !== 1} onClick={() => edit(chosen[0])}>编辑任务</button>
      <button className="tool-button" aria-pressed={skipClosed} onClick={openCalendar}><CalendarDays size={15} />项目工作日</button>
      <div className="menu-anchor">
        <button className="tool-button" aria-haspopup="menu" aria-expanded={exportMenu} disabled={!rows.length || exporting}
          onClick={() => setExportMenu(!exportMenu)}><Download size={15} />导出</button>
        {exportMenu && <MarkdownMenu close={() => setExportMenu(false)} items={[
          { label: 'PNG 图片', run: () => void exportFile('png') },
          { label: 'JPEG 图片', run: () => void exportFile('jpeg') },
          { label: 'PDF', run: () => void exportFile('pdf') },
          { label: 'Excel（CSV）', run: () => void exportFile('csv') },
          { label: '日历（ICS）', disabled: !rows.some(row => row.task.start), run: () => void exportFile('ics') },
        ]} />}
      </div>
      <button className="icon-button" aria-label="打印甘特图" title="打印甘特图" disabled={!rows.length || exporting}
        onClick={() => void exportFile('print')}><Printer size={15} /></button>
      <div className="map-gantt-zoom" role="group" aria-label="时间轴缩放">
        <button className="icon-button" disabled={!scale} aria-label="缩小时间轴" onClick={() => zoom(scale - 1)}><Minus size={15} /></button>
        <span aria-live="polite">{scaleLabels[scale]}</span>
        <button className="icon-button" disabled={scale === scaleWidths.length - 1} aria-label="放大时间轴" onClick={() => zoom(scale + 1)}><Plus size={15} /></button>
        <button className="tool-button" disabled={!includeToday} onClick={() => scroll.current?.scrollTo({ left: Math.max(0, position(today) - 42) })}>
          <CalendarDays size={15} />今天</button>
      </div>
    </div>
    {notice && <div className="map-gantt-notice" role="status">{notice}
      <button className="icon-button" aria-label="关闭提示" onClick={clearNotice}><X size={14} /></button></div>}
    {!rows.length ? <div className="map-gantt-empty"><CalendarRange size={28} /><strong>此画布还没有计划任务</strong>
      <p>回到导图，选中主题并从「插入」添加任务。</p></div>
      : <div ref={scroll} className="map-gantt-scroll" tabIndex={0} aria-label="任务与时间轴">
        <div className="map-gantt-sheet" style={{ '--gantt-width': width + 'px', '--gantt-row': rowHeight + 'px',
          '--gantt-day': dayWidth * (scale < 2 ? 7 : 1) + 'px' } as CSSProperties}>
          <div className="map-gantt-header">
            <div className="map-gantt-columns"><span>任务</span><span>开始</span><span>天数</span></div>
            <div className="map-gantt-dates">
              {monthLabels.map((day, index) => <span key={day} className="map-gantt-month" style={{
                left: position(day), width: ((monthLabels[index + 1] ?? end + 1) - day) * dayWidth,
              }}>
                {dayDate(day).slice(0, 4)} 年 {Number(dayDate(day).slice(5, 7))} 月</span>)}
              {labels.map(day => <time key={day} dateTime={dayDate(day)} title={dayDate(day)}
                className={day === today ? 'gantt-today-label' : undefined}
                style={{ left: position(day), width: Math.min(step, end - day + 1) * dayWidth }}>
                {step === 1 ? Number(dayDate(day).slice(8, 10)) : dateLabel(day)}</time>)}
            </div>
          </div>
          <div className="map-gantt-rows">
            {rows.map(row => {
              const range = rangeFor(row.id)
              const active = chosen.includes(row.id)
              const progress = preview?.id === row.id && preview.preview ? preview.preview.progress : row.task.progress
              return <div className="map-gantt-row" key={row.id} data-selected={active}>
                <div className="map-gantt-columns">
                  <button type="button" title={row.title} aria-pressed={active} onClick={event => selectRow(row.id, event.shiftKey)}
                    onDoubleClick={() => edit(row.id)} style={{ paddingInlineStart: 12 + Math.min(4, row.depth) * 10 }}>
                    {row.title}</button>
                  <span>{range ? dateLabel(range.start) : '—'}</span>
                  <span>{range ? row.task.duration ?? days.count(range.start, range.end) : row.task.duration ?? '—'}</span>
                </div>
                <div className="map-gantt-track">
                  {range ? <div className="map-gantt-bar" data-gantt-id={row.id} data-moving={preview?.id === row.id}
                    style={{ left: position(range.start) + 2, width: Math.max(7, (range.end - range.start + 1) * dayWidth - 4),
                      '--gantt-progress': progress + '%' } as CSSProperties}
                    onPointerDown={event => startDrag(event, row, range)} onPointerMove={moveDrag}
                    onDoubleClick={() => edit(row.id)}
                    onPointerUp={event => finishDrag(event, row)} onPointerCancel={event => finishDrag(event, row, true)}
                    onLostPointerCapture={event => finishDrag(event, row, true)}>
                    <button className="map-gantt-bar-name" data-gantt-drag="move" title={row.title + ' · ' + dayDate(range.start) + ' – ' + dayDate(range.end)}
                      aria-label={'移动任务 ' + row.title} onKeyDown={event => adjust(event, 'move', row, range)}>{row.title}</button>
                    {(['start', 'end', 'progress'] as const).map((kind, index) => <button key={kind} data-gantt-drag={kind}
                      aria-label={['调整开始 ' + row.title, '调整截止 ' + row.title, '调整进度 ' + row.title + ' ' + progress + '%'][index]}
                      title={['拖动调整开始日期', '拖动调整截止日期', progress + '%'][index]}
                      onKeyDown={event => adjust(event, kind, row, range)} />)}
                  </div> : <button className="tool-button map-gantt-undated" onClick={() => edit(row.id)}>设置日期</button>}
                </div>
              </div>
            })}
            {offDays.map(day => <div key={day} className="map-gantt-day-off" aria-hidden="true"
              title={dayDate(day) + ' 休息日'} style={{ left: 'calc(var(--gantt-list) + ' + position(day) + 'px)', width: dayWidth }} />)}
            {includeToday && <div className="map-gantt-today" style={{ left: 'calc(var(--gantt-list) + ' + position(today) + 'px)' }} />}
            <svg className="map-gantt-links" width={width} height={rows.length * rowHeight} aria-hidden="true">
              <defs><marker id={marker} viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto">
                <path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" />
              </marker></defs>
              {rows.flatMap((row, index) => row.task.dependencies.flatMap(dependency => {
                const from = rangeFor(dependency.id)
                const to = rangeFor(row.id)
                const source = rowIndexes.get(dependency.id)
                if (!from || !to || source === undefined || source === index) return []
                const startSide = dependency.type[0] === 'S'
                const endSide = dependency.type[1] === 'S'
                const x1 = position(startSide ? from.start : from.end + 1)
                const x2 = position(endSide ? to.start : to.end + 1)
                const y1 = source * rowHeight + rowHeight / 2
                const y2 = index * rowHeight + rowHeight / 2
                const stub = x1 + (startSide ? -10 : 10)
                const approach = x2 + (endSide ? -9 : 9)
                const midway = (y1 + y2) / 2
                return [<path key={row.id + ':' + dependency.id} markerEnd={'url(#' + marker + ')'}
                  d={`M ${x1} ${y1} H ${stub} V ${midway} H ${approach} V ${y2} H ${x2}`} />]
              }))}
            </svg>
          </div>
        </div>
      </div>}
  </section>
}
