export const dayMs = 86_400_000

export function dateDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return undefined
  const parsed = new Date(date + 'T00:00:00Z')
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? parsed.valueOf() / dayMs : undefined
}

export const dayDate = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10)
export const firstDay = dateDay('0001-01-01')!
export const lastDay = dateDay('9999-12-31')!

export function todayDay() {
  const date = new Date()
  return Math.floor((date.valueOf() - date.getTimezoneOffset() * 60_000) / dayMs)
}

export const weekday = (day: number) => ((day + 4) % 7 + 7) % 7
export const repetitions = [
  ['once', '不重复'], ['daily', '每天'], ['weekly', '每周'], ['monthly', '每月同日'],
  ['monthly-weekday', '每月同一周次'], ['yearly', '每年'],
] as const

export interface DayException {
  title: string
  date: string
  from?: string
  through: string
  working: boolean
  repeat: typeof repetitions[number][0]
  interval?: number
}

export interface WorkCalendar {
  enabled: boolean
  weekdays: number[]
  exceptions: DayException[]
  name?: string
  from?: string
  through?: string
}

export const defaultWorkCalendar: WorkCalendar = { enabled: false, weekdays: [1, 2, 3, 4, 5], exceptions: [] }
export const workCalendarExtension = 'org.xmind.ui.working-day-settings'

const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const isoDate = (value: unknown) => typeof value === 'string' && dateDay(value) !== undefined ? value : undefined

export function readWorkCalendar(value: unknown): WorkCalendar | undefined {
  const raw = record(value)
  if (typeof raw.enabled !== 'boolean' || !Array.isArray(raw.weekdays) || !Array.isArray(raw.exceptions)) return
  const weekdays = [...new Set(raw.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day < 7))] as number[]
  if (!weekdays.length) return
  const exceptions: DayException[] = []
  for (const item of raw.exceptions) {
    const { title, date, from, through, working, repeat, interval } = record(item)
    if (typeof date !== 'string' || dateDay(date) === undefined || typeof working !== 'boolean') continue
    const frequency = repetitions.find(([id]) => id === repeat)?.[0]
    const starts = from === '' ? '' : isoDate(from)
    if (!frequency || typeof through !== 'string' || through && (!isoDate(through) || through < (starts ?? date))) continue
    const series = typeof interval === 'number' && Number.isSafeInteger(interval) && interval > 1 ? interval : undefined
    exceptions.push({ title: typeof title === 'string' ? title.slice(0, 120) : '', date, from: starts, through,
      working, repeat: frequency, interval: series })
  }
  return { enabled: raw.enabled, weekdays: weekdays.sort((a, b) => a - b), exceptions,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : undefined, from: isoDate(raw.from), through: isoDate(raw.through) }
}

function matching(day: number, anchor: number, { date, repeat, interval = 1 }: DayException) {
  if (repeat === 'once') return true
  if (repeat === 'daily') return (day - anchor) % interval === 0
  if (repeat === 'weekly') return (day - anchor) % (interval * 7) === 0
  const value = dayDate(day)
  const year = Number(value.slice(0, 4)) - Number(date.slice(0, 4))
  if (repeat === 'yearly') return value.slice(5) === date.slice(5) && year % interval === 0
  const months = year * 12 + Number(value.slice(5, 7)) - Number(date.slice(5, 7))
  if (months % interval !== 0) return false
  if (repeat === 'monthly') return value.slice(8) === date.slice(8)
  return weekday(day) === weekday(anchor) && Math.ceil(Number(value.slice(8)) / 7) === Math.ceil(Number(date.slice(8)) / 7)
}

const xmindFrequencies = { once: 'NONE', daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY_BY_DATE',
  'monthly-weekday': 'MONTHLY_BY_WEEKDAY', yearly: 'YEARLY' } as const

export function decodeXmindCalendar(value: unknown, skipping: unknown): WorkCalendar | undefined {
  const native = record(value)
  if (!Array.isArray(native.defaultWorkingDays) || !Array.isArray(native.rules)) return
  const weekdays = native.defaultWorkingDays.map(day => day === 7 ? 0 : day)
  const rules = native.rules.flatMap(value => {
    const rule = record(value)
    const repeat = repetitions.find(([key]) => xmindFrequencies[key] === rule.frequency)?.[0]
    if (!repeat || (rule.type !== 'WORKING_DAY' && rule.type !== 'NON_WORKING_DAY') || !Array.isArray(rule.selectedDates)) return []
    const span = record(rule.effectiveRange)
    const from = isoDate(span.start) ?? ''
    const through = isoDate(span.end) ?? ''
    return rule.selectedDates.flatMap(value => {
      const date = isoDate(value)
      if (!date || repeat === 'once' && (from && date < from || through && date > through)) return []
      return [{ title: rule.name, date, from: repeat === 'once' ? undefined : from,
        through: repeat === 'once' ? '' : through, working: rule.type === 'WORKING_DAY', repeat, interval: rule.interval }]
    })
  })
  const span = record(native.effectiveRange)
  return readWorkCalendar({ enabled: skipping === 'skip', weekdays, exceptions: rules, name: native.name, from: span.start, through: span.end })
}

