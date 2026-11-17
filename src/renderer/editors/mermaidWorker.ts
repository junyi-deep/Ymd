import { renderAsync } from 'pele/lazy'

self.addEventListener('message', async (event: MessageEvent<{ id: number; code: string; prefix: string }>) => {
  const { id, code, prefix } = event.data
  try {
    const { svg } = await renderAsync(code, { responsive: true, links: false, images: false, idPrefix: prefix })
    self.postMessage({ id, svg })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
