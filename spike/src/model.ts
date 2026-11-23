export interface ElementJson {
  id: string
  parent: string | null
  title: string
  kind: string
  description: string
  technology: string
  tags: string[]
  /** Headline features of the product this element carries, from the map. */
  features?: string[]
  color: string
  shape: string
  /** LikeC4 metadata; the viewer reads numeric `lines` and `churn` for its lenses. */
  metadata?: Record<string, string>
}

/** A line of code that proves a link: `path:line` (or a range), and the cited text; null when it no longer resolves. */
export interface EvidenceJson {
  at: string
  line: number
  code: string | null
}

export interface RelationJson {
  source: string
  target: string
  title: string
  /** Only on links a map adds; relations from code references are their own proof. */
  evidence?: EvidenceJson[]
  /**
   * What kind of link it is: a call at runtime (a map link: HTTP, a store, a queue), a use in code
   * (an import, a reference), or a type-only import (compile-time coupling, not use). Older maps
   * leave it out: a link with evidence is runtime, the rest code.
   */
  kind?: RelKind
  /** Lines of the source's file that name what it uses there: why the relation exists. */
  lines?: number[]
  /** How many times the project's own end-to-end tests made this call (zoom trace); absent: not seen, or not traced. */
  seen?: number
}

export type RelKind = 'code' | 'types' | 'runtime'

export interface ModelJson {
  name: string
  /** What the breadcrumb calls the landscape; the name when absent. */
  title?: string
  elements: ElementJson[]
  relations: RelationJson[]
  /** What an uploaded map was built from: the project's commit, whether it had uncommitted changes, and when. */
  published?: { commit?: string; dirty?: boolean; at: string; traced?: { at: string; command: string; exit: number; seen: number; total: number } }
}

/** A sibling-level edge: relations between descendants of two children of one container, rolled up. */
export interface SiblingEdge {
  s: number
  t: number
  count: number
}

/**
 * What a card is, in a word a reader uses: a request path's own words (Endpoint, Step, Type, View,
 * Response) where the map has them, else the map's kind.
 */
export function kindName(e: { kind: string; metadata?: Record<string, string> }): string {
  const role = e.metadata?.role
  if (e.metadata?.method) return 'Endpoint'
  if (role) return role[0].toUpperCase() + role.slice(1)
  return e.kind
}

/** A doc comment's text without its markup: {@link Pet} as Pet, <code>x</code> as x. */
export function plainDoc(s: string): string {
  return s.replace(/\{@\w+\s+([^}]*)\}/g, '$1').replace(/<\/?[a-z][^>]*>/gi, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
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
  readonly relEvidence: (EvidenceJson[] | undefined)[]
  readonly maxDepth: number

  /** Per relation: its kind, and the lines of its source file that make it (empty for runtime links). */
  readonly relKind: RelKind[]
  readonly relLines: number[][]
  /** Per relation: how often the project's own tests made it; 0 when not seen. */
  readonly relSeen: number[]
  /** The run of the project's own tests this map was traced with, if it was: then unseen means not seen, not unknown. */
  readonly traced: NonNullable<ModelJson['published']>['traced'] | null

  /** `types`: keep type-only imports too (off: they are left out, as compile-time coupling only). */
  constructor(model: ModelJson, { types = false }: { types?: boolean } = {}) {
    const root: ElementJson = {
      id: '', parent: null, title: model.title ?? model.name, kind: 'landscape', description: '',
      technology: '', tags: [], color: 'primary', shape: 'rectangle',
    }
    // Doc-comment markup reads as plain words, in maps uploaded before the scanner stripped it too.
    this.els = [root, ...model.elements.map(e => (e.description && /<\/?[a-z][^>]*>|\{@\w+/i.test(e.description) ? { ...e, description: plainDoc(e.description) } : e))]
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
    this.relEvidence = []
    this.relKind = []
    this.relLines = []
    this.relSeen = []
    this.traced = model.published?.traced ?? null
    for (const r of model.relations) {
      const kind: RelKind = r.kind ?? (r.evidence ? 'runtime' : 'code')
      if (kind === 'types' && !types) continue
      const s = this.byId.get(r.source), t = this.byId.get(r.target)
      if (s == null || t == null || s === t) continue
      if (this.isAncestor(s, t) || this.isAncestor(t, s)) continue
      pairs.push(s, t)
      this.relTitles.push(r.title)
      this.relEvidence.push(r.evidence)
      this.relKind.push(kind)
      this.relLines.push(r.lines ?? [])
      this.relSeen.push(r.seen ?? 0)
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
  /** Some folded relation is a call at runtime; every one is a type-only import. */
  runtime: boolean
  typesOnly: boolean
  /** Some folded relation was seen in the project's own tests. */
  seen: boolean
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
    if (!e) out.set(key, (e = { s, t, count: 0, both: false, rel: k >> 1, out: false, in: false, focusCount: 0, focusRel: -1, runtime: false, typesOnly: true, seen: false }))
    e.count++
    const kind = tree.relKind[k >> 1]
    if (kind === 'runtime') e.runtime = true
    if (kind !== 'types') e.typesOnly = false
    if (tree.relSeen[k >> 1] > 0) e.seen = true
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
