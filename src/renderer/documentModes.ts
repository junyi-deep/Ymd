import type { EditorMode } from '../shared/contracts'

const storageKey = 'ymd:document-modes'

function modes(): Record<string, EditorMode> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved
  } catch {}
  return {}
}

export const documentModePaths = () => Object.keys(modes())

export function documentMode(path: string) {
  const mode = modes()[path]
  return mode === 'markdown' || mode === 'outline' || mode === 'map' ? mode : undefined
}

export function rememberDocumentMode(path: string, mode: EditorMode) {
  const saved = modes()
  if (saved[path] !== mode) write({ ...saved, [path]: mode })
}

export function moveDocumentMode(path: string, next?: string) {
  const saved = modes()
  if (!Object.hasOwn(saved, path)) return
  if (next) saved[next] = saved[path]
  delete saved[path]
  write(saved)
}

function write(saved: Record<string, EditorMode>) {
  try { localStorage.setItem(storageKey, JSON.stringify(saved)) } catch {}
}
