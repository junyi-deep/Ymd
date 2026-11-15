import { emptyTask, readDependencies, readTodo, type MapTask, type MapTodo, type TaskDependency } from './mapTasks'
import { progressMarkers } from './xmindFormat'

export const taskExtension = 'org.xmind.ui.task'
export const legacyTaskExtension = 'org.xmind.ui.taskInfo'

const day = 86_400_000
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

type PlannedTaskContent = {
  progress?: number
  priority?: number
  start?: number
  due?: number
  duration?: number
  assignees?: string[]
  creator?: string
  lockDuration?: boolean
  dependencies?: TaskDependency[]
}

function bound(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined
}

function dateField(date: Date) {
  if (!Number.isFinite(date.valueOf()) || date.getFullYear() < 1 || date.getFullYear() > 9999) return ''
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-')
}

function readDate(value: unknown) {
  let time = typeof value === 'number' ? value : NaN
  if (typeof value === 'string') {
    const source = value.trim()
    const local = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}):(\d{1,2}))?$/.exec(source)
    if (local) {
      const [, year, month, day, hours = '0', minutes = '0', seconds = '0'] = local
      const pad = (text: string) => text.padStart(2, '0')
      const date = year + '-' + pad(month) + '-' + pad(day)
      const parsed = new Date(date + 'T' + [hours, minutes, seconds].map(pad).join(':'))
      if (dateField(parsed) === date) time = parsed.valueOf()
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(source)) {
      time = Date.parse(source)
    }
  }
  const date = dateField(new Date(time))
  return { date, time: date ? time : undefined }
}

function writeDate(date: string, original?: number) {
  if (!date) return
  if (original !== undefined && readDate(original).date === date) return original
  return readDate(date).time
}

function readLegacyContent(raw: unknown, markers: string[]): MapTask | undefined {
  if (!Array.isArray(raw)) return
  const fields = raw.map(record)
  const text = (name: string) => fields.find(entry => entry.name === name)?.content
  const { date: start, time: startTime } = readDate(text('start-date'))
  const { date: due, time: dueTime } = readDate(text('end-date'))
  const progress = bound(Number(text('progress')), 0, 100)
  const markerProgress = progressMarkers.findIndex(marker => markers.includes(marker))
  const assignees = fields.filter(field => field.name === 'assigned-to').map(field => field.content)
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
  const priority = markers.map(marker => /^priority-([1-9])$/.exec(marker)).find(Boolean)?.[1]
  const duration = bound(Number(text('duration')), 0, 36500)
  return { ...emptyTask, progress: progress ?? Math.round(Math.max(0, markerProgress) * 12.5),
    priority: Number(priority ?? 0), start, due, startTime, dueTime,
    duration: duration ?? null, assignee: assignees.join('、'), assignees }
}

export function importTaskExtension(provider: string, raw: unknown, markers: string[]): { task?: MapTask; todo?: MapTodo } | undefined {
  if (provider === legacyTaskExtension) {
    const task = readLegacyContent(raw, markers)
    return task && { task }
  }
  if (provider !== taskExtension) return
  const input = record(raw)
  const todo = readTodo(input.status)
  if (todo) return { todo }
  if (!['progress', 'priority', 'start', 'due', 'duration', 'assignees', 'dependencies', 'creator', 'lockDuration']
    .some(key => Object.hasOwn(input, key))) return
  const { date: start, time: startTime } = readDate(input.start)
  const { date: due, time: dueTime } = readDate(input.due)
  const assignees = Array.isArray(input.assignees)
    ? input.assignees.filter((name): name is string => typeof name === 'string' && !!name.trim()) : []
  const duration = bound(input.duration, 0, 36500 * day)
  const nativeProgress = bound(input.progress, 0, 1) ?? null
  return { task: {
    progress: Math.round((nativeProgress ?? 0) * 100), nativeProgress,
    priority: Math.round(bound(input.priority, 1, 9) ?? 0),
    start, due, startTime, dueTime, duration: duration === undefined ? null : duration / day,
    assignee: assignees.join('、'), assignees, dependencies: readDependencies(input.dependencies),
    creator: typeof input.creator === 'string' ? input.creator : undefined,
    lockDuration: typeof input.lockDuration === 'boolean' ? input.lockDuration : undefined,
  } }
}

export function exportTaskContent(task: MapTask, ids: Map<string, string>): PlannedTaskContent {
  const assignees = task.assignees?.join('、') === task.assignee ? task.assignees
    : task.assignee.split('、').map(name => name.trim()).filter(Boolean)
  const dependencies = task.dependencies.flatMap(item => {
    const target = ids.get(item.id)
    return target ? [{ ...item, id: target }] : []
  })
  return {
    progress: task.nativeProgress === null ? undefined : task.nativeProgress ?? Math.min(100, Math.max(0, task.progress)) / 100,
    priority: task.priority || undefined,
    start: writeDate(task.start, task.startTime),
    due: writeDate(task.due, task.dueTime),
    duration: task.duration === null ? undefined : Math.round(task.duration * day),
    assignees: assignees.length ? assignees : undefined,
    creator: task.creator,
    lockDuration: task.lockDuration,
    dependencies: dependencies.length ? dependencies : undefined,
  }
}
