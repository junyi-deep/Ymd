import { LanguageDescription } from '@codemirror/language'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { codeLanguages } from './codeLanguages'
import { codeLanguageToken } from './diagramSyntax'

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
const languageOptions = codeLanguages.map(item => ({
  name: item.name,
  token: [item.name, ...item.alias].find(alias => !/\s/.test(alias))?.toLowerCase() ?? item.name.toLowerCase().replace(/ /g, '-'),
}))

export function findCodeLanguage(info: string) {
  return LanguageDescription.matchLanguageName(codeLanguages, codeLanguageToken.exec(info.trimStart())?.[0] ?? '', false)
}

export function replaceCodeLanguage(info: string, value: string) {
  const leading = info.length - info.trimStart().length
  const rest = info.slice(leading)
  const first = codeLanguageToken.exec(rest)?.[0]
  return info.slice(0, leading) + value + (!first && rest && value ? ' ' : '') + rest.slice(first?.length ?? 0)
}

export function createCodeLanguagePicker(info: string, update: (value: string) => void, finish?: () => void) {
  const original = codeLanguageToken.exec(info.trimStart())?.[0] ?? ''
  const input = document.createElement('input')
  input.className = 'md-code-language'
  input.ariaLabel = '代码语言'
  input.placeholder = '纯文本'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = original
  input.title = '搜索或输入代码语言'
  const suggestions = document.createElement('datalist')
  suggestions.id = 'code-language-' + ++nextLanguageList
  input.setAttribute('list', suggestions.id)
  let committed = original
  const commit = () => {
    if (!input.isConnected) return
    const query = input.value.trim()
    const match = languageOptions.find(option => option.name.toLowerCase() === query.toLowerCase())
    const value = match?.token ?? query
    if (value && codeLanguageToken.exec(value)?.[0] !== value) { input.value = committed; return }
    input.value = value
    if (committed === value) return
    committed = value
    update(value)
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
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); finish?.() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = committed; (finish ?? (() => input.blur()))() }
  })
  const field = document.createElement('div')
  field.className = 'md-code-language-field'
  field.append(input, suggestions)
  return field
}

export function paintCode(content: HTMLElement, code: string, language: string, lineNumbers: boolean, measured?: () => void) {
  let current = true
  const match = findCodeLanguage(language)
  const setCode = (colors: { from: number; to: number; classes: string }[]) => {
    if (!lineNumbers) fillCode(content, code, colors)
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
    if (!current || !content.isConnected || textSelection && !textSelection.isCollapsed && content.contains(textSelection.anchorNode)) return
    const colors: { from: number; to: number; classes: string }[] = []
    highlightTree(support.language.parser.parse(code), classHighlighter, (from, to, classes) => colors.push({ from, to, classes }))
    setCode(colors)
    measured?.()
  }).catch(() => {})
  return () => { current = false }
}
