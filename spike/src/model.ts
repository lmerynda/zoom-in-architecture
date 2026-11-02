export interface ElementJson {
  id: string
  parent: string | null
  title: string
  kind: string
  description: string
  technology: string
  tags: string[]
  color: string
  shape: string
  /** LikeC4 metadata; the viewer reads numeric `lines` and `churn` for its lenses. */
  metadata?: Record<string, string>
}

export interface RelationJson {
  source: string
  target: string
  title: string
}

export interface ModelJson {
  name: string
  elements: ElementJson[]
  relations: RelationJson[]
}

/** A sibling-level edge: relations between descendants of two children of one container, rolled up. */
export interface SiblingEdge {
  s: number
  t: number
  count: number
}

/**
 * The element hierarchy as flat arrays. Node 0 is a virtual root holding the top-level elements,
 * so the whole landscape is just another container.
 */
export class Tree {
  readonly els: ElementJson[]
  readonly parent: Int32Array
  readonly depth: Int32Array
  readonly children: number[][]
  readonly byId = new Map<string, number>()
  /** Relations as node index pairs (source, target), parent-child relations dropped. */
  readonly rels: Int32Array
  readonly relTitles: string[]
  readonly maxDepth: number

  constructor(model: ModelJson) {
    const root: ElementJson = {
      id: '', parent: null, title: model.name, kind: 'landscape', description: '',
      technology: '', tags: [], color: 'primary', shape: 'rectangle',
    }
    this.els = [root, ...model.elements]
    const n = this.els.length
    this.parent = new Int32Array(n).fill(-1)
    this.depth = new Int32Array(n)
    this.children = Array.from({ length: n }, () => [])
    this.els.forEach((e, i) => this.byId.set(e.id, i))
    for (let i = 1; i < n; i++) {
      const p = this.els[i].parent
      const pi = p == null ? 0 : this.byId.get(p)
      if (pi == null) throw new Error(`unknown parent ${p} of ${this.els[i].id}`)
      this.parent[i] = pi
      this.children[pi].push(i)
    }
    let maxDepth = 0
    const order = this.dfs()
    for (const i of order) if (i) { this.depth[i] = this.depth[this.parent[i]] + 1; maxDepth = Math.max(maxDepth, this.depth[i]) }
    this.maxDepth = maxDepth

    const pairs: number[] = []
    this.relTitles = []
    for (const r of model.relations) {
      const s = this.byId.get(r.source), t = this.byId.get(r.target)
      if (s == null || t == null || s === t) continue
      if (this.isAncestor(s, t) || this.isAncestor(t, s)) continue
      pairs.push(s, t)
      this.relTitles.push(r.title)
    }
    this.rels = Int32Array.from(pairs)
  }

  get size() { return this.els.length }

  /** Pre-order: every parent comes before its children. */
  dfs(): number[] {
    const out: number[] = []
    const stack = [0]
    while (stack.length) {
      const i = stack.pop()!
      out.push(i)
      const c = this.children[i]
      for (let k = c.length - 1; k >= 0; k--) stack.push(c[k])
    }
    return out
  }

  isAncestor(a: number, b: number): boolean {
    for (let p = this.parent[b]; p >= 0; p = this.parent[p]) if (p === a) return true
    return false
  }

  /** Ancestor of `i` (or `i` itself) that sits directly under `container`. */
  childUnder(container: number, i: number): number {
    let c = i
    while (c >= 0 && this.parent[c] !== container) c = this.parent[c]
    return c
  }

  lca(a: number, b: number): number {
    let da = this.depth[a], db = this.depth[b]
    while (da > db) { a = this.parent[a]; da-- }
    while (db > da) { b = this.parent[b]; db-- }
    while (a !== b) { a = this.parent[a]; b = this.parent[b] }
    return a
  }

  /** For each container, its relations rolled up to edges between its direct children. */
  siblingEdges(): Map<number, SiblingEdge[]> {
    const acc = new Map<number, Map<string, SiblingEdge>>()
    for (let k = 0; k < this.rels.length; k += 2) {
      const s = this.rels[k], t = this.rels[k + 1]
      const c = this.lca(s, t)
      const cs = this.childUnder(c, s), ct = this.childUnder(c, t)
      const key = `${cs}>${ct}`
      let m = acc.get(c)
      if (!m) acc.set(c, (m = new Map()))
      const e = m.get(key)
      if (e) e.count++
      else m.set(key, { s: cs, t: ct, count: 1 })
    }
    const out = new Map<number, SiblingEdge[]>()
    for (const [c, m] of acc) out.set(c, [...m.values()])
    return out
  }
}

export interface ShownEdge {
  s: number
  t: number
  count: number
  /** Relations also run t → s, so the edge gets arrowheads at both ends. */
  both: boolean
  /** First relation folded in, for its label. */
  rel: number
  /** Some folded relation leaves the focus (out) or enters it (in). */
  out: boolean
  in: boolean
  /** How many folded relations cross the focus, and the first of them. */
  focusCount: number
  focusRel: number
}

/**
 * Rolls every relation up to the deepest ancestors that are currently shown, merging duplicates
 * and both directions into one edge. `rep(i)` returns the shown stand-in for node i. Relations
 * whose two ends collapse onto one node, or onto a node and its own ancestor, are dropped.
 * `inFocus` marks elements inside the focused element; each edge records whether any of its
 * own relations crosses that boundary, so a rolled-up edge lights up only for real relations.
 */
export function aggregateEdges(tree: Tree, rep: (i: number) => number, inFocus?: (i: number) => boolean): ShownEdge[] {
  const out = new Map<number, ShownEdge>()
  const n = tree.size
  for (let k = 0; k < tree.rels.length; k += 2) {
    const s = rep(tree.rels[k]), t = rep(tree.rels[k + 1])
    if (s === t || tree.isAncestor(s, t) || tree.isAncestor(t, s)) continue
    const key = Math.min(s, t) * n + Math.max(s, t)
    let e = out.get(key)
    if (!e) out.set(key, (e = { s, t, count: 0, both: false, rel: k >> 1, out: false, in: false, focusCount: 0, focusRel: -1 }))
    e.count++
    if (e.s !== s) e.both = true
    if (inFocus) {
      const fi = inFocus(tree.rels[k]), ti = inFocus(tree.rels[k + 1])
      if (fi && !ti) e.out = true
      if (ti && !fi) e.in = true
      if (fi !== ti && e.focusCount++ === 0) e.focusRel = k >> 1
    }
  }
  return [...out.values()]
}
