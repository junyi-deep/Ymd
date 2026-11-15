import { useEffect, useRef, useState } from 'react'
import type { MapData } from './mapAppearance'
import { dependencyTypes, emptyTask, type MapTask, type MapTodo, type TaskDependency } from './mapTasks'

export function taskTopics(tree: MapData | undefined, current: string) {
  const topics: { id: string; title: string }[] = []
  function visit(node: MapData) {
    if (node.data.uid && node.data.uid !== current && !node.data.ymdAudio) {
      topics.push({ id: node.data.uid, title: node.data.text?.replace(/\s+/g, ' ').trim() || '未命名主题' })
    }
    node.children?.forEach(visit)
  }
  if (tree) visit(tree)
  return topics
}

export function taskBadge(task: MapTask, open: () => void) {
  const element = taskControl('编辑任务，进度 ' + task.progress + '%', task.progress + '%', open)
  element.className = 'map-task-badge'
  element.style.cssText += 'width:48px;height:20px;border:0;border-radius:5px;background:#dceaff;color:#214768;'
  element.title = [task.due, task.assignee].filter(Boolean).join(' · ') || '任务进度'
  return { el: element, width: 48, height: 20 }
}

export function todoBadge(todo: MapTodo, toggle: () => void) {
  const checked = todo === 'done'
  const label = checked ? '标记待办为未完成' : '标记待办为完成'
  const element = taskControl(label, checked ? '✓' : '', toggle)
  element.className = 'map-todo-badge'
  element.style.cssText += 'width:18px;height:18px;padding:0;border:1.5px solid #637791;border-radius:4px;color:white;'
  element.style.backgroundColor = checked ? '#5275b1' : '#fff'
  element.title = label
  element.setAttribute('aria-pressed', String(checked))
  return { el: element, width: 18, height: 18 }
}

function taskControl(label: string, text: string, run: () => void) {
  const element = document.createElement('button')
  element.type = 'button'
  element.style.cssText = 'display:block;text-align:center;font:600 11px system-ui;cursor:pointer;'
  element.textContent = text
  element.setAttribute('aria-label', label)
  for (const event of ['mousedown', 'pointerdown', 'dblclick', 'contextmenu']) element.addEventListener(event, input => input.stopPropagation())
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Delete' || event.key === 'Backspace') event.stopPropagation()
  })
  element.addEventListener('click', event => { event.stopPropagation(); run() })
  return element
}

export function MindMapTask({ initial, title, topics, notice, save, close }: {
  initial?: MapTask
  title: string
  topics: ReturnType<typeof taskTopics>
  notice?: string
  save: (task: MapTask | null) => void
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [task, setTask] = useState(initial ?? emptyTask)
  useEffect(() => { dialog.current?.showModal() }, [])
  const update = (patch: Partial<MapTask>) => setTask(previous => ({ ...previous, ...patch }))
  const available = new Set(topics.map(topic => topic.id))
  const dependencies = [...topics, ...task.dependencies.filter(item => !available.has(item.id)).map(({ id }) => ({ id, title: '已删除的主题' }))]
  return <dialog className="map-task-dialog" ref={dialog} aria-labelledby="map-task-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => { event.preventDefault(); save({ ...task, assignee: task.assignee.trim() }) }}>
      <h2 id="map-task-title">主题任务</h2>
      <p title={title}>{title}</p>
      {notice && <p className="map-task-error" role="alert">{notice}</p>}
      <div className="map-task-fields">
        <label>进度 <output>{task.progress}%</output><input autoFocus type="range" min="0" max="100" step="1"
          value={task.progress} onChange={event => update({ progress: Number(event.target.value), nativeProgress: undefined })} /></label>
        <label>优先级<select value={task.priority} onChange={event => update({ priority: Number(event.target.value) })}>
          <option value="0">无</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => <option key={level} value={level}>优先级 {level}</option>)}
        </select></label>
        <label>开始日期<input type="date" max={task.due || undefined} value={task.start}
          onChange={event => update({ start: event.target.value })} /></label>
        <label>截止日期<input type="date" min={task.start || undefined} value={task.due}
          onChange={event => update({ due: event.target.value })} /></label>
        <label>持续天数<input type="number" min="0" max="36500" step="any" value={task.duration ?? ''}
          onChange={event => update({ duration: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label>负责人<input value={task.assignee} maxLength={500} placeholder="多人用顿号分隔"
          onChange={event => update({ assignee: event.target.value })} /></label>
      </div>
      {dependencies.length > 0 && <fieldset className="map-task-dependencies">
        <legend>依赖主题</legend>
        <div className="map-task-dependency-list">{dependencies.map(topic => {
          const selected = task.dependencies.find(item => item.id === topic.id)
          return <div className="map-task-dependency-row" key={topic.id}>
            <label><input type="checkbox" checked={!!selected} onChange={event => update({
              dependencies: event.target.checked ? [...task.dependencies, { id: topic.id, type: 'FS' }]
                : task.dependencies.filter(item => item.id !== topic.id),
            })} />
            <span title={topic.title}>{topic.title}</span></label>
            {selected && <select aria-label={topic.title + '的依赖类型'} value={selected.type} onChange={event => update({
              dependencies: task.dependencies.map(item => item.id === topic.id
                ? { ...item, type: event.target.value as TaskDependency['type'] } : item),
            })}>
              {dependencyTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>}
          </div>
        })}</div>
      </fieldset>}
      <footer>
        {initial && <button type="button" className="map-task-remove" onClick={() => save(null)}>移除任务</button>}
        <button type="button" onClick={close}>取消</button><button type="submit" className="primary">保存任务</button>
      </footer>
    </form>
  </dialog>
}
