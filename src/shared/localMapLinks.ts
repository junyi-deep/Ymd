export type MapLocationKind = 'file' | 'folder'

export function readLocalMapUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 32768 || !/^file:\/\//i.test(value)) return
  try {
    const url = new URL(value)
    if (url.protocol === 'file:' && !url.hostname && !url.username && !url.password && !url.search && !url.hash &&
        url.pathname.startsWith('/') && !/[\x00-\x1f\x7f]/.test(decodeURIComponent(url.pathname))) return url
  } catch {}
}
