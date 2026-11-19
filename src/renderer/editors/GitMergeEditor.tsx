import { useLayoutEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { Annotation, EditorState, type ChangeSet, type Text } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'

export type ApplyGitChunk = (expected: Text, changes: ChangeSet) => boolean
const syncVersion = Annotation.define<boolean>()
const collapsed = { margin: 0, minSize: 1 }

function applyButton() {
  const button = document.createElement('button')
  button.type = 'button'
  button.title = button.ariaLabel = '将此差异块应用到当前文件'
  button.textContent = '→'
  button.addEventListener('mousedown', event => { if (event.button !== 0) event.stopPropagation() })
  // MergeView handles pointer activation through mousedown. Native keyboard clicks reach that same action.
  button.addEventListener('click', event => {
    if (event.detail === 0) button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
  return button
}

export function GitMergeEditor({ left, right, full, split, apply }: {
  left: Text; right: Text; full: boolean; split: number; apply?: ApplyGitChunk
}) {
  const host = useRef<HTMLDivElement>(null)
  const merge = useRef<MergeView>(null)
  const current = useRef({ left, right, apply })
  current.current = { left, right, apply }
  const canApply = !!apply

  useLayoutEffect(() => {
    const pane = (label: string) => [
      EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping, lineNumbers(),
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true', tabindex: '0' }),
      EditorState.phrases.of({ '$ unchanged lines': '$ 行未变化' }),
    ]
    const view = new MergeView({
      parent: host.current!,
      a: { doc: current.current.left, extensions: pane('左侧版本') },
      b: {
        doc: current.current.right,
        extensions: [pane('右侧版本'), EditorState.transactionFilter.of(transaction => {
          if (!transaction.docChanged || transaction.annotation(syncVersion)) return transaction
          return transaction.isUserEvent('revert') && current.current.apply?.(transaction.startState.doc, transaction.changes)
            ? transaction : []
        })],
      },
      diffConfig: { scanLimit: 500, timeout: 150 },
    })
    merge.current = view
    const split = host.current?.parentElement
    const measure = () => split?.style.setProperty('--git-diff-scrollbar', view.dom.offsetWidth - view.dom.clientWidth + 'px')
    const observer = new ResizeObserver(measure)
    observer.observe(view.dom)
    measure()
    return () => {
      observer.disconnect()
      split?.style.removeProperty('--git-diff-scrollbar')
      merge.current = null
      view.destroy()
    }
  }, [])

  useLayoutEffect(() => {
    const view = merge.current
    if (!view) return
    for (const [editor, doc] of [[view.a, left], [view.b, right]] as const) {
      if (!editor.state.doc.eq(doc)) editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: doc }, annotations: syncVersion.of(true),
      })
    }
  }, [left, right])

  useLayoutEffect(() => {
    merge.current?.reconfigure({ collapseUnchanged: full ? undefined : collapsed })
  }, [full])

  useLayoutEffect(() => {
    merge.current?.reconfigure({ revertControls: canApply ? 'a-to-b' : undefined, renderRevertControl: applyButton })
  }, [canApply])

  useLayoutEffect(() => {
    merge.current?.a.requestMeasure()
    merge.current?.b.requestMeasure()
  }, [split])

  return <div className="git-merge-editor" ref={host} />
}
