import type { Tree } from './model'

/**
 * Problems in a map's structure, read from its relations alone:
 * - a cycle: sibling parts at one level that use each other, directly or round a ring;
 * - a use against the grain: a lower layer (a shared part, a model or a store) reaching up into a
 *   feature or the API in front of it, as the two ends' names say;
 * - the heaviest couplings: the sibling parts that carry the most uses between them.
 * Only a file's use in code of another file is judged: calls at runtime (HTTP, a store, a queue) run
 * both ways by design, a link drawn between parts (a sample's "sends push") is not code, type-only
 * imports are compile-time coupling, and an entry file wires everything by design.
 */
export type ProblemKind = 'cycle' | 'grain' | 'coupling'

export interface Problem {
  kind: ProblemKind
  /** The container whose level the problem sits at: the two ends' lowest common ancestor. */
  level: number
  /** The two cards the arrow panel opens on: for a cycle and a use against the grain, `a` holds the flagged uses. */
  a: number
  b: number
  /** The relations to read first (the flagged direction, the offending uses); all of a coupling's. */
  rels: number[]
  /** A cycle's ring, from a round to a again. */
  ring?: number[]
  /** What the list says: the two ends, the way the flagged uses run. */
  title: string
  /** Why it is listed, in a sentence or two. */
  why: string
}

/** The layers a map's names put its parts in, lowest first. */
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

/** A file of the mapped code, as opposed to a part (an app, a component) that groups files. */
const isFile = (tree: Tree, i: number) => !!tree.els[i]?.metadata?.path
/** A part: any element that is not a file, with files under it or not. */
const isPart = (tree: Tree, i: number) => i > 0 && !isFile(tree, i)

/** The layer a part's own name or kind gives it, or null when it names none (or a low and a high one). */
export function namedLayer(tree: Tree, i: number): Layer | null {
  const e = tree.els[i]
  if (!e || i === 0) return null
  if (isFile(tree, i)) return FILE_WORDS.find(([, re]) => re.test(e.title))?.[0] ?? null
  if (e.kind === 'database') return 'data'
  if (e.kind === 'library') return 'shared'
  const hits = [...new Set(PART_WORDS.filter(([, re]) => re.test(e.title)).map(([l]) => l))]
  // "Shared model", "Data and utilities": two low words make a low part; a low and a high word say nothing.
  if (hits.length > 1) return hits.every(l => TIER[l] === TIER.data) ? hits.reduce((x, y) => (x === 'shared' || y === 'shared' ? 'shared' : x)) : null
  return hits[0] ?? null
}

/** The layer of node n as seen from container `top` (one of its ancestors): that of the deepest element on the way down that names one. */
function layerFrom(tree: Tree, top: number, n: number): Layer | null {
  for (let x = n; x !== top && x > 0; x = tree.parent[x]) {
    const l = namedLayer(tree, x)
    if (l) return l
  }
  return null
}

/** Whether a part between `top` and n (n's own, when n is a part) names the API or UI in front. */
function partNamesFront(tree: Tree, top: number, n: number): boolean {
  for (let x = n; x !== top && x > 0; x = tree.parent[x]) if (isPart(tree, x) && namedLayer(tree, x) === 'edge') return true
  return false
}

/** A file that starts a program or an app and wires its parts together: Program.cs, main.ts, App.tsx, Startup.cs, a Spring *Application. */
export function isEntry(tree: Tree, i: number): boolean {
  if (!isFile(tree, i)) return false
  const base = tree.els[i].metadata!.path!.split('/').pop()!.replace(/\.[^.]+$/, '')
  return /^(Program|Main|main|App|Startup|Bootstrap|CompositionRoot)$|.Application$/.test(base)
}

