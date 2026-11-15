import { dateDay, dayDate, lastDay, taskRange, todayDay, type ScheduledTopic } from './mapSchedule'
import type { Workdays } from './workCalendar'

export type GanttFile = 'png' | 'jpeg' | 'pdf' | 'csv' | 'ics' | 'print'

const escapeMarkup = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csv(rows: ScheduledTopic[]) {
  const fields = [
    ['任务', '开始日期', '截止日期', '持续天数', '进度', '优先级', '负责人', '依赖', '任务 ID'],
    ...rows.map(({ title, id, task }) => [title, task.start, task.due, task.duration ?? '', task.progress + '%',
      task.priority || '', task.assignee, task.dependencies.map(item => item.id + item.type).join(', '), id]),
  ]
  const cell = (value: string | number) => {
    const text = String(value)
    const plain = /^[\t\r\n]|^\s*[=+\-@]/.test(text) ? "'" + text : text
    return '"' + plain.replaceAll('"', '""') + '"'
  }
  return '\ufeff' + fields.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

function calendar(id: string, rows: ScheduledTopic[], days?: Workdays) {
  const escape = (text: string) => text.replaceAll('\\', '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[;,]/g, char => '\\' + char)
  const clock = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ymd//Gantt//ZH', 'CALSCALE:GREGORIAN']
  for (const row of rows) {
    const start = dateDay(row.task.start)
    const range = taskRange(row.task, days)
    if (start === undefined || !range) continue
    lines.push('BEGIN:VEVENT', 'UID:' + escape(row.id + '.' + id + '@ymd'), 'DTSTAMP:' + clock,
      'DTSTART;VALUE=DATE:' + dayDate(start).replaceAll('-', ''),
      ...(range.end < lastDay ? ['DTEND;VALUE=DATE:' + dayDate(range.end + 1).replaceAll('-', '')] : []),
      'SUMMARY:' + escape(row.title), 'DESCRIPTION:' + escape(row.task.assignee), 'END:VEVENT')
  }
  const encoder = new TextEncoder()
  return lines.map(line => {
    const pieces: string[] = []
    let piece = ''
    let bytes = 0
    for (const char of line) {
      const length = encoder.encode(char).length
      if (bytes + length > 75) { pieces.push(piece); piece = ' '; bytes = 1 }
      piece += char
      bytes += length
    }
    pieces.push(piece)
    return pieces.join('\r\n')
  }).join('\r\n') + '\r\n'
}

function chartImage(title: string, all: ScheduledTopic[], rows: ScheduledTopic[], days?: Workdays, page = 0) {
  const width = 1080
  const rowHeight = 29
  const header = 62
  const list = 270
  const height = header + rows.length * rowHeight
  const dates = all.map(row => taskRange(row.task, days)).filter(range => range !== undefined)
  const start = dates.length ? Math.min(...dates.map(range => range.start)) : todayDay()
  const end = (dates.length ? Math.max(...dates.map(range => range.end)) : start + 6) + 1
  const step = Math.max(1, Math.ceil((end - start) / 18))
  const pixel = (width - list) / (end - start)
  const position = (day: number) => list + (day - start) * pixel
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
      font-family="system-ui, sans-serif" font-size="12" fill="#253141">
    <defs><marker id="arrow-${page}" viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto">
      <path d="M1 1 L7 4 L1 7" fill="none" stroke="#68788c" /></marker></defs>
    <rect width="${width}" height="${height}" fill="white"/>
    <text x="12" y="25" font-size="18" font-weight="650">${escapeMarkup(title)} · 甘特图</text>
    <rect y="36" width="${width}" height="26" fill="#edf0f5"/>
    <text x="12" y="54">任务</text><text x="206" y="54">开始</text><text x="242" y="54">天数</text>`]
  for (let day = start; day < end; day += step) {
    const x = position(day)
    if (days && step === 1 && !days.working(day)) parts.push(`<rect x="${x}" y="62" width="${pixel}" height="${height - 62}" fill="#f0f1f3"/>`)
    parts.push(`<path d="M ${x} 36 V ${height}" stroke="#e1e5eb"/><text x="${x + 3}" y="54">${dayDate(day).slice(5)}</text>`)
  }
  const indexes = new Map(rows.map((row, index) => [row.id, index]))
  const bars: string[] = []
  rows.forEach((row, index) => {
    const y = header + index * rowHeight
    const range = taskRange(row.task, days)
    const characters = Array.from(row.title)
    const title = characters.length > 22 ? characters.slice(0, 21).join('') + '…' : row.title
    const duration = row.task.duration ?? (range ? (days?.count(range.start, range.end) ?? range.end - range.start + 1) : '—')
    parts.push(`<path d="M 0 ${y} H ${width}" stroke="#e1e5eb"/>
      <text x="${12 + Math.min(3, row.depth) * 7}" y="${y + 19}">${escapeMarkup(title)}</text>
      <text x="206" y="${y + 19}">${range ? dayDate(range.start).slice(5) : '—'}</text>
      <text x="246" y="${y + 19}">${duration}</text>`)
    if (!range) return
    const left = position(range.start) + 1
    const barWidth = Math.max(2, (range.end - range.start + 1) * pixel - 2)
    const progress = Math.min(100, Math.max(0, row.task.progress))
    bars.push(`<rect x="${left}" y="${y + 5}" width="${barWidth}" height="19" rx="4" fill="#d8e5f8"/>
      <rect x="${left}" y="${y + 5}" width="${barWidth * progress / 100}" height="19" rx="4" fill="#a2bde6"/>
      ${barWidth > 36 ? `<text x="${left + 5}" y="${y + 19}">${progress}%</text>` : ''}`)
    for (const dependency of row.task.dependencies) {
      const source = indexes.get(dependency.id)
      const from = source === undefined ? undefined : taskRange(rows[source].task, days)
      if (!from || source === index) continue
      const first = dependency.type[0] === 'S'
      const last = dependency.type[1] === 'S'
      const x1 = position(first ? from.start : from.end + 1)
      const x2 = position(last ? range.start : range.end + 1)
      const y1 = header + (source! + .5) * rowHeight
      const y2 = y + rowHeight / 2
      parts.push(`<path d="M ${x1} ${y1} H ${x1 + (first ? -9 : 9)} V ${(y1 + y2) / 2}
        H ${x2 + (last ? -9 : 9)} V ${y2} H ${x2}" fill="none" stroke="#68788c" marker-end="url(#arrow-${page})"/>`)
    }
  })
  return { width, height, svg: [...parts, ...bars, '</svg>'].join('') }
}

