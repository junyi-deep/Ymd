import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentFile, Entry, FileKind } from '../shared/contracts'

export const fileKind = (name: string): FileKind | undefined => {
  const extension = path.extname(name).toLowerCase()
  if (extension === '.md') return 'markdown'
  if (extension === '.excalidraw') return 'drawing'
}

const versionOf = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const directoryEntry = (file: string): Entry => ({ path: file, name: path.basename(file) || file, kind: 'directory' })

export class Files {
  private roots = new Set<string>()
  private singles = new Set<string>()
  private writes = new Map<string, Promise<unknown>>()

  async library(userData: string) {
    const directory = path.join(userData, 'Documents')
    await mkdir(directory, { recursive: true })
    return this.authorizeDirectory(directory)
  }

  async authorizeDirectory(directory: string) {
    const canonical = await realpath(directory)
    if (!(await stat(canonical)).isDirectory()) throw new Error('所选路径不是目录。')
    this.roots.add(canonical)
    return directoryEntry(canonical)
  }

  async authorizeFile(file: string) {
    const canonical = await realpath(file)
    if (!fileKind(canonical) || !(await stat(canonical)).isFile()) throw new Error('请打开 Markdown 或 Excalidraw 文件。')
    this.singles.add(canonical)
    return this.read(canonical)
  }

  private async resolve(file: string, directory = false) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('路径无效。')
    const canonical = await realpath(file)
    const withinRoot = [...this.roots].some(root => {
      const relative = path.relative(root, canonical)
      return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep).every(part => !part.startsWith('.')))
    })
    if (!withinRoot && (directory || !this.singles.has(canonical))) throw new Error('请先打开此文件或目录。')
    const info = await lstat(file)
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('文件已移动或类型已变化。')
    if (canonical !== file && await realpath(path.dirname(file)) !== path.dirname(file)) throw new Error('目录路径已变化，请重新打开。')
    return canonical
  }

  async list(directory: string): Promise<Entry[]> {
    const root = await this.resolve(directory, true)
    const entries: Entry[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? fileKind(entry.name) : undefined
      if (kind) entries.push({ kind, path: path.join(root, entry.name), name: entry.name })
    }
    return entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }

  async read(file: string): Promise<DocumentFile> {
    const canonical = await this.resolve(file)
    const kind = fileKind(canonical)
    if (!kind) throw new Error('文件类型不受支持。')
    const data = await readFile(canonical)
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)
    } catch {
      throw new Error('文件不是有效的 UTF-8 文本。')
    }
    return { path: canonical, name: path.basename(canonical), kind, text, version: versionOf(data) }
  }

  async create(directory: string, name: string, kind: FileKind) {
    const root = await this.resolve(directory, true)
    if (kind !== 'markdown' && kind !== 'drawing') throw new Error('文件类型不受支持。')
    if (typeof name !== 'string' || !name.trim() || name.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('请输入有效的文件名。')
    const extension = kind === 'markdown' ? '.md' : '.excalidraw'
    const file = path.join(root, name.toLowerCase().endsWith(extension) ? name : name + extension)
    const contents = kind === 'markdown' ? '' : JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)
    try {
      await writeFile(file, contents, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('该名称已存在，请换一个文件名。')
      throw error
    }
    return this.read(file)
  }

  save(file: string, text: string, version: string) {
    const queue = this.writes.get(file)
    const write = async () => {
      if (!fileKind(file)) throw new Error('文件类型不受支持。')
      let canonical: string
      try {
        canonical = await this.resolve(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { conflict: true } as const
        throw error
      }
      const dir = path.dirname(canonical)
      const data = Buffer.from(text)
      const temp = path.join(dir, '.ymd-' + randomUUID())
      try {
        const check = async () => {
          try {
            return versionOf(await readFile(canonical)) === version
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
            throw error
          }
        }
        if (!await check()) return { conflict: true } as const
        const mode = (await stat(canonical)).mode & 0o777
        await writeFile(temp, data, { flag: 'wx', mode, flush: true })
        if (!await check() || await this.resolve(file) !== canonical) return { conflict: true } as const
        await rename(temp, canonical)
        return { version: versionOf(data) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { conflict: true } as const
        throw error
      } finally {
        await rm(temp, { force: true })
      }
    }
    const pending = (queue ?? Promise.resolve()).catch(() => {}).then(write)
    this.writes.set(file, pending)
    return pending.finally(() => {
      if (this.writes.get(file) === pending) this.writes.delete(file)
    })
  }
}
