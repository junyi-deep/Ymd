import { contextBridge, ipcRenderer } from 'electron'
import type { Command, Desktop, Entry, JournalList, Preferences, RecoveryEntry, VersionStatus } from '../shared/contracts'
import type { PitchDesktop } from '../shared/pitch'

const desktop: Desktop = {
  windowAction: action => ipcRenderer.invoke('ymd:windowAction', action),
  onWindowMaximized: callback => {
    const listener = (_: unknown, maximized: boolean) => callback(maximized)
    ipcRenderer.on('ymd:windowMaximized', listener)
    return () => ipcRenderer.removeListener('ymd:windowMaximized', listener)
  },
  initialize: () => ipcRenderer.invoke('ymd:initialize'),
  list: path => ipcRenderer.invoke('ymd:list', path),
  chooseLibraryDirectory: () => ipcRenderer.invoke('ymd:chooseLibraryDirectory'),
  resetLibraryDirectory: () => ipcRenderer.invoke('ymd:resetLibraryDirectory'),
  chooseLocalDirectory: () => ipcRenderer.invoke('ymd:chooseLocalDirectory'),
  listRecent: () => ipcRenderer.invoke('ymd:listRecent'),
  touchRecent: path => ipcRenderer.invoke('ymd:touchRecent', path),
  removeRecentEntries: paths => ipcRenderer.invoke('ymd:removeRecentEntries', paths),
  removeRecent: path => ipcRenderer.invoke('ymd:removeRecent', path),
  reorderRecent: (path, target, after) => ipcRenderer.invoke('ymd:reorderRecent', path, target, after),
  setFolderExpanded: (path, expanded) => ipcRenderer.invoke('ymd:setFolderExpanded', path, expanded),
  hideLocalEntry: path => ipcRenderer.invoke('ymd:hideLocalEntry', path),
  recordDocumentOpen: path => ipcRenderer.invoke('ymd:recordDocumentOpen', path),
  openHistoryDocument: path => ipcRenderer.invoke('ymd:openHistoryDocument', path),
  onDocumentHistory: callback => {
    const listener = (_: unknown, entries: Entry[]) => callback(entries)
    ipcRenderer.on('ymd:documentHistory', listener)
    return () => ipcRenderer.removeListener('ymd:documentHistory', listener)
  },
  listJournals: () => ipcRenderer.invoke('ymd:listJournals'),
  openJournal: date => ipcRenderer.invoke('ymd:openJournal', date),
  deleteJournal: (date, version) => ipcRenderer.invoke('ymd:deleteJournal', date, version),
  previewJournal: date => ipcRenderer.invoke('ymd:previewJournal', date),
  cleanJournals: () => ipcRenderer.invoke('ymd:cleanJournals'),
  onJournalsChanged: callback => {
    const listener = (_: unknown, journals: JournalList) => callback(journals)
    ipcRenderer.on('ymd:journalsChanged', listener)
    return () => ipcRenderer.removeListener('ymd:journalsChanged', listener)
  },
  search: query => ipcRenderer.invoke('ymd:search', query),
  cancelSearch: () => ipcRenderer.invoke('ymd:cancelSearch'),
  chooseFile: kind => ipcRenderer.invoke('ymd:chooseFile', kind),
  chooseXmind: () => ipcRenderer.invoke('ymd:chooseXmind'),
  createImportedMarkdown: (directory, name, text) => ipcRenderer.invoke('ymd:createImportedMarkdown', directory, name, text),
  read: path => ipcRenderer.invoke('ymd:read', path),
  readDocumentState: path => ipcRenderer.invoke('ymd:readDocumentState', path),
  watchDocuments: paths => ipcRenderer.invoke('ymd:watchDocuments', paths),
  newWindow: path => ipcRenderer.invoke('ymd:newWindow', path),
  onDocumentChanged: callback => {
    const listener = (_: unknown, path: string) => callback(path)
    ipcRenderer.on('ymd:documentChanged', listener)
    return () => ipcRenderer.removeListener('ymd:documentChanged', listener)
  },
  onPreferences: callback => {
    const listener = (_: unknown, preferences: Preferences) => callback(preferences)
    ipcRenderer.on('ymd:preferences', listener)
    return () => ipcRenderer.removeListener('ymd:preferences', listener)
  },
  onWorkspaceChange: callback => {
    const listener = (_: unknown, workspace: { library: Entry; recent: Entry[] }) => callback(workspace)
    ipcRenderer.on('ymd:workspaceChanged', listener)
    return () => ipcRenderer.removeListener('ymd:workspaceChanged', listener)
  },
  onRecoveryList: callback => {
    const listener = (_: unknown, recoveries: RecoveryEntry[]) => callback(recoveries)
    ipcRenderer.on('ymd:recoveryList', listener)
    return () => ipcRenderer.removeListener('ymd:recoveryList', listener)
  },
  recordDraft: (path, draft) => ipcRenderer.invoke('ymd:recordDraft', path, draft),
  restoreDraft: id => ipcRenderer.invoke('ymd:restoreDraft', id),
  discardDraft: id => ipcRenderer.invoke('ymd:discardDraft', id),
  cancelClose: () => ipcRenderer.invoke('ymd:cancelClose'),
  create: (directory, kind) => ipcRenderer.invoke('ymd:create', directory, kind),
  createFolder: directory => ipcRenderer.invoke('ymd:createFolder', directory),
  mutateTree: mutation => ipcRenderer.invoke('ymd:mutateTree', mutation),
  save: (path, text, version) => ipcRenderer.invoke('ymd:save', path, text, version),
  duplicate: (path, directory, text) => ipcRenderer.invoke('ymd:duplicate', path, directory, text),
  rename: (path, name, version) => ipcRenderer.invoke('ymd:rename', path, name, version),
  move: (path, version) => ipcRenderer.invoke('ymd:move', path, version),
  trash: (path, version) => ipcRenderer.invoke('ymd:trash', path, version),
  openExternal: url => ipcRenderer.invoke('ymd:openExternal', url),
  chooseLocalMapLocation: (kind, previous) => ipcRenderer.invoke('ymd:chooseLocalMapLocation', kind, previous),
  openLocalMapLocation: url => ipcRenderer.invoke('ymd:openLocalMapLocation', url),
  chooseMarkdownImages: path => ipcRenderer.invoke('ymd:chooseMarkdownImages', path),
  importMarkdownImages: (path, images) => ipcRenderer.invoke('ymd:importMarkdownImages', path, images),
  pasteMarkdownClipboard: () => ipcRenderer.invoke('ymd:pasteMarkdownClipboard'),
  readMarkdownImage: (path, source) => ipcRenderer.invoke('ymd:readMarkdownImage', path, source),
  readPreviewImage: source => ipcRenderer.invoke('ymd:readPreviewImage', source),
  savePreviewImage: (name, format, data) => ipcRenderer.invoke('ymd:savePreviewImage', name, format, data),
  markdownContextMenu: (x, y, items) => ipcRenderer.invoke('ymd:markdownContextMenu', x, y, items),
  exportPdf: (name, html) => ipcRenderer.invoke('ymd:exportPdf', name, html),
  saveXmind: (name, data) => ipcRenderer.invoke('ymd:saveXmind', name, data),
  saveAudioNote: data => ipcRenderer.invoke('ymd:saveAudioNote', data),
  captureMapShot: rect => ipcRenderer.invoke('ymd:captureMapShot', rect),
  outputMapShot: (data, name) => ipcRenderer.invoke('ymd:outputMapShot', data, name),
  saveMapExport: (name, format, data) => ipcRenderer.invoke('ymd:saveMapExport', name, format, data),
  openPitch: request => ipcRenderer.invoke('ymd:openPitch', request),
  printDocument: (name, html) => ipcRenderer.invoke('ymd:printDocument', name, html),
  saveCopy: (path, text) => ipcRenderer.invoke('ymd:saveCopy', path, text),
  reveal: (path, directory) => ipcRenderer.invoke('ymd:reveal', path, directory),
  openLibraryDirectory: () => ipcRenderer.invoke('ymd:openLibraryDirectory'),
  changeStorageDirectory: (kind, reset) => ipcRenderer.invoke('ymd:changeStorageDirectory', kind, reset),
  openStorageDirectory: kind => ipcRenderer.invoke('ymd:openStorageDirectory', kind),
  listMapStickers: () => ipcRenderer.invoke('ymd:listMapStickers'),
  readMapSticker: name => ipcRenderer.invoke('ymd:readMapSticker', name),
  importMapStickers: () => ipcRenderer.invoke('ymd:importMapStickers'),
  checkForUpdates: () => ipcRenderer.invoke('ymd:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('ymd:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('ymd:installUpdate'),
  setUpdateProxy: value => ipcRenderer.invoke('ymd:setUpdateProxy', value),
  onUpdateStatus: callback => {
    const listener = (_event: unknown, status: VersionStatus) => callback(status)
    ipcRenderer.on('ymd:updateStatus', listener)
    return () => ipcRenderer.removeListener('ymd:updateStatus', listener)
  },
  setPreferences: preferences => ipcRenderer.invoke('ymd:setPreferences', preferences),
  setShortcutRecording: active => ipcRenderer.invoke('ymd:setShortcutRecording', active),
  finishClose: () => ipcRenderer.invoke('ymd:finishClose'),
  onCommand: callback => {
    const listener = (_event: unknown, command: Command) => callback(command)
    ipcRenderer.on('ymd:command', listener)
    return () => ipcRenderer.removeListener('ymd:command', listener)
  },
  onReducedTransparency: callback => {
    const listener = (_event: unknown, reduce: boolean) => callback(reduce)
    ipcRenderer.on('ymd:reducedTransparency', listener)
    return () => ipcRenderer.removeListener('ymd:reducedTransparency', listener)
  },
}

if (new URLSearchParams(location.search).has('pitch')) {
  let lastFullscreen: boolean | undefined
  const fullscreenListeners = new Set<(enabled: boolean) => void>()
  ipcRenderer.on('ymd:pitch:fullscreenChanged', (_event: unknown, enabled: boolean) => {
    lastFullscreen = enabled
    fullscreenListeners.forEach(listener => listener(enabled))
  })
  const pitch: PitchDesktop = {
    load: () => ipcRenderer.invoke('ymd:pitch:load'),
    fullscreen: enabled => ipcRenderer.invoke('ymd:pitch:fullscreen', enabled),
    onFullscreen: callback => {
      fullscreenListeners.add(callback)
      if (lastFullscreen !== undefined) callback(lastFullscreen)
      return () => { fullscreenListeners.delete(callback) }
    },
    close: () => ipcRenderer.invoke('ymd:pitch:close'),
    savePowerPoint: (name, data) => ipcRenderer.invoke('ymd:pitch:savePowerPoint', name, data),
    savePdf: (name, html) => ipcRenderer.invoke('ymd:pitch:savePdf', name, html),
  }
  contextBridge.exposeInMainWorld('pitch', pitch)
} else contextBridge.exposeInMainWorld('desktop', desktop)
