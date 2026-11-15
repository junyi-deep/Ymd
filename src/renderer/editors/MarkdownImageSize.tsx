import { useEffect, useRef, useState } from 'react'
import type { ImageResizeRequest } from './markdownImages'
import { imageDimension } from './markdownImageSyntax'

export function MarkdownImageSize({ request, close }: { request: ImageResizeRequest; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [width, setWidth] = useState(request.width)
  const [height, setHeight] = useState(request.height)
  const nextWidth = imageDimension(width)
  const nextHeight = imageDimension(height)
  const valid = !(width.trim() && !nextWidth || height.trim() && !nextHeight) && !!(nextWidth || nextHeight)

  useEffect(() => { dialog.current?.showModal() }, [])

  return <dialog ref={dialog} aria-labelledby="image-size-title" onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (!valid) return
      request.save({ width: nextWidth, height: nextHeight })
      close()
    }}>
      <h2 id="image-size-title">自定义图像尺寸</h2>
      <label>宽度<input autoFocus value={width} placeholder="例如 320px 或 60%" aria-describedby="image-size-help"
        onChange={event => setWidth(event.target.value)} /></label>
      <label>高度<input value={height} placeholder="例如 240px" aria-describedby="image-size-help"
        onChange={event => setHeight(event.target.value)} /></label>
      <p className="image-size-help" id="image-size-help">填写一个尺寸时保持原比例。</p>
      <footer><button type="button" onClick={close}>取消</button><button type="submit" className="primary" disabled={!valid}>应用</button></footer>
    </form>
  </dialog>
}
