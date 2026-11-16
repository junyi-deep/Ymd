import { renderToStaticMarkup } from 'react-dom/server'
import PptxGenJS from 'pptxgenjs'
import { pitchRatios, pitchThemes, type PitchOptions } from '../../shared/pitch'
import { PitchSlide } from './PitchSlide'
import { pitchImageForSlide, type PitchSlide as Slide } from './pitchDeck'
import slideCss from './pitch.css?inline'

function pageSize(options: PitchOptions) {
  const ratio = pitchRatios[options.ratio] || 16 / 9
  return ratio >= 1 ? { width: 10, height: 10 / ratio } : { width: 7.5 * ratio, height: 7.5 }
}

function pdfBody(slides: Slide[], options: PitchOptions) {
  const { width, height } = pageSize(options)
  return '<style>' + slideCss + `
    @page { size: ${width}in ${height}in; margin: 0; }
    html, body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pitch-export-page { width: ${width}in; height: ${height}in; break-inside: avoid; overflow: hidden; }
    .pitch-export-page + .pitch-export-page { break-before: page; }
  </style>` + renderToStaticMarkup(<>{slides.map((slide, index) =>
    <section className="pitch-export-page" key={index}><PitchSlide slide={slide} options={options} /></section>)}</>)
}

async function powerpointImage(data: string) {
  const image = new Image()
  image.src = data
  await image.decode()
  const { naturalWidth: width, naturalHeight: height } = image
  if (/^data:image\/(?:png|jpeg|gif);base64,/.test(data)) return { data, width, height }
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法转换演示图片。')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { data: canvas.toDataURL('image/png'), width, height }
}

async function powerpoint(title: string, slides: Slide[], options: PitchOptions) {
  const deck = new PptxGenJS()
  const { width, height } = pageSize(options)
  const palette = pitchThemes[options.theme]
  const ink = palette.text.slice(1)
  const accent = palette.accent.slice(1)
  const muted = palette.muted.slice(1)
  const margin = width * .075
  const contentWidth = width - margin * 2
  const contentHeight = height * .84
  const font = 'Arial'
  deck.title = title
  deck.author = 'Ymd'
  deck.defineLayout({ name: 'Ymd Pitch', width, height })
  deck.layout = 'Ymd Pitch'
  for (const page of slides) {
    const { topic, kind, first, end } = page
    const slide = deck.addSlide()
    slide.background = { color: palette.background.slice(1) }
    const rolling = topic.options.layout === 'lyrics' && topic.options.delivery !== 'all'
    const rows = kind === 'topics' ? topic.children.slice(rolling ? Math.max(first, end - 3) : first, end) : []
    const source = pitchImageForSlide(page)
    const image = source ? await powerpointImage(source) : undefined
    const position = topic.options.image === 'auto' ? 'right' : topic.options.image
    const vertical = position === 'top' || position === 'bottom'
    const full = { x: margin, y: height * .08, w: contentWidth, h: contentHeight }
    const copy = { ...full }
    if (image) {
      const picture = { ...full }
      if (vertical) {
        copy.h = picture.h = full.h * .46
        if (position === 'top') copy.y += full.h * .54
        else picture.y += full.h * .54
      } else {
        copy.w = picture.w = full.w * .46
        if (position === 'left') copy.x += full.w * .54
        else picture.x += full.w * .54
      }
      const scale = Math.min(picture.w / image.width, picture.h / image.height)
      const w = image.width * scale
      const h = image.height * scale
      slide.addImage({ data: image.data, x: picture.x + (picture.w - w) / 2, y: picture.y + (picture.h - h) / 2, w, h })
    }
    if (rows.length) {
      const heading = Math.min(copy.h * .31, Math.max(.55, copy.h - rows.length * .4))
      slide.addText(topic.title, { ...copy, h: heading, color: ink, bold: true, margin: 0, fontFace: font,
        fontSize: Math.round(width * (topic.title.length > 50 ? 3.2 : 4.1)), valign: 'middle', fit: 'shrink' })
      const gap = (copy.h - heading) / rows.length
      const brace = topic.options.layout === 'brace'
      if (brace) slide.addShape(deck.ShapeType.line, { x: copy.x + .04, y: copy.y + heading + gap * .12, w: 0,
        h: copy.h - heading - gap * .24, line: { color: accent, width: 1.7 } })
      rows.forEach((row, index) => {
        const lyrics = rolling
        slide.addText(row.title, {
          x: copy.x + (brace ? .21 : .03), y: copy.y + heading + gap * index, w: copy.w - .24, h: gap,
          color: lyrics ? index === rows.length - 1 ? accent : muted : ink, bold: lyrics && index === rows.length - 1,
          bullet: topic.options.layout === 'bullets', fontFace: font, margin: 0, fit: 'shrink',
          fontSize: Math.round(width * (rows.length > 4 ? 1.9 : 2.25)), valign: 'middle',
        })
      })
    } else slide.addText(topic.title, {
      ...copy, align: !image || vertical ? 'center' : 'left', valign: 'middle', color: ink, bold: true, fontFace: font,
      fontSize: Math.round(width * (image || topic.title.length > 50 ? 4.8 : 6.8)), margin: 0, fit: 'shrink',
    })
    if (options.watermark) slide.addText('由 Ymd 演示', { x: width * .72, y: height * .95 - .14, w: width * .24, h: .24,
      fontFace: font, fontSize: 8, color: muted, align: 'right', margin: 0 })
    if (topic.note) slide.addNotes(topic.note)
  }
  const output = await deck.write({ outputType: 'arraybuffer', compression: true })
  if (!(output instanceof ArrayBuffer)) throw new Error('无法生成 PowerPoint。')
  return output
}

export async function exportPitch(format: 'pptx' | 'pdf', title: string, slides: Slide[], options: PitchOptions) {
  if (slides.length > 500) throw new Error('每份演示可导出最多 500 张幻灯片。')
  return format === 'pdf' ? window.pitch.savePdf(title, pdfBody(slides, options))
    : window.pitch.savePowerPoint(title, await powerpoint(title, slides, options))
}
