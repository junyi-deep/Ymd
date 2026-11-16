import { contextBridge, ipcRenderer } from 'electron'
import type { Command, Desktop } from '../shared/contracts'

const desktop: Desktop = {
  initialize: () => ipcRenderer.invoke('ymd:initialize'),
  list: path => ipcRenderer.invoke('ymd:list', path),
  chooseLibraryDirectory: () => ipcRenderer.invoke('ymd:chooseLibraryDirectory'),
  resetLibraryDirectory: () => ipcRenderer.invoke('ymd:resetLibraryDirectory'),
  chooseLocalDirectory: () => ipcRenderer.invoke('ymd:chooseLocalDirectory'),
  listRecent: () => ipcRenderer.invoke('ymd:listRecent'),
  touchRecent: path => ipcRenderer.invoke('ymd:touchRecent', path),
  removeRecent: path => ipcRenderer.invoke('ymd:removeRecent', path),
  search: query => ipcRenderer.invoke('ymd:search', query),
  cancelSearch: () => ipcRenderer.invoke('ymd:cancelSearch'),
  chooseFile: kind => ipcRenderer.invoke('ymd:chooseFile', kind),
  chooseXmind: () => ipcRenderer.invoke('ymd:chooseXmind'),
  createImportedMarkdown: (directory, name, text) => ipcRenderer.invoke('ymd:createImportedMarkdown', directory, name, text),
  read: path => ipcRenderer.invoke('ymd:read', path),
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
  markdownContextMenu: (x, y, items) => ipcRenderer.invoke('ymd:markdownContextMenu', x, y, items),
  exportPdf: (name, html) => ipcRenderer.invoke('ymd:exportPdf', name, html),
  saveXmind: (name, data) => ipcRenderer.invoke('ymd:saveXmind', name, data),
  saveAudioNote: data => ipcRenderer.invoke('ymd:saveAudioNote', data),
  captureMapShot: rect => ipcRenderer.invoke('ymd:captureMapShot', rect),
  outputMapShot: (data, name) => ipcRenderer.invoke('ymd:outputMapShot', data, name),
  printDocument: (name, html) => ipcRenderer.invoke('ymd:printDocument', name, html),
  saveCopy: (path, text) => ipcRenderer.invoke('ymd:saveCopy', path, text),
  reveal: (path, directory) => ipcRenderer.invoke('ymd:reveal', path, directory),
  openLibraryDirectory: () => ipcRenderer.invoke('ymd:openLibraryDirectory'),
  checkForUpdates: () => ipcRenderer.invoke('ymd:checkForUpdates'),
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

contextBridge.exposeInMainWorld('desktop', desktop)
