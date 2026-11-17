import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BetweenHorizontalStart, Check, ChevronRight, ScanLine, Trash2 } from 'lucide-react'
import { MarkdownMenu } from './editors/MarkdownMenu'
import { markdownPageWidths, type MarkdownPageWidth, type JournalDay, type JournalList } from '../shared/contracts'
import { OutlineMarkdown } from './editors/OutlineMarkdown'

const pageSize = 24

function JournalPreview({ day, draft, remoteImages, followLink, open }: {
  day: JournalDay; draft?: string; remoteImages: boolean; followLink: (path: string, href: string) => void; open: (date: string) => void
}) {
  const target = useRef<HTMLDivElement>(null)
  const [contents, setContents] = useState<{ text: string; truncated: boolean } | null>()
  useEffect(() => {
    const element = target.current
    if (!element || draft !== undefined) return
    let current = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void window.desktop.previewJournal(day.date).then(value => { if (current) setContents(value) },
        () => { if (current) setContents(null) })
    }, { rootMargin: '400px 0px' })
    observer.observe(element)
    return () => { current = false; observer.disconnect() }
  }, [day.date, draft !== undefined])
  const text = (draft ?? contents?.text)?.slice(0, 4_096)
  return <div ref={target} className="journal-preview" onClick={event => {
    const link = event.target instanceof Element && event.target.closest<HTMLAnchorElement>('a[href]')
    if (link) {
      event.preventDefault()
      const href = link.getAttribute('href')
      if (href && !href.startsWith('#')) followLink(day.path, href)
    } else if (!(event.target instanceof Element && event.target.closest('button')) && document.getSelection()?.isCollapsed) {
      open(day.date)
    }
  }}>
    {text?.trim() ? <OutlineMarkdown text={text} path={day.path} remoteImages={remoteImages} className="outline-markdown" />
      : <span className="subtle">{contents === null ? '无法读取小记。' : contents || draft !== undefined ? '空小记' : '正在加载…'}</span>}
    {(draft !== undefined ? draft.length > 4_096 : contents?.truncated) && <span className="subtle" aria-label="小记预览已截断">…</span>}
  </div>
}

export default function JournalStream({ list, active, drafts, remoteImages, followLink, open, clean, cleaning, remove, width, setWidth, children }: {
  list?: JournalList; active: string; drafts: Map<string, string>; remoteImages: boolean
  followLink: (path: string, href: string) => void; open: (date?: string) => void; clean: () => void; cleaning: boolean
  remove: (day: JournalDay) => void; width: MarkdownPageWidth; setWidth: (value: MarkdownPageWidth) => void
  children: ReactNode
}) {
  const [confirm, setConfirm] = useState<string>()
  const [widthMenu, setWidthMenu] = useState(false)
  const [count, setCount] = useState(pageSize)
  const selected = useRef<HTMLElement>(null)
  const days = list?.days ?? []
  const current = days.findIndex(day => day.path === active)
  const limit = Math.max(count, current + 1)
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }) }, [active, current < 0])
  return <section className="journal-stream" aria-label="每日小记">
    <header className="journal-stream-header">
      <h1>每日小记</h1>
      <button type="button" className="tool-button" disabled={cleaning} onClick={clean}>
        <ScanLine size={15} />{cleaning ? '正在清理…' : '清理空小记'}
      </button>
    </header>
    {!list ? <div className="startup">正在加载小记…</div> : <>
      {days.slice(0, limit).map(day => {
        const editing = day.path === active
        return <article key={day.date} ref={editing ? selected : undefined} className="journal-day" data-journal-date={day.date}
          data-editing={editing} data-width={width} aria-label={day.date}>
          <header className="journal-day-header">
            <h2>{editing ? <time dateTime={day.date}>{day.date}</time> :
              <button type="button" onClick={() => open(day.date)} aria-label={'编辑小记 ' + day.date}>
                <time dateTime={day.date}>{day.date}</time><ChevronRight size={14} />
              </button>}
            </h2>
            <div className="journal-day-actions">
              {editing && <div className="menu-anchor">
                <button type="button" className="icon-button" aria-label="页宽设置" title="页宽设置"
                  aria-haspopup="menu" aria-expanded={widthMenu} onClick={() => setWidthMenu(!widthMenu)}><BetweenHorizontalStart size={16} /></button>
                {widthMenu && <MarkdownMenu close={() => setWidthMenu(false)} items={markdownPageWidths.map(([value, label]) => ({
                  label, selected: width === value, run: () => setWidth(value),
                }))} />}
              </div>}
              <button type="button" className="icon-button tree-delete" data-confirm={confirm === day.date}
                aria-label={(confirm === day.date ? '确认删除小记 ' : '删除小记 ') + day.date}
                title={confirm === day.date ? '确认移到回收站' : '移到回收站'}
                onBlur={() => setConfirm(undefined)} onKeyDown={event => { if (event.key === 'Escape') setConfirm(undefined) }}
                onClick={() => { if (confirm === day.date) { setConfirm(undefined); remove(day) } else setConfirm(day.date) }}>
                {confirm === day.date ? <Check size={16} /> : <Trash2 size={16} />}
              </button>
            </div>
          </header>
          {editing ? <div className="journal-editor">{children}</div>
            : <JournalPreview day={day} draft={drafts.get(day.path)} {...{ remoteImages, followLink, open }} />}
        </article>
      })}
      {current < 0 && <div className="journal-editor">{children}</div>}
      {limit < days.length && <button type="button" className="tool-button journal-more" onClick={() => setCount(limit + pageSize)}>显示更早小记</button>}
    </>}
  </section>
}
