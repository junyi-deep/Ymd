import type { MapLocationKind } from './localMapLinks'
import type { PitchRequest } from './pitch'
import type { AppShortcut, ShortcutOverrides } from './shortcuts'

export type FileKind = 'markdown' | 'drawing'
export type Scope = 'library' | 'local'
export type EditorMode = 'markdown' | 'outline' | 'map'
export type Theme = 'system' | 'light' | 'dark'
export type MarkdownPageWidth = 'narrow' | 'normal' | 'wide'
export const markdownPageWidths = [['narrow', '窄'], ['normal', '标准'], ['wide', '宽']] as const
export type CodeBlockPreferences = { lineNumbers: boolean; wrap: boolean }
export const paneWidths = { sidebar: { min: 160, max: 440 }, outline: { min: 152, max: 420 } } as const
export type SearchEngine = 'google' | 'baidu' | 'bing' | 'duckduckgo'

export const searchEngines: Record<SearchEngine, { label: string; url: string; parameter: string }> = {
  google: { label: 'Google', url: 'https://www.google.com/search', parameter: 'q' },
  baidu: { label: '百度', url: 'https://www.baidu.com/s', parameter: 'wd' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search', parameter: 'q' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/', parameter: 'q' },
}

export type UpdateProxyMode = 'system' | 'direct' | 'http'
export interface UpdateProxy {
  mode: UpdateProxyMode
  address: string
  username: string
  hasPassword: boolean
}
export type UpdateProxyInput = Omit<UpdateProxy, 'hasPassword'> & { password?: string }
export const defaultUpdateProxy: UpdateProxy = { mode: 'system', address: '', username: '', hasPassword: false }

export interface VersionStatus {
  current: string
  update?: { version: string; url: string; canDownload: boolean }
  progress?: { state: 'downloading'; received: number; total: number } |
    { state: 'ready' | 'installing' } | { state: 'error'; message: string }
}

export interface Entry {
  path: string
  name: string
  kind: FileKind | 'directory'
}

export interface TreeMutation {
  operation: 'copy' | 'import' | 'move' | 'trash' | 'rename'
  entries: (Entry & { version?: string; text?: string })[]
  name?: string
  destination?: string
}

export interface TreeChange {
  source: Entry
  target?: Entry
  error?: string
}

export interface RecoveryDraft { text: string; version: string }
export interface RecoveryEntry { id: string; path: string; updated: number }

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
  windowTransparency: number
  libraryDirectory?: string
  recentLimit: number
  markdownOutline: MarkdownOutlinePreferences
  sidebarWidth?: number
  markdownPageWidth: MarkdownPageWidth
  outlinePageWidth: MarkdownPageWidth
  outlineRemainderVisible: boolean
  mapRemainderVisible: boolean
  codeBlocks: CodeBlockPreferences
  animations: boolean
  documentTheme: 'classic' | 'paper' | 'mono'
  autoSave: boolean
  remoteImages: boolean
  autoCheckUpdates: boolean
  autoDownloadUpdates: boolean
  searchEngine: SearchEngine
  shortcuts: ShortcutOverrides
}

export interface MarkdownOutlinePreferences {
  position: 'left' | 'right'
  numbering: 'none' | 'flat' | 'hierarchical'
  visible: boolean
  width?: number
}

export const defaultPreferences: Preferences = {
  theme: 'system', size: 'normal', solidBackground: false, windowTransparency: 80, recentLimit: 10, animations: true, documentTheme: 'classic',
  markdownOutline: { position: 'right', numbering: 'none', visible: false },
  markdownPageWidth: 'normal', outlinePageWidth: 'normal', outlineRemainderVisible: true, mapRemainderVisible: true,
  codeBlocks: { lineNumbers: false, wrap: false },
  autoSave: true, remoteImages: false, autoCheckUpdates: false, autoDownloadUpdates: false, searchEngine: 'google', shortcuts: {},
}

export function windowMaterialFor(preferences: Preferences, platform: string, windowsAcrylic: boolean, macReducesTransparency: boolean) {
  if (preferences.solidBackground) return 'solid'
  if (platform === 'darwin') {
    if (macReducesTransparency) return 'solid'
    return preferences.windowTransparency === 100 ? 'clear' : 'vibrancy'
  }
  return windowsAcrylic ? 'acrylic' : 'solid'
}

export type Command = AppShortcut | 'close'

export const markdownImageExtensions = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
} as const
export const markdownImageLimits = { count: 20, fileBytes: 15 * 1024 * 1024, batchBytes: 60 * 1024 * 1024 }

export interface MarkdownImageUpload { name: string; type: string; data: ArrayBuffer }
export interface MarkdownImageAttachment { label: string; source: string }
export interface MapShotRect { x: number; y: number; width: number; height: number }
export const mapExportExtensions = { png: 'PNG', svg: 'SVG', pdf: 'PDF', md: 'Markdown', txt: '纯文本' } as const
export type MapExportKind = keyof typeof mapExportExtensions

