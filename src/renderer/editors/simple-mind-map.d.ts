declare module 'simple-mind-map' {
  interface NodeData {
    data: { text?: string; uid?: string; richText?: boolean }
    children?: NodeData[]
  }

  interface MapNode { isRoot: boolean }

  export default class MindMap {
    static usePlugin(plugin: unknown): typeof MindMap
    renderer: { root: MapNode | null; textEdit: { hideEditTextBox(): void } }
    constructor(options: { el: HTMLElement; data: NodeData; theme?: string; defaultInsertSecondLevelNodeText?: string; defaultInsertBelowSecondLevelNodeText?: string; beforeTextEdit?: (node: MapNode) => boolean })
    on(event: 'data_change', callback: (data: NodeData) => void): void
    off(event: 'data_change', callback: (data: NodeData) => void): void
    on(event: 'afterExecCommand', callback: () => void): void
    off(event: 'afterExecCommand', callback: () => void): void
    getData(): NodeData
    resize(): void
    setTheme(theme: string): void
    execCommand(command: string, ...args: unknown[]): void
    destroy(): void
  }
}

declare module 'simple-mind-map/src/plugins/Drag.js' {
  const Drag: unknown
  export default Drag
}
