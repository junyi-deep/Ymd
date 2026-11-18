import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Text } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'
import { createDocumentFindPanel } from './documentFind'
import { flattenBlocks } from './outlineEditing'
import type { Block, Projection } from './listProjection'

type Match = { key: string; from: number; to: number; precise?: boolean; match?: RegExpExecArray }
const normalize = (source: string) => source.replace(/\r\n?/g, '\n')

function findMatches(query: SearchQuery, blocks: Block[], projection: Projection) {
  const matches: Match[] = []
  if (!query.valid) return matches
  function search(key: string, source: string) {
    const cursor = query.getCursor(Text.of(normalize(source).split('\n')))
    for (let item = cursor.next(); !item.done; item = cursor.next()) matches.push({ key, ...item.value })
  }
  const before = projection.before.replace(/^\uFEFF/, '')
  if (before) search('before', before)
  for (const block of flattenBlocks(blocks)) search(block.id, block.text)
  if (projection.after) search('after', projection.after)
  return matches
}

const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\' }
function replacement(query: SearchQuery, result: Match) {
  const value = query.replace.replace(/\\([nrt\\])/g, (_, character: string) => escapes[character])
  const groups = result.match
  if (!groups) return value
  return value.replace(/\$([$&]|\d+)/g, (token, group: string) => {
    if (group === '$') return '$'
    if (group === '&') return groups[0]
    for (let size = group.length; size > 0; size--) {
      const index = Number(group.slice(0, size))
      if (index > 0 && index < groups.length) return (groups[index] ?? '') + group.slice(size)
    }
    return token
  })
}

function replaceMatches(query: SearchQuery, blocks: Block[], projection: Projection, matches: Match[]) {
  const byKey = new Map<string, Match[]>()
  for (const match of matches) {
    if (match.precise === false) continue
    const part = byKey.get(match.key)
    if (part) part.push(match)
    else byKey.set(match.key, [match])
  }
  function update(key: string, source: string, newline = '\n') {
    const ranges = byKey.get(key)
    if (!ranges) return source
    // Cursor offsets count CRLF as one character. Copy the unchanged spans from the original text.
    const pairs = [...source.matchAll(/\r\n/g)].map(pair => pair.index)
    let offset = 0
    const raw = (position: number) => {
      while (offset < pairs.length && pairs[offset] < position + offset) offset++
      return position + offset
    }
    const chunks: string[] = []
    let end = 0
    for (const match of ranges) {
      chunks.push(source.slice(end, raw(match.from)), normalize(replacement(query, match)).replaceAll('\n', newline))
      end = raw(match.to)
    }
    return chunks.join('') + source.slice(end)
  }
  const bom = projection.before.startsWith('\uFEFF') ? '\uFEFF' : ''
  const before = bom + update('before', projection.before.slice(bom.length), projection.newline)
  const after = update('after', projection.after, projection.newline)
  const updateBlocks = (nodes: Block[]): Block[] => nodes.map(block => ({
    ...block, text: update(block.id, block.text), children: updateBlocks(block.children),
  }))
  return { blocks: updateBlocks(blocks), projection: { ...projection, before, after } }
}

type Options = {
  find: number
  host: RefObject<HTMLDivElement | null>
  root: RefObject<HTMLDivElement | null>
  platform: string
  blocks: Block[]
  projection: Projection
  reveal: (key: string) => void
  apply: (blocks: Block[], projection: Projection) => void
}

