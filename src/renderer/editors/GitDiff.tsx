import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { GitCompareArrows, ListFilter, ListTree, X } from 'lucide-react'
import { Text } from '@codemirror/state'
import type { GitFileHistory, GitFileVersion } from '../../shared/contracts'
import { GitMergeEditor, type ApplyGitChunk } from './GitMergeEditor'
import { currentFile, GitVersionPicker } from './GitVersionPicker'

const emptyVersion: GitFileVersion = { text: '', exists: false }
const normalize = (text: string) => Text.of(text.replace(/^\uFEFF/, '').split(/\r\n?|\n/))

function fileFormat(text: string) {
  const endings = new Set<string>()
  for (const [ending] of text.matchAll(/\r\n?|\n/g)) endings.add(ending)
  const names = [['\n', 'LF'], ['\r\n', 'CRLF'], ['\r', 'CR']].filter(([ending]) => endings.has(ending)).map(([, name]) => name)
  return [text.startsWith('\uFEFF') ? '有 BOM' : '无 BOM', names.join('/') || '无换行'].join(' · ')
}

function SplitHandle({ value, set }: { value: number; set: (value: number) => void }) {
  const drag = useRef<AbortController | null>(null)
  useEffect(() => () => { drag.current?.abort() }, [])
  const resize = (next: number) => set(Math.max(25, Math.min(75, Math.round(next))))
  return <div className="git-diff-divider" role="separator" aria-label="调整差异分栏宽度" aria-orientation="vertical"
    aria-valuenow={value} aria-valuemin={25} aria-valuemax={75} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      const handle = event.currentTarget
      const parent = handle.parentElement!
      const pointer = event.pointerId
      const offset = event.clientX - handle.getBoundingClientRect().left - handle.offsetWidth / 2
      drag.current?.abort()
      const controller = new AbortController()
      drag.current = controller
      const finish = () => { controller.abort(); if (drag.current === controller) drag.current = null }
      const end = (event: PointerEvent) => { if (event.pointerId === pointer) finish() }
      const options = { signal: controller.signal, capture: true }
      // Keep receiving moves if the browser releases pointer capture during a drag.
      window.addEventListener('pointermove', event => {
        if (event.pointerId !== pointer) return
        if (!(event.buttons & 1)) { finish(); return }
        const pivot = parent.getBoundingClientRect()
        const style = getComputedStyle(parent)
        const gutter = parseFloat(style.getPropertyValue('--git-diff-gutter'))
        const scrollbar = parseFloat(style.getPropertyValue('--git-diff-scrollbar')) || 0
        resize((event.clientX - offset - pivot.left) * 100 / Math.max(1, pivot.width - gutter - scrollbar))
      }, options)
      window.addEventListener('pointerup', end, options)
      window.addEventListener('pointercancel', end, options)
      window.addEventListener('blur', finish, { signal: controller.signal })
      handle.focus({ preventScroll: true })
      handle.setPointerCapture(event.pointerId)
    }}
    onKeyDown={event => {
      const values: Record<string, number> = { ArrowLeft: value - 5, ArrowRight: value + 5, Home: 25, End: 75 }
      if (!Object.hasOwn(values, event.key)) return
      event.preventDefault()
      resize(values[event.key])
    }} />
}

