import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search'
import { runScopeHandlers, type EditorView, type Panel } from '@codemirror/view'

function icon(art: typeof X) {
  return renderToStaticMarkup(createElement(art, { size: 16, 'aria-hidden': true }))
}

type FindActions = {
  change: (query: SearchQuery) => void
  navigate: (backward: boolean) => void
  replace: (all: boolean) => void
  close: () => void
  keydown: (event: KeyboardEvent) => boolean
}

export function createDocumentFindPanel(initial: SearchQuery, actions: FindActions, readOnly = false) {
  let query = initial
  let expanded = false
  const dom = document.createElement('div')
  dom.className = 'document-find'
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
  const previous = button('上一个匹配', ArrowUp, () => actions.navigate(true))
  const next = button('下一个匹配', ArrowDown, () => actions.navigate(false))
  const replace = button('替换当前匹配', Replace, () => actions.replace(false))
  const replaceEvery = button('替换全部匹配', ReplaceAll, () => actions.replace(true))
  const toggle = button('展开替换', ChevronRight, () => {
    expanded = !expanded
    updateVisibility()
    if (!expanded && dom.ownerDocument.activeElement === replacement) search.focus()
  })
  const findRow = document.createElement('div')
  findRow.className = 'document-find-row'
  findRow.append(search, matchCase, wholeWord, regexp, previous, next, button('关闭查找', X, actions.close))
  const replaceRow = document.createElement('div')
  replaceRow.className = 'document-find-row'
  replaceRow.append(replacement, replace, replaceEvery)
  dom.append(toggle, findRow, replaceRow)

  function updateVisibility() {
    toggle.hidden = readOnly
    const visible = expanded && !readOnly
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
    if (!value.eq(query)) {
      render(value)
      actions.change(value)
    }
  }

  dom.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (actions.keydown(event)) event.preventDefault()
    else if (event.key === 'Enter' && (event.target === search || event.target === replacement)) {
      event.preventDefault()
      if (event.target === replacement) actions.replace(false)
      else actions.navigate(event.shiftKey)
    }
  })

  updateVisibility()
  render(query)
  return { dom, focus() { search.focus(); search.select() }, update(value: SearchQuery, readonly = false) {
    if (!value.eq(query)) render(value)
    if (readOnly !== readonly) { readOnly = readonly; updateVisibility() }
  } }
}

export function markdownFindPanel(view: EditorView): Panel {
  const panel = createDocumentFindPanel(getSearchQuery(view.state), {
    change: query => view.dispatch({ effects: setSearchQuery.of(query) }),
    navigate: backward => (backward ? findPrevious : findNext)(view),
    replace: all => (all ? replaceAll : replaceNext)(view),
    close: () => closeSearchPanel(view),
    keydown: event => runScopeHandlers(view, event, 'search-panel'),
  }, view.state.readOnly)
  return {
    dom: panel.dom,
    top: true,
    mount: panel.focus,
    update: update => panel.update(getSearchQuery(update.state), update.state.readOnly),
  }
}
