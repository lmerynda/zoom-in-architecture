import type { ElementJson, ModelJson, RelationJson } from './model'

const LEVELS = [
  { kind: 'domain', color: 'indigo', suffix: ['Domain', 'Division', 'Area'] },
  { kind: 'system', color: 'primary', suffix: ['Platform', 'System', 'Hub', 'Suite'] },
  { kind: 'container', color: 'secondary', suffix: ['Service', 'API', 'Worker', 'Store', 'Gateway', 'Web App'] },
  { kind: 'component', color: 'green', suffix: ['Controller', 'Repository', 'Handler', 'Client', 'Engine', 'Adapter'] },
  { kind: 'module', color: 'amber', suffix: ['Module', 'Policy', 'Mapper', 'Validator', 'Cache', 'Job'] },
]
const WORDS = ['Billing', 'Orders', 'Catalog', 'Payments', 'Identity', 'Search', 'Shipping', 'Pricing', 'Inventory',
  'Ledger', 'Reviews', 'Messaging', 'Fraud', 'Analytics', 'Reporting', 'Accounts', 'Returns', 'Loyalty', 'Media',
  'Routing', 'Tax', 'Audit', 'Consent', 'Profiles', 'Cart', 'Checkout', 'Partners', 'Supply', 'Forecast', 'Support']
const TECH = ['Go', 'Kotlin', 'Node.js', 'Rust', 'Python', 'Java', 'PostgreSQL', 'Kafka', 'Redis', 'React']

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A deterministic landscape of about `target` elements, five levels deep, with relations that
 * are mostly local (siblings, cousins) and some global, like real systems.
 */
export function synthetic(target: number, seed = 7): ModelJson {
  // Branching b with b + b^2 + ... + b^5 ≈ target, corrected for how one random tree came out.
  let b = 2
  while (b + b ** 2 + b ** 3 + b ** 4 + b ** 5 < target) b += 0.05
  let m = build(b, seed)
  for (let k = 0; k < 8 && Math.abs(m.elements.length / target - 1) > 0.15; k++) {
    b *= (target / m.elements.length) ** (1 / 5)
    m = build(b, seed)
  }
  return m
}

function build(b: number, seed: number): ModelJson {
  const r = rng(seed)
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]
  const elements: ElementJson[] = []
  const byLevel: string[][] = LEVELS.map(() => [])
  // Leaves are pushed in depth-first order, so each element's leaves form one index range.
  const range = new Map<string, [number, number]>()
  const leaves = byLevel[LEVELS.length - 1]
  const grow = (parent: string | null, level: number) => {
    if (level >= LEVELS.length) return
    const L = LEVELS[level]
    const n = Math.max(2, Math.round(b * (0.75 + r() * 0.5)))
    for (let k = 0; k < n; k++) {
      const id = parent ? `${parent}.n${k}` : `n${k}`
      const word = pick(WORDS)
      elements.push({
        id, parent, kind: L.kind, color: L.color, shape: 'rectangle', tags: r() < 0.2 ? [pick(['team-a', 'team-b', 'legacy', 'next'])] : [],
        title: `${word} ${pick(L.suffix)}`,
        technology: level >= 2 ? pick(TECH) : '',
        description: `${L.kind[0].toUpperCase() + L.kind.slice(1)} handling ${word.toLowerCase()} concerns: owns its data, publishes events and serves requests from neighbouring parts of the landscape.`,
      })
      const lo = leaves.length
      byLevel[level].push(id)
      grow(id, level + 1)
      range.set(id, [lo, leaves.length])
    }
  }
  grow(null, 0)
  range.set('', [0, leaves.length])
  const parentOf = (id: string) => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : '')
  const relations: RelationJson[] = []
  const verbs = ['calls', 'reads from', 'publishes to', 'subscribes to', 'writes to', 'queries']
  for (const s of leaves) {
    const n = 1 + Math.floor(r() * 2.5)
    for (let k = 0; k < n; k++) {
      const u = r()
      // Siblings, then cousins under the same container, system, or anywhere.
      let scope = parentOf(s)
      if (u > 0.5) scope = parentOf(scope)
      if (u > 0.75) scope = parentOf(scope)
      if (u > 0.88) scope = parentOf(scope)
      const [lo, hi] = range.get(u > 0.96 ? '' : scope)!
      const t = leaves[lo + Math.floor(r() * (hi - lo))]
      if (t !== s) relations.push({ source: s, target: t, title: pick(verbs) })
    }
  }
  return { name: `synthetic-${elements.length}`, elements, relations }
}
