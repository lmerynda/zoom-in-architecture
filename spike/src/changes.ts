// What changed since the upload before this one (the store works it out: scripts/changes.mjs): new
// or removed endpoints, crossings between processes and dependencies between components. Shown as
// a lens on the map (cards where something changed, new arrows drawn green) and as a list in the
// panel. A map with no earlier upload has none of it.
import { ago } from './hud'
import type { Lens } from './lens'
import type { ModelJson, Tree } from './model'

type Pair = { from: string; to: string; title: string }
export interface Changes {
  /** What the upload compared with was built from; null when it did not say. */
  since: NonNullable<ModelJson['published']> | null
  endpoints: { added: { title: string; at: string | null }[]; removed: { title: string }[] }
  crossings: { added: Pair[]; removed: Pair[] }
  dependencies: { added: Pair[]; removed: Pair[] }
}

/** How many things the list names. */
export function changeCount(c: Changes | null | undefined): number {
  if (!c) return 0
  return c.endpoints.added.length + c.endpoints.removed.length + c.crossings.added.length + c.crossings.removed.length + c.dependencies.added.length + c.dependencies.removed.length
}

/** "abc1234 · 2 days ago", or what is known of it. */
export function sinceText(since: Changes['since'], now = Date.now()): string {
  if (!since) return 'the upload before'
  return [since.commit ? `${since.commit.slice(0, 7)}${since.dirty ? '+' : ''}` : '', ago(since.at, now)].filter(Boolean).join(' · ')
}

/** A node's component, as the store counts dependencies: the node holding a file, or the node itself. */
const componentOf = (tree: Tree, i: number) => (tree.els[i].metadata?.path ? tree.parent[i] : i)
const topOf = (tree: Tree, i: number) => { while (tree.depth[i] > 1) i = tree.parent[i]; return i }

/**
 * Per relation of the tree: whether it makes a crossing or a dependency that is new since the
 * upload before. Those are the arrows the lens draws green.
 */
export function newRelations(tree: Tree, changed: Changes | null | undefined): boolean[] {
  const n = tree.rels.length / 2
  if (!changed) return new Array(n).fill(false)
  const crossings = new Set(changed.crossings.added.map(p => `${p.from}>${p.to}`))
  const deps = new Set(changed.dependencies.added.map(p => `${p.from}>${p.to}`))
  const id = (i: number) => tree.els[i].id
  return Array.from({ length: n }, (_, k) => {
    const s = tree.rels[k * 2], t = tree.rels[k * 2 + 1]
    // A type-only import is never a dependency the store counts, so it is never new.
    if (tree.relKind[k] === 'types') return false
    return crossings.has(`${id(topOf(tree, s))}>${id(topOf(tree, t))}`) || deps.has(`${id(componentOf(tree, s))}>${id(componentOf(tree, t))}`)
  })
}

/**
 * Per node, how many changes touch it or something inside it, each change counted once: a new
 * endpoint at the card that stands for it, a crossing or a dependency (new or removed) at both its
 * ends, where they still exist.
 */
export function changeCounts(tree: Tree, changed: Changes): Float64Array {
  const sum = new Float64Array(tree.size)
  const idx = (id: string | null) => (id == null ? -1 : tree.byId.get(id) ?? -1)
  const mark = (ends: number[]) => {
    const hit = new Set<number>()
    for (let i of ends) for (; i > 0; i = tree.parent[i]) hit.add(i)
    for (const i of hit) sum[i]++
  }
  for (const e of changed.endpoints.added) mark([idx(e.at)])
  for (const p of [...changed.crossings.added, ...changed.crossings.removed, ...changed.dependencies.added, ...changed.dependencies.removed]) mark([idx(p.from), idx(p.to)])
  return sum
}

/** The Changed lens: a card is lit where something changed at it or inside it. Null with no earlier upload. */
export function changeLens(tree: Tree): Lens | null {
  if (!changeCount(tree.changed)) return null
  const raw = changeCounts(tree, tree.changed!)
  const heat = new Float32Array(tree.size)
  for (let i = 0; i < tree.size; i++) heat[i] = raw[i] > 0 ? 1 : 0
  return { name: 'changed', label: `Changed since ${sinceText(tree.changed!.since)}`, raw, heat, unit: 'changes' }
}

const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }

/**
 * The list of what changed, for the panel: each new thing a jump to its card or arrow; removed
 * things are named only, since they are no longer on the map.
 */
export function renderChanges(panel: HTMLElement, tree: Tree, act: { select: (i: number) => void; inspect: (a: number, b: number) => void }) {
  const c = tree.changed
  if (!c) return
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', 'Changed'), el('h2', '', `${changeCount(c)} changes since ${sinceText(c.since)}`))
  const parts: HTMLElement[] = [head, el('p', 'd-hint', `Compared with the upload before this one${c.since?.at ? `, made ${new Date(c.since.at).toLocaleString()}` : ''}. New things are lit on the map; pick one to go to it.`)]
  const section = (title: string, rows: HTMLElement[]) => {
    if (!rows.length) return
    const box = el('section', 'd-outline d-changes')
    box.append(el('h3', '', `${title} · ${rows.length}`))
    const ul = el('ul')
    ul.setAttribute('aria-label', title)
    for (const r of rows) { const li = el('li'); li.append(r); ul.append(li) }
    box.append(ul)
    parts.push(box)
  }
  const jump = (text: string, where: string, go: () => void) => {
    const b = el('button', 'd-rel')
    b.append(el('b', '', text))
    if (where) b.append(el('span', '', where))
    b.onclick = go
    return b
  }
  const plain = (text: string, cls = '') => { const s = el('span', `d-rel ${cls}`); s.append(el('b', '', text)); return s }
  const gone = (text: string) => plain(text, 'd-gone')
  const idx = (id: string | null) => (id == null ? -1 : tree.byId.get(id) ?? -1)
  section('New endpoints', c.endpoints.added.map(e => {
    const i = idx(e.at)
    // In the architecture an endpoint is the file that serves it.
    return i > 0 ? jump(e.title, tree.els[i].metadata?.method ? '' : tree.els[i].title, () => act.select(i)) : plain(e.title)
  }))
  section('Removed endpoints', c.endpoints.removed.map(e => gone(e.title)))
  const pairs = (list: Pair[]) => list.map(p => {
    const a = idx(p.from), b = idx(p.to)
    return a > 0 && b > 0 ? jump(p.title, '', () => act.inspect(a, b)) : plain(p.title)
  })
  section('New crossings between processes', pairs(c.crossings.added))
  section('Removed crossings', c.crossings.removed.map(p => gone(p.title)))
  section('New dependencies between components', pairs(c.dependencies.added))
  section('Removed dependencies', c.dependencies.removed.map(p => gone(p.title)))
  panel.replaceChildren(...parts)
  panel.classList.add('outline')
  panel.hidden = false
}
