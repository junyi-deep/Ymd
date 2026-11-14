import { contextBridge, ipcRenderer } from 'electron'
import type { Command, Desktop } from '../shared/contracts'

const desktop: Desktop = {
  initialize: () => ipcRenderer.invoke('ymd:initialize'),
  list: path => ipcRenderer.invoke('ymd:list', path),
  chooseProjectDirectory: () => ipcRenderer.invoke('ymd:chooseProjectDirectory'),
  resetProjectDirectory: () => ipcRenderer.invoke('ymd:resetProjectDirectory'),
  search: query => ipcRenderer.invoke('ymd:search', query),
  cancelSearch: () => ipcRenderer.invoke('ymd:cancelSearch'),
  chooseFile: () => ipcRenderer.invoke('ymd:chooseFile'),
  read: path => ipcRenderer.invoke('ymd:read', path),
  create: (directory, kind) => ipcRenderer.invoke('ymd:create', directory, kind),
  save: (path, text, version) => ipcRenderer.invoke('ymd:save', path, text, version),
  duplicate: (path, directory, text) => ipcRenderer.invoke('ymd:duplicate', path, directory, text),
  rename: (path, name, version) => ipcRenderer.invoke('ymd:rename', path, name, version),
  move: (path, version) => ipcRenderer.invoke('ymd:move', path, version),
  trash: (path, version) => ipcRenderer.invoke('ymd:trash', path, version),
  openExternal: url => ipcRenderer.invoke('ymd:openExternal', url),
  chooseMarkdownImage: path => ipcRenderer.invoke('ymd:chooseMarkdownImage', path),
  readMarkdownImage: (path, source) => ipcRenderer.invoke('ymd:readMarkdownImage', path, source),
  markdownContextMenu: (x, y, items) => ipcRenderer.invoke('ymd:markdownContextMenu', x, y, items),
  exportPdf: (name, html) => ipcRenderer.invoke('ymd:exportPdf', name, html),
  saveXmind: (name, data) => ipcRenderer.invoke('ymd:saveXmind', name, data),
  printDocument: (name, html) => ipcRenderer.invoke('ymd:printDocument', name, html),
  saveCopy: (path, text) => ipcRenderer.invoke('ymd:saveCopy', path, text),
  reveal: path => ipcRenderer.invoke('ymd:reveal', path),
  openLibraryDirectory: location => ipcRenderer.invoke('ymd:openLibraryDirectory', location),
  checkForUpdates: () => ipcRenderer.invoke('ymd:checkForUpdates'),
  setPreferences: preferences => ipcRenderer.invoke('ymd:setPreferences', preferences),
  finishClose: () => ipcRenderer.invoke('ymd:finishClose'),
  onCommand: callback => {
    const listener = (_event: unknown, command: Command) => callback(command)
    ipcRenderer.on('ymd:command', listener)
    return () => ipcRenderer.removeListener('ymd:command', listener)
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
