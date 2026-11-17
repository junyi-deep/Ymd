import { useRef, useState } from 'react'
import { documentMode, rememberDocumentMode } from './documentModes'
import type { DocumentFile, EditorMode, RecoveryDraft, Scope } from '../shared/contracts'

export interface Session extends DocumentFile {
  saved: string
  scope: Scope
  mode: EditorMode
  reload: number
  opened: number
  conflict?: boolean
  disk?: DocumentFile | null
}

export function useDocuments() {
  const [documents, setDocuments] = useState<Session[]>([])
  const [active, setActive] = useState<string>()
  const latest = useRef(documents)
  const saving = useRef(new Map<string, Promise<boolean>>())
  const refreshes = useRef(new Map<string, symbol>())

  function update(transform: (sessions: Session[]) => Session[]) {
    latest.current = transform(latest.current)
    setDocuments(latest.current)
  }

  function journal(file: string, draft: RecoveryDraft | null) {
    return window.desktop.recordDraft(file, draft)
  }

  function patch(path: string, changes: Partial<Session>) {
    update(sessions => sessions.map(document => {
      if (document.path !== path) return document
      const next = { ...document, ...changes }
      if (document.text !== next.text || document.version !== next.version || document.saved !== next.saved) {
        const dirty = next.text !== next.saved
        if (dirty || document.text !== document.saved) {
          void journal(next.path, dirty ? { text: next.text, version: next.version } : null).catch(() => {})
        }
      }
      return next
    }))
  }

  function open(file: DocumentFile, scope: Scope, fallback: EditorMode = scope === 'journal' ? 'outline' : 'markdown') {
    const opened = Date.now()
    const remembered = documentMode(file.path)
    const stored = scope === 'journal' && remembered === 'map' ? 'outline' : remembered
    if (!latest.current.some(session => session.path === file.path)) {
      update(sessions => [...sessions, { ...file, saved: file.text, scope, mode: stored ?? fallback, reload: 0, opened }])
    } else {
      patch(file.path, { opened, scope, ...(stored ? { mode: stored } : {}) })
    }
    setActive(file.path)
  }

  function setMode(path: string, mode: EditorMode) {
    rememberDocumentMode(path, mode)
    patch(path, { mode })
  }

  function applyDisk(session: Session, file: DocumentFile) {
    patch(session.path, { ...file, saved: file.text, reload: session.reload + 1, conflict: false, disk: undefined })
  }

  async function refresh(path: string, beforeReplace?: () => void) {
    const token = Symbol()
    refreshes.current.set(path, token)
    try {
      const pending = saving.current.get(path)
      if (pending) await pending.catch(() => {})
      const before = latest.current.find(document => document.path === path)
      if (!before || refreshes.current.get(path) !== token) return
      const disk = await window.desktop.readDocumentState(path)
      let current = latest.current.find(document => document.path === path)
      if (!current || current.version !== before.version || current.reload !== before.reload ||
          saving.current.has(path) || refreshes.current.get(path) !== token) return
      if (disk?.version === current.version) {
        if (current.conflict) patch(path, { conflict: false, disk: undefined })
        return
      }
      if (current.conflict && current.disk?.version === disk?.version && (current.disk === null) === (disk === null)) return
      beforeReplace?.()
      current = latest.current.find(document => document.path === path)
      if (!current) return
      if (disk && (current.text === current.saved || current.text === disk.text)) applyDisk(current, disk)
      else patch(path, { conflict: true, disk })
    } finally {
      if (refreshes.current.get(path) === token) refreshes.current.delete(path)
    }
  }

  function save(path: string, overwrite?: { version: string | null }): Promise<boolean> {
    const inFlight = saving.current.get(path)
    if (inFlight) return overwrite ? inFlight.then(() => save(path, overwrite)) : inFlight.then(ok => ok && save(path))
    const session = latest.current.find(document => document.path === path)
    if (!session || !overwrite && session.text === session.saved) return Promise.resolve(true)
    if (!overwrite && session.conflict) return Promise.resolve(false)
    const pending = (async () => {
      try {
        const result = await window.desktop.save(path, session.text, overwrite ? overwrite.version : session.version)
        if ('conflict' in result) {
          const disk = await window.desktop.readDocumentState(path).catch(() => undefined)
          patch(path, { conflict: true, disk })
          return false
        }
        patch(path, { saved: session.text, version: result.version, modified: result.modified, conflict: false, disk: undefined })
        return true
      } finally {
        saving.current.delete(path)
      }
    })()
    saving.current.set(path, pending)
    return pending
  }

  async function reload(path: string) {
    const disk = await window.desktop.readDocumentState(path)
    const session = latest.current.find(document => document.path === path)
    if (!disk || !session) return false
    applyDisk(session, disk)
    return true
  }

  async function restore(file: DocumentFile, draft: RecoveryDraft, missing: boolean, scope: Scope) {
    open(file, scope)
    if (!missing && file.text === draft.text) return
    const disk = missing ? null : file
    const conflict = missing || file.version !== draft.version
    const current = latest.current.find(document => document.path === file.path)!
    update(sessions => sessions.map(document => document.path === file.path ? {
      ...document, ...file, version: conflict ? draft.version : file.version, saved: file.text, text: draft.text, reload: current.reload + 1,
      conflict, disk: conflict ? disk : undefined,
    } : document))
  }

  function close(path: string) {
    refreshes.current.delete(path)
    void journal(path, null).catch(() => {})
    update(sessions => sessions.filter(session => session.path !== path))
    setActive(current => current === path ? latest.current.at(-1)?.path : current)
  }

  function relocate(path: string, target: string, name: string, scope: Scope) {
    void journal(path, null).catch(() => {})
    patch(path, { path: target, name, scope })
    setActive(current => current === path ? target : current)
  }

  return { documents, active: documents.find(document => document.path === active), open, patch, setMode, save, refresh, reload, restore, close, relocate, latest, journal,
    hasPending: (path?: string) => path ? saving.current.has(path) : saving.current.size > 0,
    waitForPending: (path?: string) => Promise.allSettled(path ? [saving.current.get(path)] : [...saving.current.values()]),
    showHome: () => setActive(undefined) }
}
