import DOMPurify from 'dompurify'
import { marked } from 'marked'

const inlineTags = ['a', 'abbr', 'b', 'br', 'cite', 'code', 'del', 'em', 'font', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']
const documentTags = ['article', 'aside', 'blockquote', 'caption', 'col', 'colgroup', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'input', 'li', 'ol', 'p',
  'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']
const styles = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration-line', 'text-align']
// Only literal values for text properties are accepted. Functions with references to the document or external resources are excluded.
const unsafeCss = /(?:url|var|attr|env|image|paint)\s*\(|\\|[{}]/i

export function cleanMarkdownStyles(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    if (!(element instanceof HTMLElement) || element.localName === 'img') continue
    const declarations = styles.flatMap(property => {
      const value = element.style.getPropertyValue(property)
      return value && !unsafeCss.test(value) ? [[property, value] as const] : []
    })
    element.removeAttribute('style')
    for (const [property, value] of declarations) element.style.setProperty(property, value)
  }
}

export function markdownHtmlFragment(html: string, inline = false) {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-preview-image', 'data-preview-block'],
    ALLOWED_TAGS: inline ? inlineTags : [...inlineTags, ...documentTags],
    ALLOWED_ATTR: ['href', 'title', 'style', 'class', 'color', 'open', 'start', 'value', 'align', 'colspan', 'rowspan',
      'span', 'type', 'checked', 'disabled', 'datetime', 'dir'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'svg', 'math', 'textarea', 'template', 'form'],
  })
  cleanMarkdownStyles(fragment)
  for (const element of fragment.querySelectorAll('[class]')) {
    const classes = [...element.classList].filter(name =>
      /^(?:ymd-text-(?:red|yellow|green|blue|purple)|ymd-highlight-(?:red|yellow|gray|green|blue|purple|mint)|ymd-outline-number|language-[\w+-]+|contains-task-list|task-list-item)$/.test(name))
    if (classes.length) element.className = classes.join(' ')
    else element.removeAttribute('class')
  }
  for (const input of fragment.querySelectorAll('input')) {
    if (input.type === 'checkbox') {
      input.disabled = true
      input.removeAttribute('value')
    } else input.remove()
  }
  return fragment
}

export function sanitizeMarkdownHtml(html: string, inline = false) {
  const template = document.createElement('template')
  template.content.append(markdownHtmlFragment(html, inline))
  return template.innerHTML
}

export function markdownHtml(text: string) {
  return sanitizeMarkdownHtml(marked.parse(text, { gfm: true, breaks: true, async: false }))
}

export function markdownPlainText(text: string) {
  return new DOMParser().parseFromString(markdownHtml(text), 'text/html').body.textContent ?? ''
}

export function markdownInlineHtml(text: string) {
  return sanitizeMarkdownHtml(marked.parseInline(text, { gfm: true, async: false }), true)
}

export function isInlineHtmlTag(name: string) { return inlineTags.includes(name) }
