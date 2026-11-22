import { kindName, type EvidenceJson, type Tree } from './model'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** What the panel can ask of the page: travel, select, and open code. */
export interface PanelActions {
  /** Selects element i and frames it, recording the place left behind. */
  go: (i: number) => void
  /** Opens a file of the map at a line; `near` picks among cards showing the same file. */
  openPath: (path: string, line: number, near: number) => void
  /** Opens element i's own code at its start. */
  read: (i: number) => void
}

/** One relation as the panel lists it: the card on the other side, what it reaches there, and the cited lines. */
export interface RelationRow { other: number; names: string[]; evidence: EvidenceJson[] }

type Rel = { other: number; title: string; evidence?: EvidenceJson[] }

/**
 * The relations of element i grouped one row per card on the other side. A container's are listed
 * by what is on the other side at its own level (a sibling component, another app), naming the
 * elements reached inside it; a leaf's by the exact element. Links a map added (they carry
 * evidence) cross the architecture, so they lead; then the busiest; then by name, so the order is
 * stable. Every relation is in some row: the list is complete.
 */
export function relationRows(tree: Tree, i: number, rels: Rel[]): RelationRow[] {
  const rollUp = (o: number) => (tree.children[i].length ? tree.childUnder(tree.lca(i, o), o) : o)
  const byOther = new Map<number, { names: Set<string>; evidence: Map<string, EvidenceJson> }>()
  for (const r of rels) {
    const o = rollUp(r.other)
    const row = byOther.get(o) ?? { names: new Set(), evidence: new Map() }
    const name = o === r.other ? r.title : tree.els[r.other].title
    // A relation named after the element it reaches (an import of KingdomDto) says nothing twice.
    if (name && name !== tree.els[o].title && name !== 'uses') row.names.add(name)
    for (const ev of r.evidence ?? []) row.evidence.set(ev.at, ev)
    byOther.set(o, row)
  }
  return [...byOther]
    .map(([other, r]) => ({ other, names: [...r.names], evidence: [...r.evidence.values()] }))
    .sort((a, b) => Number(b.evidence.length > 0) - Number(a.evidence.length > 0) || b.names.length - a.names.length || tree.els[a.other].title.localeCompare(tree.els[b.other].title))
}

/** Evidence with identical code excerpts folded together: one excerpt, every place it stands. */
export function foldEvidence(evidence: EvidenceJson[]): { code: string | null; at: EvidenceJson[] }[] {
  const out = new Map<string, { code: string | null; at: EvidenceJson[] }>()
  for (const ev of evidence) {
    const key = ev.code == null ? `\0${ev.at}` : ev.code.trim()
    const g = out.get(key) ?? { code: ev.code, at: [] }
    g.at.push(ev)
    out.set(key, g)
  }
  // Excerpts that stand in one place say the most about this link; the shared ones come last.
  return [...out.values()].sort((a, b) => a.at.length - b.at.length)
}

/** A card's kind in words: "Component", "21 files", "File". */
export function kindWord(tree: Tree, i: number): string {
  const e = tree.els[i], n = tree.children[i].length
  if (e.metadata?.path) return 'File'
  const name = kindName(e), k = name ? name[0].toUpperCase() + name.slice(1) : 'Element'
  return n ? `${k} · ${n} inside` : k
}

/** Where the panel's rows are, so ] and [ can walk them in the order shown. */
export interface PanelRows { uses: number[]; usedBy: number[]; mark: (dir: 'uses' | 'usedBy', k: number) => void }

const EMPTY: PanelRows = { uses: [], usedBy: [], mark: () => {} }

/**
 * The details panel for the selected element: what it is, where it sits, its file, and every
 * relation it has as one line each, Uses then Used by. A line's cited code opens on click.
 */
