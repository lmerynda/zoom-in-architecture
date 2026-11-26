import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { cardW, centreOut, CONTENT_ASPECT, GUTTER, lanePlace, type LayoutJob, type LocalLayout } from './layout'
import { ChannelGrid } from './route'

const elk = new ELK()

/** Up to this many arrows in a level, arrows that share no end keep out of each other's gutters. */
const FEW_EDGES = 8

/** Aspect targets tried for a level that must fit a given shape, as multiples of that shape. */
const ASPECT_TRIES = [0.5, 0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1, 2.6, 3.2]

// Packs cards into a near-grid that fills the parent card; edges are routed afterwards
// through the gutters, which rectpacking leaves GUTTER wide.
const OPTIONS = {
  'elk.algorithm': 'rectpacking',
  'elk.aspectRatio': String(CONTENT_ASPECT),
  'elk.padding': `[top=${GUTTER},left=${GUTTER},bottom=${GUTTER},right=${GUTTER}]`,
  'elk.spacing.nodeNode': String(GUTTER),
}

/**
 * All of a chunk's containers go to ELK in one call, as compound children of a dummy root:
 * elkjs has a fixed cost of ~30 ms per call, and ELK lays out each compound node's children on
 * their own, so the result is the same as separate calls.
 */
async function layoutAll(jobs: LayoutJob[]): Promise<LocalLayout[]> {
  // Coupling-view levels are placed centre-out by importance; the rest are packed by ELK.
  // A request's path is placed in reading order.
  const packed = jobs.filter(j => !j.weights && !j.lane)
  // ELK takes the aspect ratio as a loose target: a level that must fit a given shape (the whole
  // map, the stage) is packed for several targets around it, and the packing that comes out
  // largest in that shape is kept.
  const tries = (job: LayoutJob) => (job.aspect ? [...ASPECT_TRIES.map(t => job.aspect! * t), CONTENT_ASPECT] : [CONTENT_ASPECT])
  const runs = packed.flatMap(job => tries(job).map(a => ({ job, a })))
  const root: ElkNode = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'box' },
    children: runs.map(({ job, a }, n) => ({
      id: `c${job.id}~${n}`,
      layoutOptions: { ...OPTIONS, 'elk.aspectRatio': String(a) },
      children: job.children.map((c, k) => ({ id: String(c), width: cardW(job.spans[k]), height: job.heights[k] })),
    })),
  }
  const g = runs.length ? await elk.layout(root) : { children: [] }
  const elkOf = new Map<number, ElkNode>()
  runs.forEach(({ job }, n) => {
    const c = g.children![n], best = elkOf.get(job.id), want = job.aspect ?? CONTENT_ASPECT
    const fit = (e: ElkNode) => Math.min(want / e.width!, 1 / e.height!)
    if (!best || fit(c) > fit(best) + 1e-12) elkOf.set(job.id, c)
  })
  return jobs.map(job => {
    let pos: number[], w: number, h: number
    if (job.lane) ({ pos, w, h } = lanePlace({ ...job, lane: job.lane }))
    else if (job.weights) ({ pos, w, h } = centreOut(job))
    else {
      const c = elkOf.get(job.id)!
      const at = new Map(c.children!.map(k => [k.id, k]))
      pos = []
      for (const ch of job.children) {
        const k = at.get(String(ch))!
        pos.push(k.x!, k.y!)
      }
      w = c.width!; h = c.height!
    }
    const index = new Map(job.children.map((ch, k) => [ch, k]))
    const rect = (ch: number) => { const k = index.get(ch)!; return { x: pos[k * 2], y: pos[k * 2 + 1], w: cardW(job.spans[k]), h: job.heights[k], header: job.headed[k] } }
    const grid = new ChannelGrid(job.children.map(rect), GUTTER / 2)
    // Heavy edges first, so lighter ones join their trunks. A level of few arrows keeps them apart
    // instead: one shares a gutter only with arrows it shares an end with, steering clear of the
    // rest, and where two still share a line they run side by side (separate), so a landscape of
    // six arrows does not read as one figure.
    const used = new Set<number>()
    const few = job.edges.length <= FEW_EDGES
    const at = new Map<number, Set<number>>()
    const of = (n: number) => at.get(n) ?? at.set(n, new Set()).get(n)!
    const routes = [...job.edges].sort((a, b) => b.count - a.count).flatMap(e => {
      const mine = few ? new Set([...of(e.s), ...of(e.t)]) : used
      const r = grid.route(rect(e.s), rect(e.t), mine, few ? used : undefined)
      if (few) for (const k of mine) { of(e.s).add(k); of(e.t).add(k); used.add(k) }
      return r ? [{ s: e.s, t: e.t, ...r }] : []
    })
    if (few) separate(routes)
    return { id: job.id, w, h, children: job.children, pos, spans: job.spans, heights: job.heights, routes }
  })
}

/**
 * In a level of few arrows, arrows that run along the same gutter line (often the only way between
 * two columns) are drawn side by side, a lane apart, rather than on top of each other, so each can
 * be followed from end to end: Player's arrow to the client never reads as one to the server that
 * leaves the client along the same line. Each inner stretch moves over by a lane for every arrow
 * already on it; the stretches at either end stay on their ports.
 */
export function separate(routes: { s: number; t: number; pts: number[] }[]) {
  const placed: { v: boolean; at: number; a: number; b: number }[] = []
  for (const r of routes) {
    const p = r.pts, n = p.length / 2
    for (let k = 1; k + 2 < n; k++) {
      const x0 = p[k * 2], y0 = p[k * 2 + 1], x1 = p[k * 2 + 2], y1 = p[k * 2 + 3]
      const v = Math.abs(x0 - x1) < 0.5
      if (!v && Math.abs(y0 - y1) >= 0.5) continue
      const at = v ? x0 : y0, a = Math.min(v ? y0 : x0, v ? y1 : x1), b = Math.max(v ? y0 : x0, v ? y1 : x1)
      const others = placed.filter(o => o.v === v && Math.abs(o.at - at) < LANE * 5 && o.a < b - 0.5 && a < o.b - 0.5)
      let lane = 0
      while (others.some(o => Math.abs(o.at - (at + lane * LANE)) < 0.5)) lane = lane > 0 ? -lane : 1 - lane
      // Three lanes each side fit in half a gutter; past that the stretch stays on the line.
      if (Math.abs(lane) > 3) lane = 0
      if (lane) {
        if (v) { p[k * 2] += lane * LANE; p[k * 2 + 2] += lane * LANE } else { p[k * 2 + 1] += lane * LANE; p[k * 2 + 3] += lane * LANE }
      }
      placed.push({ v, at: at + lane * LANE, a, b })
    }
  }
}

/** Space between arrows side by side in a gutter, in local units (a gutter is 56). */
const LANE = 7

self.onmessage = async (ev: MessageEvent<LayoutJob[]>) => {
  ;(self as unknown as Worker).postMessage(await layoutAll(ev.data))
}
