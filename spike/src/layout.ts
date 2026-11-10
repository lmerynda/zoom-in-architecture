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
  /** Connections view: each child's importance (relations crossing its boundary), in `children` order; placed centre-out. */
  weights?: number[]
}

/**
 * How connected each node is: the relations that cross its boundary, to anything outside it.
 * The Connections view ranks siblings by it and places the most connected at the centre.
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

/** How many of its siblings each node shares at least one relation with. */
export function siblingPartners(tree: Tree): Int32Array {
  const p = new Int32Array(tree.size)
  for (const edges of tree.siblingEdges().values()) {
    const seen = new Set<string>()
    for (const e of edges) {
      const key = e.s < e.t ? `${e.s}>${e.t}` : `${e.t}>${e.s}`
      if (seen.has(key)) continue
      seen.add(key)
      p[e.s]++
      p[e.t]++
    }
  }
  return p
}

/**
 * What ranks a node among its siblings in the Connections view: the share of its siblings it
 * reaches, plus half its relations on a log scale against its busiest sibling. Breadth leads, so a
 * shared-types library that a few parts import hundreds of times does not outrank the part that
 * talks to all of its peers; volume still counts, so a heavy part missing one sibling is not
 * ranked below a light one that touches them all.
 */
export function rankKey(tree: Tree): Float64Array {
  const w = importance(tree), p = siblingPartners(tree), key = new Float64Array(tree.size)
  for (let i = 0; i < tree.size; i++) {
    const kids = tree.children[i]
    if (!kids.length) continue
    const others = Math.max(1, kids.length - 1), top = Math.log1p(Math.max(...kids.map(k => w[k])))
    for (const k of kids) key[k] = p[k] / others + (top > 0 ? (0.5 * Math.log1p(w[k])) / top : 0)
  }
  return key
}

/** Each node's rank among its siblings by importance, 1 for the most connected; ties keep map order. */
export function ranks(tree: Tree, w: Float64Array): Int32Array {
  const r = new Int32Array(tree.size)
  for (let i = 0; i < tree.size; i++) [...tree.children[i]].sort((a, b) => w[b] - w[a] || tree.children[i].indexOf(a) - tree.children[i].indexOf(b)).forEach((c, k) => { r[c] = k + 1 })
  return r
}

/** How far out a ring reaches, in cell widths: cells this much farther than the nearest free one wait. Tight, so a ring fills its edge cells before its corners, as far out as the next ring. */
const RING = 0.3

/**
 * The Connections view's arrangement of one level, on the same grid as the cards (so edges still
 * run in the gutters). The most connected child sits at the centre (exactly, unless a side would
 * be left empty); the rest fill rings
 * outward in rank order, so distance from the centre follows rank: a card never sits farther out
 * than one ranked below it by more than a ring. Within its ring a card takes the cell nearest the
 * siblings it is coupled with. The centre of a level is its centre of gravity; the rim holds what
 * little depends on anything.
 */
