import type { Tree } from './model'

/** Map overlays, like strategy-game lenses: each colours every card by one measure. */
export type LensName = 'structure' | 'size' | 'coupling' | 'churn'

export interface Lens {
  name: LensName
  label: string
  /** Value per node, before normalisation. */
  raw: Float64Array
  /** Heat per node in 0..1, normalised against the node's siblings across its level. */
  heat: Float32Array
  unit: string
}

/** Inferno-like ramp: deep violet through red and orange to pale yellow. */
const STOPS = [[0x1b, 0x0c, 0x41], [0x6a, 0x17, 0x6e], [0xbc, 0x37, 0x54], [0xf1, 0x71, 0x1f], [0xfb, 0xd1, 0x4b], [0xfc, 0xff, 0xa4]]

export function heatColor(v: number): number {
  const x = Math.min(1, Math.max(0, v)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x)), t = x - i
  const a = STOPS[i], b = STOPS[i + 1]
  const c = a.map((ai, k) => Math.round(ai + (b[k] - ai) * t))
  return (c[0] << 16) | (c[1] << 8) | c[2]
}

const num = (v: string | undefined) => (v == null ? NaN : Number(v))

/**
 * Builds the available lenses. Size sums `lines` metadata (or counts leaves), churn sums
 * `churn` metadata, and coupling counts relations crossing each node's boundary.
 */
export function buildLenses(tree: Tree): Lens[] {
  const n = tree.size
  const order = tree.dfs()
  const sum = (leaf: (i: number) => number) => {
    const v = new Float64Array(n)
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k]
      if (!tree.children[i].length) v[i] = leaf(i)
      if (i > 0) v[tree.parent[i]] += v[i]
    }
    return v
  }
  const hasLines = tree.els.some(e => Number.isFinite(num(e.metadata?.lines)))
  const hasChurn = tree.els.some(e => num(e.metadata?.churn) > 0)
  const size = sum(i => (hasLines ? num(tree.els[i].metadata?.lines) || 0 : 1))
  const coupling = new Float64Array(n)
  for (let k = 0; k < tree.rels.length; k += 2) {
    const s = tree.rels[k], t = tree.rels[k + 1], top = tree.lca(s, t)
    for (let a = s; a !== top; a = tree.parent[a]) coupling[a]++
    for (let a = t; a !== top; a = tree.parent[a]) coupling[a]++
  }
  const lenses: Lens[] = [
    { name: 'size', label: hasLines ? 'Size · lines of code' : 'Size · elements inside', raw: size, heat: normalise(tree, size), unit: hasLines ? 'lines' : 'elements' },
    { name: 'coupling', label: 'Coupling · relations crossing the boundary', raw: coupling, heat: normalise(tree, coupling), unit: 'relations' },
  ]
  if (hasChurn) {
    const churn = sum(i => num(tree.els[i].metadata?.churn) || 0)
    lenses.push({ name: 'churn', label: 'Churn · commits in the last 90 days', raw: churn, heat: normalise(tree, churn), unit: 'commits' })
  }
  return lenses
}

/** Log-scaled heat per depth level, so a busy file stands out among files, a busy folder among folders. */
function normalise(tree: Tree, v: Float64Array): Float32Array {
  const heat = new Float32Array(tree.size)
  const max = new Float64Array(tree.maxDepth + 1)
  for (let i = 1; i < tree.size; i++) max[tree.depth[i]] = Math.max(max[tree.depth[i]], v[i])
  for (let i = 1; i < tree.size; i++) {
    const m = max[tree.depth[i]]
    heat[i] = m > 0 ? Math.log1p(v[i]) / Math.log1p(m) : 0
  }
  return heat
}
