import { readdir, writeFile, lstat, realpath, open } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { JournalDay } from '../shared/contracts'

export function journalDate(day = new Date()) {
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-')
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(value + 'T12:00:00.000Z')
  return Number.isFinite(day.getTime()) && day.toISOString().startsWith(value + 'T')
}

const previewLimit = 4096
const emptyLine = /^[ \t]*(?:[-+*][ \t]*)?$/

export class Journals {
  constructor(readonly root: string) {}

  file(date: string) {
    if (!validDate(date)) throw new Error('日志日期无效。')
    return path.join(this.root, date + '.md')
  }

  date(file: string) {
    if (path.relative(this.root, path.dirname(file)) || path.extname(file) !== '.md') return
    const date = path.basename(file, '.md')
    return validDate(date) ? date : undefined
  }

  async ensureToday(today: string) {
    if (await realpath(this.root) !== this.root) throw new Error('日志目录已移动。')
    await writeFile(this.file(today), '', { flag: 'wx', mode: 0o600 }).catch(error => {
      if (error.code !== 'EEXIST') throw error
    })
  }

  async list(): Promise<JournalDay[]> {
    if (await realpath(this.root) !== this.root) throw new Error('日志目录已移动。')
    return (await readdir(this.root, { withFileTypes: true }))
      .flatMap(entry => {
        if (!entry.isFile() || !entry.name.endsWith('.md')) return []
        const date = entry.name.slice(0, -3)
        return validDate(date) ? [{ date, path: this.file(date) }] : []
      }).sort((left, right) => right.date.localeCompare(left.date))
  }

  async preview(date: string) {
    const file = await this.checkedFile(date)
    if (!file) return null
    const data = await this.readPrefix(file, previewLimit)
    if (!data) return null
    return { text: data.text, truncated: data.size > previewLimit }
  }

  async clean(cutoff: string, protectedFile: (file: string) => boolean, trash: (file: string) => Promise<void>) {
    const removed: string[] = []
    let failed = 0
    for (const day of await this.list()) {
      if (day.date >= cutoff || protectedFile(day.path)) continue
      try {
        const file = await this.checkedFile(day.date)
        if (!file) continue
        const blank = await this.emptyFile(file)
        if (!blank) continue
        const current = await lstat(file)
        if (current.isFile() && current.ino === blank.ino && current.size === blank.size && current.mtimeMs === blank.mtimeMs &&
            current.ctimeMs === blank.ctimeMs && !protectedFile(file)) {
          await trash(file)
          removed.push(file)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++
      }
    }
    return { removed, failed }
  }

  private async checkedFile(date: string) {
    const file = this.file(date)
    try {
      return (await lstat(file)).isFile() && await realpath(file) === file ? file : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async emptyFile(file: string) {
    const handle = await open(file, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile()) return
      const stream = handle.createReadStream({ encoding: 'utf8', autoClose: false })
      const lines = createInterface({ input: stream, crlfDelay: Infinity })
      try {
        let first = true
        for await (const line of lines) {
          if (!emptyLine.test(first ? line.replace(/^\uFEFF/, '') : line)) return
          first = false
        }
        if (stream.bytesRead === info.size) return info
      } finally { lines.close(); stream.destroy() }
    } finally { await handle.close() }
  }

  private async readPrefix(file: string, limit: number) {
    const handle = await open(file, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile()) return
      const buffer = Buffer.alloc(limit)
      const { bytesRead } = await handle.read(buffer, 0, limit, 0)
      const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
      return { text: decoder.decode(buffer.subarray(0, bytesRead), { stream: info.size > bytesRead }), size: info.size }
    } finally { await handle.close() }
  }
}
