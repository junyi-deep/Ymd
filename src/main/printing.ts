import { BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function printView<T>(name: string, body: string, output: (window: BrowserWindow) => Promise<T>) {
  if (typeof body !== 'string' || body.length > 32 * 1024 * 1024) throw new Error('打印内容过大或无效。')
  const title = name.replace(/[<>&"]/g, '')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ymd-print-'))
  const file = path.join(directory, 'document.html')
  let window: BrowserWindow | undefined
  try {
    await writeFile(file, `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
      <title>${title}</title><style>
      @page{margin:20mm} body{margin:0;color:#222;font:11pt/1.63 system-ui,sans-serif;overflow-wrap:anywhere}
      h1,h2,h3,h4,h5,h6{line-height:1.28;break-after:avoid;margin:1.1em 0 .45em} p{margin:.6em 0}
      pre,blockquote,figure,table{break-inside:avoid} pre,code{font-family:monospace;background:#f4f4f4}
      pre{white-space:pre-wrap;padding:9px} blockquote{border-left:2px solid #aaa;margin-left:0;padding-left:1em;color:#555}
      table{border-collapse:collapse} th,td{border:1px solid #ccc;padding:.25em .5em} img,svg{max-width:100%;height:auto}
      img[data-standalone]{display:block;margin-inline:auto}
      figure{margin:1em 0;text-align:center} a{color:#255b92}
      </style></head><body>${body}</body></html>`, { mode: 0o600 })
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    await window.loadFile(file)
    return await output(window)
  } finally {
    window?.destroy()
    await rm(directory, { recursive: true, force: true })
  }
}
