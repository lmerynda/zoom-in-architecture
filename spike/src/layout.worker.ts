import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { cardW, centreOut, CONTENT_ASPECT, GUTTER, lanePlace, type LayoutJob, type LocalLayout } from './layout'
import { ChannelGrid } from './route'

const elk = new ELK()

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
    // Heavy edges first, so lighter ones join their trunks.
    const used = new Set<number>()
    const routes = [...job.edges].sort((a, b) => b.count - a.count).flatMap(e => {
      const r = grid.route(rect(e.s), rect(e.t), used)
      return r ? [{ s: e.s, t: e.t, ...r }] : []
    })
    return { id: job.id, w, h, children: job.children, pos, spans: job.spans, heights: job.heights, routes }
  })
}

self.onmessage = async (ev: MessageEvent<LayoutJob[]>) => {
  ;(self as unknown as Worker).postMessage(await layoutAll(ev.data))
}
