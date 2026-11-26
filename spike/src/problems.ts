import type { Tree } from './model'

/**
 * Problems in a map's structure, read from its relations alone:
 * - a cycle: sibling parts at one level that use each other, directly or round a ring;
 * - a use against the grain: a lower layer (a shared part, a model or a store) reaching up into a
 *   feature or the API in front of it;
 * - the heaviest couplings: the sibling parts that carry the most uses between them.
 * Only uses in code are judged: calls at runtime (HTTP, a store, a queue) run both ways by design,
 * and type-only imports are compile-time coupling, not use.
 */
export type ProblemKind = 'cycle' | 'grain' | 'coupling'

export interface Problem {
  kind: ProblemKind
  /** The container whose level the problem sits at: the two ends' lowest common ancestor. */
  level: number
  /** The two cards the arrow panel opens on: for a cycle and a use against the grain, `a` holds the suspect uses. */
  a: number
  b: number
  /** The relations to read first (the suspect direction, the offending uses); all of a coupling's. */
  rels: number[]
  /** A cycle's ring, from a round to a again. */
  ring?: number[]
  /** What the list says: the two ends, the way the suspect uses run. */
  title: string
  /** Why it is listed, in a sentence. */
  why: string
}

/** The layers a map's names put its parts in, lowest first; a feature is a part that names none of the others. */
export type Layer = 'shared' | 'data' | 'feature' | 'edge'
/**
 * How high each layer sits. A shared part and a model or store are one band: a config naming a DTO,
 * or a store using a shared helper, is how low parts hold together, not a use against the grain.
 */
const TIER: Record<Layer, number> = { shared: 0, data: 0, feature: 1, edge: 2 }
const LAYER_WORD: Record<Layer, string> = { shared: 'a shared part', data: 'a model or store', feature: 'a feature', edge: 'the API or UI in front' }

/** Words in a part's title that name its layer. An API client is how a part reaches out, not an API in front. */
const PART_WORDS: [Layer, RegExp][] = [
  ['shared', /\b(shared|common|core|utils?|utilities|libs?|kernel|primitives|contracts|abstractions|config|configuration|settings|options|constants|kit|toolkit|design system)\b/i],
  ['data', /\b(models?|entit(y|ies)|domain|state|stores?|storage|repositor(y|ies)|persistence|data|db|database|schemas?|(api|http) clients?)\b/i],
  ['edge', /\b(api|apis|controllers?|http|routes?|routing|endpoints?|handlers?|pages?|views?|screens?|shell)\b(?! clients?\b)/i],
]
/** A file's layer from the last word of its name (KingdomEntity, MarketService, AuthController). */
const FILE_WORDS: [Layer, RegExp][] = [
  // A view's model is the view's: ChatPresentationModel, HangarViewModel.
  ['edge', /(ViewModel|PresentationModel)$/],
  ['shared', /(Utils?|Helpers?|Extensions|Constants)$/],
  ['data', /(Repository|Repo|Store|Dao|Entity|Model|Dto|Record|Schema)$/],
  ['feature', /(Service|Manager|Coordinator|UseCase|Interactor)$/],
  ['edge', /(Controller|Endpoint|Page|Screen)$/],
]

/** The layer a part's own name or kind gives it, or null when it names none (or a low and a high one). */
export function namedLayer(tree: Tree, i: number): Layer | null {
  const e = tree.els[i]
  if (!e || i === 0) return null
  if (tree.children[i].length) {
    if (e.kind === 'database') return 'data'
    if (e.kind === 'library') return 'shared'
    const hits = [...new Set(PART_WORDS.filter(([, re]) => re.test(e.title)).map(([l]) => l))]
    // "Shared model", "Data and utilities": two low words make a low part; a low and a high word say nothing.
    if (hits.length > 1) return hits.every(l => TIER[l] <= TIER.data) ? hits.reduce((x, y) => (TIER[x] <= TIER[y] ? x : y)) : null
    return hits[0] ?? null
  }
  if (!e.metadata?.path) return null
  return FILE_WORDS.find(([, re]) => re.test(e.title))?.[0] ?? null
}

/**
 * The layer of node n as seen from container `top` (one of its ancestors): that of the deepest part
 * on the way down that names one, and whether a file's own name said it.
 */
function layerFrom(tree: Tree, top: number, n: number): { layer: Layer; byFile: boolean } | null {
  for (let x = n; x !== top && x > 0; x = tree.parent[x]) {
    const l = namedLayer(tree, x)
    if (l) return { layer: l, byFile: !tree.children[x].length }
  }
  return null
}

