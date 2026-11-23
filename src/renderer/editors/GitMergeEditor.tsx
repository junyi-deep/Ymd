import { useLayoutEffect, useRef, type RefObject } from 'react'
import { getChunks, MergeView, type Change, type Chunk } from '@codemirror/merge'
import { ChangeSet, Compartment, EditorState, StateEffect, StateField, type Range, type Text } from '@codemirror/state'
import { Decoration, EditorView, lineNumbers, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { inlineChanges, lineChanges, type DiffDetail } from './gitDiffChanges'

export type ApplyGitChunk = (expected: Text, changes: ChangeSet) => boolean
export interface GitDiffNavigation { index: number; count: number }
export interface GitDiffControls { move(direction: number): void; apply(): void; workingPosition(): number | undefined }

const collapsed = { margin: 2, minSize: 3 }
const selectChunk = StateEffect.define<number>()
const selectedChunk = StateField.define({
  create: () => -1,
  update(index, transaction) {
    return transaction.effects.find(effect => effect.is(selectChunk))?.value ?? index
  },
})
const selectedLine = Decoration.line({ class: 'git-current-line' })
const addedLine = Decoration.line({ class: 'git-added-line' })
const removedLine = Decoration.line({ class: 'git-removed-line' })
const modifiedLine = Decoration.line({ class: 'git-modified-line' })
const inlineMark = Decoration.mark({ class: 'git-inline-change' })

function lines(chunk: Chunk, doc: Text, isLeft: boolean) {
  const from = isLeft ? chunk.fromA : chunk.fromB
  const end = isLeft ? chunk.endA : chunk.endB
  const to = isLeft ? chunk.toA : chunk.toB
  const first = doc.lineAt(from).number
  return { first, last: to === from ? first - 1 : doc.lineAt(end).number }
}

function lineHighlights(isLeft: boolean, detail: DiffDetail, other: () => Text, cache: WeakMap<Chunk, Map<number, readonly Change[]>>) {
  return ViewPlugin.fromClass(class {
    decorations
    constructor(view: EditorView) { this.decorations = this.build(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged ||
          getChunks(update.startState)?.chunks !== getChunks(update.state)?.chunks ||
          update.startState.field(selectedChunk) !== update.state.field(selectedChunk)) this.decorations = this.build(update.view)
    }
    build(view: EditorView) {
      const ranges: Range<Decoration>[] = []
      const chunks = getChunks(view.state)?.chunks
      if (!chunks?.length) return Decoration.none
      const doc = view.state.doc
      const otherDoc = other()
      const selected = view.state.field(selectedChunk)
      for (const range of view.visibleRanges) {
        const start = doc.lineAt(range.from).number, end = doc.lineAt(range.to).number
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index]
          if ((isLeft ? chunk.fromA : chunk.fromB) > range.to) break
          if ((isLeft ? chunk.endA : chunk.endB) < range.from) continue
          const here = lines(chunk, doc, isLeft)
          const there = lines(chunk, otherDoc, !isLeft)
          const paired = here.last - here.first === there.last - there.first
          const modified = there.last >= there.first
          const lineDecoration = modified ? modifiedLine : isLeft ? removedLine : addedLine
          for (let line = Math.max(start, here.first); line <= Math.min(end, here.last); line++) {
            const content = doc.line(line)
            const corresponding = paired ? otherDoc.line(there.first + line - here.first) : undefined
            if (corresponding?.text === content.text) continue
            ranges.push(lineDecoration.range(content.from))
            if (index === selected) ranges.push(selectedLine.range(content.from))
            if (detail === 'line' || !corresponding) continue
            const offset = line - here.first
            let chunkMarks = cache.get(chunk)
            if (!chunkMarks) cache.set(chunk, chunkMarks = new Map())
            let marks = chunkMarks.get(offset)
            if (!marks) {
              marks = isLeft ? inlineChanges(content.text, corresponding.text, detail) : inlineChanges(corresponding.text, content.text, detail)
              chunkMarks.set(offset, marks)
            }
            for (const mark of marks) {
              const from = isLeft ? mark.fromA : mark.fromB, to = isLeft ? mark.toA : mark.toB
              if (from < to) ranges.push(inlineMark.range(content.from + from, content.from + to))
            }
          }
        }
      }
      return Decoration.set(ranges, true)
    }
  }, { decorations: plugin => plugin.decorations })
}

