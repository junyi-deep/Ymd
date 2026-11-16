import { mathjax } from '@mathjax/src/js/mathjax.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js'
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js'
import { readEquation } from './mapEquation'

// Vite resolves the font blocks as local chunks, including for the packaged file:// renderer.
const fontDirectory = '/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/'
const glyphs = import.meta.glob('/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js')
mathjax.asyncLoad = name => {
  const file = name.split('/').at(-1)
  const load = glyphs[fontDirectory + file]
  if (!load) return Promise.reject(new Error('找不到公式所需的字形。'))
  return load()
}
const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
MathJaxNewcmFont.addExtension(MathJaxMhchemFontExtension)
const output = new SVG({ fontData: new MathJaxNewcmFont(), fontCache: 'local' })

export interface EquationPreview {
  source: string
  width: number
  height: number
}

export async function previewEquation(source: string): Promise<EquationPreview> {
  const latex = readEquation(source)
  if (!latex) throw new Error('请输入有效的 LaTeX。')
  const input = new TeX({
    packages: ['base', 'ams', 'mhchem', 'newcommand', 'mathtools'],
    maxBuffer: 12_000, maxMacros: 1000,
    formatError: (_input: unknown, error: { message: string }) => { throw new Error(error.message) },
  })
  const equation = mathjax.document('', { InputJax: input, OutputJax: output })
  const node = await equation.convertPromise(latex, { display: true, em: 20, ex: 10 })
  const svg = adaptor.tags(node, 'svg')[0]
  const viewBox = svg && adaptor.getAttribute(svg, 'viewBox')?.split(/\s+/).map(Number)
  const [, , w, h] = viewBox ?? []
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) throw new Error('公式没有可显示的内容。')
  const scale = Math.min(.021, 428 / w, 288 / h)
  const contentWidth = Math.ceil(w * scale)
  const contentHeight = Math.ceil(h * scale)
  const width = contentWidth + 16
  const height = contentHeight + 12
  adaptor.setAttribute(svg, 'width', String(contentWidth))
  adaptor.setAttribute(svg, 'height', String(contentHeight))
  adaptor.setAttribute(svg, 'x', '8')
  adaptor.setAttribute(svg, 'y', '6')
  const markup = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
    '<rect width="100%" height="100%" rx="4" fill="#fdfdfd"/>' + adaptor.outerHTML(svg) + '</svg>'
  const encoded = new TextEncoder().encode(markup)
  if (encoded.length > 800_000) throw new Error('公式过于复杂，请拆成较短的公式。')
  let binary = ''
  for (let start = 0; start < encoded.length; start += 16384) binary += String.fromCharCode(...encoded.subarray(start, start + 16384))
  return { source: 'data:image/svg+xml;base64,' + btoa(binary), width, height }
}

export async function equationImage(preview: EquationPreview) {
  const image = new Image()
  image.src = preview.source
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = preview.width * 3
  canvas.height = preview.height * 3
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成公式图像。')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}
