import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { CARD_H, CARD_W, CONTENT_ASPECT, GUTTER, type LayoutJob, type LocalLayout } from './layout'
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
  const root: ElkNode = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'box' },
    children: jobs.map(job => ({
      id: `c${job.id}`,
      layoutOptions: OPTIONS,
      children: job.children.map(c => ({ id: String(c), width: CARD_W, height: CARD_H })),
    })),
  }
  const g = await elk.layout(root)
  return g.children!.map((c, n) => {
    const job = jobs[n]
    const at = new Map(c.children!.map(k => [k.id, k]))
    const pos: number[] = []
    for (const ch of job.children) {
      const k = at.get(String(ch))!
      pos.push(k.x!, k.y!)
    }
    const index = new Map(job.children.map((ch, k) => [ch, k]))
    const rect = (ch: number) => { const k = index.get(ch)!; return { x: pos[k * 2], y: pos[k * 2 + 1], w: CARD_W, h: CARD_H } }
    const grid = new ChannelGrid(job.children.map(rect), GUTTER / 2)
    // Heavy edges first, so lighter ones join their trunks.
    const used = new Set<number>()
    const routes = [...job.edges].sort((a, b) => b.count - a.count).flatMap(e => {
      const r = grid.route(rect(e.s), rect(e.t), used)
      return r ? [{ s: e.s, t: e.t, ...r }] : []
    })
    return { id: job.id, w: c.width!, h: c.height!, pos, routes }
  })
}

self.onmessage = async (ev: MessageEvent<LayoutJob[]>) => {
  ;(self as unknown as Worker).postMessage(await layoutAll(ev.data))
}