export function GitMergeEditor({ left, right, full, split, detail, apply, controls, report }: {
  left: Text; right: Text; full: boolean; split: number; detail: DiffDetail; apply?: ApplyGitChunk
  controls: RefObject<GitDiffControls | null>; report: (value: GitDiffNavigation) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const merge = useRef<MergeView>(null)
  const compartments = useRef({ a: new Compartment(), b: new Compartment() })
  const current = useRef({ left, right, detail, apply, report })
  current.current = { left, right, detail, apply, report }
  const index = useRef(-1)
  const canApply = !!apply

  function select(view: MergeView, requested: number, scroll = true) {
    const count = view.chunks.length
    index.current = count ? Math.max(0, Math.min(count - 1, requested)) : -1
    const chunk = view.chunks[index.current]
    const toScroll = chunk && (chunk.fromB === chunk.toB ? view.a : view.b)
    for (const editor of [view.a, view.b]) {
      const effects: StateEffect<unknown>[] = [selectChunk.of(index.current)]
      if (scroll && chunk && editor === toScroll) {
        effects.push(EditorView.scrollIntoView(editor === view.a ? chunk.fromA : chunk.fromB, { y: 'center' }))
      }
      editor.dispatch({ effects })
    }
    current.current.report({ index: index.current, count })
  }

  function applyChunk(view: MergeView, position: number) {
    const chunk = view.chunks[position]
    if (!chunk) return
    const source = view.a.state.doc, target = view.b.state.doc
    const insert = source.sliceString(chunk.fromA, chunk.endA) +
      (chunk.fromA !== chunk.toA && chunk.toB <= target.length ? '\n' : '')
    const changes = ChangeSet.of({ from: chunk.fromB, to: Math.min(chunk.toB, target.length), insert }, target.length)
    if (!current.current.apply?.(target, changes)) return
    view.b.dispatch({ changes })
    select(view, position)
  }

  useLayoutEffect(() => {
    const pane = (label: string, isLeft: boolean) => [
      EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping, lineNumbers(), selectedChunk,
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true', tabindex: '0' }),
      EditorState.phrases.of({ '$ unchanged lines': '$ 行未变化' }),
      EditorView.domEventHandlers({ click(event, editor) {
        const view = merge.current
        if (!view || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('.cm-line')) return
        const point = editor.posAtCoords({ x: event.clientX, y: event.clientY })
        const found = point === null ? -1 : view.chunks.findIndex(chunk =>
          point >= (isLeft ? chunk.fromA : chunk.fromB) && point <= (isLeft ? chunk.endA : chunk.endB))
        if (found >= 0 && found !== index.current) select(view, found, false)
      } }),
    ]
    const view = new MergeView({
      parent: host.current!, highlightChanges: false, diffConfig: { override: lineChanges },
      a: { doc: current.current.left, extensions: [pane('左侧版本', true), compartments.current.a.of([])] },
      b: { doc: current.current.right, extensions: [pane('右侧版本', false), compartments.current.b.of([])] },
    })
    merge.current = view
    controls.current = {
      move: direction => select(view, index.current + direction),
      apply: () => applyChunk(view, index.current),
      workingPosition: () => view.chunks[index.current]?.fromB,
    }
    select(view, 0)
    const split = host.current?.parentElement
    const measure = () => split?.style.setProperty('--git-diff-scrollbar', view.dom.offsetWidth - view.dom.clientWidth + 'px')
    const observer = new ResizeObserver(measure)
    observer.observe(view.dom)
    measure()
    return () => {
      observer.disconnect()
      split?.style.removeProperty('--git-diff-scrollbar')
      controls.current = null
      merge.current = null
      view.destroy()
    }
  }, [controls])

  useLayoutEffect(() => {
    const view = merge.current
    if (!view) return
    let changed = false
    for (const [editor, doc] of [[view.a, left], [view.b, right]] as const) {
      if (editor.state.doc.eq(doc)) continue
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: doc } })
      changed = true
    }
    if (changed) select(view, 0)
  }, [left, right])

  useLayoutEffect(() => {
    const view = merge.current
    if (!view) return
    const cache = new WeakMap<Chunk, Map<number, readonly Change[]>>()
    view.a.dispatch({ effects: compartments.current.a.reconfigure(lineHighlights(true, detail, () => view.b.state.doc, cache)) })
    view.b.dispatch({ effects: compartments.current.b.reconfigure(lineHighlights(false, detail, () => view.a.state.doc, cache)) })
  }, [detail])

  useLayoutEffect(() => {
    merge.current?.reconfigure({ collapseUnchanged: full ? undefined : collapsed })
  }, [full])

  useLayoutEffect(() => {
    const view = merge.current
    if (!view) return
    view.reconfigure({ revertControls: canApply ? 'a-to-b' : undefined, renderRevertControl: () => {
      const button = document.createElement('button')
      button.type = 'button'
      button.title = button.ariaLabel = '将左侧变更应用到当前文件'
      button.textContent = '→'
      button.addEventListener('mousedown', event => event.stopPropagation())
      button.addEventListener('click', () => {
        if (document.activeElement === button) view.b.contentDOM.focus({ preventScroll: true })
        applyChunk(view, Number(button.dataset.chunk))
      })
      return button
    } })
  }, [canApply])

  useLayoutEffect(() => {
    merge.current?.a.requestMeasure()
    merge.current?.b.requestMeasure()
  }, [split])

  return <div className="git-merge-editor" ref={host} />
}