export function GitDiff({ path, text, branch, apply, close }: {
  path: string; text: string; branch: string; apply?: ApplyGitChunk; close: () => void
}) {
  const [repository, setRepository] = useState<{ history: GitFileHistory; headVersion?: GitFileVersion; baseline: string } | null>()
  const history = repository?.history
  const currentBranch = history ? history.branch ?? (history.head ? 'HEAD ' + history.head.slice(0, 7) : 'HEAD') : branch
  const [selectedLeftRef, setLeftRef] = useState<string>()
  const [rightRef, setRightRef] = useState(currentFile)
  const [loaded, setLoaded] = useState<{ pair: string; left: GitFileVersion; right?: GitFileVersion }>()
  const leftRef = selectedLeftRef ?? repository?.baseline ?? ''
  const pair = leftRef + ':' + rightRef
  const versions = loaded?.pair === pair ? loaded : undefined
  const [error, setError] = useState('')
  const [full, setFull] = useState(false)
  const [split, setSplit] = useState(50)
  const back = useRef<HTMLButtonElement>(null)
  const draft = useRef(text)
  draft.current = text
  const working = useMemo(() => normalize(text), [text])
  const left = useMemo(() => versions && normalize(versions.left.text), [versions?.left])
  const historical = useMemo(() => versions?.right && normalize(versions.right.text), [versions?.right])
  const right = rightRef === currentFile ? working : historical
  const canApply = rightRef === currentFile && !!apply
  const showingLastChange = !!repository?.headVersion && text === repository.headVersion.text &&
    rightRef === currentFile && leftRef === history?.previous
  const sameContent = left && right && left.eq(right)
  const rightVersion = rightRef === currentFile ? { text, exists: true } : versions?.right
  const formatNotice = useMemo(() => {
    if (!sameContent || !versions || !rightVersion) return ''
    if (versions.left.exists !== rightVersion.exists) return versions.left.exists ? '右侧版本中无此文件' : '左侧版本中无此文件'
    if (versions.left.text === rightVersion.text) return ''
    const leftFormat = fileFormat(versions.left.text)
    const rightFormat = fileFormat(rightVersion.text)
    return leftFormat === rightFormat ? '换行符分布有变化，正文相同' : `文件格式有变化，正文相同。左侧 ${leftFormat}，右侧 ${rightFormat}`
  }, [sameContent, versions, rightVersion?.exists, rightVersion?.text])

  useEffect(() => { back.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    let active = true
    async function start() {
      const history = await window.desktop.gitHistory(path)
      if (!active) return
      if (!history) { setRepository(null); return }
      const headVersion = history.head && history.previous ? await window.desktop.gitVersion(path, history.head).catch(() => undefined) : undefined
      if (!active) return
      const previous = headVersion?.exists && headVersion.text === draft.current ? history.previous : null
      setRepository({ history, headVersion, baseline: previous ?? history.head ?? '' })
    }
    void start().catch(error => { if (active) setError(gitError(error)) })
    return () => { active = false }
  }, [path])

  useEffect(() => {
    if (!repository) return
    let active = true
    setError('')
    const version = (ref: string) => !ref ? Promise.resolve(emptyVersion) : ref === repository.history.head && repository.headVersion
      ? Promise.resolve(repository.headVersion) : window.desktop.gitVersion(path, ref)
    const left = version(leftRef)
    const right = rightRef === currentFile ? Promise.resolve(undefined) : version(rightRef)
    void Promise.all([left, right]).then(([left, right]) => {
      if (active) setLoaded({ pair, left, right })
    }, error => { if (active) setError(gitError(error)) })
    return () => { active = false }
  }, [repository, leftRef, pair, path, rightRef])

  return <section className="git-diff" aria-label="Git 差异" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close() }
  }}>
    <header className="git-diff-toolbar">
      <span className="git-diff-title"><GitCompareArrows size={16} />Git 差异 <span title={currentBranch}>{currentBranch}</span></span>
      {showingLastChange && <span className="git-diff-baseline" title="当前文件与 HEAD 一致，正在对比此文件的上一版本">上次变更</span>}
      <button type="button" className="tool-button" aria-label="显示完整内容" aria-pressed={full}
        title={full ? '切换为仅显示变化' : '切换为完整内容'} onClick={() => setFull(value => !value)}>
        {full ? <ListTree size={16} /> : <ListFilter size={16} />}{full ? '完整内容' : '仅显示变化'}
      </button>
      <button type="button" ref={back} className="icon-button" title="返回编辑" aria-label="返回编辑" onClick={close}><X size={17} /></button>
    </header>
    <div className="git-diff-split" data-applicable={canApply} style={{ '--git-diff-ratio': split / 100 } as CSSProperties}>
      {history && <div className="git-diff-versions">
        <GitVersionPicker side="left" value={leftRef} commits={history.commits} head={history.head} select={setLeftRef} version={versions?.left} />
        <GitVersionPicker side="right" value={rightRef} commits={history.commits} head={history.head} select={setRightRef} version={versions?.right} />
      </div>}
      {error ? <p className="git-diff-status" role="alert">{error}</p>
        : repository === null ? <p className="git-diff-status" role="status">该文件的 Git 仓库已不可用。</p>
        : !left || !right ? <p className="git-diff-status" role="status">正在读取 Git 版本…</p>
        : !full && sameContent ? <p className="git-diff-status" role="status">{formatNotice || '没有内容差异'}</p>
        : <>{formatNotice && <p className="git-diff-format" role="status">{formatNotice}</p>}
          <GitMergeEditor {...{ left, right, full, split }} apply={canApply ? apply : undefined} /></>}
      {history && <SplitHandle value={split} set={setSplit} />}
    </div>
  </section>
}

function gitError(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
}
