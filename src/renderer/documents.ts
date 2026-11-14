import { useRef, useState } from 'react'
import type { DocumentFile, EditorMode, Scope } from '../shared/contracts'

export interface Session extends DocumentFile {
  saved: string
  scope: Scope
  mode: EditorMode
  reload: number
  conflict?: boolean
}

export function useDocuments() {
  const [documents, setDocuments] = useState<Session[]>([])
  const [active, setActive] = useState<string>()
  const latest = useRef(documents)
  const saving = useRef(new Map<string, Promise<boolean>>())

  function update(transform: (sessions: Session[]) => Session[]) {
    latest.current = transform(latest.current)
    setDocuments(latest.current)
  }

  function patch(path: string, changes: Partial<Session>) {
    update(sessions => sessions.map(document => document.path === path ? { ...document, ...changes } : document))
  }

  function open(file: DocumentFile, scope: Scope) {
    if (!latest.current.some(session => session.path === file.path)) {
      update(sessions => [...sessions, { ...file, saved: file.text, scope, mode: 'markdown', reload: 0 }])
    }
    setActive(file.path)
  }

  function save(path: string): Promise<boolean> {
    if (saving.current.has(path)) return saving.current.get(path)!.then(ok => ok && save(path))
    const session = latest.current.find(document => document.path === path)
    if (!session || session.text === session.saved) return Promise.resolve(true)
    const pending = (async () => {
      try {
        const result = await window.desktop.save(path, session.text, session.version)
        if ('conflict' in result) {
          patch(path, { conflict: true })
          return false
        }
        patch(path, { saved: session.text, version: result.version, conflict: false })
        return true
      } finally {
        saving.current.delete(path)
      }
    })()
    saving.current.set(path, pending)
    return pending
  }

  async function reload(session: Session) {
    const file = await window.desktop.read(session.path)
    patch(file.path, { ...file, saved: file.text, reload: session.reload + 1, conflict: false })
  }

  function close(path: string) {
    update(sessions => sessions.filter(session => session.path !== path))
    setActive(current => current === path ? latest.current.at(-1)?.path : current)
  }

  return { documents, active: documents.find(document => document.path === active), open, patch, save, reload, close, latest,
    hasPending: (path?: string) => path ? saving.current.has(path) : saving.current.size > 0,
    waitForPending: (path?: string) => Promise.allSettled(path ? [saving.current.get(path)] : [...saving.current.values()]),
    showHome: () => setActive(undefined) }
}
