import DOMPurify from 'dompurify'

type Result = { svg: string; prefix: string }
const cacheLimit = 2_000_000
const cache = new Map<string, Result>()
const requests = new Map<string, Promise<Result>>()
let cacheSize = 0

let worker: Worker | undefined
let workerAvailable = true
let nextRequest = 0
let idleTimer = 0
const jobs = new Map<number, { resolve: (svg: string) => void; reject: (reason: unknown) => void }>()

async function renderOnMain(code: string, prefix: string) {
  const { renderAsync } = await import('pele/lazy')
  return (await renderAsync(code, { responsive: true, links: false, images: false, idPrefix: prefix })).svg
}

function renderSvg(code: string, prefix: string): Promise<string> {
  if (!workerAvailable) return renderOnMain(code, prefix)
  try {
    if (!worker) {
      worker = new Worker(new URL('./mermaidWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ id: number; svg?: string; error?: string }>) => {
        const { id, svg, error } = event.data
        const job = jobs.get(id)
        jobs.delete(id)
        if (svg !== undefined) job?.resolve(svg)
        else job?.reject(new Error(error ?? '无法渲染 Mermaid 图。'))
        if (!jobs.size) idleTimer = window.setTimeout(() => { worker?.terminate(); worker = undefined }, 30_000)
      }
      worker.onerror = () => {
        workerAvailable = false
        worker?.terminate()
        worker = undefined
        for (const job of jobs.values()) job.reject(new Error('无法启动 Mermaid 渲染进程。'))
        jobs.clear()
      }
    }
  } catch {
    workerAvailable = false
    return renderOnMain(code, prefix)
  }
  window.clearTimeout(idleTimer)
  return new Promise<string>((resolve, reject) => {
    const id = ++nextRequest
    jobs.set(id, { resolve, reject })
    worker!.postMessage({ id, code, prefix })
  }).catch(error => {
    if (!workerAvailable) return renderOnMain(code, prefix)
    throw error
  })
}

const uniquePrefix = () => 'ymd-' + crypto.randomUUID().replaceAll('-', '')

export async function renderMermaid(code: string) {
  let entry = cache.get(code)
  if (entry) {
    cache.delete(code)
    cache.set(code, entry)
  } else {
    let pending = requests.get(code)
    if (!pending) {
      const prefix = uniquePrefix()
      pending = renderSvg(code, prefix).then(raw => {
        const svg = DOMPurify.sanitize(raw, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['style', 'foreignObject', 'a', 'image'],
        })
        const value = { prefix, svg }
        const size = code.length + svg.length
        if (size <= cacheLimit) {
          while (cache.size && (cacheSize + size > cacheLimit || cache.size >= 24)) {
            const [key, old] = cache.entries().next().value!
            cacheSize -= key.length + old.svg.length
            cache.delete(key)
          }
          cache.set(code, value)
          cacheSize += size
        }
        return value
      }).finally(() => requests.delete(code))
      requests.set(code, pending)
    }
    entry = await pending
  }
  return entry.svg.replaceAll(entry.prefix, uniquePrefix())
}