/** Strongly connected components of a digraph over 0..n-1 (Tarjan), each of two or more. */
function sccs(n: number, adj: Map<number, number>[]): number[][] {
  const index = new Int32Array(n).fill(-1), low = new Int32Array(n), on = new Uint8Array(n)
  const stack: number[] = [], out: number[][] = []
  let next = 0
  const visit = (v: number) => {
    index[v] = low[v] = next++
    stack.push(v); on[v] = 1
    for (const w of adj[v].keys()) {
      if (index[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]) }
      else if (on[w]) low[v] = Math.min(low[v], index[w])
    }
    if (low[v] === index[v]) {
      const c: number[] = []
      let w: number
      do { w = stack.pop()!; on[w] = 0; c.push(w) } while (w !== v)
      if (c.length > 1) out.push(c)
    }
  }
  for (let v = 0; v < n; v++) if (index[v] < 0) visit(v)
  return out
}

/**
 * An order of a ring's members that most of its weight runs along (Eades, Lin and Smyth, weighted):
 * those that mostly use go first, those mostly used last. The uses running back up it are close to
 * the fewest that break the ring: the suspects.
 */
export function grainOrder(members: number[], adj: Map<number, number>[]): number[] {
  const left = new Set(members), order: number[] = []
  const score = (v: number) => {
    let s = 0
    for (const [t, c] of adj[v]) if (left.has(t)) s += c
    for (const u of left) s -= adj[u].get(v) ?? 0
    return s
  }
  while (left.size) {
    let best = -1, top = -Infinity
    for (const v of left) {
      const d = score(v)
      if (d > top || (d === top && v < best)) { best = v; top = d }
    }
    order.push(best)
    left.delete(best)
  }
  return order
}

/** The shortest way from a to b along `adj` inside `within`, not taking the step `skip`; null when none. */
function path(a: number, b: number, adj: Map<number, number>[], within: Set<number>, skip: [number, number]): number[] | null {
  const prev = new Map<number, number>([[a, -1]])
  const queue = [a]
  for (let q = 0; q < queue.length && !prev.has(b); q++) {
    const v = queue[q]
    for (const w of adj[v].keys()) {
      if (!within.has(w) || prev.has(w) || (v === skip[0] && w === skip[1])) continue
      prev.set(w, v)
      queue.push(w)
    }
  }
  if (!prev.has(b)) return null
  const out: number[] = []
  for (let v = b; v !== -1; v = prev.get(v)!) out.push(v)
  return out.reverse()
}

/** At most this many heaviest couplings are listed, each carrying at least COUPLING_MIN uses. */
export const MAX_COUPLINGS = 5
export const COUPLING_MIN = 10
/** A pair whose lighter way carries more than this share of the heavier is tangled: no side is the one to cut. */
const BALANCED = 2 / 3

export interface ProblemReport {
  list: Problem[]
  /** Parts whose names put them in a layer, and parts whose names do not: those are not judged for direction. */
  layered: number
  unlayered: number
}

/**
 * Every problem on the map, most telling first within each kind: cycles (a few uses against many
 * first), uses against the grain (most first), then the heaviest couplings.
 */
