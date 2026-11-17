import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronRight, Trash2 } from 'lucide-react'
import type { JournalDay, JournalList } from '../shared/contracts'
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
      : <span className="subtle">{contents === null ? '无法读取日志。' : contents || draft !== undefined ? '空日志' : '正在加载…'}</span>}
    {(draft !== undefined ? draft.length > 4_096 : contents?.truncated) && <span className="subtle" aria-label="日志预览已截断">…</span>}
  </div>
}

export default function JournalStream({ list, active, drafts, remoteImages, followLink, open, clean, cleaning, children }: {
  list?: JournalList; active: string; drafts: Map<string, string>; remoteImages: boolean
  followLink: (path: string, href: string) => void; open: (date?: string) => void; clean: () => void; cleaning: boolean
  children: ReactNode
}) {
  const [count, setCount] = useState(pageSize)
  const selected = useRef<HTMLElement>(null)
  const days = list?.days ?? []
  const current = days.findIndex(day => day.path === active)
  const limit = Math.max(count, current + 1)
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }) }, [active, current < 0])
  return <section className="journal-stream" aria-label="每日日志">
    <header className="journal-stream-header">
      <h1>每日日志</h1>
      <button type="button" className="tool-button" onClick={() => open()}><CalendarDays size={16} />今天</button>
      <button type="button" className="tool-button" disabled={cleaning} onClick={clean}>
        <Trash2 size={15} />{cleaning ? '正在清理…' : '清理空日志'}
      </button>
    </header>
    {!list ? <div className="startup">正在加载日志…</div> : <>
      {days.slice(0, limit).map(day => {
        const editing = day.path === active
        return <article key={day.date} ref={editing ? selected : undefined} className="journal-day" data-journal-date={day.date}
          data-editing={editing} aria-label={day.date}>
          <h2>{editing ? <time dateTime={day.date}>{day.date}</time> :
            <button type="button" onClick={() => open(day.date)} aria-label={'编辑日志 ' + day.date}>
              <time dateTime={day.date}>{day.date}</time><ChevronRight size={14} />
            </button>}
          </h2>
          {editing ? <div className="journal-editor">{children}</div>
            : <JournalPreview day={day} draft={drafts.get(day.path)} {...{ remoteImages, followLink, open }} />}
        </article>
      })}
      {current < 0 && <div className="journal-editor">{children}</div>}
      {limit < days.length && <button type="button" className="tool-button journal-more" onClick={() => setCount(limit + pageSize)}>显示更早日志</button>}
    </>}
  </section>
}
