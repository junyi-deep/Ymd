import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileKind } from './files'
import type { Entry, SearchHit } from '../shared/contracts'

type MatchEvent = {
  type: string
  data: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: { start: number }[]
  }
}
const limit = 100
const rgArgs = ['--no-config', '--no-ignore', '--glob-case-insensitive', '-g', '*.md', '-g', '*.excalidraw', '-g', '!node_modules/**', '-g', '!**/node_modules/**']
const fold = (text: string) => text.toLowerCase()

function runRipgrep(binary: string, cwd: string, args: string[], signal: AbortSignal, onLine: (line: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, [...rgArgs, ...args], { cwd, signal, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const output = createInterface({ input: child.stdout, crlfDelay: Infinity })
    output.on('line', onLine)
    child.on('error', error => {
      if (signal.aborted) resolve()
      else reject(error)
    })
    child.on('close', code => {
      // Exit 2 also covers a directory with an unreadable descendant, even when
      // other eligible files were successfully searched.
      if (signal.aborted || code === 0 || code === 1 || code === 2) resolve()
      else reject(new Error('无法完成文档搜索。'))
    })
  })
}

function withFilePath(root: Entry, name: string): { path: string; name: string; kind: SearchHit['kind']; location: string } | undefined {
  const file = path.resolve(root.path, name)
  const relative = path.relative(root.path, file)
  const fileName = path.basename(file)
  const kind = fileKind(fileName)
  if (!kind || !relative || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.'))) return
  return { path: file, name: fileName, kind, location: path.join(root.name, path.dirname(relative)) }
}

function snippet(line: string, offset: number, query: string) {
  const from = Math.max(0, offset - 24)
  const to = Math.min(line.length, Math.max(offset + query.length + 75, from + 135))
  return (from ? '…' : '') + line.slice(from, to).trim() + (to < line.length ? '…' : '')
}

export async function searchRoots(binary: string, roots: Entry[], query: string, signal: AbortSignal) {
  const needle = fold(query)
  const names = new Map<string, SearchHit>()
  const bodies = new Map<string, SearchHit>()
  async function searchLocation(location: Entry) {
    const standalone = location.kind !== 'directory'
    const directory = path.dirname(location.path)
    const root = standalone ? { path: directory, name: path.basename(directory), kind: 'directory' as const } : location
    if (!(await stat(root.path).catch(() => null))?.isDirectory()) return
    const target = standalone ? './' + path.basename(location.path) : '.'
    if (standalone && names.size < limit && fold(location.name).includes(needle)) {
      names.set(location.path, { ...location, kind: location.kind as SearchHit['kind'], location: root.name })
    }
    const filenameSearch = !standalone && runRipgrep(binary, root.path, ['--files', '.'], signal, name => {
      if (names.size >= limit) return
      const entry = withFilePath(root, name)
      if (entry && fold(entry.name).includes(needle)) names.set(entry.path, entry)
    })
    const contentSearch = location.kind !== 'drawing' && runRipgrep(binary, root.path, [
      '-g', '!*.excalidraw', '--json', '--fixed-strings', '--ignore-case', '--max-count=1', '--max-filesize=8M', '--', query, target,
    ], signal, line => {
      if (bodies.size >= limit || !line.includes('"type":"match"')) return
      let match: MatchEvent
      try { match = JSON.parse(line) } catch { return }
      const source = match.data.lines?.text?.replace(/\r?\n$/, '')
      const relative = match.data.path?.text
      if (source === undefined || relative === undefined) return
      const entry = withFilePath(root, relative)
      if (!entry || entry.kind !== 'markdown') return
      const byteOffset = match.data.submatches?.[0]?.start ?? 0
      // ripgrep reports UTF-8 byte offsets, while the UI uses UTF-16 offsets.
      const offset = Buffer.from(source).subarray(0, byteOffset).toString().length
      bodies.set(entry.path, { ...entry, snippet: snippet(source, offset, query), line: match.data.line_number })
    })
    await Promise.all([filenameSearch, contentSearch])
  }
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, roots.length) }, async () => {
    while (!signal.aborted && next < roots.length && (names.size < limit || bodies.size < limit)) await searchLocation(roots[next++])
  }))
  if (signal.aborted) return []
  const hits = [...names.values()].map(hit => bodies.get(hit.path) ?? hit)
    .concat([...bodies.values()].filter(hit => !names.has(hit.path))).slice(0, limit)
  return Promise.all(hits.map(async hit => {
    const info = await stat(hit.path).catch(() => undefined)
    return { ...hit, created: info && info.birthtimeMs > 0 ? info.birthtimeMs : undefined, modified: info?.mtimeMs }
  }))
}
