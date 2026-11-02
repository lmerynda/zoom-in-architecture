/**
 * Orthogonal edge routing through the gutters between cards of one container.
 *
 * Grid lines run along each card's centre and half a gutter outside each card edge, so in a
 * packed grid neighbouring cards share their gutter lines. Routes are cheapest paths over that
 * grid with a cost per bend; segments other routes already use are cheaper, so edges merge into
 * shared trunks instead of running side by side.
 */

export interface Rect { x: number; y: number; w: number; h: number }

/** Card side, also the outward direction: 0 up, 1 right, 2 down, 3 left. */
export type Side = 0 | 1 | 2 | 3

export interface Route {
  /** Polyline from the source port to the target port. */
  pts: number[]
  from: Side
  to: Side
}

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]
const BEND = 60
const REUSE = 0.55

const uniq = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  return s.filter((x, i) => i === 0 || x - s[i - 1] > 1e-6)
}

export class ChannelGrid {
  readonly xs: number[]
  readonly ys: number[]
  private nx: number
  private ny: number
  /** Blocked flags per node and per outgoing direction. */
  private open: Uint8Array

  constructor(readonly cards: Rect[], readonly m: number) {
    this.xs = uniq(cards.flatMap(c => [c.x - m, c.x + c.w / 2, c.x + c.w + m]))
    this.ys = uniq(cards.flatMap(c => [c.y - m, c.y + c.h / 2, c.y + c.h + m]))
    this.nx = this.xs.length
    this.ny = this.ys.length
    this.open = new Uint8Array(this.nx * this.ny)
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      let bits = 0
      for (let d = 0; d < 4; d++) {
        const i2 = i + DX[d], j2 = j + DY[d]
        if (i2 < 0 || j2 < 0 || i2 >= this.nx || j2 >= this.ny) continue
        if (!this.segmentBlocked(this.xs[i], this.ys[j], this.xs[i2], this.ys[j2])) bits |= 1 << d
      }
      this.open[j * this.nx + i] = bits
    }
  }

  private segmentBlocked(x0: number, y0: number, x1: number, y1: number) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1)
    for (const c of this.cards) {
      // Open-interval overlap with the card's interior: touching an edge is fine.
      const inX = ax === bx ? ax > c.x && ax < c.x + c.w : ax < c.x + c.w && bx > c.x
      const inY = ay === by ? ay > c.y && ay < c.y + c.h : ay < c.y + c.h && by > c.y
      if (inX && inY) return true
    }
    return false
  }

  private index(x: number, y: number) {
    const i = this.xs.findIndex(v => Math.abs(v - x) < 1e-6)
    const j = this.ys.findIndex(v => Math.abs(v - y) < 1e-6)
    return j * this.nx + i
  }

  /** Centre of a card side, on the card border. */
  port(c: Rect, side: Side): [number, number] {
    return [c.x + c.w / 2 + DX[side] * c.w / 2, c.y + c.h / 2 + DY[side] * c.h / 2]
  }

  /** Grid node half a gutter out from a side's port. */
  private approach(c: Rect, side: Side) {
    const [px, py] = this.port(c, side)
    return this.index(px + DX[side] * this.m, py + DY[side] * this.m)
  }

  /**
   * Cheapest path from any side of card `a` to a goal. `goal(node, dir)` returns the extra cost
   * to finish from a node reached moving in `dir`, or Infinity.
   */
  private search(a: Rect, goal: (node: number, dir: number) => number, used?: Set<number>) {
    const N = this.nx * this.ny
    const dist = new Float64Array(N * 4).fill(Infinity)
    const prev = new Int32Array(N * 4).fill(-1)
    const start = new Int8Array(N * 4).fill(-1)
    const heap: number[] = []
    const cost: number[] = []
    const push = (st: number, c: number) => {
      heap.push(st); cost.push(c)
      let k = heap.length - 1
      while (k > 0) {
        const p = (k - 1) >> 1
        if (cost[p] <= cost[k]) break
        ;[heap[p], heap[k]] = [heap[k], heap[p]]; [cost[p], cost[k]] = [cost[k], cost[p]]
        k = p
      }
    }
    const pop = () => {
      const top = heap[0], tc = cost[0]
      const lh = heap.pop()!, lc = cost.pop()!
      if (heap.length) {
        heap[0] = lh; cost[0] = lc
        let k = 0
        for (;;) {
          const l = 2 * k + 1, r = l + 1
          let s = k
          if (l < heap.length && cost[l] < cost[s]) s = l
          if (r < heap.length && cost[r] < cost[s]) s = r
          if (s === k) break
          ;[heap[s], heap[k]] = [heap[k], heap[s]]; [cost[s], cost[k]] = [cost[k], cost[s]]
          k = s
        }
      }
      return [top, tc]
    }
    for (let side = 0 as Side; side < 4; side = (side + 1) as Side) {
      const n = this.approach(a, side)
      if (n < 0) continue
      const st = n * 4 + side
      if (this.m < dist[st]) { dist[st] = this.m; start[st] = side; push(st, this.m) }
    }
    let best = Infinity, bestSt = -1
    while (heap.length) {
      const [st, c] = pop()
      if (c > dist[st] || c >= best) continue
      const node = st >> 2, dir = st & 3
      const fin = goal(node, dir)
      if (c + fin < best) { best = c + fin; bestSt = st }
      const bits = this.open[node]
      const i = node % this.nx, j = (node / this.nx) | 0
      for (let d = 0; d < 4; d++) {
        if (!(bits & (1 << d)) || d === ((dir + 2) & 3)) continue
        const n2 = (j + DY[d]) * this.nx + (i + DX[d])
        let len = Math.abs(this.xs[n2 % this.nx] - this.xs[i]) + Math.abs(this.ys[(n2 / this.nx) | 0] - this.ys[j])
        if (used?.has(Math.min(node, n2) * 4 * N + Math.max(node, n2))) len *= REUSE
        const c2 = c + len + (d === dir ? 0 : BEND)
        const s2 = n2 * 4 + d
        if (c2 < dist[s2]) { dist[s2] = c2; prev[s2] = st; start[s2] = start[st]; push(s2, c2) }
      }
    }
    if (bestSt < 0) return null
    const nodes: number[] = []
    for (let st = bestSt; st >= 0; st = prev[st]) nodes.push(st >> 2)
    nodes.reverse()
    return { nodes, from: start[bestSt] as Side, endDir: bestSt & 3 }
  }

  private polyline(nodes: number[], head: [number, number], tail: [number, number][]) {
    const raw: number[] = [...head]
    for (const n of nodes) raw.push(this.xs[n % this.nx], this.ys[(n / this.nx) | 0])
    for (const p of tail) raw.push(p[0], p[1])
    return simplify(raw)
  }

  private mark(nodes: number[], used?: Set<number>) {
    if (!used) return
    const N = this.nx * this.ny
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[k - 1], b = nodes[k]
      used.add(Math.min(a, b) * 4 * N + Math.max(a, b))
    }
  }

  /** Route between two cards of this grid. Pass one `used` set for all routes in a container. */
  route(a: Rect, b: Rect, used?: Set<number>): Route | null {
    const goals = new Map<number, Side>()
    for (let side = 0 as Side; side < 4; side = (side + 1) as Side) goals.set(this.approach(b, side), side)
    const r = this.search(a, (node, dir) => {
      const side = goals.get(node)
      if (side == null) return Infinity
      return this.m + (dir === ((side + 2) & 3) ? 0 : BEND)
    }, used)
    if (!r) return null
    this.mark(r.nodes, used)
    const last = r.nodes[r.nodes.length - 1]
    const to = goals.get(last)!
    return { pts: this.polyline(r.nodes, this.port(a, r.from), [this.port(b, to)]), from: r.from, to }
  }

  /**
   * Route from card `a` out to the ring line beyond every card on `side`, ending at coordinate
   * `along` on that line (x for top and bottom, y for left and right).
   */
  exit(a: Rect, side: Side, along: number): Route | null {
    const ringX = side === 1 ? this.xs[this.nx - 1] : side === 3 ? this.xs[0] : NaN
    const ringY = side === 0 ? this.ys[0] : side === 2 ? this.ys[this.ny - 1] : NaN
    const r = this.search(a, node => {
      const x = this.xs[node % this.nx], y = this.ys[(node / this.nx) | 0]
      if (side === 0 || side === 2) return y === ringY ? Math.abs(x - along) + BEND : Infinity
      return x === ringX ? Math.abs(y - along) + BEND : Infinity
    })
    if (!r) return null
    const last = r.nodes[r.nodes.length - 1]
    const lx = this.xs[last % this.nx], ly = this.ys[(last / this.nx) | 0]
    const end: [number, number] = side === 0 || side === 2 ? [along, ly] : [lx, along]
    return { pts: this.polyline(r.nodes, this.port(a, r.from), [end]), from: r.from, to: side }
  }
}

/** Drops repeated and collinear points. */
export function simplify(p: number[]): number[] {
  const out: number[] = []
  for (let k = 0; k < p.length; k += 2) {
    const x = p[k], y = p[k + 1]
    const n = out.length
    if (n >= 2 && Math.abs(out[n - 2] - x) < 1e-6 && Math.abs(out[n - 1] - y) < 1e-6) continue
    if (n >= 4) {
      const ax = out[n - 4], ay = out[n - 3], bx = out[n - 2], by = out[n - 1]
      if ((Math.abs(ax - bx) < 1e-6 && Math.abs(bx - x) < 1e-6) || (Math.abs(ay - by) < 1e-6 && Math.abs(by - y) < 1e-6)) {
        out[n - 2] = x; out[n - 1] = y
        continue
      }
    }
    out.push(x, y)
  }
  return out
}
