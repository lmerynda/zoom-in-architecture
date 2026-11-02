// Compares ELK option sets on the synthetic model: how well each container's layout fills a
// card (1 = same aspect as the card) and how long the whole layout takes.
import ELK from 'elkjs/lib/elk.bundled.js'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
const { synthetic } = await vite.ssrLoadModule('/src/synthetic.ts')
const { Tree } = await vite.ssrLoadModule('/src/model.ts')
const { layoutJobs, CARD_W, CARD_H } = await vite.ssrLoadModule('/src/layout.ts')
const jobs = layoutJobs(new Tree(synthetic(Number(process.argv[2] ?? 1000))))
const base = {
  'elk.padding': '[top=24,left=24,bottom=24,right=24]', 'elk.spacing.nodeNode': '56',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72', 'elk.spacing.componentComponent': '56',
  'elk.aspectRatio': String(CARD_W / CARD_H),
}
const variants = {
  'layered DOWN': { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL' },
  'layered DOWN wrap': { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.layered.wrapping.strategy': 'MULTI_EDGE' },
  'layered RIGHT wrap': { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.layered.wrapping.strategy': 'MULTI_EDGE' },
  'rectpacking': { 'elk.algorithm': 'rectpacking' },
  'stress': { 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': '320' },
}
const elk = new ELK()
for (const [name, opts] of Object.entries(variants)) {
  const t0 = performance.now()
  let fill = 0, worst = 1
  for (const j of jobs) {
    const g = await elk.layout({
      id: 'r', layoutOptions: { ...base, ...opts },
      children: j.children.map(c => ({ id: String(c), width: CARD_W, height: CARD_H })),
      edges: j.edges.map((e, k) => ({ id: 'e' + k, sources: [String(e.s)], targets: [String(e.t)] })),
    })
    const a = (g.width / g.height) / (CARD_W / CARD_H)
    // Share of the card area the scaled layout covers.
    const f = Math.min(a, 1 / a)
    fill += f; worst = Math.min(worst, f)
  }
  console.log(`${name.padEnd(20)} fill avg ${(fill / jobs.length).toFixed(2)} worst ${worst.toFixed(2)}  ${(performance.now() - t0).toFixed(0)} ms for ${jobs.length} containers`)
}
await vite.close()
