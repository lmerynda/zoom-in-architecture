import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { CARD_H, CARD_W, type LayoutJob, type LayoutKind, type LocalLayout } from './layout'

const elk = new ELK()

const base = {
  'elk.aspectRatio': String(CARD_W / CARD_H),
  'elk.padding': '[top=24,left=24,bottom=24,right=24]',
  'elk.spacing.nodeNode': '56',
  'elk.spacing.componentComponent': '56',
}

const OPTIONS: Record<LayoutKind, Record<string, string>> = {
  // Edge-aware: layers left to right, wrapped back to the card's aspect ratio.
  layered: {
    ...base,
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.wrapping.strategy': 'MULTI_EDGE',
    'elk.layered.spacing.nodeNodeBetweenLayers': '72',
    'elk.spacing.edgeNode': '24',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  },
  // Ignores edges, packs cards into a near-grid that fills the card best.
  packed: { ...base, 'elk.algorithm': 'rectpacking' },
}

/**
 * All of a chunk's containers go to ELK in one call, as compound children of a dummy root:
 * elkjs has a fixed cost of ~30 ms per call, and ELK lays out each compound node's children on
 * their own, so the result is the same as separate calls.
 */
async function layoutAll(jobs: LayoutJob[], kind: LayoutKind): Promise<LocalLayout[]> {
  const opts = OPTIONS[kind]
  const root: ElkNode = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'box' },
    children: jobs.map(job => ({
      id: `c${job.id}`,
      layoutOptions: opts,
      children: job.children.map(c => ({ id: String(c), width: CARD_W, height: CARD_H })),
      edges: kind === 'packed' ? [] : job.edges.map((e, k) => ({ id: `c${job.id}e${k}`, sources: [String(e.s)], targets: [String(e.t)] })),
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
    const routes = (c.edges ?? []).map(e => {
      const k = Number(e.id.slice(e.id.lastIndexOf('e') + 1))
      const pts: number[] = []
      for (const sec of e.sections ?? []) {
        pts.push(sec.startPoint.x, sec.startPoint.y)
        for (const b of sec.bendPoints ?? []) pts.push(b.x, b.y)
        pts.push(sec.endPoint.x, sec.endPoint.y)
      }
      return { s: job.edges[k].s, t: job.edges[k].t, pts }
    })
    return { id: job.id, w: c.width!, h: c.height!, pos, routes }
  })
}

self.onmessage = async (ev: MessageEvent<{ jobs: LayoutJob[]; kind: LayoutKind }>) => {
  ;(self as unknown as Worker).postMessage(await layoutAll(ev.data.jobs, ev.data.kind))
}
