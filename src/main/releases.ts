import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { installRelease } from './installRelease'
import { UpdateNetwork } from './updateNetwork'
import type { VersionStatus } from '../shared/contracts'

const repositoryUrl = 'https://github.com/junyi-deep/Ymd/releases/'
const releaseFeed = 'https://api.github.com/repos/junyi-deep/Ymd/releases?per_page=20'
const maxInstaller = 500 * 1024 * 1024
type Asset = { name: string; url: string; digest: string; size: number }
type Candidate = { version: string; url: string; asset?: Asset }

function assetFor(tag: string, version: string, values: unknown): Asset | undefined {
  const platform = process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64.dmg'
    : process.platform === 'win32' && process.arch === 'x64' ? 'win-x64.exe' : undefined
  if (!platform || !Array.isArray(values)) return
  const name = 'Ymd-' + version + '-' + platform
  const url = repositoryUrl + 'download/' + encodeURIComponent(tag) + '/' + name
  const asset = values.find(value => value?.name === name && value.state === 'uploaded' && value.browser_download_url === url)
  if (typeof asset?.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest) &&
      Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maxInstaller) {
    return { name, url, digest: asset.digest.slice(7).toLowerCase(), size: asset.size }
  }
}
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function compare(left: RegExpExecArray, right: RegExpExecArray) {
  const difference = [1, 2, 3].map(index => Number(left[index]) - Number(right[index])).find(Boolean)
  if (difference) return difference
  if (!left[4] || !right[4]) return Number(!left[4]) - Number(!right[4])
  const a = left[4].split('.')
  const b = right[4].split('.')
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] === b[index]) continue
    const aNumeric = /^\d+$/.test(a[index])
    const bNumeric = /^\d+$/.test(b[index])
    if (aNumeric && bNumeric) return Number(a[index]) - Number(b[index])
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a[index] < b[index] ? -1 : 1
  }
  return a.length - b.length
}

function newestRelease(current: string, raw: unknown): Candidate | undefined {
  const installed = versionPattern.exec(current)
  if (!installed || !Array.isArray(raw)) return
  const candidates = raw.flatMap(release => {
    const tag = release?.tag_name
    const parsed = typeof tag === 'string' && tag.length <= 100 ? versionPattern.exec(tag) : null
    return parsed && !release.draft && (installed[4] || !release.prerelease && !parsed[4]) && compare(parsed, installed) > 0
      ? [{ tag: String(tag), parsed, assets: release.assets }] : []
  })
  candidates.sort((a, b) => compare(b.parsed, a.parsed))
  const best = candidates[0]
  if (!best) return
  const version = best.tag.replace(/^v/, '')
  return { version, url: repositoryUrl + 'tag/' + encodeURIComponent(best.tag), asset: assetFor(best.tag, version, best.assets) }
}

async function verifies(file: string, asset: Asset) {
  const info = await lstat(file).catch(() => undefined)
  if (!info?.isFile() || info.size !== asset.size) return false
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest('hex') === asset.digest
  } catch { return false }
}

export class Releases {
  readonly network: UpdateNetwork
  private readonly cache: string
  private candidate?: Candidate
  private checking?: Promise<VersionStatus>
  private work?: Promise<void>
  private readonly current = app.getVersion()
  status: VersionStatus = { current: this.current }

  constructor(data: string, private readonly notify: (status: VersionStatus) => void) {
    this.network = new UpdateNetwork(path.join(data, 'update-proxy.json'))
    this.cache = path.join(data, 'updates')
  }

  private progress(progress?: VersionStatus['progress']) {
    this.status = { ...this.status, progress }
    this.notify(this.status)
  }

  async check() {
    if (this.work || this.status.progress?.state === 'installing') return this.status
    if (this.checking) return this.checking
    const check = this.network.read(releaseFeed, 12_000, async response => {
      let size = 0
      const buffers: Buffer[] = []
      for await (const part of response) {
        const bytes = Buffer.from(part)
        size += bytes.length
        if (size > 4 * 1024 * 1024) throw new Error('更新列表过大。')
        buffers.push(bytes)
      }
      return JSON.parse(Buffer.concat(buffers).toString('utf8')) as unknown
    }).then(async raw => {
      const candidate = newestRelease(this.current, raw)
      const update = candidate && { version: candidate.version, url: candidate.url, canDownload: !!candidate.asset }
      const ready = candidate?.asset && await verifies(path.join(this.cache, candidate.asset.name), candidate.asset)
      this.candidate = candidate
      this.status = { current: this.current, update, progress: ready ? { state: 'ready' } : undefined }
      this.notify(this.status)
      return this.status
    })
    this.checking = check
    try { return await check } finally { this.checking = undefined }
  }

  async download() {
    if (this.work) return this.work
    if (this.checking) await this.checking
    if (this.work) return this.work
    if (this.status.progress?.state === 'installing') return
    const asset = this.candidate?.asset
    if (!asset) throw new Error('当前发布没有可校验的安装包。')
    const work = this.downloadAsset(asset)
    this.work = work
    try { await work } finally { this.work = undefined }
  }

  private async downloadAsset(asset: Asset) {
    const target = path.join(this.cache, asset.name)
    const temporary = target + '.' + randomUUID() + '.part'
    try {
      this.progress({ state: 'downloading', received: 0, total: asset.size })
      await mkdir(this.cache, { recursive: true, mode: 0o700 })
      if (!await verifies(target, asset)) {
        await this.network.read(asset.url, 15 * 60_000, async response => {
          const hash = createHash('sha256')
          let received = 0, notified = 0
          const measure = new Transform({
            transform: (chunk: Buffer, _encoding, done) => {
              received += chunk.length
              if (received > asset.size) { done(new Error('下载的安装包大小不符。')); return }
              hash.update(chunk)
              const now = Date.now()
              if (now - notified > 150) {
                notified = now
                this.progress({ state: 'downloading', received, total: asset.size })
              }
              done(null, chunk)
            },
          })
          await pipeline(response, measure, createWriteStream(temporary, { flags: 'wx', mode: 0o700 }))
          if (received !== asset.size || hash.digest('hex') !== asset.digest) throw new Error('安装包校验失败，请重新下载。')
          await rename(temporary, target)
        })
      }
      const old = await readdir(this.cache).catch(() => [])
      await Promise.allSettled(old.filter(name => name !== asset.name && /^Ymd-[\w.-]+-(?:mac-arm64\.dmg|win-x64\.exe)(?:\.[\da-f-]+\.part)?$/i.test(name))
        .map(name => rm(path.join(this.cache, name), { force: true })))
      this.progress({ state: 'ready' })
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      this.progress({ state: 'error', message: error instanceof Error ? error.message : '无法下载更新。' })
    }
  }

  async install() {
    const candidate = this.candidate
    if (!candidate?.asset || this.work || this.checking || this.status.progress?.state !== 'ready') throw new Error('安装包尚未下载完成。')
    this.progress({ state: 'installing' })
    const installer = path.join(this.cache, candidate.asset.name)
    if (!await verifies(installer, candidate.asset)) {
      this.progress({ state: 'error', message: '安装包校验失败，请重新下载。' })
      throw new Error('安装包校验失败，请重新下载。')
    }
    try {
      await installRelease(installer, candidate.version)
    } catch (error) {
      this.progress({ state: 'ready' })
      throw error
    }
  }
}
