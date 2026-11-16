import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { equationLimit } from './mapEquation'
import type { EquationPreview } from './renderMapEquation'

const templates = [
  ['分式', String.raw`\frac{a}{b}`],
  ['求和', String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2}`],
  ['矩阵', String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`],
  ['化学方程式', String.raw`\ce{2H2 + O2 -> 2H2O}`],
]

export function MindMapEquation({ initial, hasImage, close, save }: {
  initial?: string
  hasImage: boolean
  close: () => void
  save: (latex: string, source: string, size: { width: number; height: number }) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [code, setCode] = useState(initial ?? '')
  const [result, setResult] = useState<{ code: string; preview?: EquationPreview; error?: string }>()
  const [saving, setSaving] = useState(false)
  const current = result?.code === code ? result : undefined

  useLayoutEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    if (!code.trim()) return
    let canceled = false
    const timer = window.setTimeout(async () => {
      try {
        const { previewEquation } = await import('./renderMapEquation')
        const preview = await previewEquation(code)
        if (!canceled) setResult({ code, preview })
      } catch (error) {
        if (!canceled) setResult({ code, error: error instanceof Error ? error.message : '无法预览公式。' })
      }
    }, 100)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [code])

  function insert(markup: string) {
    const editor = input.current
    if (!editor || saving) return
    const { selectionStart: from, selectionEnd: to } = editor
    const next = code.slice(0, from) + markup + code.slice(to)
    if (next.length > equationLimit) return
    editor.setRangeText(markup, from, to, 'end')
    setCode(next)
    editor.focus()
  }

  async function submit() {
    const preview = current?.preview
    if (saving || !preview) return
    setSaving(true)
    try {
      const { equationImage } = await import('./renderMapEquation')
      const source = await equationImage(preview)
      if (dialog.current?.open) save(code, source, { width: preview.width, height: preview.height })
    } catch (error) {
      setResult({ code, preview, error: error instanceof Error ? error.message : '无法保存公式。' })
    } finally { setSaving(false) }
  }

  const title = initial ? '编辑公式' : '插入公式'
  return <dialog ref={dialog} className="map-equation-dialog" aria-labelledby="map-equation-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <h2 id="map-equation-title">{title}</h2>
      <label>LaTeX<textarea ref={input} autoFocus value={code} rows={4} maxLength={equationLimit}
        spellCheck={false} disabled={saving} onChange={event => setCode(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          void submit()
        }} /></label>
      <div className="map-equation-examples" role="group" aria-label="公式示例">
        {templates.map(([label, markup]) => <button key={label} type="button" className="tool-button"
          onClick={() => insert(markup)} disabled={saving}>{label}</button>)}
      </div>
      <div className="map-equation-preview" aria-label="公式预览" aria-live="polite">
        {current?.error ? <p className="map-equation-error" role="status">{current.error}</p>
          : current?.preview ? <img src={current.preview.source} alt="LaTeX 公式预览" />
          : <p>{code.trim() ? '正在预览…' : '输入 LaTeX 或插入上方的示例'}</p>}
      </div>
      {hasImage && !initial && <p className="map-equation-replaces">公式将替换此主题中的图片。</p>}
      <footer><button type="button" onClick={close}>取消</button>
        <button className="primary" type="submit" disabled={!current?.preview || saving}>
          {saving ? '正在保存…' : initial ? '保存' : '插入'}</button></footer>
    </form>
  </dialog>
}
