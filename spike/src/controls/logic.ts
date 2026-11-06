import type { Tree } from '../model'

/** One step of a route: from element `from` along relation `rel` to element `to`. */
export interface Hop { from: number; to: number; title: string; reversed: boolean }

const inside = (tree: Tree, root: number, n: number) => n === root || tree.isAncestor(root, n)

/** Walking a relation against its arrow costs this many forward hops. */
const AGAINST = 4

/**
 * Cheapest dependency path from anything in `a` to anything in `b` (each an element and its
 * descendants), like a GPS route between two places on the map. Hops follow relation
 * direction; walking one backwards is allowed but costs AGAINST times as much, so routes
 * follow real calls wherever they can.
 */
export function findRoute(tree: Tree, a: number, b: number): Hop[] | null {
  if (a === b || inside(tree, a, b) || inside(tree, b, a)) return null
  const steps = new Map<number, { to: number; rel: number; reversed: boolean }[]>()
  const add = (n: number, e: { to: number; rel: number; reversed: boolean }) => (steps.get(n) ?? steps.set(n, []).get(n)!).push(e)
  for (let k = 0; k < tree.rels.length; k += 2) {
    const s = tree.rels[k], t = tree.rels[k + 1]
    add(s, { to: t, rel: k >> 1, reversed: false })
    add(t, { to: s, rel: k >> 1, reversed: true })
  }
  // Dijkstra over small integer costs with bucket queues.
  const dist = new Map<number, number>()
  const prev = new Map<number, { from: number; rel: number; reversed: boolean }>()
  const buckets: number[][] = [[]]
  for (const n of steps.keys()) if (inside(tree, a, n)) { dist.set(n, 0); buckets[0].push(n) }
  for (let d = 0; d < buckets.length; d++) {
    for (const n of buckets[d] ?? []) {
      if (dist.get(n) !== d) continue
      if (inside(tree, b, n)) {
        const hops: Hop[] = []
        for (let m = n; prev.has(m); m = prev.get(m)!.from) {
          const p = prev.get(m)!
          hops.unshift({ from: p.from, to: m, title: tree.relTitles[p.rel] || 'uses', reversed: p.reversed })
        }
        return hops
      }
      for (const e of steps.get(n) ?? []) {
        const nd = d + (e.reversed ? AGAINST : 1)
        if (nd >= (dist.get(e.to) ?? Infinity)) continue
        dist.set(e.to, nd)
        prev.set(e.to, { from: n, rel: e.rel, reversed: e.reversed })
        ;(buckets[nd] ??= []).push(e.to)
      }
    }
  }
  return null
}

/** A camera view to come back to; the selection is an element id, stable across model versions. */
export interface View { x: number; y: number; z: number; selected: string | null }

/** Back/forward through places visited, like a browser or an RPG's "return to last location". */
export class History {
  back: View[] = []
  forward: View[] = []

  /** Records leaving `from`; views close to the last entry are not duplicated. */
  push(from: View, viewportW: number) {
    const last = this.back[this.back.length - 1]
    if (last && same(last, from, viewportW)) return
    this.back.push(from)
    if (this.back.length > 100) this.back.shift()
    this.forward = []
  }

  goBack(current: View): View | null {
    const v = this.back.pop()
    if (v) this.forward.push(current)
    return v ?? null
  }

  goForward(current: View): View | null {
    const v = this.forward.pop()
    if (v) this.back.push(current)
    return v ?? null
  }
}

function same(a: View, b: View, viewportW: number) {
  return a.selected === b.selected && Math.abs(Math.log(a.z / b.z)) < 0.2 && Math.hypot(a.x - b.x, a.y - b.y) * a.z < viewportW * 0.15
}

/**
 * Fuzzy score of `query` against `text`: every query character must appear in order. Matches
 * at word starts and consecutive runs score higher; -1 means no match.
 */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase()
  if (!q) return 0
  let score = 0, ti = 0, run = 0
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    let found = -1
    for (let j = ti; j < t.length; j++) if (t[j] === c) { found = j; break }
    if (found < 0) return -1
    const wordStart = found === 0 || /[\s._/-]/.test(text[found - 1]) || (text[found] >= 'A' && text[found] <= 'Z' && text[found - 1] >= 'a' && text[found - 1] <= 'z')
    run = found === ti ? run + 1 : 0
    score += 1 + (wordStart ? 6 : 0) + run * 3 - Math.min(found - ti, 8) * 0.3
    ti = found + 1
  }
  return score - t.length * 0.02
}

/** How well a query finds an element: by its title, its id, or a feature it carries. */
export function elementScore(query: string, e: { title: string; id: string; features?: string[] }): number {
  return Math.max(fuzzy(query, e.title), fuzzy(query, e.id) - 4, ...(e.features ?? []).map(f => fuzzy(query, f) - 1))
}
