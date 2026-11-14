import { contextBridge, ipcRenderer } from 'electron'
import type { Command, Desktop } from '../shared/contracts'

const desktop: Desktop = {
  initialize: () => ipcRenderer.invoke('ymd:initialize'),
  list: path => ipcRenderer.invoke('ymd:list', path),
  chooseDirectory: () => ipcRenderer.invoke('ymd:chooseDirectory'),
  chooseFile: () => ipcRenderer.invoke('ymd:chooseFile'),
  read: path => ipcRenderer.invoke('ymd:read', path),
  create: (directory, name, kind) => ipcRenderer.invoke('ymd:create', directory, name, kind),
  save: (path, text, version) => ipcRenderer.invoke('ymd:save', path, text, version),
  saveCopy: (path, text) => ipcRenderer.invoke('ymd:saveCopy', path, text),
  reveal: path => ipcRenderer.invoke('ymd:reveal', path),
  setPreferences: preferences => ipcRenderer.invoke('ymd:setPreferences', preferences),
  finishClose: () => ipcRenderer.invoke('ymd:finishClose'),
  onCommand: callback => {
    const listener = (_event: unknown, command: Command) => callback(command)
    ipcRenderer.on('ymd:command', listener)
    return () => ipcRenderer.removeListener('ymd:command', listener)
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
