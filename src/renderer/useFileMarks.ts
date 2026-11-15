import { useState } from 'react'

interface Marks { pinned: string[]; starred: string[] }
const key = 'ymd.file-marks'

function load(): Marks {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (Array.isArray(value?.pinned) && Array.isArray(value?.starred)) return value
  } catch {}
  return { pinned: [], starred: [] }
}

export function useFileMarks() {
  const [marks, setMarks] = useState(load)
  function update(change: (marks: Marks) => Marks) {
    setMarks(current => {
      const next = change(current)
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }
  return {
    ...marks,
    toggle(type: keyof Marks, path: string) {
      update(current => ({ ...current, [type]: current[type].includes(path)
        ? current[type].filter(item => item !== path) : [...current[type], path] }))
    },
    remap(paths: ReadonlyMap<string, string | undefined>) {
      const replace = (values: string[]) => [...new Set(values.flatMap(path => paths.has(path) ? [paths.get(path)].filter((value): value is string => !!value) : [path]))]
      update(current => ({ pinned: replace(current.pinned), starred: replace(current.starred) }))
    },
    relocate(oldPath: string, newPath?: string) {
      const replace = (paths: string[]) => [...new Set(paths.flatMap(path => path === oldPath ? (newPath ? [newPath] : []) : [path]))]
      update(current => ({ pinned: replace(current.pinned), starred: replace(current.starred) }))
    },
  }
}
