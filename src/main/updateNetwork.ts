import { net, safeStorage, session, type IncomingMessage } from 'electron'
import type { Readable } from 'node:stream'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { UpdateProxy, UpdateProxyInput } from '../shared/contracts'
import { defaultUpdateProxy } from '../shared/contracts'

type ProxySettings = Omit<UpdateProxy, 'hasPassword'> & { encrypted?: string }

function proxyUrl(value: string) {
  const address = value.trim()
  if (!address || address.length > 400 || /[\\\r\n\t ,;]/.test(address)) throw new Error('请输入 HTTP 代理地址，例如 proxy.example.com:8080。')
  let url: URL
  try { url = new URL(address.includes('://') ? address : 'http://' + address) }
  catch { throw new Error('HTTP 代理地址无效。') }
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请输入 HTTP 主机和端口，用户名和密码请填写在对应的输入框。')
  }
  return url
}

const releaseHosts = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

function trustedUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && releaseHosts.has(url.hostname)
  } catch { return false }
}

export class UpdateNetwork {
  private readonly connection = session.fromPartition('ymd-update', { cache: false })
  private proxy: ProxySettings = { ...defaultUpdateProxy }
  private configured = false
  private users = 0
  private saving = false

  constructor(private readonly file: string) {}

  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as ProxySettings
      if (value.mode === 'direct') this.proxy = { mode: 'direct', address: '', username: '' }
      if (value.mode === 'http') this.proxy = {
        mode: 'http', address: proxyUrl(value.address).origin,
        username: typeof value.username === 'string' ? value.username.slice(0, 256) : '',
        encrypted: typeof value.encrypted === 'string' ? value.encrypted.slice(0, 12000) : undefined,
      }
    } catch {}
    return this.publicProxy()
  }

  publicProxy(): UpdateProxy {
    const { encrypted, ...proxy } = this.proxy
    return { ...proxy, hasPassword: !!encrypted }
  }

  async save(value: UpdateProxyInput) {
    if (this.users || this.saving) throw new Error('请等本次更新请求完成再更改代理。')
    if (!value || !['system', 'direct', 'http'].includes(value.mode)) throw new Error('代理模式无效。')
    this.saving = true
    try {
      let next: ProxySettings = { mode: value.mode, address: '', username: '' }
      if (value.mode === 'http') {
        if (typeof value.address !== 'string' || typeof value.username !== 'string' ||
            value.username.length > 256 || /[\r\n\u0000]/.test(value.username) ||
            (value.password !== undefined && (typeof value.password !== 'string' || value.password.length > 2048))) throw new Error('代理凭据格式无效。')
        const address = proxyUrl(value.address).origin
        const username = value.username.trim()
        let encrypted = address === this.proxy.address && username === this.proxy.username ? this.proxy.encrypted : undefined
        if (value.password !== undefined) {
          if (value.password && !await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统凭据存储目前不可用。')
          encrypted = value.password ? (await safeStorage.encryptStringAsync(value.password)).toString('base64') : undefined
        }
        next = { mode: 'http', address, username, encrypted }
      }
      await writeFile(this.file + '.tmp', JSON.stringify(next), { mode: 0o600, flush: true })
      await rename(this.file + '.tmp', this.file)
      this.proxy = next
      this.configured = false
      return this.publicProxy()
    } finally { this.saving = false }
  }

  async read<T>(url: string, timeout: number, consume: (response: IncomingMessage & Readable) => Promise<T>) {
    if (!trustedUrl(url)) throw new Error('更新请求地址无效。')
    if (this.saving) throw new Error('正在保存更新代理。')
    this.users++
    try {
      const proxy = this.proxy.mode === 'http' ? proxyUrl(this.proxy.address) : undefined
      if (!this.configured) {
        await this.connection.setProxy(proxy ? { mode: 'fixed_servers', proxyRules: proxy.origin } :
          { mode: this.proxy.mode === 'direct' ? 'direct' : 'system' })
        await this.connection.closeAllConnections()
        await this.connection.clearAuthCache()
        this.configured = true
      }
      return await new Promise<T>((resolve, reject) => {
        const request = net.request({ url, session: this.connection, redirect: 'manual' })
        const timer = setTimeout(() => fail(new Error('更新请求超时。')), timeout)
        const fail = (error: Error) => {
          clearTimeout(timer)
          reject(error)
          request.abort()
        }
        let loginAttempted = false
        request.setHeader('Accept', url.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/octet-stream')
        request.on('login', async (info, reply) => {
          const compatible = proxy && info.isProxy && info.host.toLowerCase().replace(/^\[|\]$/g, '') === proxy.hostname.toLowerCase().replace(/^\[|\]$/g, '') &&
            info.port === Number(proxy.port || '80')
          if (!compatible || loginAttempted || (!this.proxy.username && !this.proxy.encrypted)) {
            fail(new Error(info.isProxy ? '代理需要有效的用户名和密码。' : '更新服务器要求额外身份验证。'))
            return
          }
          loginAttempted = true
          try {
            const password = this.proxy.encrypted ? (await safeStorage.decryptStringAsync(Buffer.from(this.proxy.encrypted, 'base64'))).result : ''
            reply(this.proxy.username, password)
          } catch { fail(new Error('无法读取已保存的代理密码，请重新输入。')) }
        })
        request.on('redirect', (_status, _method, next) => {
          if (trustedUrl(next)) request.followRedirect()
          else fail(new Error('更新服务器返回了无效的重定向。'))
        })
        request.on('error', () => fail(new Error('无法连接更新服务器，请检查网络或代理设置。')))
        request.once('response', response => {
          response.on('error', () => fail(new Error('更新连接中断。')))
          if (response.statusCode !== 200) {
            fail(new Error(response.statusCode === 407 ? '代理身份验证失败。' : '更新服务器返回 HTTP ' + response.statusCode + '。'))
            return
          }
          void consume(response as IncomingMessage & Readable).then(value => { clearTimeout(timer); resolve(value) }, error => fail(error))
        })
        request.end()
      })
    } finally { this.users-- }
  }
}