/** Strongly connected components of a digraph over 0..n-1, each of two or more (Tarjan, without recursion: a long chain must not overflow the stack). */
export function sccs(n: number, adj: Map<number, number>[]): number[][] {
  const index = new Int32Array(n).fill(-1), low = new Int32Array(n), on = new Uint8Array(n)
  const succ = adj.map(m => [...m.keys()])
  const stack: number[] = [], out: number[][] = []
  let next = 0
  for (let r = 0; r < n; r++) {
    if (index[r] >= 0) continue
    index[r] = low[r] = next++
    stack.push(r); on[r] = 1
    const work: [number, number][] = [[r, 0]]
    while (work.length) {
      const top = work[work.length - 1], v = top[0]
      if (top[1] < succ[v].length) {
        const w = succ[v][top[1]++]
        if (index[w] < 0) { index[w] = low[w] = next++; stack.push(w); on[w] = 1; work.push([w, 0]) }
        else if (on[w]) low[v] = Math.min(low[v], index[w])
        continue
      }
      work.pop()
      if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]) }
      if (low[v] === index[v]) {
        const c: number[] = []
        let w: number
        do { w = stack.pop()!; on[w] = 0; c.push(w) } while (w !== v)
        if (c.length > 1) out.push(c)
      }
    }
  }
  return out
}

/**
 * The uses to cut so a ring of parts uses each other no more, close to the fewest by weight: while a
 * ring is left, its shortest one loses its lightest use; then each cut use, heaviest first, is put
 * back where it closes no ring again. A simple ring loses only its lightest use. `adj` is left as it was.
 */
export function ringCuts(members: number[], adj: Map<number, number>[]): [number, number][] {
  const within = new Set(members)
  const g = new Map(members.map(u => [u, new Map([...adj[u]].filter(([v]) => within.has(v) && v !== u))]))
  const graph = members.reduce<Map<number, number>[]>((out, u) => { out[u] = g.get(u)!; return out }, [])
  const cut: [number, number, number][] = []
  for (;;) {
    let ring: number[] | null = null
    for (const u of members) {
      for (const v of g.get(u)!.keys()) {
        const back = path(v, u, graph, within)
        if (back && (!ring || back.length + 1 < ring.length)) ring = [u, ...back]
      }
    }
    if (!ring) break
    let at = 0, least = Infinity
    for (let j = 0; j + 1 < ring.length; j++) {
      const w = g.get(ring[j])!.get(ring[j + 1])!
      if (w < least) { least = w; at = j }
    }
    const [u, v] = [ring[at], ring[at + 1]]
    cut.push([u, v, least])
    g.get(u)!.delete(v)
  }
  cut.sort((x, y) => y[2] - x[2])
  const kept: [number, number][] = []
  for (const [u, v, w] of cut) {
    if (path(v, u, graph, within)) kept.push([u, v])
    else g.get(u)!.set(v, w)
  }
  return kept
}

/** The shortest way from a to b along `adj` inside `within`; null when none. */
function path(a: number, b: number, adj: Map<number, number>[], within: Set<number>): number[] | null {
  const prev = new Map<number, number>([[a, -1]])
  const queue = [a]
  for (let q = 0; q < queue.length && !prev.has(b); q++) {
    for (const w of adj[queue[q]].keys()) {
      if (!within.has(w) || prev.has(w)) continue
      prev.set(w, queue[q])
      queue.push(w)
    }
  }
  if (!prev.has(b)) return null
  const out: number[] = []
  for (let v = b; v !== -1; v = prev.get(v)!) out.push(v)
  return out.reverse()
}

/** At most this many heaviest couplings are named, each carrying at least COUPLING_MIN uses. */
export const MAX_COUPLINGS = 5
export const COUPLING_MIN = 10
/** A pair whose lighter way carries at least this share of the heavier is tangled: no one side to cut. */
const BALANCED = 2 / 3

export interface ProblemReport {
  list: Problem[]
  /** Parts whose names put them in a layer, and parts whose names do not: those are not judged for direction. */
  layered: number
  unlayered: number
}

/** The uses the rules judge: one file's use in code of another, not made by an entry file. */
export function judgedRelations(tree: Tree): number[] {
  const out: number[] = []
  for (let k = 0; k < tree.relKind.length; k++) {
    const s = tree.rels[k * 2], t = tree.rels[k * 2 + 1]
    if (tree.relKind[k] === 'code' && isFile(tree, s) && isFile(tree, t) && !isEntry(tree, s)) out.push(k)
  }
  return out
}

