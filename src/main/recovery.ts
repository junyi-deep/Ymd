import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RecoveryDraft, RecoveryEntry } from '../shared/contracts'
import { fileKind } from './files'

type Snapshot = RecoveryDraft & RecoveryEntry
type Pending = { latest: Snapshot | null; timer?: NodeJS.Timeout; writing?: Promise<void> }

export class Recovery {
  private readonly run = randomUUID()
  private readonly pending = new Map<string, Pending>()
  private readonly stale = new Map<string, Snapshot>()

  constructor(private readonly directory: string) {}

  async load() {
    let files: string[]
    try { files = await readdir(this.directory) } catch { return }
    for (const name of files.filter(name => /^[a-f\d]{64}\.json$/.test(name))) {
      try {
        const data = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as Snapshot
        if (data.id === name.slice(0, -5) && path.isAbsolute(data.path) && fileKind(data.path) &&
            typeof data.text === 'string' && typeof data.version === 'string' && Number.isFinite(data.updated)) this.stale.set(data.id, data)
      } catch {}
    }
  }

  list(): RecoveryEntry[] {
    return [...this.stale.values()].sort((a, b) => b.updated - a.updated)
      .map(({ id, path, updated }) => ({ id, path, updated }))
  }

  get(id: string) { return this.stale.get(id) }

  async discard(id: string) {
    if (!this.stale.has(id)) return
    await rm(path.join(this.directory, id + '.json'), { force: true })
    this.stale.delete(id)
  }

  private set(owner: number, file: string, draft: RecoveryDraft | null) {
    const id = createHash('sha256').update(this.run + ':' + owner + ':' + file).digest('hex')
    let entry = this.pending.get(id)
    if (!entry) this.pending.set(id, entry = { latest: null })
    entry.latest = draft && { ...draft, id, path: file, updated: Date.now() }
    return { id, entry }
  }

  schedule(owner: number, file: string, draft: RecoveryDraft | null) {
    const { id, entry } = this.set(owner, file, draft)
    if (entry.timer) return
    entry.timer = setTimeout(() => { void this.write(id, entry).catch(() => {}) }, 225)
  }

  preserve(owner: number, file: string, draft: RecoveryDraft) {
    const { id, entry } = this.set(owner, file, draft)
    return this.write(id, entry)
  }

  async wait() {
    await Promise.allSettled([...this.pending].map(([id, entry]) => this.write(id, entry)))
  }

  private write(id: string, entry: Pending) {
    clearTimeout(entry.timer)
    entry.timer = undefined
    const data = entry.latest
    const file = path.join(this.directory, id + '.json')
    const previous = entry.writing
    const next = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!data) { await rm(file, { force: true }); return }
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temp = file + '.tmp'
      try {
        await writeFile(temp, JSON.stringify(data), { mode: 0o600, flush: true })
        await rename(temp, file)
      } finally { await rm(temp, { force: true }).catch(() => {}) }
    })
    entry.writing = next
    return next.finally(() => {
      if (entry.writing === next) {
        entry.writing = undefined
        if (entry.latest === data && !entry.timer) this.pending.delete(id)
      }
    })
  }
}
