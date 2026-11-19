import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Code2, Copy, Pencil } from 'lucide-react'
import { EditorState, Annotation, Compartment } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { createCodeLanguagePicker, findCodeLanguage, paintCode } from './codeCard'
import { mountBlockPreview } from './markdownPreviewMedia'
import { diagramKind } from './renderDiagram'
import type { OutlineCaret } from './outlineEditing'
import type { OutlineCode } from './outlineCode'

const external = Annotation.define<boolean>()

export function OutlineCodeCard({ fence, raw, editing, showNumbers, request, start, stop, change, rememberCaret, clearRequest }: {
  fence: OutlineCode; raw: string; editing: boolean; showNumbers: boolean; request?: OutlineCaret
  start: (offset: number) => void
  stop: () => void
  change: (text: string, previous: number, previousEnd: number, next: number, coalesce: boolean) => void
  rememberCaret: (start: number, end: number) => void
  clearRequest: () => void
}) {
  const [source, setSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const language = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLElement>(null)
  const diagramHost = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const langExtension = useRef(new Compartment())
  const numberExtension = useRef(new Compartment())
  const current = useRef({ fence, change, rememberCaret })
  current.current = { fence, change, rememberCaret }
  const live = editing && !source
  const diagram = fence.code.trim() ? diagramKind(fence.info) : undefined

  useLayoutEffect(() => {
    const parent = language.current!
    const picker = createCodeLanguagePicker(fence.info, value => {
      const latest = current.current
      const selection = editor.current?.state.selection.main
      latest.change(latest.fence.withLanguage(value), latest.fence.offset + (selection?.from ?? 0),
        latest.fence.offset + (selection?.to ?? 0), -1, false)
    })
    parent.replaceChildren(picker)
    return () => picker.remove()
  }, [fence.info])

  useEffect(() => {
    const content = preview.current
    if (!content || live) return
    if (source) return paintCode(content, raw, fence.info, showNumbers)
    let dispose: (() => void) | undefined
    const root = content.closest('.outline-editor')
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      dispose = paintCode(content, fence.code, fence.info, showNumbers)
    }, { root, rootMargin: '350px 0px' })
    observer.observe(content)
    return () => { observer.disconnect(); dispose?.() }
  }, [fence.code, fence.info, raw, showNumbers, source, live])

  useEffect(() => {
    const content = diagramHost.current
    if (!content || !diagram) return
    return mountBlockPreview(content, fence.code, diagram, content.closest('.outline-editor'), { showSourceOnError: true })
  }, [fence.code, diagram, source, live])

  useLayoutEffect(() => {
    if (!live || !host.current) return
    const view = new EditorView({ parent: host.current, state: EditorState.create({
      doc: current.current.fence.code,
      extensions: [
        langExtension.current.of([]), numberExtension.current.of([]), syntaxHighlighting(classHighlighter),
        EditorView.contentAttributes.of({ 'aria-label': '编辑大纲代码', spellcheck: 'false' }),
        keymap.of(defaultKeymap),
        EditorView.updateListener.of(update => {
          const state = current.current
          if (update.transactions.some(transaction => transaction.annotation(external))) return
          const { from, to } = update.state.selection.main
          if (!update.docChanged) { state.rememberCaret(state.fence.offset + from, state.fence.offset + to); return }
          const before = update.startState.selection.main
          const next = state.fence.withCode(update.state.doc.toString())
          state.change(next.text, state.fence.offset + before.from, state.fence.offset + before.to,
            next.offset + from, update.transactions.some(transaction => transaction.isUserEvent('input.type') || transaction.isUserEvent('delete')))
          state.rememberCaret(next.offset + from, next.offset + to)
        }),
      ],
    }) })
    editor.current = view
    return () => { view.destroy(); editor.current = null }
  }, [live])

  useLayoutEffect(() => {
    const view = editor.current
    if (!view) return
    const selection = request && {
      anchor: Math.min(fence.code.length, Math.max(0, request.start - fence.offset)),
      head: Math.min(fence.code.length, Math.max(0, request.end - fence.offset)),
    }
    const changes = view.state.doc.toString() !== fence.code ? { from: 0, to: view.state.doc.length, insert: fence.code } : undefined
    if (selection || changes) view.dispatch({ changes, selection, annotations: external.of(true) })
    if (selection) {
      current.current.rememberCaret(fence.offset + selection.anchor, fence.offset + selection.head)
      view.focus()
      clearRequest()
    }
  }, [fence.code, fence.offset, live, request])

  useEffect(() => {
    const view = editor.current
    if (!view) return
    const match = findCodeLanguage(fence.info)
    let active = true
    view.dispatch({ effects: langExtension.current.reconfigure([]) })
    if (match) void match.load().then(support => {
      if (active && editor.current === view) view.dispatch({ effects: langExtension.current.reconfigure(support.extension) })
    }).catch(() => {})
    return () => { active = false }
  }, [fence.info, live])
  useEffect(() => {
    editor.current?.dispatch({ effects: numberExtension.current.reconfigure(showNumbers ? lineNumbers() : []) })
  }, [showNumbers, live])
  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1100)
    return () => window.clearTimeout(timeout)
  }, [copied])

  return <figure className="md-code-preview outline-code-card" onBlur={event => {
    if (editing && !event.currentTarget.contains(event.relatedTarget)) stop()
  }}>
    <div className="md-code-header">
      <div ref={language} className="md-code-language-field" />
      {diagram && !live && !source && <button type="button" className="icon-button" aria-label="编辑代码块" title="编辑代码块"
        onClick={() => start(fence.offset + fence.code.length)}><Pencil size={15} /></button>}
      <button type="button" className="icon-button" aria-label={source ? '返回代码卡片' : '查看源码'}
        title={source ? '返回代码卡片' : '查看源码'} aria-pressed={source} onClick={() => setSource(!source)}><Code2 size={15} /></button>
      <button type="button" className="icon-button" aria-label={copied ? '已复制代码' : '复制代码'} title="复制代码"
        onClick={() => { void navigator.clipboard.writeText(fence.code).then(() => setCopied(true)).catch(() => {}) }}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
    {source ? <pre className="md-code-body" aria-label="代码块源码"><code ref={preview} /></pre>
      : live ? <div className="md-code-body outline-code-edit" data-code-editor ref={host} onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            stop()
          }
        }} />
      : diagram ? <div className="md-code-body"><figure ref={diagramHost} /></div>
      : <pre className="md-code-body" aria-label="编辑代码块" tabIndex={0}
          style={{ minHeight: Math.min(200, 40 + (fence.code.match(/\n/g)?.length ?? 0) * 20) }}
          onClick={event => {
            const selection = document.getSelection()
            if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return
            start(fence.offset + fence.code.length)
          }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); start(fence.offset + fence.code.length) } }}>
          <code ref={preview} />
        </pre>}
  </figure>
}