export function renderDetails(panel: HTMLElement, tree: Tree, relationsOf: (i: number) => { out: Rel[]; inn: Rel[] }, i: number, act: PanelActions, rank?: string): PanelRows {
  if (i <= 0) { panel.hidden = true; panel.replaceChildren(); return EMPTY }
  const files = new Set(tree.els.flatMap(f => (f.metadata?.path ? [f.metadata.path] : [])))
  const e = tree.els[i]
  const path: number[] = []
  for (let a = tree.parent[i]; a > 0; a = tree.parent[a]) path.unshift(a)
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', kindWord(tree, i)), el('h2', '', e.title))
  const crumbs = el('nav', 'd-path')
  crumbs.setAttribute('aria-label', 'Inside')
  for (const a of path) {
    const b = el('button', '', tree.els[a].title)
    b.onclick = () => act.go(a)
    crumbs.append(b)
  }

  // A file: where it is, how big, and the way into its code.
  const file = e.metadata?.path
  const fileBox: HTMLElement[] = []
  if (file) {
    const box = el('div', 'd-file')
    const lines = Number(e.metadata?.lines), ext = file.match(/\.(\w+)$/)?.[1]
    const p = el('code', 'd-filepath', file)
    p.title = file
    const facts = el('span', 'd-facts', [lines > 0 ? `${lines} line${lines === 1 ? '' : 's'}` : '', ext ?? ''].filter(Boolean).join(' · '))
    const actions = el('div', 'd-actions')
    const read = el('button', 'primary', 'Read code')
    read.onclick = () => act.read(i)
    const start = Number(e.metadata?.span?.split('-')[0]) || 0
    const copy = el('button', '', 'Copy path')
    copy.onclick = () => {
      const text = start > 1 ? `${file}:${start}` : file
      void navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy path' }, 1200) }, () => {})
    }
    actions.append(read, copy)
    box.append(p, facts, actions)
    fileBox.push(box)
  } else if (tree.children[i].length) {
    const actions = el('div', 'd-actions')
    const inBtn = el('button', 'primary', 'Go in')
    inBtn.onclick = () => act.go(i)
    actions.append(inBtn)
    fileBox.push(actions)
  }

  const tags = el('div', 'd-tags')
  for (const f of e.features ?? []) tags.append(el('span', 'feat', f))
  for (const t of [e.technology, ...e.tags.map(t => '#' + t)].filter(Boolean)) tags.append(el('span', '', t))

  const { out, inn } = relationsOf(i)
  const uses = relationRows(tree, i, out), usedBy = relationRows(tree, i, inn)
  const buttons: Record<'uses' | 'usedBy', HTMLElement[]> = { uses: [], usedBy: [] }
  const section = (title: string, cls: 'out' | 'in', key: 'uses' | 'usedBy', rows: RelationRow[]) => {
    const box = el('section', `d-rels ${cls}`)
    box.append(el('h3', '', `${title} · ${rows.length}`))
    if (!rows.length) { box.append(el('div', 'd-none', 'none on this map')); return box }
    const list = el('ul')
    for (const r of rows) {
      const li = el('li')
      const b = el('button', 'd-rel')
      b.append(el('i', '', cls === 'out' ? '→' : '←'), el('b', '', tree.els[r.other].title))
      if (r.names.length) b.append(el('span', '', r.names.length > 3 ? `${r.names.slice(0, 3).join(', ')} +${r.names.length - 3}` : r.names.join(', ')))
      b.title = `${title === 'Uses' ? 'Uses' : 'Used by'} ${tree.els[r.other].title}: go there`
      b.onclick = () => act.go(r.other)
      li.append(b)
      if (r.evidence.length) {
        const n = r.evidence.length
        const toggle = el('button', 'd-cite', `${n} cited line${n === 1 ? '' : 's'}`)
        toggle.setAttribute('aria-expanded', 'false')
        let box2: HTMLElement | null = null
        toggle.onclick = () => {
          if (box2) { box2.remove(); box2 = null; toggle.setAttribute('aria-expanded', 'false'); return }
          box2 = proof(r.evidence, files, (p, line) => act.openPath(p, line, i))
          li.append(box2)
          toggle.setAttribute('aria-expanded', 'true')
        }
        li.append(toggle)
      }
      list.append(li)
      buttons[key].push(li)
    }
    box.append(list)
    return box
  }
  // A request's path: its numbered steps in the order the request runs, then what stands beside
  // them (the types it names, its branches and answers). Each a jump to its card.
  const kids = tree.children[i], roleOf = (k: number) => tree.els[k].metadata?.role
  const path2: HTMLElement[] = []
  if (kids.some(k => roleOf(k) === 'step')) {
    const box = el('section', 'd-steps')
    const order = (k: number) => (roleOf(k) === 'step' ? Number(tree.els[k].metadata?.step) : 1e3 + ['view', 'response', 'type'].indexOf(roleOf(k) ?? '') )
    const steps = [...kids].sort((a, b) => order(a) - order(b))
    box.append(el('h3', '', 'The request, in order'))
    const ol = el('ol')
    for (const k of steps) {
      const li = el('li', roleOf(k) === 'step' ? '' : 'beside')
      const b = el('button', 'd-rel')
      const note = roleOf(k) === 'step' ? tree.els[k].technology || '' : kindName(tree.els[k])
      b.append(el('b', '', tree.els[k].title), ...(note && !tree.els[k].title.includes(note) ? [el('span', '', note)] : []))
      b.onclick = () => act.go(k)
      li.append(b)
      ol.append(li)
    }
    box.append(ol)
    path2.push(box)
  }
  panel.replaceChildren(
    head,
    ...(path.length ? [crumbs] : []),
    ...fileBox,
    ...(rank ? [el('p', 'd-rank', rank)] : []),
    ...(tags.childElementCount ? [tags] : []),
    ...(e.description ? [el('p', '', e.description.replace(/\s+/g, ' ').trim())] : []),
    // What the scanner saw here but could not follow: the map has no arrow for it.
    ...(e.metadata?.missed ? [el('p', 'd-missed', `Not followed by the scanner, so not on the map: ${e.metadata.missed.split('; ').map(x => { const [line, ...spec] = x.split(' '); return `${spec.join(' ')} (line ${line})` }).join(', ')}`)] : []),
    ...path2,
    section('Uses', 'out', 'uses', uses),
    section('Used by', 'in', 'usedBy', usedBy),
  )
  panel.hidden = false
  return {
    uses: uses.map(r => r.other),
    usedBy: usedBy.map(r => r.other),
    mark(dir, k) {
      for (const key of ['uses', 'usedBy'] as const) buttons[key].forEach((li, j) => li.classList.toggle('on', key === dir && j === k))
      buttons[dir][k]?.scrollIntoView({ block: 'nearest' })
    },
  }
}

/**
 * The code lines that prove a link the map added: where each is, and what it says, so a reader
 * can judge the link without opening the repository. One in a file of the map opens it there.
 * Identical lines in several places show once, with every place they stand as its own button.
 */
function proof(evidence: EvidenceJson[], files: Set<string>, open: (path: string, line: number) => void) {
  const box = el('div', 'd-ev')
  for (const g of foldEvidence(evidence)) {
    const div = el('div', g.code == null ? 'stale' : '')
    const places = el('div', 'at')
    for (const ev of g.at) {
      const file = ev.at.replace(/:\d+(-\d+)?$/, '')
      // The file name and its folder are enough to recognise it; the full path is in the tooltip.
      const short = ev.at.split('/').slice(-2).join('/')
      if (ev.code != null && files.has(file)) {
        const b = el('button', 'cite', short)
        b.title = `${ev.at}: open the code here`
        b.onclick = () => open(file, ev.line)
        places.append(b)
      } else places.append(el('span', '', short))
    }
    div.append(places, g.code == null ? el('em', '', 'no longer at this line') : el('pre', '', g.code))
    box.append(div)
  }
  return box
}
