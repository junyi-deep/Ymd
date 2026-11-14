import { useEffect, useRef, useState } from 'react'
import type { MapData } from './mapAppearance'

export interface MapTask {
  progress: number
  priority: number
  start: string
  due: string
  duration: number | null
  assignee: string
  dependencies: string[]
}

export function readTask(value: unknown): MapTask | undefined {
  if (!value || typeof value !== 'object' || !('progress' in value) || typeof value.progress !== 'number') return
  return value as MapTask
}

export function taskTopics(tree: MapData | undefined, current: string) {
  const topics: { id: string; title: string }[] = []
  function visit(node: MapData) {
    if (node.data.uid && node.data.uid !== current) {
      topics.push({ id: node.data.uid, title: node.data.text?.replace(/\s+/g, ' ').trim() || '未命名主题' })
    }
    node.children?.forEach(visit)
  }
  if (tree) visit(tree)
  return topics
}

export function taskBadge(task: MapTask, open: () => void) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'map-task-badge'
  element.style.cssText = 'display:block;width:48px;height:20px;border:0;border-radius:5px;background:#dceaff;color:#214768;text-align:center;font:600 11px system-ui;cursor:pointer;'
  element.textContent = task.progress + '%'
  element.title = [task.due, task.assignee].filter(Boolean).join(' · ') || '任务进度'
  element.setAttribute('aria-label', '编辑任务，进度 ' + task.progress + '%')
  for (const event of ['mousedown', 'pointerdown', 'dblclick', 'contextmenu']) element.addEventListener(event, input => input.stopPropagation())
  element.addEventListener('click', event => { event.stopPropagation(); open() })
  return { el: element, width: 48, height: 20 }
}

const emptyTask: MapTask = { progress: 0, priority: 0, start: '', due: '', duration: null, assignee: '', dependencies: [] }

export function MindMapTask({ initial, title, topics, save, close }: {
  initial?: MapTask
  title: string
  topics: ReturnType<typeof taskTopics>
  save: (task: MapTask | null) => void
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [task, setTask] = useState(initial ?? emptyTask)
  useEffect(() => { dialog.current?.showModal() }, [])
  const update = (patch: Partial<MapTask>) => setTask(previous => ({ ...previous, ...patch }))
  const available = new Set(topics.map(topic => topic.id))
  const dependencies = [...topics, ...task.dependencies.filter(id => !available.has(id)).map(id => ({ id, title: '已删除的主题' }))]
  return <dialog className="map-task-dialog" ref={dialog} aria-labelledby="map-task-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => { event.preventDefault(); save({ ...task, assignee: task.assignee.trim() }) }}>
      <h2 id="map-task-title">主题任务</h2>
      <p title={title}>{title}</p>
      <div className="map-task-fields">
        <label>进度 <output>{task.progress}%</output><input autoFocus type="range" min="0" max="100" step="1"
          value={task.progress} onChange={event => update({ progress: Number(event.target.value) })} /></label>
        <label>优先级<select value={task.priority} onChange={event => update({ priority: Number(event.target.value) })}>
          <option value="0">无</option>
          {[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>优先级 {level}</option>)}
        </select></label>
        <label>开始日期<input type="date" max={task.due || undefined} value={task.start}
          onChange={event => update({ start: event.target.value })} /></label>
        <label>截止日期<input type="date" min={task.start || undefined} value={task.due}
          onChange={event => update({ due: event.target.value })} /></label>
        <label>持续天数<input type="number" min="0" max="36500" value={task.duration ?? ''}
          onChange={event => update({ duration: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label>负责人<input value={task.assignee} maxLength={120}
          onChange={event => update({ assignee: event.target.value })} /></label>
      </div>
      {dependencies.length > 0 && <fieldset className="map-task-dependencies">
        <legend>依赖主题</legend>
        <div>{dependencies.map(topic => <label key={topic.id}>
          <input type="checkbox" checked={task.dependencies.includes(topic.id)} onChange={event => update({
            dependencies: event.target.checked ? [...task.dependencies, topic.id] : task.dependencies.filter(id => id !== topic.id),
          })} />
          <span title={topic.title}>{topic.title}</span>
        </label>)}</div>
      </fieldset>}
      <footer>
        {initial && <button type="button" className="map-task-remove" onClick={() => save(null)}>移除任务</button>}
        <button type="button" onClick={close}>取消</button><button type="submit" className="primary">保存任务</button>
      </footer>
    </form>
  </dialog>
}
