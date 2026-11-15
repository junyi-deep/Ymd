import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { markdownImageExtension, markdownImageLimits, type MarkdownImageAttachment } from '../../shared/contracts'
import type { MenuItem } from './MarkdownMenu'

type Target = { from: number; to: number }
type Report = (error: unknown) => void

const attachmentTargets = ViewPlugin.fromClass(class {
  readonly pending = new Set<Target>()

  update({ docChanged, changes }: ViewUpdate) {
    if (!docChanged) return
    for (const target of this.pending) {
      const from = changes.mapPos(target.from, 1)
      const to = changes.mapPos(target.to, -1)
      target.from = from
      target.to = Math.max(from, to)
    }
  }
})

function imageAlt(text: string) {
  return text.replace(/\s+/g, ' ').trim().replace(/[\\[\]]/g, '\\$&')
}

async function insertAttachments(view: EditorView, original: Target, load: () => Promise<MarkdownImageAttachment[]>, report: Report) {
  const pending = view.plugin(attachmentTargets)?.pending
  if (!pending || view.state.readOnly) return
  const target = { from: original.from, to: original.to }
  const selected = view.state.sliceDoc(target.from, target.to)
  pending.add(target)
  try {
    const attachments = await load()
    if (!attachments.length || !view.dom.isConnected || view.state.readOnly) return
    const selection = view.state.selection.main
    const follow = selection.from === target.from && selection.to === target.to
    // Preserve edits that landed inside the range while the files were being read.
    const canReplace = view.state.sliceDoc(target.from, target.to) === selected
    const from = canReplace ? target.from : target.to
    const insert = attachments.map(attachment => {
      const alt = imageAlt((attachments.length === 1 && canReplace && selected) || attachment.label) || '图像'
      return '![' + alt + '](' + attachment.source + ')'
    }).join('\n\n')
    view.dispatch({
      changes: { from, to: target.to, insert },
      selection: follow ? { anchor: from + insert.length } : undefined,
      scrollIntoView: follow,
      annotations: isolateHistory.of('full'),
      userEvent: 'input.paste',
    })
  } catch (error) {
    if (view.dom.isConnected) report(error)
  } finally {
    pending.delete(target)
  }
}

export function chooseMarkdownImages(view: EditorView, path: string, report: Report) {
  void insertAttachments(view, view.state.selection.main, () => window.desktop.chooseMarkdownImages(path), report)
}

function supportedImages(transfer: DataTransfer | null) {
  return Array.from(transfer?.files ?? []).filter(file => markdownImageExtension(file.name, file.type))
}

async function importFiles(path: string, files: File[]) {
  if (files.length > markdownImageLimits.count) throw new Error('一次最多导入 20 张图片。')
  if (files.some(file => file.size === 0 || file.size > markdownImageLimits.fileBytes)) throw new Error('单张图片必须小于或等于 15 MB。')
  if (files.reduce((bytes, file) => bytes + file.size, 0) > markdownImageLimits.batchBytes) throw new Error('一次最多导入 60 MB 的图片。')
  const images = await Promise.all(files.map(async file => ({ name: file.name, type: file.type, data: await file.arrayBuffer() })))
  return window.desktop.importMarkdownImages(path, images)
}

export function markdownImageIntake(path: string, report: Report) {
  return [
    attachmentTargets,
    Prec.high(EditorView.domEventHandlers({
      paste(event, view) {
        const images = supportedImages(event.clipboardData)
        if (!images.length) return false
        event.preventDefault()
        void insertAttachments(view, view.state.selection.main, () => importFiles(path, images), report)
        return true
      },
      dragover(event, view) {
        if (!event.dataTransfer?.types.includes('Files')) return false
        event.preventDefault()
        event.dataTransfer.dropEffect = view.state.readOnly ? 'none' : 'copy'
        return true
      },
      drop(event, view) {
        const images = supportedImages(event.dataTransfer)
        if (!images.length) return false
        event.preventDefault()
        if (view.state.readOnly) return true
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
        view.dispatch({ selection: { anchor: position } })
        view.focus()
        void insertAttachments(view, { from: position, to: position }, () => importFiles(path, images), report)
        return true
      },
    })),
  ]
}

function imageReference(view: EditorView, image: Element) {
  const wrapper = image.closest('.md-image')
  if (!wrapper || !view.contentDOM.contains(wrapper)) return
  const position = view.posAtDOM(wrapper)
  let node = syntaxTree(view.state).resolveInner(position, 1)
  while (node.parent && node.name !== 'Image') node = node.parent
  const url = node.name === 'Image' && node.getChild('URL')
  if (!url) return
  return {
    from: node.from, to: node.to, urlFrom: url.from, urlTo: url.to,
    markdown: view.state.sliceDoc(node.from, node.to),
    source: view.state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ''),
  }
}

function editableReference(view: EditorView, reference: NonNullable<ReturnType<typeof imageReference>>) {
  return view.dom.isConnected && !view.state.readOnly &&
    view.state.sliceDoc(reference.from, reference.to) === reference.markdown
}

export function editImageReference(view: EditorView, image: Element) {
  const reference = imageReference(view, image)
  if (!reference || !editableReference(view, reference)) return false
  const { urlFrom, urlTo } = reference
  view.dispatch({ selection: { anchor: urlFrom, head: urlTo }, scrollIntoView: true })
  view.focus()
  return true
}

function imageAsPng(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('无法拷贝图像。'))
  context.drawImage(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob)
    else reject(new Error('无法拷贝图像。'))
  }, 'image/png'))
}

export function imageContextItems(view: EditorView, target: Element, report: Report): MenuItem[] | undefined {
  const reference = imageReference(view, target)
  if (!reference) return
  const image = target.closest('.md-image')?.querySelector('img')
  return [
    { label: '编辑图像源码', disabled: view.state.readOnly, run: () => { editImageReference(view, target) } },
    { label: '拷贝图像', disabled: !image?.naturalWidth || !image.currentSrc.startsWith('data:image/'), run: () => {
      if (!image) return
      try {
        void navigator.clipboard.write([new ClipboardItem({ 'image/png': imageAsPng(image) })]).catch(report)
      } catch (error) { report(error) }
    } },
    { label: '拷贝图像路径', run: () => { void navigator.clipboard.writeText(reference.source).catch(report) } },
    { label: '拷贝为 Markdown', run: () => { void navigator.clipboard.writeText(reference.markdown).catch(report) } },
    { label: '移除图像引用', separator: true, disabled: view.state.readOnly, run: () => {
      if (!editableReference(view, reference)) return
      view.dispatch({
        changes: { from: reference.from, to: reference.to }, selection: { anchor: reference.from },
        annotations: isolateHistory.of('full'), userEvent: 'delete',
      })
    } },
  ]
}