export function centreOut(job: LayoutJob): { pos: number[]; w: number; h: number } {
  const weights = job.weights ?? job.children.map(() => 0)
  const cellW = CARD_W + GUTTER, cellH = CARD_H + GUTTER
  const order = job.children.map((_, k) => k).sort((a, b) => weights[b] - weights[a] || a - b)
  const cells = job.spans.reduce((a, s) => a + s * s, 0)
  // The grid shape whose cards come out largest in the parent's content box, with the parity that
  // puts #1 exactly at the centre (even around a 2 × 2 card, odd around a single one): a crowded
  // level fills its card as well as the packed Architecture grid does, so it opens at the same zoom.
  const first = job.spans[order[0]] ?? 1, parity = first === 2 ? 0 : 1
  let cols = 1, rows = 1, bestScale = 0
  for (let c = parity || 2; c <= cells + 2; c += 2) {
    const r0 = Math.max(first, Math.ceil(cells / c))
    const r = r0 % 2 === parity ? r0 : r0 + 1
    const scale = Math.min(CONTENT_ASPECT / (c * cellW + GUTTER), 1 / (r * cellH + GUTTER))
    if (scale > bestScale + 1e-12) { bestScale = scale; cols = c; rows = r }
  }
  const taken = new Uint8Array(cols * rows)
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2
  const at = new Map<number, { c: number; r: number; span: number }>()
  const pair = new Map<string, number>()
  for (const e of job.edges) { pair.set(`${e.s}>${e.t}`, e.count); pair.set(`${e.t}>${e.s}`, e.count) }
  const dist = (c1: number, r1: number, c2: number, r2: number) => Math.hypot((c1 - c2) * cellW, (r1 - r2) * cellH) / cellW
  const take = (c: number, r: number, span: number) => { for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) taken[(r + dr) * cols + c + dc] = 1 }
  const fits = (c: number, r: number, span: number) => { for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) if (taken[(r + dr) * cols + c + dc]) return false; return true }
  order.forEach((k, n) => {
    const child = job.children[k], span = job.spans[k]
    if (n === 0) { const c = (cols - span) / 2, r = (rows - span) / 2; at.set(child, { c, r, span }); take(c, r, span); return }
    const free: { c: number; r: number; d: number }[] = []
    for (let r = 0; r + span <= rows; r++) for (let c = 0; c + span <= cols; c++) if (fits(c, r, span)) free.push({ c, r, d: dist(c + (span - 1) / 2, r + (span - 1) / 2, cx, cy) })
    // The innermost ring with room; within it, nearest what this card is coupled with.
    const inner = Math.min(...free.map(f => f.d))
    let best: { c: number; r: number; score: number } | null = null
    for (const f of free.filter(x => x.d <= inner + RING)) {
      let pull = 0, total = 0
      for (const [other, p] of at) {
        const wgt = pair.get(`${child}>${other}`) ?? 0
        if (wgt) { pull += wgt * dist(f.c + (span - 1) / 2, f.r + (span - 1) / 2, p.c + (p.span - 1) / 2, p.r + (p.span - 1) / 2); total += wgt }
      }
      const score = (total ? pull / total : 0) + 0.25 * f.d
      if (!best || score < best.score - 1e-9) best = { c: f.c, r: f.r, score }
    }
    at.set(child, { c: best!.c, r: best!.r, span })
    take(best!.c, best!.r, span)
  })
  // Drop every empty outer row and column. A ring that does not go all the way round (three cards
  // around one) would otherwise leave a whole side of the level blank; #1 then sits half a cell
  // off the exact middle, still at the centre of the cards around it.
  const placed = [...at.values()]
  const left = Math.min(...placed.map(p => p.c)), right = cols - Math.max(...placed.map(p => p.c + p.span))
  const top = Math.min(...placed.map(p => p.r)), bottom = rows - Math.max(...placed.map(p => p.r + p.span))
  const pos = job.children.flatMap(ch => { const p = at.get(ch)!; return [GUTTER + (p.c - left) * cellW, GUTTER + (p.r - top) * cellH] })
  return { pos, w: (cols - left - right) * cellW + GUTTER, h: (rows - top - bottom) * cellH + GUTTER }
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
  // The Connections view sizes by connection, not by code: the most connected child of a level of
  // four or more is the big card at its centre.
  const weight = coupling ? rankKey(tree) : null
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
    // From four up: three cards around a single centre form a plus with one side empty, around a
    // 2 × 2 one they close the grid.
    if (c.length < 4) continue
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
      // No larger than a 2 × 2 grid's cards: a lone file would otherwise fill its app's card and
      // open with it, long before the files of its siblings.
      s = Math.min(b.w / L.w, b.h / L.h, b.w / (cardW(2) + 2 * GUTTER), b.h / (cardH(2) + 2 * GUTTER))
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
