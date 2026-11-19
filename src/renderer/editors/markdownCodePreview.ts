import { WidgetType, type EditorView } from '@codemirror/view'
import { Pencil, Trash2 } from 'lucide-react'
import { createCodeLanguagePicker, paintCode, replaceCodeLanguage } from './codeCard'
import { codeButton, codeDisplayButtons, copyCodeButton } from './codeToolbar'
import { deleteCodeBlock, toggleCodeDisplay } from './markdownCodeEditing'
import type { CodeBlockPreferences } from '../../shared/contracts'

interface CodeBlock {
  from: number
  opening: number
  editAt: number
  code: string
  language: string
  languageRange?: { from: number; to: number }
  lineOffsets: number[]
  quoteDepth: number
}

export class CodePreview extends WidgetType {
  private cancel?: () => void
  destroy() { this.cancel?.() }
  constructor(readonly block: CodeBlock, readonly options: CodeBlockPreferences, readonly readOnly: boolean) { super() }

  get estimatedHeight() { return Math.min(620, (this.block.code.match(/\n/g)?.length ?? 0) * 21 + 57) }

  eq(other: CodePreview) {
    return this.block.from === other.block.from && this.block.opening === other.block.opening && this.block.editAt === other.block.editAt &&
      this.block.languageRange?.from === other.block.languageRange?.from && this.block.languageRange?.to === other.block.languageRange?.to &&
      this.block.lineOffsets.every((offset, index) => offset === other.block.lineOffsets[index]) &&
      this.block.code === other.block.code && this.block.language === other.block.language && this.block.quoteDepth === other.block.quoteDepth &&
      this.readOnly === other.readOnly && this.options.wrap === other.options.wrap && this.options.lineNumbers === other.options.lineNumbers
  }

  toDOM(view: EditorView) {
    const { from, opening, editAt, code, language, languageRange, lineOffsets, quoteDepth } = this.block
    const figure = document.createElement('figure')
    figure.className = 'md-code-preview'
    figure.dataset.wrap = String(this.options.wrap)
    if (quoteDepth) figure.style.paddingInlineStart = Math.min(44, 11 * quoteDepth) + 'px'
    const toolbar = document.createElement('div')
    toolbar.className = 'md-code-header'
    toolbar.dataset.codeOpening = String(opening)
    const caption = document.createElement('span')
    caption.textContent = language || '纯文本'
    const position = () => view.posAtDOM(figure)
    const startEditing = (offset = editAt - from) => {
      const start = position()
      view.dispatch({ selection: { anchor: Math.min(start + Math.max(offset, 1), view.state.doc.length) }, scrollIntoView: true })
      view.focus()
    }
    if (!this.readOnly && languageRange) toolbar.append(createCodeLanguagePicker(language, value => {
      const info = view.state.sliceDoc(languageRange.from, languageRange.to)
      view.dispatch({ changes: { ...languageRange, insert: replaceCodeLanguage(info, value) }, userEvent: 'input' })
    }, () => view.focus()))
    else toolbar.append(caption)
    toolbar.append(...codeDisplayButtons(this.options, option => toggleCodeDisplay(view, opening, option, !this.options[option])))
    if (!this.readOnly) toolbar.append(codeButton('编辑代码块', Pencil, () => startEditing()))
    toolbar.append(copyCodeButton(() => code))
    if (!this.readOnly) toolbar.append(codeButton('删除代码块', Trash2, () => deleteCodeBlock(view, opening)))
    const body = document.createElement('pre')
    body.className = 'md-code-body'
    body.tabIndex = 0
    body.ariaLabel = (language || '纯文本') + '代码'
    body.addEventListener('pointerdown', event => {
      if (event.button === 0) body.focus({ preventScroll: true })
    })
    if (!this.readOnly) {
      body.addEventListener('click', event => {
        const selection = document.getSelection()
        if (selection && !selection.isCollapsed && body.contains(selection.anchorNode)) return
        const hit = document.caretRangeFromPoint(event.clientX, event.clientY)
        if (!hit || !content.contains(hit.startContainer)) { startEditing(); return }
        const prefix = hit.cloneRange()
        prefix.selectNodeContents(content)
        prefix.setEnd(hit.startContainer, hit.startOffset)
        const lines = prefix.toString().split('\n')
        startEditing((lineOffsets[lines.length - 1] ?? editAt - from) + lines.at(-1)!.length)
      })
      body.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); startEditing() }
      })
    }
    body.addEventListener('contextmenu', event => {
      event.preventDefault()
      event.stopPropagation()
      const selection = document.getSelection()
      const selected = selection?.anchorNode && selection.focusNode && body.contains(selection.anchorNode) &&
        body.contains(selection.focusNode) ? selection.toString() : ''
      const items = [{ id: 0, label: selected ? '复制所选代码' : '复制代码' }]
      void window.desktop.markdownContextMenu(event.clientX, event.clientY, items)
        .then(id => { if (id === 0) return navigator.clipboard.writeText(selected || code) }).catch(() => {})
    })
    const content = document.createElement('code')
    this.cancel = paintCode(content, code, language, this.options.lineNumbers, () => view.requestMeasure())
    body.append(content)
    figure.append(toolbar, body)
    return figure
  }
}