export function useOutlineFind(options: Options) {
  const current = useRef(options)
  current.current = options
  const [shown, setShown] = useState<Match>()
  const active = useRef<Match | undefined>(undefined)
  const query = useRef(new SearchQuery({ search: '' }))
  const panel = useRef<ReturnType<typeof createDocumentFindPanel> | undefined>(undefined)
  const previousFind = useRef(options.find)

  function show(match?: Match) {
    active.current = match
    if (match) current.current.reveal(match.key)
    setShown(match)
  }

  function snapshot() {
    const { blocks, projection } = current.current
    const matches = findMatches(query.current, blocks, projection)
    const selected = active.current
    const index = selected ? matches.findIndex(match => match.key === selected.key && match.from === selected.from && match.to === selected.to) : -1
    return { blocks, projection, matches, index }
  }

  function navigate(backward: boolean) {
    const { matches, index } = snapshot()
    if (!matches.length) { show(); return }
    const start = index < 0 && backward ? 0 : index
    show(matches[(start + (backward ? -1 : 1) + matches.length) % matches.length])
  }

  function replace(all: boolean) {
    const { blocks, projection, matches, index } = snapshot()
    if (!matches.length) return
    if (!all && (index < 0 || matches[index].precise === false)) { navigate(false); return }
    const changed = replaceMatches(query.current, blocks, projection, all ? matches : [matches[index]])
    current.current.apply(changed.blocks, changed.projection)
    if (all) { show(); return }

    const replaced = matches[index]
    const inserted = normalize(replacement(query.current, replaced)).length
    const end = replaced.from + (replaced.from === replaced.to && !inserted ? 1 : inserted)
    const nextPart = matches.slice(index + 1).find(match => match.key !== replaced.key)?.key
    const remaining = findMatches(query.current, changed.blocks, changed.projection)
    const next = remaining.find(match => match.key === replaced.key && match.from >= end)
      ?? remaining.find(match => match.key === nextPart)
    show(next ?? remaining[0])
  }

  function close() {
    panel.current?.dom.remove()
    panel.current = undefined
    show()
    current.current.root.current?.focus({ preventScroll: true })
  }

  function keydown(event: KeyboardEvent) {
    if (!panel.current || event.isComposing || event.keyCode === 229 || event.altKey) return false
    if (event.key === 'Escape') { close(); return true }
    const mod = current.current.platform === 'darwin' ? event.metaKey : event.ctrlKey
    if (event.key !== 'F3' && !(mod && event.key.toLowerCase() === 'g')) return false
    navigate(event.shiftKey)
    return true
  }

  useLayoutEffect(() => {
    if (options.find === previousFind.current) return
    previousFind.current = options.find
    if (!panel.current) {
      const root = current.current.root.current
      const focused = document.activeElement
      const selection = document.getSelection()
      const selected = focused instanceof HTMLTextAreaElement && root?.contains(focused)
        ? focused.value.slice(focused.selectionStart, focused.selectionEnd)
        : selection?.anchorNode && root?.contains(selection.anchorNode) ? selection.toString() : ''
      if (selected && selected.length <= 100) {
        query.current = new SearchQuery({ ...query.current, search: selected.replaceAll('\n', '\\n') })
      }
      panel.current = createDocumentFindPanel(query.current, {
        change: value => {
          const prior = query.current
          query.current = value
          if (prior.search !== value.search || prior.caseSensitive !== value.caseSensitive ||
              prior.wholeWord !== value.wholeWord || prior.regexp !== value.regexp) show()
        },
        navigate, replace, close, keydown,
      })
      current.current.host.current?.append(panel.current.dom)
    }
    panel.current.focus()
  }, [options.find])

  useLayoutEffect(() => () => panel.current?.dom.remove(), [])
  useLayoutEffect(() => {
    if (shown) current.current.root.current?.querySelector('.outline-find-source mark')?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [shown])

  return { match: shown, keydown, clearMatch: () => { if (active.current) show() } }
}

export function OutlineFindSource({ source, match, excerpt }: { source: string; match: Match; excerpt?: boolean }) {
  const text = normalize(source.replace(/^\uFEFF/, ''))
  const start = excerpt ? text.lastIndexOf('\n', match.from - 1) + 1 : 0
  const lineEnd = excerpt ? text.indexOf('\n', match.to) : -1
  return <div className="outline-find-source">{text.slice(start, match.from)}<mark>{text.slice(match.from, match.to)}</mark>
    {text.slice(match.to, lineEnd < 0 ? undefined : lineEnd)}</div>
}
