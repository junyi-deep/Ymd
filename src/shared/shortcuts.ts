export const appShortcuts = {
  'new-file': { label: '新建文档', key: 'Mod-n' },
  'open-file': { label: '打开文件', key: 'Mod-o' },
  'import-xmind': { label: '导入 Xmind' },
  'new-drawing': { label: '新建绘图', key: 'Mod-Shift-n' },
  save: { label: '保存', key: 'Mod-s' },
  find: { label: '查找和替换', key: 'Mod-f' },
  search: { label: '搜索文档', key: 'Mod-j' },
  preferences: { label: '设置', key: 'Mod-,' },
} satisfies Record<string, Shortcut>

export const markdownShortcuts = {
  'heading-1': { label: '一级标题', key: 'Mod-1' },
  'heading-2': { label: '二级标题', key: 'Mod-2' },
  'heading-3': { label: '三级标题', key: 'Mod-3' },
  'heading-4': { label: '四级标题', key: 'Mod-4' },
  'heading-5': { label: '五级标题', key: 'Mod-5' },
  'heading-6': { label: '六级标题', key: 'Mod-6' },
  'heading-more': { label: '增加标题级别', key: 'Mod-=' },
  'heading-less': { label: '减少标题级别', key: 'Mod--' },
  quote: { label: '引用', key: 'Mod-Shift-q', mac: 'Alt-Mod-q' },
  'ordered-list': { label: '有序列表', key: 'Mod-Shift-[', mac: 'Alt-Mod-o' },
  'unordered-list': { label: '无序列表', key: 'Mod-Shift-]', mac: 'Alt-Mod-u' },
  'task-list': { label: '任务列表' },
  indent: { label: '缩进', key: 'Mod-[' },
  outdent: { label: '减少缩进', key: 'Mod-]' },
  paragraph: { label: '段落', key: 'Mod-0' },
  bold: { label: '加粗', key: 'Mod-b' },
  italic: { label: '斜体', key: 'Mod-i' },
  underline: { label: '下划线', key: 'Mod-u' },
  code: { label: '代码', key: 'Mod-Shift-`' },
  strike: { label: '删除线', key: 'Alt-Shift-5', mac: 'Ctrl-Shift-`' },
  highlight: { label: '高亮' },
  hyperlink: { label: '超链接', key: 'Mod-k' },
  'clear-style': { label: '清除样式', key: 'Mod-\\' },
  table: { label: '表格', key: 'Mod-t', mac: 'Alt-Mod-t' },
  image: { label: '图像' },
  'code-block': { label: '代码块', key: 'Mod-Shift-k', mac: 'Alt-Mod-c' },
  formula: { label: '公式块', key: 'Mod-Shift-m', mac: 'Alt-Mod-b' },
  rule: { label: '水平分割线' },
  mermaid: { label: 'Mermaid 图' },
  footnote: { label: '脚注' },
  metadata: { label: 'YAML 元数据' },
  'paragraph-before': { label: '在上方插入段落' },
  'paragraph-after': { label: '在下方插入段落' },
} satisfies Record<string, Shortcut>

const mapShortcuts = {
  'map-link': { label: '编辑主题链接', key: 'Mod-k' },
  'map-shot': { label: '导图截图', mac: 'Mod-Shift-p', key: 'F7' },
  'map-branch': { label: '仅显示分支／显示全部内容', key: 'Mod-;' },
} satisfies Record<string, Shortcut>
export const shortcutGroups = { app: appShortcuts, markdown: markdownShortcuts, map: mapShortcuts }
type Shortcut = { label: string; key?: string; mac?: string }
export type AppShortcut = keyof typeof appShortcuts
export type MarkdownShortcut = keyof typeof markdownShortcuts
export type ShortcutId = AppShortcut | MarkdownShortcut | keyof typeof mapShortcuts
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>
type Scope = keyof typeof shortcutGroups

export const shortcutCatalog = Object.entries(shortcutGroups).flatMap(([scope, actions]) =>
  Object.entries(actions).map(([id, item]) => ({ ...item as Shortcut, id: id as ShortcutId, scope: scope as Scope })))
