import type MindMap from 'simple-mind-map'
import type { MapData } from './mapAppearance'
import { readTask, readTodo } from './mapTasks'

type MapNode = NonNullable<MindMap['renderer']['root']>
type Group = '标记' | '标签' | '任务状态' | '优先级'
export const navigationGroups: Group[] = ['标记', '标签', '任务状态', '优先级']
export interface Facet { id: string; group: Group; label: string }
export interface NavigationTopic { id: string; title: string; note: string; facets: Facet[] }

const facet = (group: Group, label: string): Facet => ({ id: group + ':' + label, group, label })
export const taskStatusFacets = ['已完成', '未完成'].map(label => facet('任务状态', label))
const storedItems = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const tag = (value: unknown) => {
  const label = typeof value === 'object' && value !== null && 'text' in value ? value.text : value
  return typeof label === 'string' && label ? facet('标签', label) : undefined
}
const marker = (value: unknown) => {
  if (typeof value !== 'string') return
  const priority = /^priority_([1-9])$/.exec(value)
  if (priority) return facet('优先级', '优先级 ' + priority[1])
  const progress = /^progress_([0-8])$/.exec(value)
  return progress ? facet('标记', '进度 ' + Math.round(Number(progress[1]) * 12.5) + '%') : facet('标记', value)
}
const taskStatus = (data: MapData['data'], task = readTask(data.ymdTask)) => {
  const todo = readTodo(data.ymdTodo)
  if (todo || task) return taskStatusFacets[todo === 'done' || task?.progress === 100 ? 0 : 1]
}

export function navigationTopics(tree: MapData): NavigationTopic[] {
  const topics: NavigationTopic[] = []
  function add(data: MapData['data']) {
    if (!data.uid) return
    const task = readTask(data.ymdTask)
    const facets = [...storedItems(data.tag).map(tag), ...storedItems(data.icon).map(marker), taskStatus(data, task)]
    if (task?.priority) facets.push(facet('优先级', '优先级 ' + task.priority))
    topics.push({ id: data.uid, title: data.text ?? '', note: typeof data.note === 'string' ? data.note : '',
      facets: [...new Map(facets.flatMap(item => item ? [[item.id, item] as const] : [])).values()] })
  }
  function visit(node: MapData) {
    add(node.data)
    const summaries = node.data.generalization
    for (const summary of Array.isArray(summaries) ? summaries : [summaries]) {
      if (summary && typeof summary === 'object' && typeof summary.uid === 'string') add(summary)
    }
    node.children?.forEach(visit)
  }
  visit(tree)
  return topics
}

export function facetAt(node: MapNode, target: EventTarget | null) {
  if (!(target instanceof Element)) return
  const label = node._tagData?.findIndex(item => item.node.node.contains(target)) ?? -1
  if (label >= 0) return tag(storedItems(node.getData('tag'))[label])
  const icon = node._iconData?.findIndex(item => item.node.node.contains(target)) ?? -1
  if (icon >= 0) return marker(storedItems(node.getData('icon'))[icon])
  if (node._postfixData?.el.contains(target)) return taskStatus(node.getData())
}

export function highlightTopics(map: MindMap, matches: ReadonlySet<string> | null) {
  function visit(node: MapNode): boolean {
    const match = !matches || matches.has(node.getData().uid ?? node.uid)
    let through = match
    node.group?.node.toggleAttribute('data-map-filtered', !match)
    node.children.forEach((child, index) => {
      const childMatch = visit(child)
      node._lines?.[index]?.node.toggleAttribute('data-map-filtered', !childMatch)
      through ||= childMatch
    })
    node._generalizationList?.forEach(({ generalizationLine, generalizationNode }) => {
      const labelMatch = visit(generalizationNode)
      generalizationLine.node.toggleAttribute('data-map-filtered', !labelMatch)
      through ||= labelMatch
    })
    return through
  }
  if (map.renderer.root) visit(map.renderer.root)
}
