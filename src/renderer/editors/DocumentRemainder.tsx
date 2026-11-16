import { useId } from 'react'
import type { Links } from 'marked'
import { OutlineMarkdown } from './OutlineMarkdown'

export function DocumentRemainder({ text, path, remoteImages, links, visible, onToggle, className }: {
  text: string; path: string; remoteImages: boolean; links?: Links
  visible: boolean; onToggle: (visible: boolean) => void; className?: string
}) {
  const id = useId()
  return <section className={'document-remainder' + (className ? ' ' + className : '')} aria-label="文档正文">
    <header><span>文档正文</span>
      <button type="button" className="switch" role="switch" aria-label="显示文档正文" aria-checked={visible}
        aria-controls={id} onClick={() => onToggle(!visible)} />
    </header>
    <div id={id} className="document-remainder-body" hidden={!visible}
      onClick={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault() }}>
      {visible && <OutlineMarkdown text={text} className="outline-markdown" {...{ path, remoteImages, links }} />}
    </div>
  </section>
}
