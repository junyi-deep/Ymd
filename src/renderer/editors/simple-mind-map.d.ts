declare module 'simple-mind-map' {
  interface NodeData {
    data: { text?: string; uid?: string; richText?: boolean; [key: string]: unknown }
    children?: NodeData[]
  }

  export interface MapNode {
    opt: { ymdNumberText?: string }
    style: { text(node: import('@svgdotjs/svg.js').Text): void }
    isRoot: boolean
    uid: string
    isGeneralization?: boolean
    left: number
    top: number
    width: number
    height: number
    layerIndex: number
    dir?: string
    parent: MapNode | null
    children: MapNode[]
    nodeData: NodeData
    group?: { node: Element }
    _tagData?: { node: { node: Element } }[]
    _iconData?: { node: { node: Element } }[]
    _lines?: { node: Element }[]
    _postfixData?: { el: Element }
    _generalizationList?: { generalizationLine: { node: Element }; generalizationNode: MapNode }[]
    expandBtnSize: number
    _generalizationNodeWidth: number
    _generalizationNodeHeight: number
    checkHasGeneralization(): boolean
    hasCustomPosition(): boolean
    active(): void
    getData(): NodeData['data']
    getData(property: string): unknown
  }

  export interface MapLayout {
    renderer: MindMap['renderer']
    doLayout(callback: (root: MapNode) => void): void
    renderLine(node: MapNode, ...args: unknown[]): void
    renderExpandBtn(node: MapNode, ...args: unknown[]): void
    renderExpandBtnRect(rect: unknown, size: number, width: number, height: number, node: MapNode): void
    renderGeneralization(items: { node: MapNode; range?: number[] }[]): void
    nodeIsRemoveAllLines?(node: MapNode): boolean
    computedBaseValue(): void
    computedTopValue(): void
    adjustTopValue(): void
    computedLeftValue(): void
    adjustLeftValue(): void
    computedLeftTopValue(): void
    adjustLeftTopValue(): void
    createNode(...args: unknown[]): unknown
    setNodeCenter(...args: unknown[]): void
    root: unknown
  }

  type MapEvents = {
    data_change: [data: NodeData | undefined]
    afterExecCommand: [command: string]
    node_active: [node: MapNode | null, active: MapNode[]]
    node_click: [node: MapNode, event: MouseEvent]
    draw_click: []
    contextmenu: []
    node_contextmenu: [event: MouseEvent, node: MapNode]
    scale: [scale: number]
    search_info_change: [info: { total: number; currentIndex: number }]
    search_match_node_list_change: [nodes: (MapNode | NodeData)[]]
    node_tree_render_end: []
    node_tree_render_start: []
    view_data_change: []
    node_attachmentClick: [node: MapNode]
  }

  export default class MindMap {
    static extendNodeDataNoStylePropList(fields: string[]): void
    static usePlugin(plugin: unknown): typeof MindMap
    command: { originAddHistory(): void; pause(): void; recovery(): void }
    nodeInnerPrefixList: {
      name: string
      createNodeData: (context: { data: NodeData }) => [string, string | undefined]
      updateNodeData: (node: MapNode, data: Record<string, string | undefined>) => boolean
      createContent: (node: MapNode) => { node: import('@svgdotjs/svg.js').Text; width: number; height: number } | undefined
    }[]
    draw: { node: SVGGElement }
    renderer: {
      root: MapNode | null
      renderTree: NodeData
      layout: MapLayout
      activeNodeList: MapNode[]
      textEdit: { hideEditTextBox(): void }
      findNodeByUid(uid: string): MapNode | undefined
      expandToNodeUid(uid: string, callback: () => void): void
      moveNodeToCenter(node: MapNode, resetScale?: boolean): void
      setNodeDataRender(node: MapNode, data: Record<string, unknown>): void
    }
    view: {
      scale: number
      enlarge(): void; narrow(): void; fit(): void; reset(): void; translateXY(x: number, y: number): void
      getTransformData(): { transform: Record<string, number>; state: { scale: number; x: number; y: number; sx: number; sy: number } }
      setTransformData(view: ReturnType<MindMap['view']['getTransformData']>): void
    }
    miniMap: {
      calculationMiniMap(width: number, height: number): { svgHTML: string; viewBoxStyle: Record<string, string> }
      onViewBoxMousedown(event: { clientX: number; clientY: number }): void
      onViewBoxMousemove(event: { clientX: number; clientY: number }): void
      onMouseup(): void
    }
    associativeLine: { isCreatingLine: boolean; createLineFromActiveNode(): void; cancelCreateLine(): void }
    search: { mindMap: MindMap; doSearch(): void; search(text: string): void; endSearch(): void; searchNext(): void; jump(index: number): void; replace(text: string, jumpNext?: boolean): void; replaceAll(text: string): void }
    constructor(options: {
      el: HTMLElement
      data: NodeData
      theme?: string
      themeConfig?: Record<string, unknown>
      layout?: string
      fit?: boolean
      readonly?: boolean
      defaultInsertSecondLevelNodeText?: string
      defaultInsertBelowSecondLevelNodeText?: string
      beforeAssociativeLineConnection?: () => boolean
      customHyperlinkJump?: (link: string) => void
      createNodePostfixContent?: (node: MapNode) => { el: HTMLElement; width: number; height: number } | undefined
      customCheckEnableShortcut?: (event: KeyboardEvent) => boolean
      beforeTextEdit?: (node: MapNode) => boolean
      beforeDragEnd?: (event: { overlapNodeUid: string }) => boolean
      beforeDeleteNodeImg?: (node: MapNode) => boolean
      maxImgResizeWidthInheritTheme?: boolean
      maxImgResizeWidth?: number
      maxImgResizeHeight?: number
      rainbowLinesConfig?: { open: boolean; colorsList: string[] }
      enableAutoEnterTextEditWhenKeydown?: boolean
      enableFreeDrag?: boolean
      initRootNodePosition?: string[]
    })
    on<K extends keyof MapEvents>(event: K, callback: (...args: MapEvents[K]) => void): void
    off<K extends keyof MapEvents>(event: K, callback: (...args: MapEvents[K]) => void): void
    getData(): NodeData
    updateData(data: NodeData): void
    resize(): void
    render(callback?: () => void): void
    reRender(callback?: () => void): void
    setTheme(theme: string): void
    getLayout(): string
    setLayout(layout: string): void
    setThemeConfig(config: Record<string, unknown>): void
    updateConfig(options: Record<string, unknown>): void
    execCommand(command: string, ...args: unknown[]): void
    export(format: string, download: boolean, name: string): Promise<string | null>
    destroy(): void
  }
}

declare module 'simple-mind-map/src/plugins/AssociativeLine.js' {
  export default class AssociativeLine {
    protected isCreatingLine: boolean
    protected creatingStartNode: object | null
    protected checkOverlapNode(x: number, y: number): void
    cancelCreateLine(): void
  }
}

declare module 'simple-mind-map/src/plugins/*.js' {
  const plugin: unknown
  export default plugin
}

declare module 'simple-mind-map/src/layouts/*.js' {
  import type MindMap from 'simple-mind-map'
  import type { MapLayout } from 'simple-mind-map'
  const layout: new (renderer: { mindMap: MindMap; renderTree: unknown }, name: string) => MapLayout
  export default layout
}
