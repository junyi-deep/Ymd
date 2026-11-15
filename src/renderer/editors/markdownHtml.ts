import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function sanitizeMarkdownHtml(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'style', 'iframe', 'img', 'video', 'audio', 'picture', 'source', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'autofocus'],
  })
}

export function markdownHtml(text: string) {
  return sanitizeMarkdownHtml(marked.parse(text, { gfm: true, breaks: true, async: false }))
}

export function markdownPlainText(text: string) {
  return new DOMParser().parseFromString(markdownHtml(text), 'text/html').body.textContent ?? ''
}

export function markdownInlineHtml(text: string) {
  return DOMPurify.sanitize(marked.parseInline(text, { gfm: true, async: false }), {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 's', 'del', 'code', 'mark', 'u', 'br'],
    ALLOWED_ATTR: [],
  })
}
