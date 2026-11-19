import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Code2, Copy, Pencil, Trash2 } from 'lucide-react'
import { EditorState, Annotation, Compartment } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { createCodeLanguagePicker, findCodeLanguage, paintCode } from './codeCard'
import { mountBlockPreview } from './markdownPreviewMedia'
import { diagramKind } from './renderDiagram'
import { codeDisplayControls, type CodeDisplayOption } from './codeToolbar'
import type { CodeBlockPreferences } from '../../shared/contracts'
import type { OutlineCaret } from './outlineEditing'
import type { OutlineCode } from './outlineCode'

const external = Annotation.define<boolean>()

export function OutlineCodeCard({ fence, raw, editing, options, toggleDisplay, request, start, stop, change, rememberCaret, clearRequest,
  changeOpening, insertAbove, remove }: {
  fence: OutlineCode; raw: string; editing: boolean; options: CodeBlockPreferences; request?: OutlineCaret
  toggleDisplay: (option: CodeDisplayOption) => void
  start: (offset: number) => void
  stop: () => void
  change: (text: string, previous: number, previousEnd: number, next: number, coalesce: boolean) => void
  rememberCaret: (start: number, end: number) => void
  clearRequest: () => void
  changeOpening: (text: string, caret: number) => void
  insertAbove: (text: string) => void
  remove: () => void
}) {
  const [source, setSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const language = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLElement>(null)
  const diagramHost = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const openingInput = useRef<HTMLInputElement>(null)
  const editor = useRef<EditorView | null>(null)
  const langExtension = useRef(new Compartment())
  const displayExtension = useRef(new Compartment())
  const current = useRef({ fence, change, rememberCaret, start })
  current.current = { fence, change, rememberCaret, start }
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
    if (source) return paintCode(content, raw, fence.info, options.lineNumbers)
    let dispose: (() => void) | undefined
    const root = content.closest('.outline-editor')
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      dispose = paintCode(content, fence.code, fence.info, options.lineNumbers)
    }, { root, rootMargin: '350px 0px' })
    observer.observe(content)
    return () => { observer.disconnect(); dispose?.() }
  }, [fence.code, fence.info, raw, options.lineNumbers, source, live])

  useEffect(() => {
    const content = diagramHost.current
    if (!content || !diagram) return
    return mountBlockPreview(content, fence.code, diagram, content.closest('.outline-editor'), {
      showSourceOnError: true,
      editDiagram: () => current.current.start(current.current.fence.offset),
    })
  }, [fence.code, diagram, source, live])

  useLayoutEffect(() => {
    if (!live || !host.current) return
    const view = new EditorView({ parent: host.current, state: EditorState.create({
      doc: current.current.fence.code,
      extensions: [
        langExtension.current.of([]), displayExtension.current.of([]), syntaxHighlighting(classHighlighter),
        EditorView.contentAttributes.of({ 'aria-label': '编辑大纲代码', spellcheck: 'false' }),
        keymap.of(defaultKeymap),
        EditorView.updateListener.of(update => {
          const state = current.current
          if (update.transactions.some(transaction => transaction.annotation(external))) return
          const { from, to } = update.state.selection.main
          if (!update.docChanged) {
            if (update.selectionSet) state.rememberCaret(state.fence.offset + from, state.fence.offset + to)
            return
          }
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
    const selectOpening = request && request.start < fence.offset && openingInput.current
    const selection = request && !selectOpening ? {
      anchor: Math.min(fence.code.length, Math.max(0, request.start - fence.offset)),
      head: Math.min(fence.code.length, Math.max(0, request.end - fence.offset)),
    } : undefined
    const changes = view.state.doc.toString() !== fence.code ? { from: 0, to: view.state.doc.length, insert: fence.code } : undefined
    if (selection || changes) view.dispatch({ changes, selection, annotations: external.of(true) })
    if (selectOpening && request) {
      selectOpening.focus()
      selectOpening.setSelectionRange(request.start, Math.min(request.end, fence.opening.length))
      current.current.rememberCaret(selectOpening.selectionStart ?? 0, selectOpening.selectionEnd ?? 0)
      clearRequest()
    } else if (selection) {
      current.current.rememberCaret(fence.offset + selection.anchor, fence.offset + selection.head)
      view.focus()
      clearRequest()
    }
  }, [fence.code, fence.offset, fence.opening, live, request])

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
    editor.current?.dispatch({ effects: displayExtension.current.reconfigure([
      options.lineNumbers ? lineNumbers() : [], options.wrap ? EditorView.lineWrapping : [],
    ]) })
  }, [options.lineNumbers, options.wrap, live])
  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1100)
    return () => window.clearTimeout(timeout)
  }, [copied])

  return <figure className="md-code-preview outline-code-card" data-wrap={options.wrap} onBlur={event => {
    if (editing && !event.currentTarget.contains(event.relatedTarget)) stop()
  }}>
    <div className="md-code-header">
      <div ref={language} className="md-code-language-field" />
      {(!diagram || live) && codeDisplayControls.map(({ option, label, on, off }) => {
        const Icon = options[option] ? on : off
        return <button key={option} type="button" className="icon-button" data-code-option={option}
          aria-label={label} title={label} aria-pressed={options[option]} onClick={() => toggleDisplay(option)}>
          <Icon size={15} aria-hidden="true" />
        </button>
      })}
      {!live && !source && <button type="button" className="icon-button" aria-label="编辑代码块" title="编辑代码块"
        onClick={() => start(fence.code ? fence.offset + fence.code.length : fence.opening.length)}><Pencil size={15} /></button>}
      <button type="button" className="icon-button" aria-label={source ? '返回代码卡片' : '查看源码'}
        title={source ? '返回代码卡片' : '查看源码'} aria-pressed={source} onClick={() => setSource(!source)}><Code2 size={15} /></button>
      <button type="button" className="icon-button" aria-label={copied ? '已复制代码' : '复制代码'} title="复制代码"
        onClick={() => { void navigator.clipboard.writeText(fence.code).then(() => setCopied(true)).catch(() => {}) }}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button type="button" className="icon-button" aria-label="删除代码块" title="删除代码块" onClick={remove}><Trash2 size={15} /></button>
    </div>
    {source ? <pre className="md-code-body" aria-label="代码块源码"><code ref={preview} /></pre>
      : live ? <div className="md-code-body outline-code-edit" data-code-editor onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            stop()
          }
        }}>
          <input className="outline-code-fence" ref={openingInput} aria-label="代码块起始围栏" spellCheck={false} value={fence.opening}
            onSelect={event => rememberCaret(event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0)}
            onChange={event => {
              const { value, selectionStart } = event.currentTarget
              const at = selectionStart ?? value.length
              const added = value.length - fence.opening.length
              if (added > 0 && at === fence.markerStart + added &&
                  value.slice(0, fence.markerStart) === fence.opening.slice(0, fence.markerStart) &&
                  value.slice(at) === fence.opening.slice(fence.markerStart)) insertAbove(value.slice(fence.markerStart, at))
              else changeOpening(fence.withOpening(value), at)
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
              if (event.key !== 'Enter' && event.key !== 'ArrowDown') return
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Enter' && event.currentTarget.selectionStart === fence.markerStart &&
                  event.currentTarget.selectionEnd === fence.markerStart) insertAbove('')
              else start(fence.offset)
            }} />
          <div ref={host} />
        </div>
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