export function findProblems(tree: Tree): ProblemReport {
  const code: number[] = []
  for (let k = 0; k < tree.relKind.length; k++) if (tree.relKind[k] === 'code') code.push(k)
  const title = (i: number) => tree.els[i].title
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  const isPart = (i: number) => tree.children[i].length > 0

  // Per container, its children's uses of each other: counts and the relations behind them.
  type Level = { adj: Map<number, number>[]; rels: Map<string, number[]>; kids: number[]; at: Map<number, number> }
  const byLevel = (rels: number[]) => {
    const levels = new Map<number, Level>()
    for (const k of rels) {
      const s = tree.rels[k * 2], t = tree.rels[k * 2 + 1], c = tree.lca(s, t)
      const cs = tree.childUnder(c, s), ct = tree.childUnder(c, t)
      let L = levels.get(c)
      if (!L) {
        const kids = tree.children[c]
        L = { adj: kids.map(() => new Map()), rels: new Map(), kids, at: new Map(kids.map((x, j) => [x, j])) }
        levels.set(c, L)
      }
      const a = L.at.get(cs)!, b = L.at.get(ct)!
      L.adj[a].set(b, (L.adj[a].get(b) ?? 0) + 1)
      const key = `${cs}>${ct}`
      const list = L.rels.get(key)
      if (list) list.push(k)
      else L.rels.set(key, [k])
    }
    return levels
  }
  const levels = byLevel(code)
  // An entry file (Program.cs, main.ts, App.tsx) wires the parts together: it uses them all by
  // design, so its uses neither close a cycle nor run against the grain.
  const judged = code.filter(k => !isEntry(tree, tree.rels[k * 2]))

  // Cycles between parts (files of one part using each other is that part holding together): in
  // each ring, the uses running back against its main way.
  const cycles: (Problem & { rank: number })[] = []
  for (const [c, L] of byLevel(judged)) {
    const parts = L.adj.map((m, j) => (isPart(L.kids[j]) ? new Map([...m].filter(([t]) => isPart(L.kids[t]))) : new Map<number, number>()))
    // Two parts using each other: the lighter way is the one to cut, unless both ways weigh about the same.
    for (let u = 0; u < parts.length; u++) for (const [v, count] of parts[u]) {
      const back = parts[v].get(u) ?? 0
      if (!back || count > back || (count === back && u > v)) continue
      const a = L.kids[u], b = L.kids[v]
      const rels = L.rels.get(`${a}>${b}`) ?? []
      if (count >= back * BALANCED) {
        cycles.push({
          kind: 'cycle', level: c, a: b, b: a, rels: [...(L.rels.get(`${b}>${a}`) ?? []), ...rels], ring: [b, a, b], rank: 0,
          title: `${title(b)} ↔ ${title(a)}`,
          why: `${title(b)} and ${title(a)} use each other about as much both ways (${back} and ${count}): a tangle, with no one side to cut.`,
        })
        continue
      }
      cycles.push({
        kind: 'cycle', level: c, a, b, rels, ring: [a, b, a], rank: back / count,
        title: `${title(a)} → ${title(b)}`,
        why: `${title(a)} and ${title(b)} use each other: ${plural(count, 'use')} this way against ${back} the other. Look at ${count === 1 ? 'that one' : `these ${count}`} first: cutting ${count === 1 ? 'it' : 'them'}, or moving what ${count === 1 ? 'it uses' : 'they use'}, breaks the cycle.`,
      })
    }
    // Rings of three or more: the uses running back against the ring's main way, where the two
    // ends do not already use each other (that pair is listed above).
    for (const ring of sccs(L.kids.length, parts)) {
      if (ring.length < 3) continue
      const order = grainOrder(ring, parts), pos = new Map(order.map((v, j) => [v, j]))
      const within = new Set(ring)
      for (const u of ring) for (const [v, count] of parts[u]) {
        if (!within.has(v) || pos.get(v)! > pos.get(u)! || parts[v].has(u)) continue
        // u → v runs back up the order: the ring it closes is the way from v round to u.
        const round = path(v, u, parts, within, [u, v])
        if (!round) continue
        const a = L.kids[u], b = L.kids[v]
        const loop = [a, ...round.map(x => L.kids[x])]
        cycles.push({
          kind: 'cycle', level: c, a, b, rels: L.rels.get(`${a}>${b}`) ?? [], ring: loop, rank: 1 / count,
          title: `${title(a)} → ${title(b)}`,
          why: `${count === 1 ? 'This use closes' : `These ${count} uses close`} a ring of ${round.length}: ${loop.map(title).join(' → ')}.`,
        })
      }
    }
  }
  cycles.sort((x, y) => y.rank - x.rank || title(x.a).localeCompare(title(y.a)))

  // Against the grain: a use whose source sits in a lower layer than its target, as each end's
  // nearest named part says. A target whose names say nothing is taken for a feature only when a
  // part's name put the source low ("Kingdom state and storage") and the target is a part too: a
  // file's own name (KingdomEntity) is judged only against a target that names its layer.
  const grain = new Map<string, { a: number; b: number; level: number; rels: number[]; from: Layer; to: Layer }>()
  for (const k of judged) {
    const s = tree.rels[k * 2], t = tree.rels[k * 2 + 1], c = tree.lca(s, t)
    const from = layerFrom(tree, c, s)
    if (!from || TIER[from.layer] > TIER.data) continue
    const to = layerFrom(tree, c, t)
    const ct = tree.childUnder(c, t)
    const toLayer: Layer | null = to?.layer ?? (!from.byFile && isPart(ct) ? 'feature' : null)
    if (!toLayer || TIER[from.layer] >= TIER[toLayer]) continue
    // Said between the parts the two files sit in, or between the files when they share one.
    const ga = isPart(s) ? s : tree.parent[s], gb = isPart(t) ? t : tree.parent[t]
    const [a, b] = ga === gb || tree.isAncestor(ga, gb) || tree.isAncestor(gb, ga) ? [s, t] : [ga, gb]
    const key = `${a}>${b}`
    const g = grain.get(key)
    if (g) g.rels.push(k)
    else grain.set(key, { a, b, level: tree.lca(a, b), rels: [k], from: from.layer, to: toLayer })
  }
  // A use against the grain that also closes a cycle is said once, on the cycle.
  const grains: Problem[] = []
  for (const g of grain.values()) {
    const hit = cycles.filter(p => p.rels.some(k => g.rels.includes(k)))
    for (const p of hit) if (!p.why.includes('against the grain')) p.why += ` It also runs against the grain: ${LAYER_WORD[g.from]} using ${LAYER_WORD[g.to]}.`
    const shown = new Set(hit.flatMap(p => p.rels))
    const rels = g.rels.filter(k => !shown.has(k))
    if (!rels.length) continue
    const word = LAYER_WORD[g.from]
    grains.push({
      kind: 'grain', level: g.level, a: g.a, b: g.b, rels,
      title: `${title(g.a)} → ${title(g.b)}`,
      why: `${word[0].toUpperCase()}${word.slice(1)} uses ${LAYER_WORD[g.to]}: ${plural(rels.length, 'use')} against the grain.`,
    })
  }
  grains.sort((x, y) => y.rels.length - x.rels.length || title(x.a).localeCompare(title(y.a)))

  // The heaviest couplings: sibling parts carrying the most uses between them, both ways. A pair
  // most of whose weight one nested pair carries is left to that pair, the more telling.
  const pairs: { a: number; b: number; level: number; rels: number[] }[] = []
  for (const [c, L] of levels) {
    const at = new Map<string, { a: number; b: number; level: number; rels: number[] }>()
    for (const [key, rels] of L.rels) {
      const [x, y] = key.split('>').map(Number)
      if (!isPart(x) || !isPart(y)) continue
      const pk = x < y ? `${x}-${y}` : `${y}-${x}`
      const p = at.get(pk)
      if (p) p.rels.push(...rels)
      else at.set(pk, { a: x, b: y, level: c, rels: [...rels] })
    }
    pairs.push(...at.values())
  }
  pairs.sort((x, y) => y.rels.length - x.rels.length || x.a - y.a)
  const under = (x: number, y: number) => x === y || tree.isAncestor(x, y)
  const couplings: Problem[] = []
  for (const p of pairs) {
    if (couplings.length >= MAX_COUPLINGS || p.rels.length < COUPLING_MIN) break
    if (pairs.some(q => q !== p && q.rels.length >= p.rels.length * 0.8 && ((under(p.a, q.a) && under(p.b, q.b)) || (under(p.a, q.b) && under(p.b, q.a))))) continue
    const out = p.rels.filter(k => under(p.a, tree.rels[k * 2])).length
    const [a, b, ab, ba] = out >= p.rels.length - out ? [p.a, p.b, out, p.rels.length - out] : [p.b, p.a, p.rels.length - out, out]
    // A pair already listed as a cycle says its weight there, on one row.
    const cycle = cycles.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a))
    if (cycle) { cycle.why += ` Among the heaviest couplings: ${p.rels.length} uses in all.`; continue }
    couplings.push({
      kind: 'coupling', level: p.level, a, b, rels: p.rels,
      title: `${title(a)} ${ba ? '↔' : '→'} ${title(b)}`,
      why: `${plural(p.rels.length, 'use')} between them${ba ? ` (${ab} one way, ${ba} back)` : ''}: among the heaviest couplings on the map.`,
    })
  }

  let layered = 0, unlayered = 0
  for (let i = 1; i < tree.size; i++) {
    if (!isPart(i) || tree.depth[i] === 1) continue
    if (namedLayer(tree, i)) layered++
    else unlayered++
  }
  return { list: [...cycles.map(({ rank: _, ...p }) => p), ...grains, ...couplings], layered, unlayered }
}

