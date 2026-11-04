import type { EvidenceJson, Tree } from './model'
import type { Renderer } from './render'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** How many cited lines a relation row shows before "+N more". */
const SHOWN = 2

/** Opens a file of the map at a line, in the code view. */
export type OpenCode = (path: string, line: number) => void

/**
 * The code lines that prove a link the map added: where each is, and what it says, so a reader
 * can judge the link without opening the repository. One in a file of the map opens it there.
 */
function proof(evidence: EvidenceJson[], files: Set<string>, open?: OpenCode) {
  const box = el('div', 'd-ev')
  const item = (ev: EvidenceJson) => {
    const file = ev.at.replace(/:\d+(-\d+)?$/, '')
    const canOpen = !!open && ev.code != null && files.has(file)
    const div = el('div', [ev.code == null && 'stale', canOpen && 'open'].filter(Boolean).join(' '))
    // The file name and its folder are enough to recognise it; the full path is in the tooltip.
    const short = ev.at.split('/').slice(-2).join('/')
    div.append(el('span', 'at', canOpen ? `${short} ↗` : short))
    div.title = canOpen ? `${ev.at} · open in the code` : ev.at
    div.append(ev.code == null ? el('em', '', 'no longer at this line') : el('pre', '', ev.code))
    if (canOpen) div.onclick = () => open!(file, ev.line)
    return div
  }
  box.append(...evidence.slice(0, SHOWN).map(item))
  if (evidence.length > SHOWN) {
    const more = el('button', 'more', `+${evidence.length - SHOWN} more`)
    more.onclick = () => more.replaceWith(...evidence.slice(SHOWN).map(item))
    box.append(more)
  }
  return box
}

/** Unit panel for the selected element: identity, path, description and clickable relations. */
export function renderDetails(panel: HTMLElement, tree: Tree, renderer: Renderer, i: number, go: (i: number) => void, open?: OpenCode) {
  if (i <= 0) { panel.hidden = true; return }
  const files = new Set(tree.els.flatMap(f => (f.metadata?.path ? [f.metadata.path] : [])))
  const e = tree.els[i]
  const path: number[] = []
  for (let a = tree.parent[i]; a > 0; a = tree.parent[a]) path.unshift(a)
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', e.kind), el('h2', '', e.title))
  const crumbs = el('div', 'd-path')
  for (const a of path) {
    const b = el('button', '', tree.els[a].title)
    b.onclick = () => go(a)
    crumbs.append(b)
  }
  const tags = el('div', 'd-tags')
  for (const t of [e.technology, ...e.tags.map(t => '#' + t)].filter(Boolean)) tags.append(el('span', '', t))
  if (tree.children[i].length) tags.append(el('span', '', `${tree.children[i].length} inside`))

  const { out, inn } = renderer.relationsOf(i)
  // A container's relations are listed by what is on the other side at its own level (a sibling
  // component, another app), naming the elements reached inside it; a leaf's by the exact element.
  const rollUp = (o: number) => (tree.children[i].length ? tree.childUnder(tree.lca(i, o), o) : o)
  const list = (title: string, cls: string, all: { other: number; title: string; evidence?: EvidenceJson[] }[], arrow: string) => {
    if (!all.length) return []
    // One row per element on the other side, however many of our children talk to it.
    const byOther = new Map<number, { titles: Set<string>; evidence: Map<string, EvidenceJson> }>()
    for (const r of all) {
      const o = rollUp(r.other)
      const row = byOther.get(o) ?? { titles: new Set(), evidence: new Map() }
      row.titles.add(o === r.other ? r.title : tree.els[r.other].title)
      for (const ev of r.evidence ?? []) row.evidence.set(ev.at, ev)
      byOther.set(o, row)
    }
    const names = (s: Set<string>) => { const a = [...s]; return a.length > 4 ? `${a.slice(0, 4).join(', ')} +${a.length - 4}` : a.join(', ') }
    // Links a map added (they carry evidence) cross the architecture, so they lead; then the busiest.
    const rows = [...byOther]
      .sort((a, b) => Number(b[1].evidence.size > 0) - Number(a[1].evidence.size > 0) || b[1].titles.size - a[1].titles.size)
      .map(([other, r]) => ({ other, title: names(r.titles), evidence: [...r.evidence.values()] }))
    const box = el('div', `d-rels ${cls}`)
    box.append(el('h3', '', `${title} · ${rows.length}`))
    for (const r of rows.slice(0, 40)) {
      const b = el('button')
      b.append(el('i', '', arrow), el('b', '', tree.els[r.other].title), el('span', '', r.title))
      b.onclick = () => go(r.other)
      box.append(b, ...(r.evidence.length ? [proof(r.evidence, files, open)] : []))
    }
    return [box]
  }
  panel.replaceChildren(
    head,
    ...(path.length ? [crumbs] : []),
    tags,
    ...(e.description ? [el('p', '', e.description.replace(/\s+/g, ' ').trim())] : []),
    ...list('Outgoing', 'out', out, '→'),
    ...list('Incoming', 'in', inn, '←'),
    el('div', 'd-hint', 'Esc clears the selection'),
  )
  panel.hidden = false
}
