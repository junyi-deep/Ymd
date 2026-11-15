export const dependencyTypes = [
  ['FS', '完成 → 开始'], ['SS', '开始 → 开始'], ['FF', '完成 → 完成'], ['SF', '开始 → 完成'],
] as const

export interface TaskDependency {
  id: string
  type: (typeof dependencyTypes)[number][0]
  lag?: number
}

export interface MapTask {
  progress: number
  priority: number
  start: string
  due: string
  duration: number | null
  assignee: string
  dependencies: TaskDependency[]
  nativeProgress?: number | null
  startTime?: number
  dueTime?: number
  assignees?: string[]
  creator?: string
  lockDuration?: boolean
}

export type MapTodo = 'todo' | 'done'

export const emptyTask: MapTask = { progress: 0, priority: 0, start: '', due: '', duration: null, assignee: '', dependencies: [] }

export function readTodo(value: unknown): MapTodo | undefined {
  return value === 'todo' || value === 'done' ? value : undefined
}

export function readDependencies(value: unknown): TaskDependency[] {
  const dependencies: TaskDependency[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(value) ? value : []) {
    const id = typeof item === 'string' ? item : item?.id
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    const type = dependencyTypes.find(([type]) => type === item?.type)?.[0] ?? 'FS'
    const lag = item?.lag
    dependencies.push({ id, type, ...(typeof lag === 'number' && Number.isFinite(lag) ? { lag } : {}) })
    seen.add(id)
  }
  return dependencies
}

export function readTask(value: unknown): MapTask | undefined {
  if (!value || typeof value !== 'object' || !('progress' in value) || typeof value.progress !== 'number') return
  const task = value as MapTask
  return { ...emptyTask, ...task, dependencies: readDependencies(task.dependencies) }
}
