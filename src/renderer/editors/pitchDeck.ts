import { pitchImage, readPitchTopic, type PitchTopic } from '../../shared/pitch'
import type { MapData } from './mapAppearance'

export function pitchTopicFromMap(tree: MapData): PitchTopic {
  const data = tree.data
  return {
    id: data.uid ?? '',
    title: data.text?.trim() || '未命名主题',
    note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined,
    image: pitchImage(data.image) ? data.image : undefined,
    options: readPitchTopic(data.ymdPitch),
    children: (tree.children ?? []).map(pitchTopicFromMap),
  }
}

export interface PitchSlide {
  topic: PitchTopic
  kind: 'title' | 'topics'
  first: number
  end: number
  parent?: string
}

export function buildPitchDeck(root: PitchTopic) {
  const slides: PitchSlide[] = []
  const jump = new Map<string, number>()
  const after = new Map<string, number>()
  const pageSize = 6
  function append(topic: PitchTopic, kind: PitchSlide['kind'], parent?: string, first = 0, end = 0) {
    slides.push({ topic, kind, parent, first, end })
  }
  function visit(topic: PitchTopic, parent?: string, rootTopic = false) {
    const { id, children, options, image, note } = topic
    const visible = rootTopic || options.visibility === 'show' || options.visibility === 'auto' &&
      (children.length > 0 || !!image || !!note || options.cover !== 'auto')
    if (!visible) {
      children.forEach(child => visit(child, parent))
      return
    }
    jump.set(id, slides.length)
    if (rootTopic || !children.length || !!image || !!note || options.cover !== 'auto') append(topic, 'title', parent)
    for (let first = 0; first < children.length; first += pageSize) {
      const end = Math.min(first + pageSize, children.length)
      if (options.delivery === 'all') append(topic, 'topics', parent, first, end)
      for (let index = first; index < end; index++) {
        const child = children[index]
        if (options.delivery !== 'all') append(topic, 'topics', parent, first, index + 1)
        jump.set(child.id, slides.length - 1)
        if (options.delivery === 'drill') visit(child, id)
      }
      if (options.delivery !== 'drill') children.slice(first, end).forEach(child => visit(child, id))
    }
    after.set(id, slides.length)
  }
  visit(root, undefined, true)
  return { slides, jump, after }
}

export function pitchImageForSlide({ kind, topic }: PitchSlide) {
  return kind === 'title' && topic.options.cover !== 'title' ? topic.image : undefined
}
