import { execFile, spawn } from 'node:child_process'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { promisify } from 'node:util'
import { app } from 'electron'
import path from 'node:path'

const exec = promisify(execFile)

async function launch(command: string, args: string[]) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}

const replaceBundle = String.raw`
set -u
pid="$1"; target="$2"; work="$3"; profile="$4"
old="$work/previous.app"; new="$work/staged.app"
tries=0
while kill -0 "$pid" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 150 ]; then exit 1; fi
  /bin/sleep .2
done
if /bin/mv "$target" "$old"; then
  if /bin/mv "$new" "$target"; then
    if /usr/bin/open -n -a "$target" --args "--user-data-dir=$profile"; then
      /bin/rm -rf "$work"
      exit 0
    fi
    /bin/mv "$target" "$new"
  fi
  if /bin/mv "$old" "$target"; then
    /usr/bin/open -n -a "$target" --args "--user-data-dir=$profile"
    /bin/rm -rf "$work"
  fi
fi
/usr/bin/osascript -e 'display alert "Ymd 更新未安装" message "请检查应用目录的写入权限，或通过安装包更新。"'
`

export async function installRelease(installer: string, version: string) {
  if (!app.isPackaged) throw new Error('可从已安装的 Ymd 中重启并安装更新。')
  if (process.platform === 'win32') {
    await launch(installer, ['/S', '--updated', '--force-run'])
    return
  }
  if (process.platform !== 'darwin') throw new Error('当前系统无法直接安装此更新。')
  const executable = await realpath(process.execPath)
  const current = path.resolve(executable, '../../..')
  if (path.extname(current) !== '.app' || current.startsWith('/Volumes/') || current.includes('/AppTranslocation/')) {
    throw new Error('请先将 Ymd 安装到「应用程序」或其他可写目录。')
  }
  const parent = path.dirname(current)
  await access(parent, constants.W_OK).catch(() => { throw new Error('当前应用目录不可写，无法替换 Ymd。') })
  const staged = await mkdtemp(path.join(parent, '.ymd-update-'))
  const volume = await mkdtemp(path.join(app.getPath('temp'), 'ymd-update-volume-')).catch(async error => {
    await rm(staged, { recursive: true, force: true })
    throw error
  })
  let handedOff = false
  let attached = false
  try {
    await exec('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', volume, installer], { timeout: 120_000 })
    attached = true
    const source = path.join(volume, 'Ymd.app')
    const target = path.join(staged, 'staged.app')
    const info = path.join(source, 'Contents/Info.plist')
    const { stdout: id } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', info])
    const { stdout: tag } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', info])
    if (id.trim() !== 'com.ymd.editor' || tag.trim() !== version) throw new Error('安装包的应用标识或版本不匹配。')
    await exec('/usr/bin/ditto', [source, target], { timeout: 120_000 })
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', target], { timeout: 30_000 })
    await exec('/usr/bin/hdiutil', ['detach', volume], { timeout: 30_000 })
    attached = false
    await launch('/bin/sh', ['-c', replaceBundle, 'ymd-update', String(process.pid), current, staged, app.getPath('userData')])
    handedOff = true
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
    throw new Error('无法验证或安装 macOS 更新，请使用发布页上的安装包。')
  } finally {
    if (attached) {
      await exec('/usr/bin/hdiutil', ['detach', volume], { timeout: 15_000 }).then(() => { attached = false }, () => {})
    }
    // A mounted volume remains read-only and must not be traversed during cleanup.
    if (!attached) await rm(volume, { recursive: true, force: true }).catch(() => {})
    if (!handedOff) await rm(staged, { recursive: true, force: true }).catch(() => {})
  }
}
