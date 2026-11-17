import type { MapData } from './mapAppearance'

export const numberingExtension = 'org.xmind.ui.numbering'
export const numberingPatterns = [
  ['numeral-arabic', '1. 2. 3.'],
  ['alphabet-uppercase', 'A. B. C.'],
  ['alphabet-lowercase', 'a. b. c.'],
  ['numeral-roman', 'I. II. III.'],
] as const
export type NumberingPattern = (typeof numberingPatterns)[number][0]
export interface TopicNumbering {
  pattern?: NumberingPattern
  tiered?: boolean
  fixedIndex?: number
  prefix?: string
  suffix?: string
  separator?: string
}

export function readNumbering(value: unknown): TopicNumbering | undefined {
  if (!value || typeof value !== 'object') return
  const data = value as Record<string, unknown>
  const pattern = numberingPatterns.find(([key]) => key === data.pattern)?.[0]
  const tiered = data.tiered
  const fixed = data.fixedIndex
  const fixedIndex = typeof fixed === 'number' && Number.isSafeInteger(fixed) && fixed >= 0 && fixed <= 10000 ? fixed : undefined
  if (!pattern && typeof tiered !== 'boolean' && fixedIndex === undefined) return
  const decoration = (key: string) => typeof data[key] === 'string' ? data[key].replace(/[\u0000-\u001f]/g, ' ').slice(0, 64) : undefined
  return { pattern, tiered: typeof tiered === 'boolean' ? tiered : undefined, fixedIndex,
    prefix: decoration('prefix'), suffix: decoration('suffix'), separator: decoration('separator') }
}

const legacyPatterns: Record<string, NumberingPattern> = {
  'org.xmind.numbering.arabic': 'numeral-arabic',
  'org.xmind.numbering.roman': 'numeral-roman',
  'org.xmind.numbering.uppercase': 'alphabet-uppercase',
  'org.xmind.numbering.lowercase': 'alphabet-lowercase',
}
export function legacyNumbering(value: Record<string, unknown>) {
  const pattern = typeof value.numberFormat === 'string' && Object.hasOwn(legacyPatterns, value.numberFormat)
    ? legacyPatterns[value.numberFormat] : undefined
  const numbering = pattern && readNumbering({ ...value, pattern, separator: value.numberSeparator ?? value.separator,
    tiered: value.prependingNumbers !== 'none' })
  if (!numbering) return
  const depth = Number(value.numberDepth)
  return { numbering, depth: Number.isInteger(depth) && depth > 0 ? Math.min(depth, 80) : 3 }
}

const romanDigits = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'],
  [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const

export function formatNumber(pattern: NumberingPattern, number: number) {
  if (pattern === 'numeral-arabic') return String(number)
  let label = ''
  if (pattern === 'numeral-roman') {
    for (const [value, glyph] of romanDigits) {
      label += glyph.repeat(Math.floor(number / value))
      number %= value
    }
    return label
  }
  while (number > 0) {
    number--
    label = String.fromCharCode(65 + number % 26) + label
    number = Math.floor(number / 26)
  }
  return pattern === 'alphabet-lowercase' ? label.toLowerCase() : label
}

export const attachedTopic = (topic: MapData) => topic.data.ymdFloating !== true

export type NumberingEdit = { pattern: NumberingPattern | null } | { tiered: boolean } | { restart: boolean } | { siblings: true }

export function editNumbering(tree: MapData, selected: Set<string>, edit: NumberingEdit) {
  let changed = false
  function write(topic: MapData, config: TopicNumbering | null) {
    const next = readNumbering(config) ?? null
    if (JSON.stringify(readNumbering(topic.data.ymdNumbering) ?? null) === JSON.stringify(next)) return
    topic.data.ymdNumbering = next
    changed = true
  }
  function visit(parent: MapData) {
    const children = parent.children
    if (!children?.length) return
    const siblings = children.filter(attachedTopic)
    const targets = siblings.filter(topic => topic.data.uid && selected.has(topic.data.uid))
    if (targets.length) {
      if ('siblings' in edit) {
        const source = targets.map(topic => readNumbering(topic.data.ymdNumbering)).find(config => config?.pattern)
        if (source) {
          for (const sibling of siblings) write(sibling, { ...source, fixedIndex: readNumbering(sibling.data.ymdNumbering)?.fixedIndex })
        }
      } else if ('tiered' in edit) {
        for (const sibling of siblings) {
          const config = readNumbering(sibling.data.ymdNumbering)
          write(sibling, edit.tiered || config?.pattern || config?.fixedIndex !== undefined ? { ...config, tiered: edit.tiered } : null)
        }
      } else {
        for (const topic of targets) {
          const config = readNumbering(topic.data.ymdNumbering)
          if ('pattern' in edit) write(topic, edit.pattern ? { ...config, pattern: edit.pattern } : null)
          else write(topic, { ...config, fixedIndex: edit.restart ? 0 : undefined })
        }
      }
    }
    children.forEach(visit)
  }
  visit(tree)
  return changed
}

export function numberingLabels(tree: MapData) {
  const labels = new Map<MapData, string>()
  function visit(parent: MapData, parentNumber: string) {
    const indexes = new Map<NumberingPattern, number>()
    for (const topic of parent.children ?? []) {
      let number = ''
      const config = attachedTopic(topic) ? readNumbering(topic.data.ymdNumbering) : undefined
      if (config?.pattern) {
        const index = config.fixedIndex ?? (indexes.get(config.pattern) ?? -1) + 1
        indexes.set(config.pattern, index)
        number = (config.tiered ? parentNumber : '') + formatNumber(config.pattern, index + 1) + (config.separator ?? '.')
        labels.set(topic, (config.prefix ?? '') + number + (config.suffix ?? ''))
      }
      if (topic.children?.length) visit(topic, number)
    }
  }
  visit(tree, '')
  return labels
}
