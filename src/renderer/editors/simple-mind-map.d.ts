declare module 'simple-mind-map' {
  interface NodeData {
    data: { text?: string; uid?: string; richText?: boolean; [key: string]: unknown }
    children?: NodeData[]
  }

  interface MapNode {
    isRoot: boolean
    uid: string
    getData(): NodeData['data']
    getData(property: string): unknown
  }

  type MapEvents = {
    data_change: [data: NodeData]
    afterExecCommand: [command: string]
    node_active: [node: MapNode | null, active: MapNode[]]
    node_contextmenu: [event: MouseEvent, node: MapNode]
    scale: [scale: number]
    search_info_change: [info: { total: number; currentIndex: number }]
    node_tree_render_end: []
    view_data_change: []
    node_attachmentClick: [node: MapNode]
  }

  export default class MindMap {
    static extendNodeDataNoStylePropList(fields: string[]): void
    static usePlugin(plugin: unknown): typeof MindMap
    renderer: {
      root: MapNode | null
      activeNodeList: MapNode[]
      textEdit: { hideEditTextBox(): void }
    }
    view: { scale: number; enlarge(): void; narrow(): void; fit(): void; reset(): void }
    miniMap: {
      calculationMiniMap(width: number, height: number): { svgHTML: string; viewBoxStyle: Record<string, string> }
      onViewBoxMousedown(event: { clientX: number; clientY: number }): void
      onViewBoxMousemove(event: { clientX: number; clientY: number }): void
      onMouseup(): void
    }
    associativeLine: { createLineFromActiveNode(): void; cancelCreateLine(): void }
    search: { search(text: string): void; endSearch(): void; searchNext(): void; replace(text: string, jumpNext?: boolean): void; replaceAll(text: string): void }
    constructor(options: {
      el: HTMLElement
      data: NodeData
      theme?: string
      themeConfig?: Record<string, unknown>
      layout?: string
      defaultInsertSecondLevelNodeText?: string
      defaultInsertBelowSecondLevelNodeText?: string
      beforeAssociativeLineConnection?: () => boolean
      customHyperlinkJump?: (link: string) => void
      customCheckEnableShortcut?: (event: KeyboardEvent) => boolean
      beforeTextEdit?: (node: MapNode) => boolean
      rainbowLinesConfig?: { open: boolean; colorsList: string[] }
      enableAutoEnterTextEditWhenKeydown?: boolean
      initRootNodePosition?: string[]
    })
    on<K extends keyof MapEvents>(event: K, callback: (...args: MapEvents[K]) => void): void
    off<K extends keyof MapEvents>(event: K, callback: (...args: MapEvents[K]) => void): void
    getData(): NodeData
    resize(): void
    setTheme(theme: string): void
    setLayout(layout: string): void
    setThemeConfig(config: Record<string, unknown>): void
    updateConfig(options: Record<string, unknown>): void
    execCommand(command: string, ...args: unknown[]): void
    export(format: string, download: boolean, name: string): Promise<unknown>
    destroy(): void
  }
}

declare module 'simple-mind-map/src/plugins/*.js' {
  const plugin: unknown
  export default plugin
}
