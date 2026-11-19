import DOMPurify from 'dompurify'
import { renderMermaid } from './renderMermaid'
import { codeLanguageToken, plantUmlAliases } from './codeLanguages'

export type DiagramKind = 'mermaid' | 'plantuml'
export type PreviewBlockKind = DiagramKind | 'math'

export function diagramKind(info = ''): DiagramKind | undefined {
  const language = codeLanguageToken.exec(info.trimStart())?.[0].toLowerCase()
  if (language === 'mermaid') return 'mermaid'
  if (language && (language === 'plantuml' || plantUmlAliases.includes(language))) return 'plantuml'
}

export const diagramTitle = (kind: DiagramKind) => (kind === 'mermaid' ? 'Mermaid' : 'PlantUML') + ' 图'
export const blockTitle = (kind: PreviewBlockKind) => kind === 'math' ? '公式块' : diagramTitle(kind)

type Job = { code: string; resolve: (svg: string) => void; reject: (error: Error) => void }
const jobs = new Map<number, Job>()
const pending = new Map<string, Promise<string>>()
const cache = new Map<string, string>()
let cacheSize = 0
let frame: HTMLIFrameElement | undefined
let ready = false
let sequence = 0
let timer = 0

function resetFrame(error?: string) {
  frame?.remove()
  frame = undefined
  ready = false
  window.removeEventListener('message', onFrameMessage)
  window.clearTimeout(timer)
  if (error) for (const job of jobs.values()) job.reject(new Error(error))
  jobs.clear()
}

function send(id: number, code: string) {
  frame?.contentWindow?.postMessage({ type: 'ymd:plantuml-render', id, code }, location.origin)
}

function onFrameMessage(event: MessageEvent) {
  if (event.source !== frame?.contentWindow || event.origin !== location.origin || typeof event.data?.type !== 'string') return
  const { type, id, svg, error } = event.data
  if (type === 'ymd:plantuml-ready') {
    if (error) { resetFrame(error); return }
    ready = true
    for (const [id, job] of jobs) send(id, job.code)
  } else if (type === 'ymd:plantuml-result') {
    const job = jobs.get(id)
    jobs.delete(id)
    if (typeof svg === 'string') job?.resolve(svg)
    else job?.reject(new Error(error ?? 'PlantUML 无法渲染。'))
  }
  watchFrame()
}

function renderPlantUml(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!frame) {
      frame = document.createElement('iframe')
      frame.hidden = true
      frame.title = 'PlantUML'
      frame.src = new URL('plantuml.html', document.baseURI).href
      window.addEventListener('message', onFrameMessage)
      document.body.append(frame)
    }
    const id = ++sequence
    jobs.set(id, { code, resolve, reject })
    if (ready) send(id, code)
    if (jobs.size === 1) watchFrame()
  })
}

function watchFrame() {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => resetFrame(jobs.size ? 'PlantUML 渲染超时。' : undefined), 30_000)
}

export async function renderDiagram(kind: DiagramKind, code: string) {
  if (kind === 'mermaid') return renderMermaid(code)
  let svg = cache.get(code)
  if (svg !== undefined) {
    cache.delete(code)
    cache.set(code, svg)
  } else {
    let request = pending.get(code)
    if (!request) {
      request = renderPlantUml(code).then(raw => {
        const clean = DOMPurify.sanitize(raw, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['style', 'foreignObject', 'a', 'image'],
        })
        const size = code.length + clean.length
        if (size <= 2_000_000) {
          while (cache.size && (cache.size >= 24 || cacheSize + size > 2_000_000)) {
            const [key, value] = cache.entries().next().value!
            cache.delete(key)
            cacheSize -= key.length + value.length
          }
          cache.set(code, clean)
          cacheSize += size
        }
        return clean
      }).finally(() => pending.delete(code))
      pending.set(code, request)
    }
    svg = await request
  }

  // A file may contain identical diagrams. Keep filter and marker references local to each SVG.
  const prefix = 'puml-' + crypto.randomUUID() + '-'
  return svg.replace(/\bid="([^"]+)"|url\(#([\w:.-]+)\)|\bhref="#([\w:.-]+)"/g, (_, id, url, href) =>
    id ? 'id="' + prefix + id + '"' : url ? 'url(#' + prefix + url + ')' : 'href="#' + prefix + href + '"')
}
