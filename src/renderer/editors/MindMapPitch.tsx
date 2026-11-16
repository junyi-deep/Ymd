import { ArrowLeft, ArrowRight, CircleHelp, CornerUpLeft, Download, Maximize, Minimize, PanelRight, Settings2, SkipForward, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pitchRatios, type PitchDesktop, type PitchOptions } from '../../shared/pitch'
import { PitchNavigator } from './PitchNavigator'
import { PitchOptionFields } from './PitchOptions'
import { PitchSlide } from './PitchSlide'
import { buildPitchDeck, type PitchSlide as Slide } from './pitchDeck'
import './pitch.css'

type Loaded = Awaited<ReturnType<PitchDesktop['load']>>

function Frame({ slide, options, animate }: { slide: Slide; options: PitchOptions; animate?: boolean }) {
  const ratio = pitchRatios[options.ratio]
  return <div className="pitch-viewport">
    <div className="pitch-frame" style={ratio ? { width: 'min(100cqw, calc(100cqh * ' + ratio + '))', aspectRatio: ratio } : undefined}>
      <PitchSlide key={slide.topic.id + ':' + slide.kind + ':' + slide.first} slide={slide} options={options} animate={animate} />
    </div>
  </div>
}

function Presentation({ request }: { request: Loaded }) {
  const { root, title, platform } = request
  const model = useMemo(() => buildPitchDeck(root), [root])
  const [index, setIndex] = useState(() => request.start ? model.jump.get(request.start) ?? 0 : 0)
  const [options, setOptions] = useState(request.options)
  const [fullscreen, setFullscreen] = useState(request.fullscreen)
  const [presenter, setPresenter] = useState(request.mode === 'presenter')
  const [popup, setPopup] = useState<'settings' | 'export'>()
  const [showKeys, setShowKeys] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const surface = useRef<HTMLElement>(null)
  const help = useRef<HTMLDialogElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const { slides, jump, after } = model
  const slide = slides[index]
  const next = slides[index + 1]
  const revealed = slide.kind === 'topics' && slide.topic.options.delivery !== 'all' ? slide.topic.children[slide.end - 1] : undefined
  const active = revealed?.id ?? slide.topic.id
  const skippable = slide.topic.options.delivery === 'step' && revealed ? index + 1 : after.get(active) ?? index + 1
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl'

  const report = (error: unknown) => setNotice(error instanceof Error ? error.message : '演示操作失败。')
  const change = (patch: Partial<PitchOptions>) => setOptions(current => ({ ...current, ...patch }))
  const focus = () => surface.current?.focus({ preventScroll: true })
  const position = (value: number) => {
    setIndex(Math.max(0, Math.min(slides.length - 1, value)))
    focus()
  }
  const select = (id: string) => position(jump.get(id) ?? 0)
  const exit = () => { void window.pitch.close().catch(report) }
  const toggleFullscreen = () => { void window.pitch.fullscreen(!fullscreen).catch(report); focus() }

  useEffect(() => {
    focus()
    return window.pitch.onFullscreen(setFullscreen)
  }, [])
  useEffect(() => {
    if (showKeys) help.current?.showModal()
    else if (help.current?.open) { help.current.close(); focus() }
  }, [showKeys])
  useEffect(() => {
    if (!popup) return
    const dismiss = (event: PointerEvent) => { if (!toolbar.current?.contains(event.target as Node)) setPopup(undefined) }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [popup])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return
      const key = event.key.toLowerCase()
      if (key === 'escape') {
        event.preventDefault()
        if (showKeys) setShowKeys(false)
        else if (popup) { setPopup(undefined); focus() }
        else exit()
        return
      }
      if (showKeys || event.target instanceof Element && event.target.closest('input, select, textarea')) return
      const command = event.metaKey || event.ctrlKey
      if (command && key === 'arrowright') position(skippable)
      else if (command && key === 'arrowleft' && slide.parent) select(slide.parent)
      else if (command || event.altKey) return
      else if (['arrowright', 'arrowdown', 'pagedown'].includes(key) ||
        key === ' ' && !(event.target instanceof Element && event.target.closest('button,[role="button"]'))) position(index + 1)
      else if (['arrowleft', 'arrowup', 'pageup', 'backspace'].includes(key)) position(index - 1)
      else if (key === 'home') position(0)
      else if (key === 'end') position(slides.length - 1)
      else if (key === 'q') exit()
      else if (key === '?') setShowKeys(true)
      else if (key === 'a') change({ animation: !options.animation })
      else if (key === 'f') toggleFullscreen()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  async function exportFile(format: 'pptx' | 'pdf') {
    if (pending) return
    setPending(true)
    setPopup(undefined)
    setNotice('')
    try {
      const { exportPitch } = await import('./pitchExport')
      if (await exportPitch(format, title, slides, options)) setNotice('演示文稿已保存。')
    } catch (error) { report(error) } finally { setPending(false); focus() }
  }

  return <main className="pitch-session" data-presenter={presenter} data-fullscreen={fullscreen} ref={surface} tabIndex={-1}
    aria-label={presenter ? '演讲者视图' : '导图演示'}>
    <div className="pitch-controls" ref={toolbar} role="group" aria-label="演示控制">
      <div className="pitch-control-group">
        <button type="button" className="pitch-exit" onClick={exit}>退出</button>
        <button type="button" title="演示设置" aria-label="演示设置" aria-expanded={popup === 'settings'}
          onClick={() => setPopup(popup === 'settings' ? undefined : 'settings')}><Settings2 size={17} /></button>
        <button type="button" title="演讲者视图" aria-label="演讲者视图" aria-pressed={presenter}
          onClick={() => { setPresenter(!presenter); focus() }}><PanelRight size={17} /></button>
        <button type="button" title={fullscreen ? '在窗口中播放' : '全屏播放'} aria-label={fullscreen ? '在窗口中播放' : '全屏播放'}
          onClick={toggleFullscreen}>{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}</button>
        <button type="button" title="演示快捷键" aria-label="演示快捷键" onClick={() => { setPopup(undefined); setShowKeys(true) }}><CircleHelp size={17} /></button>
        <button type="button" title="导出演示" aria-label="导出演示" aria-expanded={popup === 'export'} disabled={pending}
          onClick={() => setPopup(popup === 'export' ? undefined : 'export')}><Download size={17} /></button>
      </div>
      <div className="pitch-control-group">
        <button type="button" title="返回父主题" aria-label="返回父主题" disabled={!slide.parent}
          onClick={() => slide.parent && select(slide.parent)}><CornerUpLeft size={17} /></button>
        <button type="button" title="上一页" aria-label="上一页" disabled={index === 0} onClick={() => position(index - 1)}><ArrowLeft size={17} /></button>
        <output aria-label="幻灯片进度">{index + 1} / {slides.length}</output>
        <button type="button" title="下一页" aria-label="下一页" disabled={!next} onClick={() => position(index + 1)}><ArrowRight size={17} /></button>
        <button type="button" title="跳过当前分支" aria-label="跳过当前分支" disabled={skippable >= slides.length}
          onClick={() => position(skippable)}><SkipForward size={17} /></button>
      </div>
      {popup === 'settings' && <div className="pitch-popover" role="region" aria-label="演示设置">
        <PitchOptionFields options={options} change={change} />
      </div>}
      {popup === 'export' && <div className="pitch-popover pitch-export-menu" role="group" aria-label="导出格式">
        <button type="button" onClick={() => void exportFile('pptx')}>PowerPoint</button>
        <button type="button" onClick={() => void exportFile('pdf')}>PDF</button>
      </div>}
    </div>
    {presenter ? <div className="pitch-presenter">
      <section className="pitch-presenter-current" aria-label="当前幻灯片"><Frame slide={slide} options={options} />
        {slide.topic.note && <section className="pitch-notes" aria-label="演讲者备注">{slide.topic.note}</section>}
      </section>
      <aside className="pitch-presenter-side">
        {next && <section className="pitch-presenter-next" aria-label="下一页预览"><Frame slide={next} options={options} /></section>}
        <PitchNavigator root={root} active={active} jump={select} />
      </aside>
    </div> : <Frame slide={slide} options={options} animate={options.animation} />}
    {(notice || pending) && <div className="pitch-message" role="status">{pending ? '正在导出演示文稿…' : notice}
      {!pending && <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button>}
    </div>}
    <dialog className="pitch-keys" ref={help} onCancel={event => { event.preventDefault(); setShowKeys(false) }} aria-labelledby="pitch-keys-title">
      <header><h2 id="pitch-keys-title">演示快捷键</h2><button type="button" aria-label="关闭快捷键" onClick={() => setShowKeys(false)}><X size={16} /></button></header>
      <dl>{[['下一页', 'Space · → · ↓'], ['上一页', '← · ↑'], ['跳过当前分支', mod + ' + →'],
        ['返回父主题', mod + ' + ←'], ['切换全屏', 'F'], ['切换过渡动画', 'A'], ['退出演示', 'Esc · Q']].map(([label, shortcut]) =>
        <div key={label}><dt>{label}</dt><dd><kbd>{shortcut}</kbd></dd></div>)}</dl>
    </dialog>
  </main>
}

export function MindMapPitch() {
  const [request, setRequest] = useState<Loaded>()
  const [error, setError] = useState('')
  useEffect(() => { void window.pitch.load().then(setRequest, error => setError(String(error))) }, [])
  if (!request) return <main className="pitch-session pitch-loading" role="status">{error || '正在载入演示…'}
    {error && <button type="button" onClick={() => void window.pitch.close()}>退出</button>}</main>
  return <Presentation request={request} />
}
