import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { cardH, cardW, centreOut, CONTENT_ASPECT, GUTTER, lanePlace, type LayoutJob, type LocalLayout } from './layout'
import { ChannelGrid } from './route'

const elk = new ELK()

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
  const root: ElkNode = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'box' },
    children: packed.map(job => ({
      id: `c${job.id}`,
      layoutOptions: OPTIONS,
      children: job.children.map((c, k) => ({ id: String(c), width: cardW(job.spans[k]), height: cardH(job.spans[k]) })),
    })),
  }
  const g = packed.length ? await elk.layout(root) : { children: [] }
  const elkOf = new Map(packed.map((j, n) => [j.id, g.children![n]]))
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
    const rect = (ch: number) => { const k = index.get(ch)!; return { x: pos[k * 2], y: pos[k * 2 + 1], w: cardW(job.spans[k]), h: cardH(job.spans[k]), header: job.headed[k] } }
    const grid = new ChannelGrid(job.children.map(rect), GUTTER / 2)
    // Heavy edges first, so lighter ones join their trunks.
    const used = new Set<number>()
    const routes = [...job.edges].sort((a, b) => b.count - a.count).flatMap(e => {
      const r = grid.route(rect(e.s), rect(e.t), used)
      return r ? [{ s: e.s, t: e.t, ...r }] : []
    })
    return { id: job.id, w, h, children: job.children, pos, spans: job.spans, routes }
  })
}

self.onmessage = async (ev: MessageEvent<LayoutJob[]>) => {
  ;(self as unknown as Worker).postMessage(await layoutAll(ev.data))
}
