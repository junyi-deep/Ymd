import MindMap from 'simple-mind-map'
import { installCallouts } from './calloutLayer'
import { taskBadge, todoBadge } from './MindMapTask'
import type { MapExportKind } from '../../shared/contracts'
import { audioButton, readAudioNote } from './mapAudio'
import { branchStructure, mapTheme, palettes, type MapData, type MapSettings } from './mapAppearance'
import { setBranchDepth } from './mapBranchView'
import { installNumbering } from './mapNumberingLayer'
import { installBranchLayouts } from './mixedMapLayout'
import { readTask, readTodo } from './mapTasks'

export type MapExportFormat = MapExportKind | 'print'

export function mapExportTitle(value: string) {
  return value.replace(/[<>:"/\\|?*&\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120) || '思维导图'
}

export async function exportMapTree(source: MapData, settings: MapSettings, dark: boolean, depth: number,
  format: MapExportFormat, title: string, originalTree?: MapData) {
  // Prepare a separately rendered map so the live selection, folds, view and undo stack are untouched.
  const tree = structuredClone(source)
  if (depth) {
    delete tree.data.customLeft
    delete tree.data.customTop
    setBranchDepth(tree, Infinity)
  }
  function deactivate(node: MapData) {
    node.data.isActive = false
    node.children?.forEach(deactivate)
    const summaries = node.data.generalization
    for (const summary of Array.isArray(summaries) ? summaries : [summaries]) {
      if (summary && typeof summary === 'object') summary.isActive = false
    }
  }
  deactivate(tree)
  const host = document.createElement('div')
  host.className = 'map-branch-export'
  host.inert = true
  host.setAttribute('aria-hidden', 'true')
  document.body.append(host)
  let map: MindMap | undefined
  const noop = () => {}
  try {
    map = new MindMap({
      el: host, data: tree, readonly: true, customCheckEnableShortcut: () => false,
      layout: (depth ? branchStructure(tree.data.ymdStructure) : undefined) ?? settings.layout,
      theme: 'default', themeConfig: mapTheme(settings, dark, depth),
      rainbowLinesConfig: { open: settings.colored, colorsList: palettes[settings.palette].colors },
      createNodePostfixContent: node => {
        const audio = readAudioNote(node.getData('ymdAudio'))
        if (audio) return audioButton(audio, noop)
        const task = readTask(node.getData('ymdTask'))
        if (task) return taskBadge(task, noop)
        const todo = readTodo(node.getData('ymdTodo'))
        if (todo) return todoBadge(todo, noop)
      },
    })
    const disposeNumbering = installNumbering(map, originalTree)
    const disposeLayouts = installBranchLayouts(map)
    const callouts = installCallouts(map, {
      select: noop, edit: noop, remove: noop, menu: noop, follow: noop, download: noop, change: noop,
    })
    try {
      await new Promise<void>(resolve => map!.on('node_tree_render_end', function ready() {
        map!.off('node_tree_render_end', ready)
        resolve()
      }))
      if (format === 'print') {
        const image = await map.export('svg', false, title)
        if (!image || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error('无法生成分支图像。')
        await window.desktop.printDocument(title, '<figure><img data-standalone src="' + image + '" alt="思维导图分支"></figure>')
      } else {
        const output = await map.export(format, false, title)
        const prefix = output?.indexOf(';base64,') ?? -1
        if (!output || prefix < 0) throw new Error('无法导出思维导图。')
        if (output.length - prefix > 90 * 1024 * 1024) throw new Error('导图文件过大。')
        const bytes = Uint8Array.from(atob(output.slice(prefix + 8)), value => value.charCodeAt(0))
        await window.desktop.saveMapExport(title, format, bytes.buffer)
      }
    } finally {
      callouts.dispose()
      disposeLayouts()
      disposeNumbering()
    }
  } finally {
    map?.destroy()
    host.remove()
  }
}
