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
  modified: number
}

export interface SearchHit extends Entry {
  kind: FileKind
  location: string
  modified?: number
  opened?: number
  snippet?: string
  line?: number
}

export interface Preferences {
  theme: Theme
  size: 'small' | 'normal' | 'large'
  solidBackground: boolean
  projectDirectory?: string
  animations: boolean
  documentTheme: 'classic' | 'paper' | 'mono'
  autoSave: boolean
}

export const defaultPreferences: Preferences = { theme: 'system', size: 'normal', solidBackground: false, animations: true, documentTheme: 'classic', autoSave: false }
export type Command = 'open-file' | 'new-file' | 'new-drawing' | 'search' | 'save' | 'preferences' | 'close' | 'find'

export interface Desktop {
  initialize(): Promise<{ library: Entry; project: Entry | null; preferences: Preferences; platform: string; windowsAcrylic: boolean }>
  list(path: string): Promise<Entry[]>
  chooseProjectDirectory(): Promise<Entry | null>
  resetProjectDirectory(): Promise<Entry | null>
  search(query: string): Promise<SearchHit[]>
  cancelSearch(): Promise<void>
  chooseFile(): Promise<DocumentFile | null>
  read(path: string): Promise<DocumentFile>
  create(directory: string, kind: FileKind): Promise<DocumentFile>
  save(path: string, text: string, version: string): Promise<{ version: string; modified: number } | { conflict: true }>
  duplicate(path: string, directory: string, text: string): Promise<DocumentFile>
  move(path: string, version: string): Promise<DocumentFile | null>
  trash(path: string, version: string): Promise<void>
  exportPdf(name: string): Promise<boolean>
  printDocument(): Promise<void>
  saveCopy(path: string, text: string): Promise<DocumentFile | null>
  reveal(path: string): Promise<void>
  setPreferences(preferences: Preferences): Promise<Preferences>
  finishClose(): Promise<void>
  onCommand(callback: (command: Command) => void): () => void
}
