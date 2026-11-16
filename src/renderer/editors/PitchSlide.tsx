import type { CSSProperties } from 'react'
import { pitchThemes, type PitchOptions } from '../../shared/pitch'
import { pitchImageForSlide, type PitchSlide as Slide } from './pitchDeck'

export function PitchSlide({ slide, options, animate = false }: { slide: Slide; options: PitchOptions; animate?: boolean }) {
  const { topic, kind, first, end } = slide
  const theme = pitchThemes[options.theme]
  const hasTopics = kind === 'topics'
  const layout = topic.options.layout
  const image = pitchImageForSlide(slide)
  const position = topic.options.image === 'auto' ? 'right' : topic.options.image
  const lyrics = layout === 'lyrics'
  const rolling = lyrics && topic.options.delivery !== 'all'
  const rows = hasTopics ? topic.children.slice(rolling ? Math.max(first, end - 3) : first, end) : []
  const swatches = { '--pitch-paper': theme.background, '--pitch-text': theme.text, '--pitch-muted': theme.muted,
    '--pitch-accent': theme.accent } as CSSProperties
  return <article className="pitch-paper" data-kind={kind} data-list={layout} data-image={image ? position : undefined}
    data-portrait={options.ratio === '9:16' || options.ratio === '3:4' || undefined}
    data-animate={animate || undefined} style={swatches} aria-label={topic.title}>
    <div className="pitch-slide-copy">
      <h1 data-long={topic.title.length > 50 || undefined}>{topic.title}</h1>
      {hasTopics && <ol className="pitch-items" data-size={rows.length > 4 ? 'dense' : undefined}>
        {rows.map((child, index) => <li key={child.id} data-long={child.title.length > 50 || undefined}
          data-current={rolling && index === rows.length - 1 || undefined}>{child.title}</li>)}
      </ol>}
    </div>
    {image && <img className="pitch-image" decoding="async" src={image} alt="" draggable={false} />}
    {options.watermark && <small className="pitch-mark">由 Ymd 演示</small>}
  </article>
}
