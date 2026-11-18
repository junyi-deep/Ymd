import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search'
import { runScopeHandlers, type EditorView, type Panel } from '@codemirror/view'

function icon(art: typeof X) {
  return renderToStaticMarkup(createElement(art, { size: 16, 'aria-hidden': true }))
}

export function markdownFindPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state)
  let expanded = false
  const dom = document.createElement('div')
  dom.className = 'markdown-find'
  dom.setAttribute('role', 'search')
  dom.setAttribute('aria-label', '文档内查找替换')

  function field(label: string, value: string) {
    const element = document.createElement('input')
    element.ariaLabel = element.placeholder = label
    element.value = value
    element.spellcheck = false
    element.addEventListener('input', commit)
    return element
  }

  function button(label: string, art: typeof X, click: () => void) {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'icon-button'
    element.ariaLabel = element.title = label
    element.innerHTML = icon(art)
    element.addEventListener('click', click)
    return element
  }

  function option(label: string, art: typeof X) {
    const element = button(label, art, () => {
      element.ariaPressed = String(element.ariaPressed !== 'true')
      commit()
    })
    return element
  }

  const search = field('查找', query.search)
  search.setAttribute('main-field', 'true')
  const replacement = field('替换为', query.replace)
  const matchCase = option('区分大小写', CaseSensitive)
  const wholeWord = option('全字匹配', WholeWord)
  const regexp = option('正则表达式', Regex)
  const previous = button('上一个匹配', ArrowUp, () => findPrevious(view))
  const next = button('下一个匹配', ArrowDown, () => findNext(view))
  const replace = button('替换当前匹配', Replace, () => replaceNext(view))
  const replaceEvery = button('替换全部匹配', ReplaceAll, () => replaceAll(view))
  const toggle = button('展开替换', ChevronRight, () => {
    expanded = !expanded
    updateVisibility()
    if (!expanded && dom.ownerDocument.activeElement === replacement) search.focus()
  })
  const findRow = document.createElement('div')
  findRow.className = 'markdown-find-row'
  findRow.append(search, matchCase, wholeWord, regexp, previous, next, button('关闭查找', X, () => closeSearchPanel(view)))
  const replaceRow = document.createElement('div')
  replaceRow.className = 'markdown-find-row'
  replaceRow.append(replacement, replace, replaceEvery)
  dom.append(toggle, findRow, replaceRow)

  function updateVisibility() {
    toggle.hidden = view.state.readOnly
    const visible = expanded && !view.state.readOnly
    toggle.ariaExpanded = String(visible)
    toggle.ariaLabel = toggle.title = visible ? '收起替换' : '展开替换'
    toggle.innerHTML = icon(visible ? ChevronDown : ChevronRight)
    replaceRow.hidden = !visible
  }

  function render(value: SearchQuery) {
    query = value
    if (search.value !== value.search) search.value = value.search
    if (replacement.value !== value.replace) replacement.value = value.replace
    matchCase.ariaPressed = String(value.caseSensitive)
    wholeWord.ariaPressed = String(value.wholeWord)
    regexp.ariaPressed = String(value.regexp)
    search.setAttribute('aria-invalid', String(Boolean(value.search) && !value.valid))
    search.title = value.search && !value.valid ? '正则表达式无效' : ''
    previous.disabled = next.disabled = replace.disabled = replaceEvery.disabled = !value.valid
  }

  function commit() {
    const value = new SearchQuery({
      search: search.value, replace: replacement.value, caseSensitive: matchCase.ariaPressed === 'true',
      wholeWord: wholeWord.ariaPressed === 'true', regexp: regexp.ariaPressed === 'true',
    })
    if (!value.eq(query)) view.dispatch({ effects: setSearchQuery.of(value) })
  }

  dom.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault()
    else if (event.key === 'Enter' && (event.target === search || event.target === replacement)) {
      event.preventDefault()
      if (event.target === replacement) replaceNext(view)
      else if (event.shiftKey) findPrevious(view)
      else findNext(view)
    }
  })

  updateVisibility()
  render(query)
  return {
    dom,
    top: true,
    mount() { search.select(); search.focus() },
    update(update) {
      const value = getSearchQuery(update.state)
      if (!value.eq(query)) render(value)
      if (update.startState.readOnly !== update.state.readOnly) updateVisibility()
    },
  }
}
