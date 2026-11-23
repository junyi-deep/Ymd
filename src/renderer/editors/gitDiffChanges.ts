import { Change, diff } from '@codemirror/merge'
import { diffArrays, diffLines } from 'diff'

export type DiffDetail = 'line' | 'word' | 'character'
export const diffDetails = { line: '按行', word: '按词', character: '按字符' } as const

type DiffPart = { value: string; added?: boolean; removed?: boolean }

function changedRanges(parts: readonly DiffPart[]) {
  const result: Change[] = []
  let a = 0, b = 0, fromA = 0, fromB = 0
  const flush = () => {
    if (a !== fromA || b !== fromB) result.push(new Change(fromA, a, fromB, b))
  }
  for (const { value, added, removed } of parts) {
    if (added) b += value.length
    else if (removed) a += value.length
    else {
      flush()
      fromA = a += value.length
      fromB = b += value.length
    }
  }
  flush()
  return result
}

export function lineChanges(a: string, b: string): readonly Change[] {
  if (a === b) return []
  const parts = diffLines(a, b, { timeout: 75, maxEditLength: 2400 })
  return parts ? changedRanges(parts) : diff(a, b, { scanLimit: 600, timeout: 35 })
}

const segmenters = {
  word: new Intl.Segmenter(undefined, { granularity: 'word' }),
  character: new Intl.Segmenter(undefined, { granularity: 'grapheme' }),
}

export function inlineChanges(a: string, b: string, detail: Exclude<DiffDetail, 'line'>) {
  const broad = [new Change(0, a.length, 0, b.length)]
  if (a.length + b.length > 2500) return broad
  const tokenize = (text: string) => Array.from(segmenters[detail].segment(text), ({ segment }) => segment)
  const parts = diffArrays(tokenize(a), tokenize(b), { timeout: 5, maxEditLength: 160 })
  return parts ? changedRanges(parts.map(part => ({ ...part, value: part.value.join('') }))) : broad
}
