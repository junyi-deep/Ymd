import type { MapData } from './mapAppearance'
import { readTask, type MapTask } from './mapTasks'

export const dayMs = 86_400_000
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

export function dateDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const parsed = new Date(date + 'T00:00:00Z')
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? parsed.valueOf() / dayMs : undefined
}

export const dayDate = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10)
export const firstDay = dateDay('0001-01-01')!
export const lastDay = dateDay('9999-12-31')!

export function todayDay() {
  const date = new Date()
  const local = date.valueOf() - date.getTimezoneOffset() * 60_000
  return Math.floor(local / dayMs)
}

export type TaskRange = { start: number; end: number }

const durationDays = (task: MapTask) => Number.isFinite(task.duration) ? Math.max(1, Math.ceil(task.duration!)) : 1

export function taskRange(task: MapTask): TaskRange | undefined {
  const start = dateDay(task.start)
  const end = dateDay(task.due)
  if (start === undefined && end === undefined) return
  if (start === undefined) return { start: Math.max(firstDay, end! - durationDays(task) + 1), end: end! }
  if (end === undefined) return { start, end: Math.min(lastDay, start + durationDays(task) - 1) }
  return { start, end: Math.max(start, end) }
}

export function setTaskRange(task: MapTask, { start, end }: TaskRange, resize: boolean): MapTask {
  const first = dayDate(start)
  const last = dayDate(end)
  return { ...task, start: first, due: last, duration: resize ? end - start + 1 : task.duration,
    startTime: first === task.start ? task.startTime : undefined,
    dueTime: last === task.due ? task.dueTime : undefined }
}

// Work on calendar days. Ends are inclusive, so a finish-to-start successor starts the following day.
export function orderSchedule(before: ScheduledTopic[], edits: Map<string, MapTask>): Map<string, MapTask> | 'cycle' | 'dates' {
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
  function earliest(task: MapTask, length: number, lookup: Map<string, MapTask>) {
    let start = -Infinity
    for (const dependency of task.dependencies) {
      const target = lookup.get(dependency.id)
      const boundary = target && taskRange(target)
      if (!boundary) continue
      const lag = Math.ceil((dependency.lag ?? 0) / dayMs)
      const from = dependency.type[0] === 'F' ? boundary.end : boundary.start
      const to = dependency.type[1] === 'F' ? length - 1 : 0
      const gap = dependency.type === 'FS' ? 1 : 0
      start = Math.max(start, from - to + gap + lag)
    }
    return start
  }
  for (const id of ready) {
    const task = tasks.get(id)!
    const range = taskRange(task)
    const length = range ? range.end - range.start + 1 : durationDays(task)
    const required = earliest(task, length, tasks)
    const old = previous.get(id)
    const follows = !edits.has(id) && old && range && range.start === earliest(old, length, previous)
    if (Number.isFinite(required) && (!range || range.start < required || follows && range.start !== required)) {
      const start = Math.max(firstDay, required)
      if (start + length - 1 > lastDay) return 'dates'
      const next = setTaskRange(task, { start, end: start + length - 1 }, false)
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