export function markdownImageExtension(name: string, type = '') {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()
  if (extension && Object.hasOwn(markdownImageExtensions, extension)) return extension as keyof typeof markdownImageExtensions
  return (Object.keys(markdownImageExtensions) as (keyof typeof markdownImageExtensions)[])
    .find(extension => markdownImageExtensions[extension] === type)
}

export interface Desktop {
  initialize(): Promise<{ library: Entry; recent: Entry[]; preferences: Preferences; platform: string; windowsAcrylic: boolean; macReducesTransparency: boolean; version: string; updateProxy: UpdateProxy; release: VersionStatus;
    initialFile?: DocumentFile; recoveries: RecoveryEntry[] }>
  list(path: string): Promise<Entry[]>
  chooseLibraryDirectory(): Promise<Entry | null>
  resetLibraryDirectory(): Promise<Entry>
  chooseLocalDirectory(): Promise<Entry[] | null>
  listRecent(): Promise<Entry[]>
  touchRecent(path: string): Promise<Entry[]>
  removeRecent(path: string): Promise<Entry[]>
  search(query: string): Promise<SearchHit[]>
  cancelSearch(): Promise<void>
  chooseFile(kind?: FileKind): Promise<DocumentFile | null>
  chooseXmind(): Promise<{ name: string; data: ArrayBuffer } | null>
  createImportedMarkdown(directory: string, name: string, text: string): Promise<DocumentFile>
  read(path: string): Promise<DocumentFile>
  readDocumentState(path: string): Promise<DocumentFile | null>
  watchDocuments(paths: string[]): Promise<void>
  newWindow(path?: string): Promise<void>
  onDocumentChanged(callback: (path: string) => void): () => void
  onPreferences(callback: (preferences: Preferences) => void): () => void
  onWorkspaceChange(callback: (workspace: { library: Entry; recent: Entry[] }) => void): () => void
  onRecoveryList(callback: (recoveries: RecoveryEntry[]) => void): () => void
  recordDraft(path: string, draft: RecoveryDraft | null): Promise<void>
  restoreDraft(id: string): Promise<{ file: DocumentFile; draft: RecoveryDraft; missing: boolean } | null>
  discardDraft(id: string): Promise<void>
  cancelClose(): Promise<void>
  create(directory: string, kind: FileKind): Promise<DocumentFile>
  createFolder(directory: string): Promise<Entry>
  mutateTree(mutation: TreeMutation): Promise<TreeChange[] | null>
  save(path: string, text: string, version: string | null): Promise<{ version: string; modified: number } | { conflict: true }>
  duplicate(path: string, directory: string, text: string): Promise<DocumentFile>
  rename(path: string, name: string, version: string): Promise<DocumentFile>
  move(path: string, version: string): Promise<DocumentFile | null>
  trash(path: string, version: string): Promise<void>
  openExternal(url: string): Promise<void>
  chooseLocalMapLocation(kind: MapLocationKind, previous?: string): Promise<string | null>
  openLocalMapLocation(url: string): Promise<void>
  chooseMarkdownImages(path: string): Promise<MarkdownImageAttachment[]>
  importMarkdownImages(path: string, images: MarkdownImageUpload[]): Promise<MarkdownImageAttachment[]>
  pasteMarkdownClipboard(): Promise<void>
  readMarkdownImage(path: string, source: string): Promise<string | null>
  readPreviewImage(source: string): Promise<string>
  savePreviewImage(name: string, format: 'png' | 'svg', data: ArrayBuffer): Promise<boolean>
  markdownContextMenu(x: number, y: number, items: ContextMenuItem[]): Promise<number | null>
  exportPdf(name: string, html: string): Promise<boolean>
  saveXmind(name: string, data: ArrayBuffer): Promise<boolean>
  saveAudioNote(data: ArrayBuffer): Promise<boolean>
  captureMapShot(rect: MapShotRect): Promise<ArrayBuffer>
  outputMapShot(data: ArrayBuffer, name?: string): Promise<boolean>
  saveMapExport(name: string, format: MapExportKind, data: ArrayBuffer): Promise<boolean>
  openPitch(request: PitchRequest): Promise<void>
  printDocument(name: string, html: string): Promise<void>
  saveCopy(path: string, text: string): Promise<DocumentFile | null>
  reveal(path: string, directory?: boolean): Promise<void>
  openLibraryDirectory(): Promise<void>
  checkForUpdates(): Promise<VersionStatus>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  setUpdateProxy(value: UpdateProxyInput): Promise<UpdateProxy>
  onUpdateStatus(callback: (status: VersionStatus) => void): () => void
  setPreferences(preferences: Partial<Preferences>): Promise<Preferences>
  setShortcutRecording(active: boolean): Promise<void>
  finishClose(): Promise<void>
  onCommand(callback: (command: Command) => void): () => void
  onReducedTransparency(callback: (reduce: boolean) => void): () => void
}
