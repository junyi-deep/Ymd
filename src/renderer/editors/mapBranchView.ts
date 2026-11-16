import type MindMap from 'simple-mind-map'
import type { MapLayout } from 'simple-mind-map'
import type { MapData } from './mapAppearance'

export function findBranch(tree: MapData, uid: string, depth = 0): { tree: MapData; depth: number } | undefined {
  if (tree.data.uid === uid) return { tree, depth }
  for (const child of tree.children ?? []) {
    const branch = findBranch(child, uid, depth + 1)
    if (branch) return branch
  }
}

export function setBranchDepth(tree: MapData, levels: number, depth = 0) {
  if (!tree.children?.length) return
  tree.data.expand = depth < levels
  tree.children.forEach(child => setBranchDepth(child, levels, depth + 1))
}

export function installBranchView(map: MindMap) {
  const { renderer, search } = map
  let uid: string | undefined
  const branch = () => uid ? findBranch(renderer.renderTree, uid) : undefined
  const projected = new Proxy(renderer, {
    get(target, property, receiver) {
      if (property === 'renderTree') return branch()?.tree ?? target.renderTree
      return Reflect.get(target, property, receiver)
    },
  })
  // Layout and search can start from a subtree. Commands and history still own the full render tree.
  const layouts = new WeakSet<MapLayout>()
  const projectLayout = () => {
    const layout = renderer.layout
    if (layouts.has(layout)) return
    layouts.add(layout)
    layout.renderer = projected
  }
  const originalSearch = search.doSearch
  const searchMap = new Proxy(map, {
    get(target, property, receiver) {
      return property === 'renderer' ? projected : Reflect.get(target, property, receiver)
    },
  })
  search.doSearch = function () {
    if (!uid) { originalSearch.call(this); return }
    this.mindMap = searchMap
    try { originalSearch.call(this) } finally { this.mindMap = map }
  }
  const originalExpand = renderer.expandToNodeUid
  renderer.expandToNodeUid = (target, callback) => originalExpand.call(uid ? projected : renderer, target, callback)
  map.on('node_tree_render_start', projectLayout)
  return {
    get uid() { return uid },
    branch,
    set: (value?: string) => { uid = value },
    dispose: () => {
      map.off('node_tree_render_start', projectLayout)
      search.doSearch = originalSearch
      renderer.expandToNodeUid = originalExpand
    },
  }
}
