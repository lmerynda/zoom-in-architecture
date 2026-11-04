import type { Tree } from './model'
import type { Side } from './route'

/**
 * A card is one cell of its parent's local layout, at every level. A child holding far more code
 * than its siblings spans 2 × 2 cells, so the big parts of a system read as big.
 */
export const CARD_W = 240
export const CARD_H = 150
/** Header band of a container, as a fraction of its height. */
export const HEADER = 0.14
export const PAD = 0.045
/** Space between cards in a local layout; edges run along its centre line. */
export const GUTTER = 56

/** Local size of a card spanning `span` cells per side, gutters between the cells included. */
export const cardW = (span: number) => CARD_W * span + GUTTER * (span - 1)
export const cardH = (span: number) => CARD_H * span + GUTTER * (span - 1)

/** A child spans 2 cells when it holds at least this many files, and this many times its siblings' median. */
export const BIG_FILES = 10
export const BIG_RATIO = 3

/**
 * Cells per side for every node. Size counts the files (leaves) under a node, so actors, stores
 * and external systems stay one cell, and a component that holds most of an app's code grows.
 */
export function spans(tree: Tree): Uint8Array {
  const leaves = new Int32Array(tree.size)
  const order = tree.dfs()
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    if (!tree.children[i].length && i > 0) leaves[i] = 1
    if (i > 0) leaves[tree.parent[i]] += leaves[i]
  }
  const span = new Uint8Array(tree.size).fill(1)
  for (let i = 0; i < tree.size; i++) {
    const c = tree.children[i]
    if (c.length < 2) continue
    // A file is a leaf of its own, not a holder of files: only containers can grow.
    const held = c.map(k => (tree.children[k].length ? leaves[k] : 0)).sort((a, b) => a - b)
    const median = held[held.length >> 1]
    for (const k of c) if (tree.children[k].length && leaves[k] >= BIG_FILES && leaves[k] >= BIG_RATIO * Math.max(1, median)) span[k] = 2
  }
  return span
}

export interface LayoutJob {
  id: number
  children: number[]
  /** Cells per side of each child, in `children` order. */
  spans: number[]
  /** Sibling edges, one per unordered pair, with how many relations they carry. */
  edges: { s: number; t: number; count: number }[]
}

export interface SiblingRoute {
  s: number
  t: number
  /** Polyline from s's port to t's port, local coordinates. */
  pts: number[]
  from: Side
  to: Side
}

/** One container's local layout as ELK returns it. */
export interface LocalLayout {
  id: number
  w: number
  h: number
  /** Children in the order they were laid out; pos follows this order. */
  children: number[]
  /** x, y per child, in `children` order. */
  pos: number[]
  /** Cells per side of each child, in `children` order. */
  spans: number[]
  routes: SiblingRoute[]
}

export interface World {
  /** World rect per node: x, y, w, h. */
  rect: Float64Array
  /** Child-content transform per container: world = o + s * local. */
  content: Float64Array
  local: Map<number, LocalLayout>
}

export function layoutJobs(tree: Tree): LayoutJob[] {
  const edges = tree.siblingEdges()
  const span = spans(tree)
  const jobs: LayoutJob[] = []
  for (let i = 0; i < tree.size; i++) {
    const c = tree.children[i]
    if (!c.length) continue
    const pairs = new Map<string, { s: number; t: number; count: number }>()
    for (const e of edges.get(i) ?? []) {
      const key = e.s < e.t ? `${e.s}>${e.t}` : `${e.t}>${e.s}`
      const p = pairs.get(key)
      if (p) p.count += e.count
      else pairs.set(key, { ...e })
    }
    jobs.push({ id: i, children: c, spans: c.map(k => span[k]), edges: [...pairs.values()] })
  }
  return jobs
}

/** Content area of a container card in its own world rect, below the header band. */
export function contentBox(x: number, y: number, w: number, h: number) {
  const pad = PAD * w
  const top = HEADER * h
  return { x: x + pad, y: y + top + pad * 0.5, w: w - 2 * pad, h: h - top - pad * 1.5 }
}

/** Width over height of a card's content area: local layouts aim for it so they fill the card. */
export const CONTENT_ASPECT = (() => { const b = contentBox(0, 0, CARD_W, CARD_H); return b.w / b.h })()

/**
 * Places every node in one world, top-down: the root's layout sits at scale 1 and each
 * container's local layout is scaled to fit its card's content area. Positions depend only on
 * the model, never on the camera, so nothing moves while zooming.
 */
export function placeWorld(tree: Tree, local: Map<number, LocalLayout>): World {
  const n = tree.size
  const rect = new Float64Array(n * 4)
  const content = new Float64Array(n * 3)
  const root = local.get(0)
  rect.set([0, 0, root?.w ?? CARD_W, root?.h ?? CARD_H], 0)
  for (const i of tree.dfs()) {
    const L = local.get(i)
    if (!L) continue
    let ox: number, oy: number, s: number
    if (i === 0) {
      ox = 0; oy = 0; s = 1
    } else {
      const b = contentBox(rect[i * 4], rect[i * 4 + 1], rect[i * 4 + 2], rect[i * 4 + 3])
      s = Math.min(b.w / L.w, b.h / L.h)
      ox = b.x + (b.w - L.w * s) / 2
      oy = b.y + (b.h - L.h * s) / 2
    }
    content.set([ox, oy, s], i * 3)
    L.children.forEach((c, k) => {
      rect.set([ox + L.pos[k * 2] * s, oy + L.pos[k * 2 + 1] * s, cardW(L.spans[k]) * s, cardH(L.spans[k]) * s], c * 4)
    })
  }
  return { rect, content, local }
}
