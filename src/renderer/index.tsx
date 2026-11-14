import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

window.EXCALIDRAW_ASSET_PATH = new URL(import.meta.env.DEV ? '/node_modules/@excalidraw/excalidraw/dist/prod/' : './', document.baseURI).href

createRoot(document.getElementById('root')!).render(<App />)
