import type { LayoutJob, LocalLayout, World } from './layout'
import type { Tree } from './model'

export interface ModelDiff {
  /** New-tree indices of elements that did not exist before. */
  added: number[]
  /** Ids of elements that are gone. */
  removed: string[]
  /** New-tree indices of elements whose own fields or children changed. */
  changed: number[]
  /** New index → old index, for elements in both. */
  oldIndex: Int32Array
}

const fields = (t: Tree, i: number) => {
  const e = t.els[i]
  return JSON.stringify([e.title, e.kind, e.description, e.technology, e.tags, e.features ?? [], e.color, e.shape, e.metadata ?? null])
}
const childIds = (t: Tree, i: number) => t.children[i].map(c => t.els[c].id).join('\n')

/** What changed between two versions of a model, matched by element id. */
export function diffModels(prev: Tree, next: Tree): ModelDiff {
  const oldIndex = new Int32Array(next.size).fill(-1)
  const added: number[] = [], changed: number[] = []
  oldIndex[0] = 0
  for (let i = 1; i < next.size; i++) {
    const j = prev.byId.get(next.els[i].id)
    if (j == null) { added.push(i); continue }
    oldIndex[i] = j
    if (fields(prev, j) !== fields(next, i) || childIds(prev, j) !== childIds(next, i)) changed.push(i)
  }
  const removed = prev.els.slice(1).filter(e => !next.byId.has(e.id)).map(e => e.id)
  return { added, removed, changed, oldIndex }
}

const jobKey = (t: Tree, job: LayoutJob) => JSON.stringify([
  job.children.map(c => t.els[c].id),
  job.spans,
  job.headed,
  job.edges.map(e => [t.els[e.s].id, t.els[e.t].id, e.count]).sort(),
])

/**
 * Puts each container's children in a stable order for layout: children it already had keep
 * their previous order, new ones go at the end. Adding an element then moves its siblings as
 * little as the packing allows, instead of reflowing everything after its place in the file.
 */
export function stableOrder(prevTree: Tree, prevJobs: LayoutJob[], next: Tree, nextJobs: LayoutJob[]) {
  const prevOrder = new Map(prevJobs.map(j => [prevTree.els[j.id].id, new Map(j.children.map((c, k) => [prevTree.els[c].id, k]))]))
  for (const job of nextJobs) {
    const order = prevOrder.get(next.els[job.id].id)
    if (!order) continue
    const rank = (c: number) => order.get(next.els[c].id) ?? Infinity
    job.children = [...job.children].sort((a, b) => rank(a) - rank(b))
  }
}

/**
 * Splits the new model's layout jobs into ones whose previous layout can be reused (same
 * children in the same order and sizes, same sibling edges) and ones that must run again. Reused
 * layouts are re-keyed to the new tree's indices, so unchanged containers keep their
 * exact positions.
 */
export function reuseLayouts(prevTree: Tree, prevJobs: LayoutJob[], prevLocal: Map<number, LocalLayout>, next: Tree, nextJobs: LayoutJob[]) {
  const prevByKey = new Map<string, LayoutJob>()
  for (const j of prevJobs) prevByKey.set(`${prevTree.els[j.id].id}|${jobKey(prevTree, j)}`, j)
  const reused = new Map<number, LocalLayout>()
  const rerun: LayoutJob[] = []
  for (const job of nextJobs) {
    const old = prevByKey.get(`${next.els[job.id].id}|${jobKey(next, job)}`)
    const L = old && prevLocal.get(old.id)
    if (!L || !old) { rerun.push(job); continue }
    // Same children in the same order: positions carry over; route ends map by child id.
    const map = new Map(old.children.map((c, k) => [c, job.children[k]]))
    reused.set(job.id, { ...L, id: job.id, children: L.children.map(c => map.get(c)!), routes: L.routes.map(r => ({ ...r, s: map.get(r.s)!, t: map.get(r.t)! })) })
  }
  return { reused, rerun }
}

/**
 * Where each new element starts its morph: its old world rect if it existed, else a point at
 * the centre of its nearest surviving ancestor, so new cards grow out of their parent.
 */
export function startRects(prevWorld: World, next: Tree, nextWorld: World, oldIndex: Int32Array) {
  const rect = new Float64Array(nextWorld.rect.length)
  const content = new Float64Array(nextWorld.content.length)
  for (let i = 0; i < next.size; i++) {
    const j = oldIndex[i]
    if (j >= 0) {
      rect.set(prevWorld.rect.subarray(j * 4, j * 4 + 4), i * 4)
      content.set(prevWorld.content.subarray(j * 3, j * 3 + 3), i * 3)
      continue
    }
    let a = next.parent[i]
    while (a > 0 && oldIndex[a] < 0) a = next.parent[a]
    const r = a >= 0 && oldIndex[a] >= 0 ? prevWorld.rect.subarray(oldIndex[a] * 4, oldIndex[a] * 4 + 4) : nextWorld.rect.subarray(i * 4, i * 4 + 4)
    const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2
    rect.set([cx, cy, 0, 0], i * 4)
    content.set([cx, cy, 0], i * 3)
  }
  return { rect, content }
}
