import { cp } from 'node:fs/promises'
import { defineConfig, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

const localDrawingFontSources = {
  name: 'local-drawing-font-sources',
  transform(code: string, id: string) {
    if (!normalizePath(id).includes('/@excalidraw/excalidraw/dist/') || !code.includes('ASSETS_FALLBACK_URL')) return
    // Keep SDK font loading and SVG export on the same bundled assets.
    return code.replace(/`https:\/\/esm\.sh\/[^\r\n]*?\/dist\/prod\/`/, 'window.EXCALIDRAW_ASSET_PATH')
  },
}

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173")
      },
    },
    react(),
    tailwind(),
    localDrawingFontSources,
    {
      name: 'local-drawing-fonts',
      apply: 'build',
      closeBundle() {
        return cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/renderer/fonts', { recursive: true })
      },
    },
  ],
  optimizeDeps: { rolldownOptions: { plugins: [localDrawingFontSources] } },
  server: {
    fs: { allow: ['.'] },
  },
  define: { 'process.env.IS_PREACT': 'false' },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
})