/** A file that starts a program or an app and wires its parts together: Program.cs, main.ts, index.js, App.tsx, Startup.cs, a Spring *Application. */
export function isEntry(tree: Tree, i: number): boolean {
  if (tree.children[i].length || !tree.els[i].metadata?.path) return false
  const base = tree.els[i].metadata!.path!.split('/').pop()!.replace(/\.[^.]+$/, '')
  return /^(Program|Main|main|index|App|app|Startup|Bootstrap|CompositionRoot)$|.Application$/.test(base)
}

const KIND_NAME: Record<ProblemKind, string> = { cycle: 'Cycles', grain: 'Against the grain', coupling: 'Heaviest couplings' }
const KIND_ONE: Record<ProblemKind, string> = { cycle: 'Cycle', grain: 'Against the grain', coupling: 'Heavy coupling' }
/** Rows a group shows before "Show N more". */
const FIRST_ROWS = 5

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** The problems at a place: those whose level is the place or inside it, as indices into the report's list. */
export function problemsAt(tree: Tree, report: ProblemReport, here: number): number[] {
  return report.list.flatMap((p, k) => (p.level === here || here === 0 || tree.isAncestor(here, p.level) ? [k] : []))
}

/** A problem's row: what kind, how many uses, and where when that is below the place listed. */
export function problemLine(tree: Tree, p: Problem, here: number): string {
  const uses = `${p.rels.length} use${p.rels.length === 1 ? '' : 's'}`
  const ring = p.kind === 'cycle' && p.ring && p.ring.length > 3 ? `ring of ${p.ring.length - 1}` : ''
  return [KIND_ONE[p.kind], ring, uses, p.level !== here ? `in ${tree.els[p.level].title}` : ''].filter(Boolean).join(' · ')
}

