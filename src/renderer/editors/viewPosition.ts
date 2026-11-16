import type { EditorView } from '@codemirror/view'
import type MindMap from 'simple-mind-map'

export interface DocumentViewPosition {
  markdown?: { text: string; anchor: number; head: number; top: number; scroll: ReturnType<EditorView['scrollSnapshot']>; source: boolean }
  outline?: number
  map?: Map<string, ReturnType<MindMap['view']['getTransformData']>>
}
