import vizScript from '@plantuml/core/viz-global.js?url'
import { renderToString } from '@plantuml/core'

const resources: Record<string, () => Promise<unknown>> = {
  'themes.js': () => import('@plantuml/core/themes.js'),
  'openiconic.js': () => import('@plantuml/core/openiconic.js'),
  'emoji.js': () => import('@plantuml/core/emoji.js'),
}
Object.assign(window, {
  PLANTUML_STDLIB_LOADER(name: string, done: () => void, fail: (message: string) => void) {
    const load = Object.hasOwn(resources, name) ? resources[name] : undefined
    if (load) void load().then(done, error => fail(String(error)))
    else fail('未随 PlantUML 引擎附带的资源：' + name)
    return true
  },
})

const origin = window.location.origin
function send(value: { type: string; id?: number; svg?: string; error?: string }) {
  if (window.parent !== window) window.parent.postMessage(value, origin)
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== origin || event.data?.type !== 'ymd:plantuml-render') return
  const { id, code } = event.data
  if (typeof id !== 'number' || typeof code !== 'string') return
  const fail = (error: unknown) => send({ type: 'ymd:plantuml-result', id, error: error instanceof Error ? error.message : String(error) })
  const lines = (/^\s*@start\w+/im.test(code) ? code : '@startuml\n' + code + '\n@enduml').split('\n')
  try { renderToString(lines, svg => send({ type: 'ymd:plantuml-result', id, svg }), fail) }
  catch (error) { fail(error) }
})

const graphviz = document.createElement('script')
graphviz.src = vizScript
graphviz.onload = () => send({ type: 'ymd:plantuml-ready' })
graphviz.onerror = () => send({ type: 'ymd:plantuml-ready', error: 'PlantUML 布局引擎无法载入。' })
document.head.append(graphviz)