/**
 * The outline's Problems section: the place's problems by kind, each row opening that problem's
 * arrow. Folded, it says how many; open, the map marks them all (`onToggle`).
 */
export function problemsSection(tree: Tree, report: ProblemReport, here: number, open: boolean, act: { open: (k: number) => void; toggle: (open: boolean) => void }): HTMLElement | null {
  if (!tree.children[here].length) return null
  const mine = problemsAt(tree, report, here)
  const box = el('details', 'd-problems')
  box.open = open
  const summary = el('summary')
  summary.append(el('span', '', `Problems · ${mine.length}`))
  box.append(summary)
  box.addEventListener('toggle', () => act.toggle(box.open))
  const how = 'Read from uses in code: calls at runtime, type-only imports and an entry file’s wiring are not judged.'
  const layers = report.unlayered ? ` Layers come from names: ${report.layered} part${report.layered === 1 ? '' : 's'} name theirs; ${report.unlayered} name none, so their direction is not judged.` : ''
  if (!mine.length) box.append(el('p', 'd-hint', `No cycles between parts, no uses against the grain and no coupling of ${COUPLING_MIN} uses or more here. ${how}${layers}`))
  else box.append(el('p', 'd-hint', `${how}${layers} ] and [ step through them.`))
  for (const kind of ['cycle', 'grain', 'coupling'] as const) {
    const ks = mine.filter(k => report.list[k].kind === kind)
    if (!ks.length) continue
    box.append(el('h4', '', `${KIND_NAME[kind]} · ${ks.length}`))
    const ul = el('ul')
    ul.setAttribute('aria-label', KIND_NAME[kind])
    for (const [j, k] of ks.entries()) {
      const p = report.list[k]
      const li = el('li', `k-${kind}`)
      if (j >= FIRST_ROWS) li.hidden = true
      const b = el('button', 'd-rel')
      b.append(el('b', '', p.title), el('span', '', problemLine(tree, p, here)))
      b.title = p.why
      b.dataset.problem = String(k)
      b.onclick = () => act.open(k)
      li.append(b)
      ul.append(li)
    }
    box.append(ul)
    if (ks.length > FIRST_ROWS) {
      const more = el('button', 'd-more', `Show ${ks.length - FIRST_ROWS} more`)
      more.onclick = () => {
        const first = ul.querySelector<HTMLElement>('li[hidden] button')
        for (const li of ul.querySelectorAll<HTMLElement>('li[hidden]')) li.hidden = false
        more.remove()
        first?.focus()
      }
      box.append(more)
    }
  }
  box.addEventListener('keydown', ev => {
    const items = [...box.querySelectorAll<HTMLButtonElement>('li:not([hidden]) button')], at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    if (ev.key === 'ArrowDown') { items[Math.min(items.length - 1, at + 1)]?.focus(); ev.preventDefault() }
    if (ev.key === 'ArrowUp') { items[Math.max(0, at - 1)]?.focus(); ev.preventDefault() }
  })
  return box
}

/** Above an open problem's arrow: which problem it is, why it is listed, and the ring it closes. */
export function problemNote(tree: Tree, p: Problem, k: number, total: number): HTMLElement {
  const box = el('section', `d-problem k-${p.kind}`)
  box.append(el('span', 'd-kindtag', `Problem ${k + 1} of ${total} · ${KIND_ONE[p.kind]}`), el('p', '', p.why))
  if (p.ring && p.ring.length > 3) box.append(el('p', 'd-ring', p.ring.map(i => tree.els[i].title).join(' → ')))
  box.append(el('p', 'd-hint', '] next problem · [ previous · Esc back to the list'))
  return box
}
