import { useRef, useState, type ComponentProps } from 'react'
import { Excalidraw, MainMenu, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

type Scene = Exclude<ComponentProps<typeof Excalidraw>['initialData'], Function | PromiseLike<unknown> | null | undefined>

function readScene(text: string): Scene | undefined {
  try {
    const scene = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements) ||
      scene.elements.some((element: unknown) => !element || typeof element !== 'object') ||
      (scene.appState != null && (typeof scene.appState !== 'object' || Array.isArray(scene.appState))) ||
      (scene.files != null && (typeof scene.files !== 'object' || Array.isArray(scene.files)))) return
    return { elements: scene.elements, appState: scene.appState ?? {}, files: scene.files ?? {}, scrollToContent: true }
  } catch {
    return undefined
  }
}

export default function DrawingEditor({ text, dark, onChange, backup, reveal }: {
  text: string; dark: boolean; onChange: (text: string) => void; backup: () => void; reveal: () => void
}) {
  const [scene] = useState(() => readScene(text))
  const previous = useRef<string | undefined>(undefined)
  if (!scene) return <div className="editor-empty">
    <h2>无法读取绘图</h2>
    <p>此文件需要有效的 Excalidraw 场景 JSON。可以用文本编辑器检查原文件，或先另存副本。</p>
    <div className="editor-empty-actions">
      <button type="button" className="tool-button" onClick={backup}>另存原文件副本</button>
      <button type="button" className="tool-button" onClick={reveal}>在文件管理器中显示原文件</button>
    </div>
  </div>
  return <div className="drawing-editor">
    <Excalidraw initialData={scene} theme={dark ? 'dark' : 'light'} langCode="zh-CN"
      onChange={(elements, appState, files) => {
        const content = serializeAsJSON(elements, appState, files, 'local')
        const old = previous.current
        previous.current = content
        if (old !== undefined && old !== content) onChange(content)
      }}>
      <MainMenu>
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
      </MainMenu>
    </Excalidraw>
  </div>
}