export function encodeXmindCalendar(calendar: WorkCalendar, id: () => string) {
  const content = {
    id: id(), name: calendar.name || '项目工作日',
    defaultWorkingDays: calendar.weekdays.map(day => day || 7).sort((a, b) => a - b),
    effectiveRange: calendar.from || calendar.through ? { start: calendar.from, end: calendar.through } : undefined,
    rules: calendar.exceptions.map(rule => {
      const span = rule.repeat === 'once' && Boolean(rule.through)
      return { id: id(), name: rule.title || (rule.working ? '工作日' : '休息日'),
        type: rule.working ? 'WORKING_DAY' : 'NON_WORKING_DAY',
        frequency: span ? 'DAILY' : xmindFrequencies[rule.repeat], selectedDates: [rule.date], interval: rule.interval,
        effectiveRange: rule.repeat === 'once' && !span ? undefined : {
          start: (rule.from ?? rule.date) || undefined, end: rule.through || undefined,
        } }
    }),
  }
  return { provider: workCalendarExtension, content }
}

export interface Workdays {
  working(day: number): boolean
  count(start: number, end: number): number
  seek(day: number, direction: 1 | -1): number | undefined
  shift(day: number, offset: number): number | undefined
}

export function calendarDays(calendar?: WorkCalendar): Workdays {
  const enabled = calendar?.enabled === true
  const weekdays = new Set(calendar?.weekdays)
  const effectiveStart = dateDay(calendar?.from ?? '') ?? firstDay
  const effectiveEnd = dateDay(calendar?.through ?? '') ?? lastDay
  // Later exceptions override earlier rules, so a special working day can reopen a holiday.
  const exceptions = enabled ? calendar.exceptions.toReversed().map(rule => ({
    ...rule, anchor: dateDay(rule.date)!,
    start: rule.from === '' ? firstDay : dateDay(rule.from ?? rule.date)!,
    end: dateDay(rule.through) ?? (rule.repeat === 'once' ? dateDay(rule.date)! : lastDay),
  })) : []
  const cache = new Map<number, boolean>()
  function working(day: number) {
    if (day < firstDay || day > lastDay) return false
    if (!enabled || day < effectiveStart || day > effectiveEnd) return true
    if (!exceptions.length) return weekdays.has(weekday(day))
    const cached = cache.get(day)
    if (cached !== undefined) return cached
    const rule = exceptions.find(rule => day >= rule.start && day <= rule.end && matching(day, rule.anchor, rule))
    const result = rule?.working ?? weekdays.has(weekday(day))
    if (cache.size < 48_000) cache.set(day, result)
    return result
  }
  function count(start: number, end: number) {
    const length = Math.max(0, end - start + 1)
    if (!enabled) return length
    const from = Math.max(start, effectiveStart)
    const through = Math.min(end, effectiveEnd)
    const bounded = Math.max(0, through - from + 1)
    if (!exceptions.some(rule => rule.start <= through && rule.end >= from)) {
      const weeks = Math.floor(bounded / 7)
      let total = length - bounded + weeks * weekdays.size
      for (let day = from + weeks * 7; day <= through; day++) if (working(day)) total++
      return total
    }
    let total = length - bounded
    for (let day = from; day <= through; day++) if (working(day)) total++
    return total
  }
  function seek(day: number, direction: 1 | -1) {
    while (day >= firstDay && day <= lastDay) {
      if (working(day)) return day
      // Jump completely covered intervals instead of walking through every date in a long closure.
      const cover = exceptions.findIndex(rule => !rule.working && ((rule.repeat === 'daily' && !rule.interval) || rule.repeat === 'once') &&
        day >= rule.start && day <= rule.end)
      if (cover >= 0) {
        const interval = exceptions[cover]
        const later = exceptions.slice(0, cover).filter(rule => rule.working)
        const boundary = direction === 1 ?
          Math.min(effectiveEnd, interval.end, ...later.map(rule => rule.start > day ? rule.start - 1 : rule.end >= day ? day : interval.end)) :
          Math.max(effectiveStart, interval.start, ...later.map(rule => rule.end < day ? rule.end + 1 : rule.start <= day ? day : interval.start))
        day = boundary + direction
      } else day += direction
    }
  }
  function shift(day: number, offset: number) {
    if (!enabled) {
      const shifted = day + offset
      return shifted >= firstDay && shifted <= lastDay ? shifted : undefined
    }
    const direction = offset < 0 ? -1 : 1
    let date = seek(day, direction)
    let remaining = Math.abs(offset)
    if (date !== undefined && !exceptions.length && effectiveStart === firstDay && effectiveEnd === lastDay && remaining >= weekdays.size) {
      const weeks = Math.floor(remaining / weekdays.size)
      date += direction * weeks * 7
      remaining %= weekdays.size
      if (date < firstDay || date > lastDay) return
    }
    for (; remaining && date !== undefined; remaining--) date = seek(date + direction, direction)
    return date
  }
  return { working, count, seek, shift }
}
