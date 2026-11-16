import { useState } from 'react'
import type { UpdateProxy, UpdateProxyInput, UpdateProxyMode } from '../shared/contracts'

export function UpdateProxySettings({ proxy, save, disabled }: {
  proxy: UpdateProxy; save: (input: UpdateProxyInput) => Promise<UpdateProxy>; disabled: boolean
}) {
  const [mode, setMode] = useState(proxy.mode)
  const [address, setAddress] = useState(proxy.address)
  const [username, setUsername] = useState(proxy.username)
  const [password, setPassword] = useState('')
  const [clear, setClear] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const canKeep = proxy.hasPassword && mode === 'http' && username.trim() === proxy.username
  const changed = mode !== proxy.mode || mode === 'http' && (address !== proxy.address || username !== proxy.username || !!password || clear)
  return <form className="update-proxy" onSubmit={event => {
    event.preventDefault()
    if (!changed || saving || disabled) return
    setSaving(true)
    void save({ mode, address, username, password: clear ? '' : password || undefined }).then(saved => {
      setAddress(saved.address)
      setUsername(saved.username)
      setPassword('')
      setClear(false)
      setNotice({ text: '已保存代理设置。' })
    }, error => {
      setNotice({ text: String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, ''), error: true })
    }).finally(() => setSaving(false))
  }}>
    <div className="update-proxy-heading">
      <label htmlFor="update-proxy-mode">更新代理</label>
      <select id="update-proxy-mode" value={mode} disabled={saving || disabled} onChange={event => {
        setMode(event.target.value as UpdateProxyMode)
        setNotice(undefined)
      }}>
        <option value="system">系统代理</option>
        <option value="direct">无代理</option>
        <option value="http">HTTP 代理</option>
      </select>
    </div>
    {mode === 'http' && <div className="update-proxy-fields">
      <label>代理地址<input value={address} onChange={event => setAddress(event.target.value)}
        placeholder="proxy.example.com:8080" required maxLength={400} /></label>
      <div className="update-proxy-auth">
        <label>用户名<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" maxLength={256} /></label>
        <label>密码<input type="password" value={password} onChange={event => { setPassword(event.target.value); setClear(false) }}
          autoComplete="new-password" maxLength={2048} placeholder={clear ? '将清除密码' : canKeep ? '保留已保存的密码' : '可选'} /></label>
      </div>
      {canKeep && !clear && !password && <button type="button" className="tool-button" onClick={() => setClear(true)}>清除已保存的密码</button>}
    </div>}
    {(changed || notice) && <div className="update-proxy-actions">
      {notice && <p role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      <button type="submit" className="tool-button" disabled={!changed || saving || disabled}>{saving ? '正在保存…' : '保存代理设置'}</button>
    </div>}
  </form>
}
