import type { MapData } from './mapAppearance'
import { readTask, type MapTask } from './mapTasks'
import { calendarDays, dateDay, dayDate, dayMs, firstDay, lastDay, type Workdays } from './workCalendar'
export { dateDay, dayDate, dayMs, firstDay, lastDay, todayDay } from './workCalendar'

export interface ScheduledTopic { id: string; title: string; depth: number; task: MapTask }

export function scheduledTopics(tree?: MapData) {
  const rows: ScheduledTopic[] = []
  function visit(node: MapData, depth: number) {
    const task = readTask(node.data.ymdTask)
    if (node.data.uid && task && !node.data.ymdAudio) {
      rows.push({ id: node.data.uid, title: node.data.text?.replace(/\s+/g, ' ').trim() || '未命名主题', depth, task })
    }
    node.children?.forEach(child => visit(child, depth + 1))
  }
  if (tree) visit(tree, 0)
  return rows
}

export type TaskRange = { start: number; end: number }

const allDays = calendarDays()
const durationDays = (task: MapTask, fallback = 1) => Math.max(1, Math.ceil(task.duration ?? fallback))

export function taskRange(task: MapTask, days = allDays): TaskRange | undefined {
  const start = dateDay(task.start)
  const end = dateDay(task.due)
  if (start === undefined && end === undefined) return
  if (start === undefined) {
    const final = days.seek(end!, -1)
    return final === undefined ? undefined : { start: days.shift(final, 1 - durationDays(task)) ?? firstDay, end: final }
  }
  if (end === undefined) {
    const initial = days.seek(start, 1)
    return initial === undefined ? undefined : { start: initial, end: days.shift(initial, durationDays(task) - 1) ?? lastDay }
  }
  return { start, end: Math.max(start, end) }
}

export function setTaskRange(task: MapTask, { start, end }: TaskRange, resize: boolean, days = allDays): MapTask {
  const first = dayDate(start)
  const last = dayDate(end)
  return { ...task, start: first, due: last, duration: resize ? days.count(start, end) : task.duration,
    startTime: first === task.start ? task.startTime : undefined,
    dueTime: last === task.due ? task.dueTime : undefined }
}

export function calendarSchedule(rows: ScheduledTopic[], previous: Workdays, days: Workdays) {
  const edits = new Map<string, MapTask>()
  for (const { id, task } of rows) {
    const range = taskRange(task, previous)
    if (!range) continue
    const start = days.seek(range.start, 1)
    const duration = task.duration ?? Math.max(1, previous.count(range.start, range.end))
    const end = start === undefined ? undefined : days.shift(start, durationDays(task, duration) - 1)
    if (start === undefined || end === undefined) return 'dates'
    edits.set(id, setTaskRange({ ...task, duration }, { start, end }, false, days))
  }
  return orderSchedule(rows, edits, days, previous)
}

export function editWorkDates(task: MapTask, previous: MapTask | undefined, days: Workdays): MapTask | undefined {
  const startDate = dateDay(task.start)
  const dueDate = dateDay(task.due)
  if (startDate === undefined && dueDate === undefined) return task
  const start = startDate === undefined ? undefined : days.seek(startDate, 1)
  const end = dueDate === undefined ? undefined : days.seek(dueDate, -1)
  const lengthEdited = task.duration !== (previous?.duration ?? null) && task.duration !== null
  const movedStart = previous?.start !== task.start && previous?.due === task.due
  if (start === undefined) {
    if (startDate !== undefined || end === undefined) return
    const first = days.shift(end, 1 - durationDays(task))
    return first === undefined ? undefined : setTaskRange(task, { start: first, end }, false, days)
  }
  if (dueDate === undefined || movedStart || lengthEdited) {
    const last = days.shift(start, durationDays(task) - 1)
    return last === undefined ? undefined : setTaskRange(task, { start, end: last }, false, days)
  }
  if (end === undefined || end < start) return
  return setTaskRange(task, { start, end }, true, days)
}

export function orderSchedule(before: ScheduledTopic[], edits: Map<string, MapTask>, days = allDays, previousDays?: Workdays): Map<string, MapTask> | 'cycle' | 'dates' {
  const previous = new Map(before.map(({ id, task }) => [id, task]))
  const tasks = new Map([...previous, ...edits])
  const successors = new Map<string, string[]>()
  for (const [id, task] of tasks) {
    for (const { id: dependency } of task.dependencies) {
      if (!tasks.has(dependency)) continue
      const next = successors.get(dependency)
      if (next) next.push(id)
      else successors.set(dependency, [id])
    }
  }
  const affected = new Set(edits.keys())
  for (const id of affected) for (const child of successors.get(id) ?? []) affected.add(child)
  const waiting = new Map<string, number>()
  const ready: string[] = []
  for (const id of affected) {
    const count = tasks.get(id)!.dependencies.filter(item => affected.has(item.id)).length
    waiting.set(id, count)
    if (!count) ready.push(id)
  }
  const result = new Map(edits)
  function earliest(task: MapTask, length: number, lookup: Map<string, MapTask>, clock: Workdays) {
    let start = -Infinity
    for (const dependency of task.dependencies) {
      const target = lookup.get(dependency.id)
      const boundary = target && taskRange(target, clock)
      if (!boundary) continue
      const lag = Math.ceil((dependency.lag ?? 0) / dayMs)
      const from = dependency.type[0] === 'F' ? boundary.end : boundary.start
      const gap = dependency.type === 'FS' ? 1 : 0
      const anchor = clock.seek(from + gap, 1)
      const boundaryAfterLag = anchor === undefined ? undefined : clock.shift(anchor, lag)
      if (boundaryAfterLag === undefined) {
        if (from + gap + lag < firstDay) continue
        return Infinity
      }
      const offset = dependency.type[1] === 'F' ? 1 - length : 0
      start = Math.max(start, clock.shift(boundaryAfterLag, offset) ?? clock.seek(firstDay, 1) ?? Infinity)
    }
    return start
  }
  for (const id of ready) {
    const task = tasks.get(id)!
    const range = taskRange(task, days)
    const length = range ? Math.max(1, days.count(range.start, range.end)) : durationDays(task)
    const required = earliest(task, length, tasks, days)
    if (required === Infinity) return 'dates'
    const old = previous.get(id)
    const oldClock = previousDays ?? days
    const oldRange = old && taskRange(old, oldClock)
    const follows = (previousDays || !edits.has(id)) && old && oldRange &&
      oldRange.start === earliest(old, Math.max(1, oldClock.count(oldRange.start, oldRange.end)), previous, oldClock)
    if (Number.isFinite(required) && (!range || range.start < required || follows && range.start !== required)) {
      const start = Math.max(firstDay, required)
      const end = days.shift(start, length - 1)
      if (end === undefined) return 'dates'
      const next = setTaskRange(task, { start, end }, false, days)
      tasks.set(id, next)
      result.set(id, next)
    }
    for (const child of successors.get(id) ?? []) {
      const count = waiting.get(child)! - 1
      waiting.set(child, count)
      if (!count) ready.push(child)
    }
  }
  return ready.length === affected.size ? result : 'cycle'
}
