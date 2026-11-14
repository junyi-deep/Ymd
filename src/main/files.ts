import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, link, unlink, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentFile, Entry, FileKind } from '../shared/contracts'

const imageMime: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
}
const maxImageBytes = 15 * 1024 * 1024


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

  retainRoots(entries: Entry[]) {
    this.roots = new Set(entries.map(entry => entry.path))
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

  async read(file: string, keepAccess = false): Promise<DocumentFile> {
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
    if (keepAccess) this.singles.add(canonical)
    return { path: canonical, name: path.basename(canonical), kind, text, version: versionOf(data), modified: (await stat(canonical)).mtimeMs }
  }

  async create(directory: string, kind: FileKind) {
    const root = await this.resolve(directory, true)
    if (kind !== 'markdown' && kind !== 'drawing') throw new Error('文件类型不受支持。')
    const extension = kind === 'markdown' ? '.md' : '.excalidraw'
    const label = kind === 'markdown' ? '未命名' : '未命名绘图'
    const contents = kind === 'markdown' ? '' : JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)
    return this.writeNew(root, label, extension, contents)
  }

  private async writeNew(directory: string, label: string, extension: string, text: string) {
    for (let count = 1; ; count++) {
      const file = path.join(directory, label + (count === 1 ? '' : ` ${count}`) + extension)
      try {
        await writeFile(file, text, { flag: 'wx', flush: true })
        return this.read(file, true)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }

  async importImage(file: string, image: string) {
    const original = await this.authorizedFile(file)
    const extension = path.extname(image).toLowerCase()
    if (!imageMime[extension]) throw new Error('请选择受支持的图片。')
    const imageInfo = await stat(image)
    if (!imageInfo.isFile() || imageInfo.size > maxImageBytes) throw new Error('图片超过 15 MB 或类型无效。')
    const data = await readFile(image)
    if (data.length > maxImageBytes) throw new Error('图片超过 15 MB。')
    const directory = path.join(path.dirname(original), 'assets')
    await mkdir(directory, { recursive: true })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('附件目录无效。')
    const name = randomUUID() + extension
    await writeFile(path.join(directory, name), data, { flag: 'wx', flush: true })
    return 'assets/' + name
  }

  async readImage(file: string, source: string) {
    const parent = path.dirname(await this.authorizedFile(file))
    if (!source || source.length > 2048 || /[:\\\x00]/.test(source) || path.isAbsolute(source)) return null
    const decoded = decodeURIComponent(source)
    if (/[:\\\x00]/.test(decoded) || path.isAbsolute(decoded)) return null
    const target = path.resolve(parent, decoded)
    const canonical = await realpath(target).catch(() => null)
    if (!canonical) return null
    const relative = path.relative(parent, canonical)
    const underParent = relative && !path.isAbsolute(relative) && relative.split(path.sep).every(part => !part.startsWith('.'))
    if (!underParent) {
      const authorized = await this.resolve(canonical).catch(() => null)
      if (!authorized) return null
    }
    const mime = imageMime[path.extname(canonical).toLowerCase()]
    const info = mime && await stat(canonical).catch(() => null)
    if (!info || !info.isFile() || info.size > maxImageBytes) return null
    const data = await readFile(canonical)
    return data.length <= maxImageBytes ? `data:${mime};base64,${data.toString('base64')}` : null
  }

  async duplicate(file: string, directory: string, text: string) {
    const original = await this.resolve(file)
    const target = await this.resolve(directory, true)
    const extension = path.extname(original)
    return this.writeNew(target, path.basename(original, extension) + ' 副本', extension, text)
  }

  async move(file: string, directory: string, version: string) {
    const original = await this.resolve(file)
    const target = await this.resolve(directory, true)
    const destination = path.join(target, path.basename(original))
    if (original === destination) return this.read(original, true)
    if (versionOf(await readFile(original)) !== version) throw new Error('磁盘上的文件已变化，请重新载入后移动。')
    try {
      await link(original, destination)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw new Error('目标目录中已有同名文件。')
      if (code === 'EXDEV' || code === 'ENOTSUP') throw new Error('该目录位于其他磁盘或卷，无法直接移动。')
      throw error
    }
    try {
      await unlink(original)
    } catch (error) {
      await unlink(destination).catch(() => {})
      throw error
    }
    this.singles.delete(original)
    return this.read(destination, true)
  }

  async authorizedFile(file: string) {
    const canonical = await this.resolve(file)
    if (!fileKind(canonical)) throw new Error('文件类型不受支持。')
    return canonical
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
        return {
          version: versionOf(data),
          modified: await stat(canonical).then(info => info.mtimeMs, () => Date.now()),
        }
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
