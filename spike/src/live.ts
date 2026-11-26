import { PLACE, type LayoutJob, type LocalLayout, type World } from './layout'
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
  /** Arrows (relations, by their two ends and title) new and gone. */
  arrowsAdded: number
  arrowsRemoved: number
  /** Arrows in both versions whose cited lines changed. */
  evidenceChanged: number
}

/** Each relation by its ends and title, with its cited lines. */
const arrows = (t: Tree) => {
  const m = new Map<string, string>()
  for (let k = 0; k < t.rels.length; k += 2) m.set(`${t.els[t.rels[k]].id}>${t.els[t.rels[k + 1]].id}>${t.relTitles[k >> 1]}`, JSON.stringify(t.relEvidence[k >> 1] ?? []))
  return m
}

/** A live update in words: what was added, changed and removed, by name, arrows and citations too. */
export function describeDiff(d: ModelDiff, next: Tree): string {
  const names = (xs: string[]) => `${xs.slice(0, 3).join(', ')}${xs.length > 3 ? ` +${xs.length - 3}` : ''}`
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return [
    d.added.length && `added ${names(d.added.map(i => next.els[i].title))}`,
    d.changed.length && `changed ${names(d.changed.map(i => next.els[i].title))}`,
    d.removed.length && `removed ${names(d.removed.map(id => id.split('.').pop()!))}`,
    d.arrowsAdded && `+${n(d.arrowsAdded, 'arrow')}`,
    d.arrowsRemoved && `−${n(d.arrowsRemoved, 'arrow')}`,
    d.evidenceChanged && `${n(d.evidenceChanged, 'citation')} moved`,
  ].filter(Boolean).join(' · ') || 'nothing on the map changed'
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
  const a = arrows(prev), b = arrows(next)
  let arrowsAdded = 0, arrowsRemoved = 0, evidenceChanged = 0
  for (const [k, ev] of b) { if (!a.has(k)) arrowsAdded++; else if (a.get(k) !== ev) evidenceChanged++ }
  for (const k of a.keys()) if (!b.has(k)) arrowsRemoved++
  return { added, removed, changed, oldIndex, arrowsAdded, arrowsRemoved, evidenceChanged }
}

const jobKey = (t: Tree, job: LayoutJob) => JSON.stringify([
  job.children.map(c => t.els[c].id),
  job.spans,
  job.headed,
  job.edges.map(e => [t.els[e.s].id, t.els[e.t].id, e.count]).sort(),
  // The Connections view places children by importance: a change there is a change of layout.
  job.weights ?? null,
  // A request's path places children by their step: a new order is a new layout.
  job.lane ?? null,
  // The whole map's shape follows the screen held upright or on its side.
  job.aspect ?? null,
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
      content.set(prevWorld.content.subarray(j * PLACE, j * PLACE + PLACE), i * PLACE)
      continue
    }
    let a = next.parent[i]
    while (a > 0 && oldIndex[a] < 0) a = next.parent[a]
    const r = a >= 0 && oldIndex[a] >= 0 ? prevWorld.rect.subarray(oldIndex[a] * 4, oldIndex[a] * 4 + 4) : nextWorld.rect.subarray(i * 4, i * 4 + 4)
    const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2
    rect.set([cx, cy, 0, 0], i * 4)
    // Its cards start as a point at the centre too (a tiny scale, not 0, so mapping back stays finite).
    content.set([cx, cy, 0, 0, 0, 1, 1, 1e-9, 1e-9, 1e-9], i * PLACE)
  }
  return { rect, content }
}
