import { X } from 'lucide-react'
import { pitchRatios, type PitchOptions, type PitchTopic, type PitchTopicOptions } from '../../shared/pitch'
import { PitchOptionFields, PitchTopicFields } from './PitchOptions'
import { PitchSlide } from './PitchSlide'
import './pitch.css'

export function MindMapPitchFormat({ options, topic, root, change, changeTopic, close }: {
  options: PitchOptions
  topic?: PitchTopic
  root: boolean
  change: (patch: Partial<PitchOptions>) => void
  changeTopic: (patch: Partial<PitchTopicOptions>) => void
  close: () => void
}) {
  return <aside className="map-format" aria-label="演示格式">
    <header><strong>演示格式</strong><button type="button" className="icon-button" aria-label="收起演示格式" onClick={close}><X size={16} /></button></header>
    <section><h3>演示文稿</h3><PitchOptionFields options={options} change={change} /></section>
    {topic && <><section><h3>{topic.title}</h3>
      <PitchTopicFields options={topic.options} root={root} image={!!topic.image} change={changeTopic} />
    </section>
      <section><h3>幻灯片预览</h3><div className="map-pitch-preview" style={{ aspectRatio: pitchRatios[options.ratio] || 16 / 9 }}>
        <PitchSlide options={options} slide={{ topic, kind: topic.children.length && !topic.image && topic.options.cover === 'auto' ? 'topics' : 'title', first: 0,
          end: Math.min(topic.children.length, topic.options.delivery === 'all' ? 6 : 1) }} />
      </div></section></>}
  </aside>
}
