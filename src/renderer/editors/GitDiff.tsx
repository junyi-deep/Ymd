import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, GitCompareArrows, ListFilter, ListTree, TextCursorInput, X } from 'lucide-react'
import { Text } from '@codemirror/state'
import type { GitFileHistory, GitFileVersion } from '../../shared/contracts'
import { GitMergeEditor, type ApplyGitChunk, type GitDiffControls, type GitDiffNavigation } from './GitMergeEditor'
import { currentFile, GitVersionPicker } from './GitVersionPicker'
import { diffDetails, type DiffDetail } from './gitDiffChanges'
import { MarkdownMenu } from './MarkdownMenu'

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
  path: string; text: string; branch: string; apply?: ApplyGitChunk; close: (position?: number) => void
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
  const [detail, setDetail] = useState<DiffDetail>('word')
  const [detailMenu, setDetailMenu] = useState(false)
  const [navigation, setNavigation] = useState<(GitDiffNavigation & { pair: string })>()
  const controls = useRef<GitDiffControls>(null)
  const detailButton = useRef<HTMLButtonElement>(null)
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
  const nav = !error && left && right && !sameContent && navigation?.pair === pair ? navigation : undefined
  const canPrevious = !!nav && nav.index > 0
  const canNext = !!nav && nav.index + 1 < nav.count
  const move = (direction: number) => {
    if (direction < 0 ? canPrevious : canNext) controls.current?.move(direction)
  }
  const jumpToSource = () => {
    const position = controls.current?.workingPosition()
    if (rightRef === currentFile && position !== undefined) close(position)
  }
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
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key === 'F7') { event.preventDefault(); move(event.shiftKey ? -1 : 1) }
    if (event.key === 'F4' && rightRef === currentFile && nav) { event.preventDefault(); jumpToSource() }
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close() }
  }}>
    <header className="git-diff-toolbar">
      <span className="git-diff-title"><GitCompareArrows size={16} />Git 差异 <span title={currentBranch}>{currentBranch}</span></span>
      {showingLastChange && <span className="git-diff-baseline" title="当前文件与 HEAD 一致，正在对比此文件的上一版本">上次变更</span>}
      <div className="git-diff-navigation" role="group" aria-label="变更导航">
        <button type="button" className="icon-button" aria-label="上一处变更" title="上一处变更 (Shift+F7)" disabled={!canPrevious} onClick={() => move(-1)}><ArrowUp size={16} /></button>
        <span role="status" aria-live="polite" aria-label={nav ? `第 ${nav.index + 1} 处，共 ${nav.count} 处变更` : undefined}>
          {nav ? `${nav.index + 1} / ${nav.count}` : '0'}</span>
        <button type="button" className="icon-button" aria-label="下一处变更" title="下一处变更 (F7)" disabled={!canNext} onClick={() => move(1)}><ArrowDown size={16} /></button>
      </div>
      {canApply && <button type="button" className="icon-button git-diff-apply" title="将选中的左侧变更应用到当前文件"
        aria-label="应用当前变更" disabled={!nav} onClick={() => controls.current?.apply()}><ArrowRight size={17} /></button>}
      {rightRef === currentFile && <button type="button" className="icon-button" title="跳到编辑位置 (F4)"
        aria-label="跳到编辑位置" disabled={!nav} onClick={jumpToSource}><TextCursorInput size={16} /></button>}
      <div className="menu-anchor git-diff-detail">
        <button ref={detailButton} type="button" className="tool-button" aria-label="差异高亮粒度" aria-haspopup="menu"
          aria-expanded={detailMenu} title="差异高亮粒度" onClick={() => setDetailMenu(!detailMenu)}>{diffDetails[detail]}</button>
        {detailMenu && <MarkdownMenu close={() => setDetailMenu(false)} items={Object.entries(diffDetails).map(([value, label]) => ({
          label, selected: detail === value, run: () => { setDetail(value as DiffDetail); detailButton.current?.focus() },
        }))} />}
      </div>
      <button type="button" className="tool-button" aria-label="显示完整内容" aria-pressed={full}
        title={full ? '切换为仅显示变化' : '切换为完整内容'} onClick={() => setFull(value => !value)}>
        {full ? <ListTree size={16} /> : <ListFilter size={16} />}<span className="git-diff-display-label">{full ? '完整内容' : '仅显示变化'}</span>
      </button>
      <button type="button" ref={back} className="icon-button" title="返回编辑" aria-label="返回编辑" onClick={() => close()}><X size={17} /></button>
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
          <GitMergeEditor {...{ left, right, full, split, detail, controls }} apply={canApply ? apply : undefined}
            report={value => setNavigation({ ...value, pair })} /></>}
      {history && <SplitHandle value={split} set={setSplit} />}
    </div>
  </section>
}

function gitError(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
}
