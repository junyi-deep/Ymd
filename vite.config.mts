import { cp } from 'node:fs/promises'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

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
    {
      name: 'local-drawing-fonts',
      apply: 'build',
      closeBundle() {
        return cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/renderer/fonts', { recursive: true })
      },
    },
  ],
  server: {
    fs: { allow: ['.'] },
  },
  define: { 'process.env.IS_PREACT': 'false' },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
})