async function imageBlob(title: string, rows: ScheduledTopic[], mime: string, days?: Workdays) {
  const { svg, width, height } = chartImage(title, rows, rows, days)
  if (height > 8192) throw new Error('任务较多，图片高度超出限制。请导出 PDF 或 CSV。')
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建导出图片。')
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('无法生成导出图片。')), mime, .94))
  } finally { URL.revokeObjectURL(url) }
}

export async function ganttExport(title: string, rows: ScheduledTopic[], format: GanttFile, days?: Workdays) {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) + ' 甘特图'
  if (format === 'csv') download(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }), name + '.csv')
  else if (format === 'ics') download(new Blob([calendar(name, rows, days)], { type: 'text/calendar;charset=utf-8' }), name + '.ics')
  else if (format === 'pdf' || format === 'print') {
    const perPage = 19
    const pages = Array.from({ length: Math.ceil(rows.length / perPage) }, (_, page) =>
      '<div class="gantt-print-page">' + chartImage(title, rows, rows.slice(page * perPage, (page + 1) * perPage), days, page).svg + '</div>')
    const html = '<style>@page{size:landscape;margin:12mm}.gantt-print-page{break-after:page}.gantt-print-page:last-child{break-after:auto}</style>' + pages.join('')
    if (format === 'pdf') await window.desktop.exportPdf(name + '.pdf', html)
    else await window.desktop.printDocument(name, html)
  } else download(await imageBlob(title, rows, 'image/' + format, days), name + '.' + format)
}
