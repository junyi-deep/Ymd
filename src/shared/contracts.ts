export type FileKind = 'markdown' | 'drawing'
export type Scope = 'library' | 'project' | 'local'
export type EditorMode = 'markdown' | 'outline' | 'map'
export type Theme = 'system' | 'light' | 'dark'
export type SearchEngine = 'google' | 'baidu' | 'bing' | 'duckduckgo'

export const searchEngines: Record<SearchEngine, { label: string; url: string; parameter: string }> = {
  google: { label: 'Google', url: 'https://www.google.com/search', parameter: 'q' },
  baidu: { label: '百度', url: 'https://www.baidu.com/s', parameter: 'wd' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search', parameter: 'q' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/', parameter: 'q' },
}

export interface VersionStatus {
  current: string
  update?: { version: string; url: string }
}

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

export interface ContextMenuItem {
  label: string
  id?: number
  shortcut?: string
  disabled?: boolean
  selected?: boolean
  separator?: boolean
  children?: ContextMenuItem[]
}

export interface Preferences {
  theme: Theme
  size: 'small' | 'normal' | 'large'
  solidBackground: boolean
  projectDirectory?: string
  animations: boolean
  documentTheme: 'classic' | 'paper' | 'mono'
  autoSave: boolean
  remoteImages: boolean
  autoCheckUpdates: boolean
  searchEngine: SearchEngine
}

export const defaultPreferences: Preferences = {
  theme: 'system', size: 'normal', solidBackground: false, animations: true, documentTheme: 'classic',
  autoSave: false, remoteImages: false, autoCheckUpdates: false, searchEngine: 'google',
}
export type Command = 'open-file' | 'import-xmind' | 'new-file' | 'new-drawing' | 'search' | 'save' | 'preferences' | 'close' | 'find'

export const markdownImageExtensions = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
} as const
export const markdownImageLimits = { count: 20, fileBytes: 15 * 1024 * 1024, batchBytes: 60 * 1024 * 1024 }

export interface MarkdownImageUpload { name: string; type: string; data: ArrayBuffer }
export interface MarkdownImageAttachment { label: string; source: string }

export function markdownImageExtension(name: string, type = '') {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()
  if (extension && Object.hasOwn(markdownImageExtensions, extension)) return extension as keyof typeof markdownImageExtensions
  return (Object.keys(markdownImageExtensions) as (keyof typeof markdownImageExtensions)[])
    .find(extension => markdownImageExtensions[extension] === type)
}

export interface Desktop {
  initialize(): Promise<{ library: Entry; project: Entry | null; preferences: Preferences; platform: string; windowsAcrylic: boolean; version: string }>
  list(path: string): Promise<Entry[]>
  chooseProjectDirectory(): Promise<Entry | null>
  resetProjectDirectory(): Promise<Entry | null>
  search(query: string): Promise<SearchHit[]>
  cancelSearch(): Promise<void>
  chooseFile(): Promise<DocumentFile | null>
  chooseXmind(): Promise<{ name: string; data: ArrayBuffer } | null>
  createImportedMarkdown(directory: string, name: string, text: string): Promise<DocumentFile>
  read(path: string): Promise<DocumentFile>
  create(directory: string, kind: FileKind): Promise<DocumentFile>
  save(path: string, text: string, version: string): Promise<{ version: string; modified: number } | { conflict: true }>
  duplicate(path: string, directory: string, text: string): Promise<DocumentFile>
  rename(path: string, name: string, version: string): Promise<DocumentFile>
  move(path: string, version: string): Promise<DocumentFile | null>
  trash(path: string, version: string): Promise<void>
  openExternal(url: string): Promise<void>
  chooseMarkdownImages(path: string): Promise<MarkdownImageAttachment[]>
  importMarkdownImages(path: string, images: MarkdownImageUpload[]): Promise<MarkdownImageAttachment[]>
  pasteMarkdownClipboard(): Promise<void>
  readMarkdownImage(path: string, source: string): Promise<string | null>
  markdownContextMenu(x: number, y: number, items: ContextMenuItem[]): Promise<number | null>
  exportPdf(name: string, html: string): Promise<boolean>
  saveXmind(name: string, data: ArrayBuffer): Promise<boolean>
  saveAudioNote(data: ArrayBuffer): Promise<boolean>
  printDocument(name: string, html: string): Promise<void>
  saveCopy(path: string, text: string): Promise<DocumentFile | null>
  reveal(path: string): Promise<void>
  openLibraryDirectory(location: 'library' | 'project'): Promise<void>
  checkForUpdates(): Promise<VersionStatus>
  setPreferences(preferences: Preferences): Promise<Preferences>
  finishClose(): Promise<void>
  onCommand(callback: (command: Command) => void): () => void
}
