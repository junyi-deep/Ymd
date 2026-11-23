import { createRoot } from 'react-dom/client'
import './styles.css'

window.EXCALIDRAW_ASSET_PATH = new URL(import.meta.env.DEV ? '/node_modules/@excalidraw/excalidraw/dist/prod/' : './', document.baseURI).href

const root = createRoot(document.getElementById('root')!)
if (new URLSearchParams(location.search).has('pitch')) {
  void import('./editors/MindMapPitch').then(({ MindMapPitch }) => root.render(<MindMapPitch />))
} else {
  const bootstrap = window.desktop.initialize()
  void bootstrap.then(result => {
    if (result.initialFile?.kind === 'markdown') void import('./editors/Markdown').catch(() => {})
  }).catch(() => {})
  void import('./App').then(({ App }) => root.render(<App bootstrap={bootstrap} />))
}
