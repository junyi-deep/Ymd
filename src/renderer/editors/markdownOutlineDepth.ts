const storageKey = 'ymd:markdown-outline-depth'
export const maxOutlineDepth = 6

function depths(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}') ?? {}
  } catch { return {} }
}

export function getOutlineDepth(path: string) {
  const value = depths()[path]
  return Number.isInteger(value) && value >= 1 && value <= maxOutlineDepth ? value : maxOutlineDepth
}

export function setOutlineDepth(path: string, value: number) {
  try { localStorage.setItem(storageKey, JSON.stringify({ ...depths(), [path]: value })) } catch {}
}

export function outlineDepthPaths() {
  return Object.keys(depths())
}

export function moveOutlineDepth(oldPath: string, newPath?: string) {
  const stored = depths()
  if (!Object.hasOwn(stored, oldPath)) return
  if (newPath) stored[newPath] = stored[oldPath]
  delete stored[oldPath]
  try { localStorage.setItem(storageKey, JSON.stringify(stored)) } catch {}
}
