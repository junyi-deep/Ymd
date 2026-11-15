import { dialog, shell, type BrowserWindow } from 'electron'
import { readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readLocalMapUrl, type MapLocationKind } from '../shared/localMapLinks'

type Location = { canonical: string; kind: MapLocationKind }

function localPath(url?: URL) {
  if (!url) return
  try {
    const absolute = fileURLToPath(url)
    if (path.isAbsolute(absolute)) return path.resolve(absolute)
  } catch {}
}

export class LocalMapLocations {
  private readonly grants: Promise<Map<string, Location>>
  private readonly opening = new Set<string>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly storage: string) {
    this.grants = this.readGrants()
  }

  private async readGrants(): Promise<Map<string, Location>> {
    try {
      const entries: unknown = JSON.parse(await readFile(this.storage, 'utf8'))
      if (Array.isArray(entries)) return new Map(entries.filter(item => Array.isArray(item) && item.length === 2 &&
        typeof item[0] === 'string' && typeof item[1]?.canonical === 'string' &&
        (item[1]?.kind === 'file' || item[1]?.kind === 'folder')))
    } catch {}
    return new Map()
  }

  private remember(selected: string, location: Location) {
    const task = this.writeQueue.catch(() => {}).then(async () => {
      const grants = await this.grants
      const old = grants.get(selected)
      if (old?.canonical === location.canonical && old.kind === location.kind) return
      const entries = new Map(grants).set(selected, location)
      await writeFile(this.storage + '.tmp', JSON.stringify([...entries]), { mode: 0o600, flush: true })
      await rename(this.storage + '.tmp', this.storage)
      grants.set(selected, location)
    })
    this.writeQueue = task
    return task
  }

  private async locate(selected: string): Promise<Location> {
    const canonical = await realpath(selected).catch(() => undefined)
    const info = canonical && await stat(canonical).catch(() => undefined)
    if (!canonical || !info || (!info.isFile() && !info.isDirectory())) {
      throw new Error('找不到链接目标。请在链接设置中重新选择。')
    }
    return { canonical, kind: info.isDirectory() ? 'folder' : 'file' }
  }

  async choose(window: BrowserWindow, kind: MapLocationKind, previous?: string) {
    if (kind !== 'file' && kind !== 'folder') throw new Error('无效的链接类型。')
    const old = localPath(readLocalMapUrl(previous))
    const grants = await this.grants
    const known = old ? grants.get(old) : undefined
    const result = await dialog.showOpenDialog(window, {
      title: kind === 'folder' ? '选择链接文件夹' : '选择链接文件',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      defaultPath: known?.canonical,
    })
    if (result.canceled) return null
    const selected = result.filePaths[0]
    const location = await this.locate(selected)
    if (location.kind !== kind) throw new Error('所选位置与链接类型不符。')
    const canonical = location.canonical
    const url = pathToFileURL(kind === 'folder' && !canonical.endsWith(path.sep) ? canonical + path.sep : canonical)
    if (!readLocalMapUrl(url.href)) throw new Error('所选位置无法保存为本机链接。')
    await this.remember(canonical, location)
    return url.href
  }

  async open(window: BrowserWindow, href: string) {
    const url = readLocalMapUrl(href)
    const selected = localPath(url)
    if (!url || !selected) throw new Error('无效的本机链接。')
    if (this.opening.has(selected)) return
    this.opening.add(selected)
    try {
      const grant = (await this.grants).get(selected)
      if (!grant) {
        const { response } = await dialog.showMessageBox(window, {
          type: 'question', message: '打开链接位置？', detail: selected,
          buttons: ['取消', '打开'], defaultId: 0, cancelId: 0,
        })
        if (response !== 1) return
      }
      const location = await this.locate(selected)
      if (url.pathname.endsWith('/') && location.kind !== 'folder' ||
          grant && (location.canonical !== grant.canonical || location.kind !== grant.kind)) {
        throw new Error('链接目标的位置或类型已变更。请在链接设置中重新选择。')
      }
      if (!grant) await this.remember(selected, location)
      if (await shell.openPath(location.canonical)) throw new Error('系统无法打开链接目标。')
    } finally {
      this.opening.delete(selected)
    }
  }
}