/**
 * Every problem on the map, most telling first within each kind: cycles (a few uses against many
 * first), uses against the grain (most first), then the heaviest couplings.
 */
export function findProblems(tree: Tree): ProblemReport {
  const judged = judgedRelations(tree)
  const title = (i: number) => tree.els[i].title
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  const part = (i: number) => isPart(tree, i)

  // Per container, its children's uses of each other: counts and the relations behind them.
  type Level = { adj: Map<number, number>[]; rels: Map<string, number[]>; kids: number[] }
  const levels = new Map<number, Level>()
  for (const k of judged) {
    const s = tree.rels[k * 2], t = tree.rels[k * 2 + 1], c = tree.lca(s, t)
    const cs = tree.childUnder(c, s), ct = tree.childUnder(c, t)
    let L = levels.get(c)
    if (!L) levels.set(c, (L = { adj: tree.children[c].map(() => new Map()), rels: new Map(), kids: tree.children[c] }))
    const a = L.kids.indexOf(cs), b = L.kids.indexOf(ct)
    L.adj[a].set(b, (L.adj[a].get(b) ?? 0) + 1)
    const key = `${cs}>${ct}`
    const list = L.rels.get(key)
    if (list) list.push(k)
    else L.rels.set(key, [k])
  }

  // Cycles between parts (files of one part using each other is that part holding together).
  const cycles: (Problem & { rank: number })[] = []
  for (const [c, L] of levels) {
    const parts = L.adj.map((m, j) => (part(L.kids[j]) ? new Map([...m].filter(([t]) => part(L.kids[t]))) : new Map<number, number>()))
    // Two parts using each other first: the lighter way is flagged, both ways when they weigh about
    // the same. What is flagged leaves the graph, so a ring is found only where cutting them leaves one.
    const rest = parts.map(m => new Map(m))
    for (let u = 0; u < parts.length; u++) for (const [v, count] of parts[u]) {
      const back = parts[v].get(u) ?? 0
      if (!back || count > back || (count === back && u > v)) continue
      const a = L.kids[u], b = L.kids[v]
      const rels = L.rels.get(`${a}>${b}`) ?? []
      rest[u].delete(v)
      if (count >= back * BALANCED) {
        rest[v].delete(u)
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
    // Rings of three or more in what is left: the fewest uses, by weight, whose cutting breaks them.
    for (const ring of sccs(L.kids.length, rest)) {
      const within = new Set(ring)
      for (const [u, v] of ringCuts(ring, rest)) {
        const count = rest[u].get(v)!
        const round = path(v, u, rest, within)
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

  // Against the grain: a use whose source sits in a lower layer than its target, as the nearest
  // element naming a layer on each side says. Where neither the file nor a part above it names
  // the target's layer, the use is not judged: the map cannot say, and a guess would be a false alarm.
  type Grain = { a: number; b: number; level: number; rels: number[]; combos: Map<string, number> }
  const grain = new Map<string, Grain>()
  const flaggedBy = new Map<number, string>()
  for (const k of judged) {
    const s = tree.rels[k * 2], t = tree.rels[k * 2 + 1], c = tree.lca(s, t)
    const from = layerFrom(tree, c, s), to = layerFrom(tree, c, t)
    if (!from || !to || TIER[from] >= TIER[to]) continue
    // A Controller in a game client is game logic, not the API in front: a feature using the front
    // is judged only where a part names it so ("Kingdom API", "Pages").
    if (from === 'feature' && to === 'edge' && !partNamesFront(tree, c, t)) continue
    // Said between the parts the two files sit in, or between the files when they share one.
    const ga = tree.parent[s], gb = tree.parent[t]
    const [a, b] = ga === gb || tree.isAncestor(ga, gb) || tree.isAncestor(gb, ga) ? [s, t] : [ga, gb]
    const key = `${a}>${b}`
    let g = grain.get(key)
    if (!g) grain.set(key, (g = { a, b, level: tree.lca(a, b), rels: [], combos: new Map() }))
    g.rels.push(k)
    const combo = `${from}>${to}`
    g.combos.set(combo, (g.combos.get(combo) ?? 0) + 1)
    flaggedBy.set(k, combo)
  }
  const reason = (combos: Map<string, number>, total: number) => {
    const parts = [...combos].sort((x, y) => y[1] - x[1]).map(([combo, n]) => {
      const [f, t] = combo.split('>') as [Layer, Layer]
      return `${LAYER_WORD[f]} using ${LAYER_WORD[t]}${combos.size > 1 ? ` (${n})` : ''}`
    })
    return combos.size > 1 || total == null ? parts.join(', ') : parts[0]
  }
  // A use against the grain that also closes a cycle is said once, on the cycle.
  const grains: Problem[] = []
  for (const p of cycles) {
    const combos = new Map<string, number>()
    for (const k of p.rels) { const c = flaggedBy.get(k); if (c) combos.set(c, (combos.get(c) ?? 0) + 1) }
    if (combos.size) p.why += ` It also runs against the grain: ${reason(combos, p.rels.length)}.`
  }
  const onCycles = new Set(cycles.flatMap(p => p.rels))
  for (const g of grain.values()) {
    const rels = g.rels.filter(k => !onCycles.has(k))
    if (!rels.length) continue
    const combos = new Map<string, number>()
    for (const k of rels) { const c = flaggedBy.get(k)!; combos.set(c, (combos.get(c) ?? 0) + 1) }
    const text = reason(combos, rels.length)
    grains.push({
      kind: 'grain', level: g.level, a: g.a, b: g.b, rels,
      title: `${title(g.a)} → ${title(g.b)}`,
      why: `${text[0].toUpperCase()}${text.slice(1)}: ${plural(rels.length, 'use')} against the grain.`,
    })
  }
  grains.sort((x, y) => y.rels.length - x.rels.length || title(x.a).localeCompare(title(y.a)))

  // The heaviest couplings: the five sibling-part pairs carrying the most uses between them, both
  // ways. A pair most of whose weight one nested pair carries is left to that pair, the more telling.
  // Each is said once: on its cycle's row when it has one, else on a row of its own.
  const pairs: { a: number; b: number; level: number; rels: number[] }[] = []
  for (const [c, L] of levels) {
    const at = new Map<string, { a: number; b: number; level: number; rels: number[] }>()
    for (const [key, rels] of L.rels) {
      const [x, y] = key.split('>').map(Number)
      if (!part(x) || !part(y)) continue
      const pk = x < y ? `${x}-${y}` : `${y}-${x}`
      const p = at.get(pk)
      if (p) p.rels.push(...rels)
      else at.set(pk, { a: x, b: y, level: c, rels: [...rels] })
    }
    pairs.push(...at.values())
  }
  pairs.sort((x, y) => y.rels.length - x.rels.length || x.a - y.a || x.b - y.b)
  const under = (x: number, y: number) => x === y || tree.isAncestor(x, y)
  const heaviest = pairs.filter(p => p.rels.length >= COUPLING_MIN && !pairs.some(q => q !== p && q.rels.length >= p.rels.length * 0.8 && ((under(p.a, q.a) && under(p.b, q.b)) || (under(p.a, q.b) && under(p.b, q.a))))).slice(0, MAX_COUPLINGS)
  const couplings: Problem[] = []
  for (const p of heaviest) {
    const out = p.rels.filter(k => under(p.a, tree.rels[k * 2])).length
    const [a, b, ab, ba] = out >= p.rels.length - out ? [p.a, p.b, out, p.rels.length - out] : [p.b, p.a, p.rels.length - out, out]
    const cycle = cycles.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a))
    if (cycle) { cycle.why += ` One of the ${MAX_COUPLINGS} heaviest couplings: ${p.rels.length} uses in all.`; continue }
    couplings.push({
      kind: 'coupling', level: p.level, a, b, rels: p.rels,
      title: `${title(a)} ${ba ? '↔' : '→'} ${title(b)}`,
      why: `${plural(p.rels.length, 'use')} between them${ba ? ` (${ab} one way, ${ba} back)` : ''}: one of the ${MAX_COUPLINGS} heaviest couplings on the map.`,
    })
  }

  let layered = 0, unlayered = 0
  for (let i = 1; i < tree.size; i++) {
    if (!part(i) || tree.depth[i] === 1 || !tree.children[i].length) continue
    if (namedLayer(tree, i)) layered++
    else unlayered++
  }
  return { list: [...cycles.map(({ rank: _, ...p }) => p), ...grains, ...couplings], layered, unlayered }
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
 * arrow. Folded, it says how many; open, the map marks them (`toggle`). A group holding `focus`
 * shows all its rows, so that row can take focus.
 */
export function problemsSection(tree: Tree, report: ProblemReport, here: number, open: boolean, act: { open: (k: number) => void; toggle: (open: boolean) => void }, focus = -1): HTMLElement | null {
  if (here > 0 && !tree.children[here].length) return null
  const mine = problemsAt(tree, report, here)
  const box = el('details', 'd-problems')
  box.open = open
  const summary = el('summary')
  summary.append(el('span', '', `Problems · ${mine.length}`))
  box.append(summary)
  box.addEventListener('toggle', () => act.toggle(box.open))
  const how = 'Read from one file’s uses of another in code: calls at runtime, links drawn between parts, type-only imports and an entry file’s wiring are not judged.'
  const layers = report.unlayered ? ` Layers come from names: ${report.layered} part${report.layered === 1 ? '' : 's'} name theirs; ${report.unlayered} name none, so uses into them are not judged for direction.` : ''
  if (!mine.length) box.append(el('p', 'd-hint', `No problems listed here: no cycle between parts, no use against the grain, and none of the map’s ${MAX_COUPLINGS} heaviest couplings. ${how}${layers}`))
  else box.append(el('p', 'd-hint', `${how}${layers} ] and [ step through all ${report.list.length} on the map.`))
  for (const kind of ['cycle', 'grain', 'coupling'] as const) {
    const ks = mine.filter(k => report.list[k].kind === kind)
    if (!ks.length) continue
    const whole = ks.includes(focus)
    box.append(el('h4', '', `${KIND_NAME[kind]} · ${ks.length}`))
    const ul = el('ul')
    ul.setAttribute('aria-label', KIND_NAME[kind])
    for (const [j, k] of ks.entries()) {
      const p = report.list[k]
      const li = el('li', `k-${kind}`)
      if (j >= FIRST_ROWS && !whole) li.hidden = true
      const b = el('button', 'd-rel')
      b.append(el('b', '', p.title), el('span', '', problemLine(tree, p, here)))
      b.title = p.why
      b.dataset.problem = String(k)
      b.onclick = () => act.open(k)
      li.append(b)
      ul.append(li)
    }
    box.append(ul)
    if (ks.length > FIRST_ROWS && !whole) {
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

/**
 * Above an open problem's arrow: which problem it is, why it is listed, the ring it closes, and
 * buttons for the previous, the next and the list (a phone has no ] or [).
 */
export function problemNote(tree: Tree, p: Problem, k: number, total: number, act: { step: (dir: 1 | -1) => void; list: () => void }): HTMLElement {
  const box = el('section', `d-problem k-${p.kind}`)
  box.setAttribute('aria-label', `Problem ${k + 1} of ${total}`)
  box.append(el('span', 'd-kindtag', `Problem ${k + 1} of ${total} · ${KIND_ONE[p.kind]}`), el('p', '', p.why))
  if (p.ring && p.ring.length > 3) box.append(el('p', 'd-ring', p.ring.map(i => tree.els[i].title).join(' → ')))
  const nav = el('div', 'd-problem-nav')
  const button = (text: string, label: string, run: () => void) => { const b = el('button', '', text); b.setAttribute('aria-label', label); b.onclick = run; return b }
  nav.append(button('← Previous', 'Previous problem ([)', () => act.step(-1)), button('Next →', 'Next problem (])', () => act.step(1)), button('Back to the list', 'Back to the list of problems', act.list))
  box.append(nav)
  return box
}
