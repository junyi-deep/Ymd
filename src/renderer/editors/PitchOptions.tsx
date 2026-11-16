import { pitchCoverLayouts, pitchDeliveries, pitchLayouts, pitchPlacements, pitchRatios, pitchThemes, pitchVisibility,
  type PitchOptions as Options, type PitchTopicOptions } from '../../shared/pitch'

export function PitchOptionFields({ options, change }: { options: Options; change: (patch: Partial<Options>) => void }) {
  return <div className="pitch-option-fields">
    <label>主题<select value={options.theme} onChange={event => change({ theme: event.target.value as Options['theme'] })}>
      {Object.entries(pitchThemes).map(([value, theme]) => <option value={value} key={value}>{theme.label}</option>)}
    </select></label>
    <label>宽高比<select value={options.ratio} onChange={event => change({ ratio: event.target.value as Options['ratio'] })}>
      {Object.keys(pitchRatios).map(value => <option value={value} key={value}>{value === 'auto' ? '自动' : value}</option>)}
    </select></label>
    <label>过渡动画<input type="checkbox" checked={options.animation} onChange={event => change({ animation: event.target.checked })} /></label>
    <label>显示 Ymd 标记<input type="checkbox" checked={options.watermark} onChange={event => change({ watermark: event.target.checked })} /></label>
  </div>
}

export function PitchTopicFields({ options, root, image, change }: {
  options: PitchTopicOptions; root: boolean; image: boolean; change: (patch: Partial<PitchTopicOptions>) => void
}) {
  return <div className="pitch-option-fields">
    <label>主题作为幻灯片<select disabled={root} value={root ? 'show' : options.visibility}
      onChange={event => change({ visibility: event.target.value as PitchTopicOptions['visibility'] })}>
      {Object.entries(pitchVisibility).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
    <label>子主题播放<select value={options.delivery} onChange={event => change({ delivery: event.target.value as PitchTopicOptions['delivery'] })}>
      {Object.entries(pitchDeliveries).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
    <label>子主题布局<select value={options.layout} onChange={event => change({ layout: event.target.value as PitchTopicOptions['layout'] })}>
      {Object.entries(pitchLayouts).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
    <label>标题页布局<select value={options.cover} onChange={event => change({ cover: event.target.value as PitchTopicOptions['cover'] })}>
      {Object.entries(pitchCoverLayouts).map(([value, label]) => <option value={value} key={value} disabled={value === 'image' && !image}>{label}</option>)}
    </select></label>
    {image && options.cover !== 'title' && <label>图片位置<select value={options.image} onChange={event => change({ image: event.target.value as PitchTopicOptions['image'] })}>
      {Object.entries(pitchPlacements).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>}
  </div>
}