const catalog = new Map(shortcutCatalog.map(item => [item.id, item]))
const modifiers = ['Mod', 'Ctrl', 'Alt', 'Shift']
const punctuation: Record<string, string> = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' }
const singleKey = /^(?:[a-z0-9\x60=\[\]\\;',./-]|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1\d|2[0-4]))$/
const chordParts = (chord: string) => {
  const prefix = /^(?:(?:Mod|Ctrl|Alt|Shift)-)*/.exec(chord)![0]
  return { keys: prefix ? prefix.slice(0, -1).split('-') : [], key: chord.slice(prefix.length) }
}

export function defaultShortcut(id: ShortcutId, platform: string) {
  const item = catalog.get(id)!
  return (platform === 'darwin' ? item.mac ?? item.key : item.key) ?? ''
}

export function shortcutValue(overrides: ShortcutOverrides, id: ShortcutId, platform: string) {
  return overrides[id] ?? defaultShortcut(id, platform)
}

export function inputChord(input: { key: string; code: string; meta: boolean; control: boolean; alt: boolean; shift: boolean }, platform: string) {
  if (input.meta && platform !== 'darwin') return
  let key = input.key === ' ' ? 'Space' : input.key.length === 1 ? input.key.toLowerCase() : input.key
  if ((input.shift || input.alt) && key.length === 1 && !/^[a-z]$/.test(key)) {
    if (punctuation[input.code]) key = punctuation[input.code]
    else if (/^(?:Key[A-Z]|Digit\d)$/.test(input.code)) key = input.code.at(-1)!.toLowerCase()
  }
  if (!singleKey.test(key)) return
  return [platform === 'darwin' ? input.meta && 'Mod' : input.control && 'Mod', platform === 'darwin' && input.control && 'Ctrl',
    input.alt && 'Alt', input.shift && 'Shift', key].filter(Boolean).join('-')
}

function canonicalChord(value: string, platform: string) {
  const { keys, key } = chordParts(value)
  if (!singleKey.test(key)) return
  const normal = keys.map(part => platform !== 'darwin' && part === 'Ctrl' ? 'Mod' : part)
  return [...modifiers.filter(part => normal.includes(part)), key].join('-')
}

const reserved = new Set(['Mod-a', 'Mod-c', 'Mod-v', 'Mod-Shift-v', 'Mod-x', 'Mod-z', 'Mod-Shift-z', 'Mod-y', 'Mod-w', 'Mod-q',
  'Mod-Shift-a', 'Alt-F4', 'Mod-Alt-Escape'])
const macReserved = new Set(['Mod-h', 'Mod-Alt-h', 'Mod-m'])

export function normalizeShortcut(value: string, platform: string): string | undefined {
  if (!value) return ''
  if (value.length > 160) return
  const strokes = value.split(' ').map(part => canonicalChord(part, platform))
  const first = strokes[0]
  if (!first || strokes.length > 4 || strokes.some(stroke => !stroke || reserved.has(stroke) || platform === 'darwin' && macReserved.has(stroke)) ||
      !/^(?:Mod|Ctrl|Alt)-/.test(first)) return
  return strokes.join(' ')
}

export function shortcutConflicts(overrides: ShortcutOverrides, id: ShortcutId, value: string, platform: string) {
  if (!value) return []
  const scope = catalog.get(id)!.scope
  const key = value.split(' ').map(part => canonicalChord(part, platform)).join(' ')
  return shortcutCatalog.filter(item => {
    if (item.id === id) return false
    const other = shortcutValue(overrides, item.id, platform).split(' ').map(part => canonicalChord(part, platform)).join(' ')
    if (!other) return false
    if (item.scope !== scope) return (scope === 'app' || item.scope === 'app') && key.split(' ')[0] === other.split(' ')[0]
    return key === other || key.startsWith(other + ' ') || other.startsWith(key + ' ')
  })
}

export function setShortcut(overrides: ShortcutOverrides, id: ShortcutId, value: string, platform: string) {
  const normalized = normalizeShortcut(value, platform)
  if (normalized === undefined) return overrides
  const next = { ...overrides }
  for (const item of shortcutConflicts(overrides, id, normalized, platform)) {
    if (defaultShortcut(item.id, platform)) next[item.id] = ''
    else delete next[item.id]
  }
  if (normalized === normalizeShortcut(defaultShortcut(id, platform), platform)) delete next[id]
  else next[id] = normalized
  return next
}

export function readShortcutOverrides(input: unknown, platform: string) {
  let output: ShortcutOverrides = {}
  if (input && typeof input === 'object') {
    for (const [name, raw] of Object.entries(input)) {
      const id = name as ShortcutId
      if (!catalog.has(id) || typeof raw !== 'string') continue
      output = setShortcut(output, id, raw, platform)
    }
  }
  return output
}

const keyLabels: Record<string, string> = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
export function shortcutLabel(value: string, platform: string) {
  const labels: Record<string, string> = platform === 'darwin' ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }
  return value.split(' ').map(chord => {
    const { keys, key } = chordParts(chord)
    return [...keys.map(part => labels[part]), keyLabels[key] ?? (key.length === 1 ? key.toUpperCase() : key)].join(platform === 'darwin' ? '' : '+')
  }).join('  ')
}

export function shortcutAccelerator(value: string) {
  if (!value || value.includes(' ')) return
  const { keys, key } = chordParts(value)
  const nativeKey = key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, '')
  return [...keys.map(part => part === 'Mod' ? 'CommandOrControl' : part === 'Ctrl' ? 'Control' : part), nativeKey].join('+')
}

export function isShortcutAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false
  const parts = value.split('+')
  const name = parts.pop() ?? ''
  const key = name.length === 1 ? name.toLowerCase() : /^(Up|Down|Left|Right)$/.test(name) ? 'Arrow' + name : name
  return parts.length > 0 && parts.length <= 4 && new Set(parts).size === parts.length &&
    parts.every(part => ['CommandOrControl', 'Control', 'Alt', 'Shift'].includes(part)) && singleKey.test(key)
}

export function shortcutMenuLabel(label: string, value: string, platform: string) {
  return value.includes(' ') ? label + '  ' + shortcutLabel(value, platform) : label
}

export function shortcutsFor(scope: Scope, overrides: ShortcutOverrides, platform: string) {
  return shortcutCatalog.flatMap(item => {
    if (item.scope !== scope) return []
    const key = shortcutValue(overrides, item.id, platform)
    return key ? [{ id: item.id, value: key.split(' ').map(part => canonicalChord(part, platform)).join(' ') }] : []
  })
}

export class ShortcutSequence {
  private prefix = ''
  private expires = 0

  reset() { this.prefix = ''; this.expires = 0 }

  take(chord: string, bindings: { id: ShortcutId; value: string }[], repeat = false): ShortcutId | 'pending' | undefined {
    const now = Date.now()
    if (now > this.expires) this.reset()
    if (repeat) return this.prefix || bindings.some(item => item.value === chord || item.value.startsWith(chord + ' ')) ? 'pending' : undefined
    const next = this.prefix ? this.prefix + ' ' + chord : chord
    this.reset()
    const exact = bindings.find(item => item.value === next)
    if (exact) return exact.id
    if (bindings.some(item => item.value.startsWith(next + ' '))) {
      this.prefix = next
      this.expires = now + 4000
      return 'pending'
    }
  }
}
