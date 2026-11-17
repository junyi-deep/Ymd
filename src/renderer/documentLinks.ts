export function documentLinkPath(href: string, document: string, platform: string) {
  const win = platform === 'win32'
  const base = document.replaceAll('\\', '/').split('/').map((part, index) =>
    win && index === 0 && /^[A-Z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')
  const url = new URL(href, 'file://' + (win && !base.startsWith('/') ? '/' : '') + base)
  if (url.protocol !== 'file:' || url.host) return
  const target = decodeURIComponent(url.pathname)
  if (!/\.(md|excalidraw)$/i.test(target) || target.includes('\0')) return
  return win ? target.replace(/^\/(?=[A-Z]:)/i, '').replaceAll('/', '\\') : target
}
