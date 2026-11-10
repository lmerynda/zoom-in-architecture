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
  // When the map names the product's features, size is earned by carrying one: a big pile of
  // tooling or plumbing stays one cell, so it does not outweigh what the product does.
  const carries = new Uint8Array(tree.size)
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    if (tree.els[i].features?.length) carries[i] = 1
    if (i > 0 && carries[i]) carries[tree.parent[i]] = 1
  }
  const featured = carries[0] === 1
  const span = new Uint8Array(tree.size).fill(1)
  for (let i = 0; i < tree.size; i++) {
    const c = tree.children[i]
    if (c.length < 2) continue
    // A file is a leaf of its own, not a holder of files: only containers can grow.
    const held = c.map(k => (tree.children[k].length ? leaves[k] : 0)).sort((a, b) => a - b)
    const median = held[held.length >> 1]
    for (const k of c) if (tree.children[k].length && (!featured || carries[k]) && leaves[k] >= BIG_FILES && leaves[k] >= BIG_RATIO * Math.max(1, median)) span[k] = 2
  }
  return span
}

export interface LayoutJob {
  id: number
  children: number[]
  /** Cells per side of each child, in `children` order. */
  spans: number[]
  /** Whether each child is a container, whose header routes must not cross. */
  headed: boolean[]
  /** Sibling edges, one per unordered pair, with how many relations they carry. */
  edges: { s: number; t: number; count: number }[]
  /** Coupling view: each child's importance (relations crossing its boundary), in `children` order; placed centre-out. */
  weights?: number[]
}

/**
 * How connected each node is: the relations that cross its boundary, to anything outside it.
 * The Coupling view ranks siblings by it and places the most connected at the centre.
 */
export function importance(tree: Tree): Float64Array {
  const w = new Float64Array(tree.size)
  for (let k = 0; k < tree.rels.length; k += 2) {
    const s = tree.rels[k], t = tree.rels[k + 1], top = tree.lca(s, t)
    for (let a = s; a !== top; a = tree.parent[a]) w[a]++
    for (let a = t; a !== top; a = tree.parent[a]) w[a]++
  }
  return w
}

/** Each node's rank among its siblings by importance, 1 for the most connected; ties keep map order. */
export function ranks(tree: Tree, w: Float64Array): Int32Array {
  const r = new Int32Array(tree.size)
  for (let i = 0; i < tree.size; i++) [...tree.children[i]].sort((a, b) => w[b] - w[a] || tree.children[i].indexOf(a) - tree.children[i].indexOf(b)).forEach((c, k) => { r[c] = k + 1 })
  return r
}

/**
 * The Coupling view's arrangement of one level: on the same grid as the cards (so edges still run
 * in the gutters), the most connected child at the centre, then each next one by importance in the
 * free cell nearest the siblings it is coupled with, pulled toward the centre. The centre of a
 * level is its centre of gravity; its rim holds what little depends on anything.
 */
export function centreOut(job: LayoutJob): { pos: number[]; w: number; h: number } {
  const n = job.children.length, weights = job.weights ?? job.children.map(() => 0)
  const cellW = CARD_W + GUTTER, cellH = CARD_H + GUTTER
  const cells = job.spans.reduce((a, s) => a + s * s, 0)
  const cols = Math.max(1, Math.ceil(Math.sqrt((cells * CONTENT_ASPECT * cellH) / cellW)))
  const rows = Math.max(1, Math.ceil(cells / cols)) + (cols * Math.ceil(cells / cols) - cells < 1 && n > 2 ? 1 : 0)
  const taken = new Uint8Array(cols * rows)
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2
  const at = new Map<number, { c: number; r: number; span: number }>()
  const pair = new Map<string, number>()
  for (const e of job.edges) { pair.set(`${e.s}>${e.t}`, e.count); pair.set(`${e.t}>${e.s}`, e.count) }
  const dist = (c1: number, r1: number, c2: number, r2: number) => Math.hypot((c1 - c2) * cellW, (r1 - r2) * cellH) / cellW
  const order = job.children.map((_, k) => k).sort((a, b) => weights[b] - weights[a] || a - b)
  for (const k of order) {
    const child = job.children[k], span = job.spans[k]
    let best: { c: number; r: number; score: number } | null = null
    for (let r = 0; r + span <= rows; r++) for (let c = 0; c + span <= cols; c++) {
      let free = true
      for (let dr = 0; dr < span && free; dr++) for (let dc = 0; dc < span && free; dc++) if (taken[(r + dr) * cols + c + dc]) free = false
      if (!free) continue
      const mc = c + (span - 1) / 2, mr = r + (span - 1) / 2
      // Near the siblings it is coupled with (by how much), and toward the centre.
      let pull = 0, total = 0
      for (const [other, p] of at) {
        const wgt = pair.get(`${child}>${other}`) ?? 0
        if (wgt) { pull += wgt * dist(mc, mr, p.c + (p.span - 1) / 2, p.r + (p.span - 1) / 2); total += wgt }
      }
      const score = 0.6 * dist(mc, mr, cx, cy) + (total ? pull / total : 0)
      if (!best || score < best.score - 1e-9) best = { c, r, score }
    }
    if (!best) best = { c: 0, r: rows, score: 0 }
    at.set(child, { c: best.c, r: best.r, span })
    for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) if ((best.r + dr) < rows) taken[(best.r + dr) * cols + best.c + dc] = 1
  }
  // Tight bounds: drop empty rows and columns at the edges.
  const placed = [...at.values()]
  const c0 = Math.min(...placed.map(p => p.c)), r0 = Math.min(...placed.map(p => p.r))
  const c1 = Math.max(...placed.map(p => p.c + p.span)), r1 = Math.max(...placed.map(p => p.r + p.span))
  const pos = job.children.flatMap(ch => { const p = at.get(ch)!; return [GUTTER + (p.c - c0) * cellW, GUTTER + (p.r - r0) * cellH] })
  return { pos, w: (c1 - c0) * cellW + GUTTER, h: (r1 - r0) * cellH + GUTTER }
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

export function layoutJobs(tree: Tree, coupling = false): LayoutJob[] {
  const edges = tree.siblingEdges()
  // The Coupling view sizes by connection, not by code: the most connected child of a level of
  // five or more is the big card at its centre.
  const weight = coupling ? importance(tree) : null
  const span = coupling ? couplingSpans(tree, weight!) : spans(tree)
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
    jobs.push({ id: i, children: c, spans: c.map(k => span[k]), headed: c.map(k => tree.children[k].length > 0), edges: [...pairs.values()], ...(weight ? { weights: c.map(k => weight[k]) } : {}) })
  }
  return jobs
}

function couplingSpans(tree: Tree, w: Float64Array): Uint8Array {
  const span = new Uint8Array(tree.size).fill(1)
  for (let i = 0; i < tree.size; i++) {
    const c = tree.children[i]
    if (c.length < 5) continue
    const top = c.reduce((a, b) => (w[b] > w[a] ? b : a))
    if (w[top] > 0) span[top] = 2
  }
  return span
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
