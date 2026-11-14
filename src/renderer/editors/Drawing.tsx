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

export default function DrawingEditor({ text, dark, onChange }: { text: string; dark: boolean; onChange: (text: string) => void }) {
  const [scene] = useState(() => readScene(text))
  const previous = useRef<string | undefined>(undefined)
  if (!scene) return <div className="editor-empty"><h2>无法读取绘图</h2><p>此文件需要有效的 Excalidraw 场景 JSON。原文件已保留。</p></div>
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
