export type FileKind = 'markdown' | 'drawing'
export type Scope = 'library' | 'project' | 'local'
export type EditorMode = 'markdown' | 'outline' | 'map'
export type Theme = 'system' | 'light' | 'dark'

export interface Entry {
  path: string
  name: string
  kind: FileKind | 'directory'
}

export interface DocumentFile extends Entry {
  kind: FileKind
  text: string
  version: string
}

export interface Preferences {
  theme: Theme
  size: 'small' | 'normal' | 'large'
  solidBackground: boolean
}

export const defaultPreferences: Preferences = { theme: 'system', size: 'normal', solidBackground: false }
export type Command = 'open-directory' | 'open-file' | 'new-file' | 'save' | 'preferences' | 'close' | 'find'

export interface Desktop {
  initialize(): Promise<{ library: Entry; preferences: Preferences; platform: string }>
  list(path: string): Promise<Entry[]>
  chooseDirectory(): Promise<Entry | null>
  chooseFile(): Promise<DocumentFile | null>
  read(path: string): Promise<DocumentFile>
  create(directory: string, name: string, kind: FileKind): Promise<DocumentFile>
  save(path: string, text: string, version: string): Promise<{ version: string } | { conflict: true }>
  saveCopy(path: string, text: string): Promise<DocumentFile | null>
  reveal(path: string): Promise<void>
  setPreferences(preferences: Preferences): Promise<Preferences>
  finishClose(): Promise<void>
  onCommand(callback: (command: Command) => void): () => void
}
