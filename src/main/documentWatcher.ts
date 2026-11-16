import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

type Directory = { files: Set<string>; watcher?: FSWatcher }

export class DocumentWatcher {
  private readonly subscriptions = new Map<number, Set<string>>()
  private readonly directories = new Map<string, Directory>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly notify: (window: number, file: string) => void) {}

  set(window: number, files: Iterable<string>) {
    this.subscriptions.set(window, new Set(files))
    this.reconcile()
  }

  remove(window: number) {
    this.subscriptions.delete(window)
    this.reconcile()
  }

  changed(file: string) {
    clearTimeout(this.timers.get(file))
    this.timers.set(file, setTimeout(() => {
      this.timers.delete(file)
      for (const [window, files] of this.subscriptions) if (files.has(file)) this.notify(window, file)
    }, 330))
  }

  private reconcile() {
    const next = new Map<string, Set<string>>()
    for (const files of this.subscriptions.values()) for (const file of files) {
      const parent = path.dirname(file)
      let names = next.get(parent)
      if (!names) next.set(parent, names = new Set())
      names.add(file)
    }
    for (const [parent, directory] of this.directories) if (!next.has(parent)) {
      directory.watcher?.close()
      this.directories.delete(parent)
    }
    for (const [parent, files] of next) {
      let directory = this.directories.get(parent)
      if (!directory) this.directories.set(parent, directory = { files })
      directory.files = files
      if (directory.watcher) continue
      try {
        const current = directory
        current.watcher = watch(parent, { persistent: false }, (_, name) => {
          const key = process.platform === 'win32' ? name?.toLowerCase() : name
          for (const file of current.files) {
            const basename = path.basename(file)
            if (!key || key === (process.platform === 'win32' ? basename.toLowerCase() : basename)) this.changed(file)
          }
        })
        current.watcher.on('error', () => {
          current.watcher?.close()
          current.watcher = undefined
        })
      } catch {
        // A focus refresh still works on a filesystem where watching is unavailable.
      }
    }
  }
}
