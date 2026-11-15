import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, link, open, unlink, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { markdownImageExtension, markdownImageExtensions, markdownImageLimits } from '../shared/contracts'
import type { DocumentFile, Entry, FileKind, MarkdownImageAttachment, MarkdownImageUpload } from '../shared/contracts'

function checkImageSizes(sizes: number[]) {
  if (sizes.some(size => size <= 0 || size > markdownImageLimits.fileBytes)) throw new Error('单张图片必须小于或等于 15 MB。')
  if (sizes.reduce((total, size) => total + size, 0) > markdownImageLimits.batchBytes) throw new Error('一次最多导入 60 MB 的图片。')
}

function checkImageCount(images: unknown[]) {
  if (!Array.isArray(images) || images.length > markdownImageLimits.count) throw new Error('一次最多导入 20 张图片。')
}

function matchesImageFormat(data: Buffer, type: string) {
  switch (type) {
    case 'image/png': return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'image/jpeg': return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    case 'image/gif': return /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))
    case 'image/webp': return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    case 'image/bmp': return data.toString('ascii', 0, 2) === 'BM'
    case 'image/avif': {
      if (data.length < 16 || data.toString('ascii', 4, 8) !== 'ftyp') return false
      const end = Math.min(data.readUInt32BE(0), data.length, 128)
      for (let position = 8; position + 4 <= end; position += 4) {
        if (position !== 12 && /^avi[fs]$/.test(data.toString('ascii', position, position + 4))) return true
      }
      return false
    }
    default: return false
  }
}

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

  async createImportedMarkdown(directory: string, name: string, text: string) {
    if (typeof name !== 'string' || typeof text !== 'string' || text.length > 4 * 1024 * 1024) {
      throw new Error('导入的 Markdown 文档无效或过大。')
    }
    const root = await this.resolve(directory, true)
    const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/^\.+/, '').slice(0, 80).replace(/[. ]+$/, '')
    const label = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? '_' + cleaned : cleaned
    return this.writeNew(root, label || '导入的思维导图', '.md', text)
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

  async importImageFiles(file: string, images: string[]) {
    checkImageCount(images)
    const sizes = await Promise.all(images.map(async image => {
      if (!markdownImageExtension(image)) throw new Error('请选择受支持的图片。')
      const info = await stat(image)
      if (!info.isFile()) throw new Error('请选择图片文件。')
      return info.size
    }))
    checkImageSizes(sizes)
    const input = await Promise.all(images.map(async image => ({ name: path.basename(image), type: '', data: await readFile(image) })))
    return this.storeImages(file, input)
  }

  async importImageBytes(file: string, images: MarkdownImageUpload[]) {
    checkImageCount(images)
    if (images.some(image => !image || typeof image.name !== 'string' || image.name.length > 1024 ||
        typeof image.type !== 'string' || image.type.length > 80 || !(image.data instanceof ArrayBuffer))) {
      throw new Error('图片数据无效。')
    }
    return this.storeImages(file, images.map(image => ({ ...image, data: Buffer.from(image.data) })))
  }

  private async storeImages(file: string, images: { name: string; type: string; data: Buffer }[]): Promise<MarkdownImageAttachment[]> {
    const original = await this.authorizedFile(file)
    if (fileKind(original) !== 'markdown') throw new Error('请先打开 Markdown 文件。')
    if (!images.length) return []
    checkImageSizes(images.map(image => image.data.length))
    const valid = images.map(image => {
      const extension = markdownImageExtension(image.name, image.type)
      if (!extension || !matchesImageFormat(image.data, markdownImageExtensions[extension])) {
        throw new Error('无法读取图片，或图片格式与扩展名不一致。')
      }
      return { ...image, extension }
    })
    const directory = path.join(path.dirname(original), 'assets')
    await mkdir(directory, { recursive: true })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('附件目录无效。')
    const paths: string[] = []
    const attachments: MarkdownImageAttachment[] = []
    try {
      for (const { name, data, extension } of valid) {
        const basename = randomUUID() + '.' + extension
        const target = path.join(directory, basename)
        const handle = await open(target, 'wx')
        paths.push(target)
        try {
          await handle.writeFile(data)
          await handle.sync()
        } finally {
          await handle.close()
        }
        const label = path.parse(name).name.slice(0, 140).trim()
        attachments.push({ label: label || '图像', source: 'assets/' + basename })
      }
      return attachments
    } catch (error) {
      await Promise.allSettled(paths.map(target => unlink(target)))
      throw error
    }
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
    const extension = markdownImageExtension(canonical)
    const mime = extension && markdownImageExtensions[extension]
    const info = mime && await stat(canonical).catch(() => null)
    if (!info || !info.isFile() || info.size > markdownImageLimits.fileBytes) return null
    const data = await readFile(canonical)
    return data.length <= markdownImageLimits.fileBytes ? `data:${mime};base64,${data.toString('base64')}` : null
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
    return this.relocate(original, path.join(target, path.basename(original)), version)
  }

  async renameDocument(file: string, name: string, version: string) {
    const original = await this.authorizedFile(file)
    if (typeof name !== 'string') throw new Error('文件名无效。')
    const title = name.trim()
    if (!title || title.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(title) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) throw new Error('请输入有效的文件名。')
    const extension = path.extname(original)
    const target = title.toLowerCase().endsWith(extension.toLowerCase()) ? title : title + extension
    return this.relocate(original, path.join(path.dirname(original), target), version)
  }

  private async relocate(original: string, destination: string, version: string) {
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
