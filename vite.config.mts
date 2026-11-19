import { cp } from 'node:fs/promises'
import { defineConfig, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

const mapRenderGeometry = {
  name: 'map-render-geometry',
  transform(code: string, id: string) {
    const file = normalizePath(id)
    if (file.endsWith('/@svgdotjs/svg.js/src/modules/optional/sugar.js') ||
        file.endsWith('/@svgdotjs/svg.js/dist/svg.esm.js')) {
      // Pure translation is independent of its origin. Prevent SVG.js from
      // synchronously measuring the live scene for the implicit center.
      return code.replace(/this\.transform\(\{\s*translate: \[\s*x, y\s*\]\s*\}, true\)/,
        'this.transform({ translate: [x, y], origin: [0, 0] }, true)')
    }
    if (file.endsWith('/simple-mind-map/src/core/render/node/nodeCreateContents.js')) {
      const loop = 'textArr.forEach((item, index) => {'
      return code.replace(loop, loop + '\n    if (!item || measureText(item, this.style).width <= maxWidth) return')
        .replace('let { width, height } = g.bbox()', 'let { x, y, width, height } = g.bbox()')
        .replace("    node: g,\n    width,", "    node: g,\n    textOrigin: { x, y },\n    width,")
    }
    if (file.endsWith('/simple-mind-map/src/core/render/node/nodeLayout.js')) {
      const from = code.indexOf("    const oldX = this._textData.node.attr('data-offsetx')")
      const to = code.indexOf('    // 如果开启了文本编辑实时渲染', from)
      if (from < 0 || to < 0) return
      // Reuse the bounding box from plain-text measurement. Rich text keeps
      // the engine's foreignObject positioning and custom-width support.
      const position = `    const { node, textOrigin, height } = this._textData
    if (textOrigin) {
      node.attr('transform', 'translate(' + (textContentOffsetX - textOrigin.x) + ',' +
        ((textContentHeight - height) / 2 - textOrigin.y) + ')')
    } else {
${code.slice(from, to)}    }
`
      return (code.slice(0, from) + position + code.slice(to)).replace(
        'const { width: bboxWidth, height: bboxHeight } = textContentNested.bbox()',
        'const { width: bboxWidth, height: bboxHeight } = this._textData?.textOrigin && textContentNested.children().length === 1 ? this._textData : textContentNested.bbox()')
    }
  },
}

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
    mapRenderGeometry,
    {
      name: 'local-drawing-fonts',
      apply: 'build',
      closeBundle() {
        return cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/renderer/fonts', { recursive: true })
      },
    },
    {
      name: 'plantuml-license',
      apply: 'build',
      closeBundle() {
        return cp('node_modules/@plantuml/core/LICENSE', 'dist/renderer/plantuml-LICENSE.txt')
      },
    },
  ],
  optimizeDeps: { rolldownOptions: { plugins: [localDrawingFontSources, mapRenderGeometry] } },
  server: {
    fs: { allow: ['.'] },
  },
  define: { 'process.env.IS_PREACT': 'false' },
  worker: { format: 'es' },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rolldownOptions: { input: { app: 'index.html', plantuml: 'plantuml.html' } },
  },
})
