import { cardH, cardW, GUTTER, type SiblingRoute, type World } from './layout'
import type { Tree } from './model'
import { ChannelGrid, simplify, type Side } from './route'

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]

/**
 * Routes between any two shown nodes in world coordinates. The route is the sibling route at
 * their lowest common container, extended at each end by exit routes that climb out of every
 * container in between through its gutters, so no edge ever crosses a card.
 */
export class EdgeRouter {
  private grids = new Map<number, ChannelGrid>()
  private siblings = new Map<number, Map<string, SiblingRoute>>()
  private exits = new Map<string, { pts: number[]; from: Side } | null>()
  private composed = new Map<number, number[] | null>()

  constructor(private tree: Tree, private world: World) {}

  /** Forgets routes that depend on world positions, while those positions are animating. */
  invalidate() {
    this.exits.clear()
    this.composed.clear()
  }

  private grid(container: number) {
    let g = this.grids.get(container)
    if (!g) {
      const L = this.world.local.get(container)!
      const cards = L.children.map((c, k) => ({ x: L.pos[k * 2], y: L.pos[k * 2 + 1], w: cardW(L.spans[k]), h: cardH(L.spans[k]), header: this.tree.children[c].length > 0 }))
      g = new ChannelGrid(cards, GUTTER / 2)
      this.grids.set(container, g)
    }
    return g
  }

  private localRect(child: number) {
    const p = this.tree.parent[child]
    const L = this.world.local.get(p)!
    const k = L.children.indexOf(child)
    return { x: L.pos[k * 2], y: L.pos[k * 2 + 1], w: cardW(L.spans[k]), h: cardH(L.spans[k]), header: this.tree.children[child].length > 0 }
  }

  private toWorld(container: number, pts: number[]) {
    const o = this.world.content, ox = o[container * 3], oy = o[container * 3 + 1], s = o[container * 3 + 2]
    const out = new Array<number>(pts.length)
    for (let k = 0; k < pts.length; k += 2) { out[k] = ox + pts[k] * s; out[k + 1] = oy + pts[k + 1] * s }
    return out
  }

  /** World point at the centre of a node's side. */
  port(node: number, side: Side): [number, number] {
    const r = this.world.rect, x = r[node * 4], y = r[node * 4 + 1], w = r[node * 4 + 2], h = r[node * 4 + 3]
    return [x + w / 2 + DX[side] * w / 2, y + h / 2 + DY[side] * h / 2]
  }

  private sibling(cs: number, ct: number): SiblingRoute | null {
    const p = this.tree.parent[cs]
    let m = this.siblings.get(p)
    if (!m) {
      m = new Map()
      for (const r of this.world.local.get(p)?.routes ?? []) m.set(`${r.s}>${r.t}`, r)
      this.siblings.set(p, m)
    }
    const r = m.get(`${cs}>${ct}`)
    if (r) return r
    const back = m.get(`${ct}>${cs}`)
    if (!back) return null
    const pts: number[] = []
    for (let k = back.pts.length - 2; k >= 0; k -= 2) pts.push(back.pts[k], back.pts[k + 1])
    return { s: cs, t: ct, pts, from: back.to, to: back.from }
  }

  /**
   * World route from `child` out of its container to the container's port on `side`, and the
   * side of `child` it leaves from.
   */
  private exit(child: number, side: Side) {
    const key = `${child}:${side}`
    if (this.exits.has(key)) return this.exits.get(key)!
    const p = this.tree.parent[child]
    const o = this.world.content, s = o[p * 3 + 2]
    const port = this.port(p, side)
    // The port projected onto the container's local axes, to meet the ring line square on.
    const along = side === 0 || side === 2 ? (port[0] - o[p * 3]) / s : (port[1] - o[p * 3 + 1]) / s
    const r = this.grid(p).exit(this.localRect(child), side, along)
    const out = r ? { pts: [...this.toWorld(p, r.pts), port[0], port[1]], from: r.from } : null
    this.exits.set(key, out)
    return out
  }

  /** Polyline from node `a` up to the port of `top` (an ancestor's child) on `side`. */
  private climb(a: number, top: number, side: Side): number[] | null {
    const chain: number[] = []
    for (let x = a; x !== top; x = this.tree.parent[x]) chain.push(x)
    // Top down: each level's exit tells the level below which side to leave from.
    const segs: number[][] = []
    let s = side
    for (let k = chain.length - 1; k >= 0; k--) {
      const e = this.exit(chain[k], s)
      if (!e) return null
      segs.push(e.pts)
      s = e.from
    }
    const out: number[] = []
    for (let k = segs.length - 1; k >= 0; k--) out.push(...segs[k])
    return out
  }

  /** World polyline from node s to node t, or null if no route exists. */
  route(s: number, t: number): number[] | null {
    const key = s * this.tree.size + t
    if (this.composed.has(key)) return this.composed.get(key)!
    const L = this.tree.lca(s, t)
    const cs = this.tree.childUnder(L, s), ct = this.tree.childUnder(L, t)
    let out: number[] | null = null
    const sib = cs !== ct && cs >= 0 && ct >= 0 ? this.sibling(cs, ct) : null
    if (sib) {
      const mid = this.toWorld(L, sib.pts)
      const head = s === cs ? [] : this.climb(s, cs, sib.from)
      const tail = t === ct ? [] : this.climb(t, ct, sib.to)
      if (head && tail) {
        const back: number[] = []
        for (let k = tail.length - 2; k >= 0; k -= 2) back.push(tail[k], tail[k + 1])
        out = simplify([...head, ...mid, ...back])
      }
    }
    this.composed.set(key, out)
    return out
  }
}
