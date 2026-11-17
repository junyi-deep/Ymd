import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { markdownImageExtension } from '../shared/contracts'

const profileFiles = [
  'preferences.json', 'window-size.json', 'recent.json', 'document-history.json',
  'map-locations.json', 'update-proxy.json', 'recovery', 'updates',
  'Local State', 'Local Storage', 'Session Storage', 'IndexedDB',
]

export function initializeStorage() {
  const root = path.join(app.getPath('home'), '.ymd')
  const previous = app.getPath('userData')
  const override = app.commandLine.hasSwitch('user-data-dir') ||
    previous !== path.join(app.getPath('appData'), app.getName())
  const data = override ? previous : path.join(root, 'config')
  const documents = path.join(root, 'documents')
  const stickers = path.join(root, 'stickers')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const marker = path.join(data, '.profile-layout-v2')
  if (!override && previous !== data && !existsSync(marker)) {
    // Stage the profile before switching paths. Keep the old copy available for rollback.
    const staging = mkdtempSync(path.join(root, '.profile-'))
    try {
      const missing = profileFiles.filter(name => !existsSync(path.join(data, name)))
      for (const name of missing) {
        const from = path.join(previous, name)
        if (existsSync(from) && !lstatSync(from).isSymbolicLink()) {
          cpSync(from, path.join(staging, name), { recursive: true })
        }
      }
      if (!existsSync(data)) {
        try { renameSync(staging, data) }
        catch (error) { if (!existsSync(data)) throw error }
      }
      for (const name of missing) {
        const source = path.join(staging, name)
        const destination = path.join(data, name)
        if (existsSync(source) && !existsSync(destination)) {
          try { renameSync(source, destination) }
          catch (error) { if (!existsSync(destination)) throw error }
        }
      }
      writeFileSync(marker, '')
    } finally { rmSync(staging, { recursive: true, force: true }) }
  }
  mkdirSync(data, { recursive: true, mode: 0o700 })
  app.setPath('userData', data)
  app.setPath('sessionData', data)
  return { root, previous, data, documents, stickers }
}

export async function migrateStickers(previous: string, stickers: string, data: string) {
  await mkdir(stickers, { recursive: true, mode: 0o700 })
  const legacy = path.join(previous, 'stickers')
  if (stickers === legacy || (await lstat(stickers)).isSymbolicLink()) return
  const marker = path.join(data, '.stickers-layout-v2')
  if (existsSync(marker)) return
  const files = await readdir(legacy, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const file of files) {
    if (!file.isFile() || file.name.startsWith('.') || !markdownImageExtension(file.name)) continue
    await copyFile(path.join(legacy, file.name), path.join(stickers, file.name), constants.COPYFILE_EXCL).catch(error => {
      if (error.code !== 'EEXIST') throw error
    })
  }
  await writeFile(marker, '')
}
