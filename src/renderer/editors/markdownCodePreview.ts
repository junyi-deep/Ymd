import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { WidgetType, type EditorView } from '@codemirror/view'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Check, Code2, Copy } from 'lucide-react'
import type { CodeBlockPreferences } from '../../shared/contracts'

interface CodeBlock {
  from: number
  editAt: number
  code: string
  language: string
  languageRange?: { from: number; to: number }
  lineOffsets: number[]
  quoteDepth: number
}

function fillCode(content: HTMLElement, code: string, colors: { from: number; to: number; classes: string }[]) {
  let end = 0
  const fragments = document.createDocumentFragment()
  for (const { from, to, classes } of colors) {
    if (from > end) fragments.append(document.createTextNode(code.slice(end, from)))
    const span = document.createElement('span')
    span.className = classes
    span.textContent = code.slice(from, to)
    fragments.append(span)
    end = to
  }
  if (end < code.length) fragments.append(document.createTextNode(code.slice(end)))
  if (!code || code.endsWith('\n')) {
    const trailing = document.createElement('span')
    trailing.ariaHidden = 'true'
    trailing.className = 'md-code-trailing'
    fragments.append(trailing)
  }
  content.replaceChildren(fragments)
}

let nextLanguageList = 0
const languageToken = /^[^\s`{},]+/
const languageOptions = languages.map(item => ({
  name: item.name,
  token: [item.name, ...item.alias].find(alias => !/\s/.test(alias))?.toLowerCase() ?? item.name.toLowerCase().replace(/ /g, '-'),
}))

export class CodePreview extends WidgetType {
  constructor(readonly block: CodeBlock, readonly options: CodeBlockPreferences, readonly readOnly: boolean) { super() }

  get estimatedHeight() { return Math.min(620, (this.block.code.match(/\n/g)?.length ?? 0) * 21 + 57) }

  eq(other: CodePreview) {
    return this.block.from === other.block.from && this.block.editAt === other.block.editAt &&
      this.block.languageRange?.from === other.block.languageRange?.from && this.block.languageRange?.to === other.block.languageRange?.to &&
      this.block.lineOffsets.every((offset, index) => offset === other.block.lineOffsets[index]) &&
      this.block.code === other.block.code && this.block.language === other.block.language && this.block.quoteDepth === other.block.quoteDepth &&
      this.readOnly === other.readOnly && this.options.wrap === other.options.wrap && this.options.lineNumbers === other.options.lineNumbers
  }

  toDOM(view: EditorView) {
    const { from, editAt, code, language, languageRange, lineOffsets, quoteDepth } = this.block
    const figure = document.createElement('figure')
    figure.className = 'md-code-preview'
    figure.dataset.wrap = String(this.options.wrap)
    if (quoteDepth) figure.style.paddingInlineStart = Math.min(44, 11 * quoteDepth) + 'px'
    const toolbar = document.createElement('div')
    toolbar.className = 'md-code-header'
    const caption = document.createElement('span')
    caption.textContent = language || '纯文本'
    const position = () => view.posAtDOM(figure)
    const startEditing = (offset = editAt - from) => {
      const start = position()
      view.dispatch({ selection: { anchor: Math.min(start + Math.max(offset, 1), view.state.doc.length) }, scrollIntoView: true })
      view.focus()
    }
    if (!this.readOnly && languageRange) {
      const input = document.createElement('input')
      input.className = 'md-code-language'
      input.ariaLabel = '代码语言'
      input.placeholder = '纯文本'
      input.autocomplete = 'off'
      input.spellcheck = false
      const original = languageToken.exec(language)?.[0] ?? ''
      input.value = original
      input.title = '搜索或输入代码语言'
      const suggestions = document.createElement('datalist')
      suggestions.id = 'code-language-' + ++nextLanguageList
      input.setAttribute('list', suggestions.id)
      let committed = false
      const commit = () => {
        if (committed || !figure.isConnected) return
        const query = input.value.trim()
        const match = languageOptions.find(option => option.name.toLowerCase() === query.toLowerCase())
        const value = match?.token ?? query
        if (value === original || value && languageToken.exec(value)?.[0] !== value) { input.value = original; return }
        const start = languageRange.from
        const info = view.state.sliceDoc(start, languageRange.to)
        committed = true
        view.dispatch({ changes: { from: start, to: start + (languageToken.exec(info)?.[0].length ?? 0),
          insert: value + (!original && info && value ? ' ' : '') },
          userEvent: 'input' })
      }
      input.addEventListener('focus', () => {
        if (!suggestions.childElementCount) for (const { token, name } of languageOptions) {
          const option = document.createElement('option')
          option.value = token
          option.label = name
          suggestions.append(option)
        }
        input.select()
      })
      input.addEventListener('change', () => queueMicrotask(commit))
      input.addEventListener('keydown', event => {
        if (event.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); commit(); view.focus() }
        if (event.key === 'Escape') { event.preventDefault(); input.value = original; view.focus() }
      })
      const field = document.createElement('div')
      field.className = 'md-code-language-field'
      field.append(input, suggestions)
      toolbar.append(field)
    } else toolbar.append(caption)
    function button(label: string, icon: typeof Copy, onClick: (button: HTMLButtonElement) => void) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'icon-button'
      element.title = label
      element.ariaLabel = label
      element.innerHTML = renderToStaticMarkup(createElement(icon, { size: 15, 'aria-hidden': true }))
      element.addEventListener('click', () => onClick(element))
      return element
    }
    if (!this.readOnly) toolbar.append(button('编辑代码块', Code2, () => startEditing()))
    let resetCopy: number | undefined
    const copyIcon = renderToStaticMarkup(createElement(Copy, { size: 15, 'aria-hidden': true }))
    toolbar.append(button('复制代码', Copy, element => {
      void navigator.clipboard.writeText(code).then(() => {
        if (!element.isConnected) return
        window.clearTimeout(resetCopy)
        element.innerHTML = renderToStaticMarkup(createElement(Check, { size: 15, 'aria-hidden': true }))
        element.ariaLabel = element.title = '已复制代码'
        resetCopy = window.setTimeout(() => { element.innerHTML = copyIcon; element.ariaLabel = element.title = '复制代码' }, 1100)
      }).catch(() => { if (element.isConnected) element.title = '复制失败' })
    }))
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
    const qualifier = language.split(/[\s,{]/, 1)[0]
    const match = LanguageDescription.matchLanguageName(languages, qualifier, false)
    const setCode = (colors: { from: number; to: number; classes: string }[]) => {
      if (!this.options.lineNumbers) fillCode(content, code, colors)
      else {
        // Number each logical line while keeping the selectable text unchanged.
        const lines = code.split('\n')
        const rows = document.createDocumentFragment()
        let position = 0, colorIndex = 0
        for (const [index, line] of lines.entries()) {
          const row = document.createElement('span')
          row.className = 'md-code-line'
          row.dataset.line = String(index + 1)
          const last = position + line.length
          while (colorIndex < colors.length && colors[colorIndex].to <= position) colorIndex++
          const through = []
          for (let color = colorIndex; color < colors.length && colors[color].from < last; color++) {
            const range = colors[color]
            through.push({ from: Math.max(0, range.from - position), to: Math.min(line.length, range.to - position), classes: range.classes })
          }
          fillCode(row, line, through)
          rows.append(row)
          if (index + 1 < lines.length) rows.append('\n')
          position = last + 1
        }
        content.replaceChildren(rows)
        content.dataset.numbered = ''
      }
    }

    setCode([])
    if (match && code.length <= 150_000) void (match.support ? Promise.resolve(match.support) : match.load()).then(support => {
      // Avoid replacing an active native selection while a language is loading.
      const textSelection = document.getSelection()
      if (!figure.isConnected || textSelection?.anchorNode && figure.contains(textSelection.anchorNode)) return
      const colors: { from: number; to: number; classes: string }[] = []
      highlightTree(support.language.parser.parse(code), classHighlighter, (from, to, classes) => colors.push({ from, to, classes }))
      setCode(colors)
      view.requestMeasure()
    }).catch(() => {})
    body.append(content)
    figure.append(toolbar, body)
    return figure
  }
}
