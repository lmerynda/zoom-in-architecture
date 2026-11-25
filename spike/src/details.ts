import { kindName, type EvidenceJson, type Tree } from './model'
import { count } from './render'

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
  /** Lists every relation between element a and element b, as a picked arrow does. */
  inspect: (a: number, b: number) => void
}

/** Every relation between the subtrees of a and b, both directions, as relation indices. */
export function relationsAcross(tree: Tree, a: number, b: number): number[] {
  const inside = (root: number, n: number) => n === root || tree.isAncestor(root, n)
  const out: number[] = []
  for (let k = 0; k < tree.rels.length; k += 2) {
    const s = tree.rels[k], t = tree.rels[k + 1]
    if ((inside(a, s) && inside(b, t)) || (inside(b, s) && inside(a, t))) out.push(k >> 1)
  }
  return out
}

/** One relation as the panel lists it: the card on the other side, what it reaches there, and the cited lines. */
export interface RelationRow { other: number; names: string[]; evidence: EvidenceJson[]; seen: number }

type Rel = { other: number; title: string; evidence?: EvidenceJson[]; seen?: number }

/**
 * The relations of element i grouped one row per card on the other side. A container's are listed
 * by what is on the other side at its own level (a sibling component, another app), naming the
 * elements reached inside it; a leaf's by the exact element. Links a map added (they carry
 * evidence) cross the architecture, so they lead; then the busiest; then by name, so the order is
 * stable. Every relation is in some row: the list is complete.
 */
export function relationRows(tree: Tree, i: number, rels: Rel[]): RelationRow[] {
  const rollUp = (o: number) => (tree.children[i].length ? tree.childUnder(tree.lca(i, o), o) : o)
  const byOther = new Map<number, { names: Set<string>; evidence: Map<string, EvidenceJson>; seen: number }>()
  for (const r of rels) {
    const o = rollUp(r.other)
    const row = byOther.get(o) ?? { names: new Set(), evidence: new Map(), seen: 0 }
    row.seen += r.seen ?? 0
    const name = o === r.other ? r.title : tree.els[r.other].title
    // A relation named after the element it reaches (an import of KingdomDto) says nothing twice.
    if (name && name !== tree.els[o].title && name !== 'uses') row.names.add(name)
    for (const ev of r.evidence ?? []) row.evidence.set(ev.at, ev)
    byOther.set(o, row)
  }
  return [...byOther]
    .map(([other, r]) => ({ other, names: [...r.names], evidence: [...r.evidence.values()], seen: r.seen }))
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
  panel.classList.remove('outline')
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
      if (r.seen) b.append(seenTag(r.seen))
      b.onclick = () => act.go(r.other)
      li.append(b)
      // The arrow's own evidence, by keyboard as well as by clicking the arrow on the map.
      const n = relationsAcross(tree, i, r.other).length
      const why = el('button', 'd-inspect', `${n} relation${n === 1 ? '' : 's'}`)
      why.setAttribute('aria-label', `Inspect the ${n} relation${n === 1 ? '' : 's'} between ${e.title} and ${tree.els[r.other].title}`)
      why.title = 'Every relation and the lines that make it'
      why.onclick = () => act.inspect(i, r.other)
      li.append(why)
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
    ...seenLines(tree, i),
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

/**
 * With nothing selected, the panel is an outline of the place you are in: each card of the level
 * as a button saying what it is, what it holds, and how much it uses and is used, in the order
 * the map ranks them (the busiest first). Arrow keys move along it; Enter selects. It is how a
 * keyboard or a screen reader walks the map.
 */
export function renderOutline(panel: HTMLElement, tree: Tree, here: number, relationsOf: (i: number) => { out: Rel[]; inn: Rel[] }, select: (i: number) => void) {
  const e = tree.els[here]
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', here > 0 ? kindWord(tree, here) : 'Whole map'), el('h2', '', e.title))
  if (here > 0) {
    // The place itself can be selected too, to see what it uses and what uses it.
    const actions = el('div', 'd-actions')
    const show = el('button', 'primary', 'Show what it uses')
    show.onclick = () => select(here)
    actions.append(show)
    head.append(actions)
  }
  const kids = tree.children[here]
  const count = (i: number) => { const r = relationsOf(i); return { uses: new Set(r.out.map(x => x.other)).size, usedBy: new Set(r.inn.map(x => x.other)).size } }
  const rows = kids.map(k => ({ k, ...count(k) })).sort((a, b) => b.uses + b.usedBy - a.uses - a.usedBy || tree.els[a.k].title.localeCompare(tree.els[b.k].title))
  const box = el('section', 'd-outline')
  box.append(el('h3', '', `Inside · ${kids.length}`))
  const ul = el('ul')
  ul.setAttribute('aria-label', `Cards inside ${e.title}`)
  for (const r of rows) {
    const li = el('li')
    const b = el('button', 'd-rel')
    const k = tree.els[r.k]
    const inside = tree.children[r.k].length
    b.append(el('b', '', k.title), el('span', '', [kindWord(tree, r.k).replace(/ · \d+ inside$/, ''), inside ? `${inside} inside` : '', `uses ${r.uses}`, `used by ${r.usedBy}`].filter(Boolean).join(' · ')))
    b.onclick = () => select(r.k)
    li.append(b)
    ul.append(li)
  }
  ul.addEventListener('keydown', ev => {
    const items = [...ul.querySelectorAll('button')], at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (ev.key === 'ArrowDown') { items[Math.min(items.length - 1, at + 1)]?.focus(); ev.preventDefault() }
    if (ev.key === 'ArrowUp') { items[Math.max(0, at - 1)]?.focus(); ev.preventDefault() }
  })
  box.append(ul)
  panel.replaceChildren(head, ...(e.description ? [el('p', '', e.description.replace(/\s+/g, ' ').trim())] : []), el('p', 'd-hint', 'Nothing selected: click a card, or pick one here, to see what it uses and what uses it.'), box)
  panel.classList.add('outline')
  panel.hidden = false
}

/** What a relation is, in words. */
const KIND_WORD = { runtime: 'calls at runtime', code: 'uses in code', types: 'type-only import' } as const

/**
 * The panel for a click on a stretch several arrows share: which arrows run there, heaviest first,
 * each a button that opens that one arrow's panel. The hover tooltip names the same set.
 */
export function renderLines(panel: HTMLElement, tree: Tree, lines: { s: number; t: number; count: number }[], choose: (l: { s: number; t: number }) => void) {
  panel.classList.remove('outline')
  const head = el('div', 'd-head')
  const total = lines.reduce((a, l) => a + l.count, 0)
  head.append(el('span', 'd-kind', 'Arrows'), el('h2', '', `${lines.length} arrows share this line`))
  const p = el('p', '', `They carry ${total} relation${total === 1 ? '' : 's'} between them. Pick one to see what it carries and why.`)
  const box = el('section', 'd-rels d-lines')
  const ul = el('ul')
  for (const l of lines) {
    const li = el('li')
    const b = el('button', 'd-rel')
    b.append(el('b', '', `${tree.els[l.s].title} ↔ ${tree.els[l.t].title}`), el('span', '', `${l.count} relation${l.count === 1 ? '' : 's'}`))
    b.onclick = () => choose(l)
    li.append(b)
    ul.append(li)
  }
  box.append(ul)
  panel.replaceChildren(head, p, box)
}

/**
 * The panel for a picked arrow: the two cards it joins, how many relations it carries of each
 * kind, and every one of them, direction by direction: which file uses which, what it names, and
 * the lines that make it, each opening the code there. A runtime call shows its cited lines.
 */
export function renderEdge(panel: HTMLElement, tree: Tree, s: number, t: number, rels: number[], act: PanelActions) {
  panel.classList.remove('outline')
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', 'Arrow'), el('h2', '', `${tree.els[s].title} ↔ ${tree.els[t].title}`))
  const count = (kind: string) => rels.filter(k => tree.relKind[k] === kind).length
  const summary = (['runtime', 'code', 'types'] as const).filter(k => count(k)).map(k => `${count(k)} ${KIND_WORD[k]}`).join(' · ')
  const files = new Set(tree.els.flatMap(f => (f.metadata?.path ? [f.metadata.path] : [])))
  const inside = (root: number, n: number) => n === root || tree.isAncestor(root, n)
  const section = (from: number, to: number) => {
    const mine = rels.filter(k => inside(from, tree.rels[k * 2]) && inside(to, tree.rels[k * 2 + 1]))
    if (!mine.length) return []
    const box = el('section', 'd-rels d-edge')
    box.append(el('h3', '', `${tree.els[from].title} → ${tree.els[to].title} · ${mine.length}`))
    const ul = el('ul')
    // Runtime calls first, then uses, then type-only imports; by file name within each.
    const order = { runtime: 0, code: 1, types: 2 }
    mine.sort((a, b) => order[tree.relKind[a]] - order[tree.relKind[b]] || tree.els[tree.rels[a * 2]].title.localeCompare(tree.els[tree.rels[b * 2]].title))
    for (const k of mine) {
      const a = tree.rels[k * 2], b = tree.rels[k * 2 + 1], kind = tree.relKind[k]
      const li = el('li', `k-${kind}`)
      const pair = el('button', 'd-rel')
      pair.append(el('i', '', kind === 'runtime' ? '⇢' : '→'), el('b', '', `${tree.els[a].title} → ${tree.els[b].title}`))
      pair.title = `${KIND_WORD[kind]}: go to ${tree.els[a].title}`
      pair.onclick = () => act.go(a)
      li.append(pair)
      const why = el('div', 'd-why')
      why.append(el('span', 'd-kindtag', KIND_WORD[kind]))
      if (tree.relSeen[k]) why.append(seenTag(tree.relSeen[k]))
      else if (tree.relTraceable[k]) why.append(el('em', 'd-seen-tag none', 'not seen in tests'))
      else if (tree.traced && kind === 'runtime') {
        const tag = el('em', 'd-seen-tag outside', 'outside the trace')
        tag.title = 'The trace watched only the apps the tests ran; this call starts outside them, so the run says nothing of it'
        why.append(tag)
      }
      if (tree.relTitles[k]) why.append(el('span', 'd-names', tree.relTitles[k]))
      const path = tree.els[a].metadata?.path
      // The lines that make it: a use's own lines in its file, a runtime call's cited lines.
      for (const line of tree.relLines[k]) {
        if (!path) break
        const b2 = el('button', 'cite', `line ${line}`)
        b2.title = `${path}:${line}: open the code here`
        b2.onclick = () => act.openPath(path, line, a)
        why.append(b2)
      }
      for (const ev of tree.relEvidence[k] ?? []) {
        const file = ev.at.replace(/:\d+(-\d+)?$/, '')
        if (ev.code == null || !files.has(file)) { why.append(el('span', 'd-names', ev.at)); continue }
        const b2 = el('button', 'cite', ev.at.split('/').pop()!)
        b2.title = `${ev.at}: ${ev.code.trim()}`
        b2.onclick = () => act.openPath(file, ev.line, a)
        why.append(b2)
      }
      li.append(why)
      ul.append(li)
    }
    box.append(ul)
    return [box]
  }
  panel.replaceChildren(head, el('p', 'd-rank', summary || 'nothing on this map'), ...section(s, t), ...section(t, s), el('p', 'd-hint', 'Esc puts the arrow down.'))
  panel.hidden = false
}

/**
 * A call the project's own tests made, as a tag. The count stays in the tooltip: it is what the
 * trace recorded for the link (spans of its code, or its endpoint's requests), not a count of this
 * one call, and the row needs its room for what the call reaches.
 */
export function seenTag(n: number): HTMLElement {
  const tag = el('em', 'd-seen-tag', 'seen in tests')
  tag.title = `Seen in the project's own end-to-end tests: ${count(n)} recorded in the trace for this link`
  return tag
}

/**
 * What the project's own end-to-end tests showed of element i, on a traced map: an app's endpoint
 * coverage, an endpoint's requests (statuses, tables) or that no test called it, a file that ran,
 * the tables seen in a store. On an untraced map, nothing: absence there means not looked at.
 */
export function seenLines(tree: Tree, i: number): HTMLElement[] {
  const t = tree.traced, m = tree.els[i].metadata
  if (!t || !m) return []
  const out: string[] = []
  let cls = 'd-seen'
  if (m.seen?.includes('/')) out.push(`Seen in tests: ${m.seen.split('/').map(n => count(+n)).join(' of ')} endpoints`)
  else if (m.method && m.seen === '0') { out.push('Not seen in tests: no test called it, so its path is inferred from code only'); cls = 'd-seen none' }
  else if (m.method && m.seen) out.push(`Seen in tests: ${count(+m.seen)} request${m.seen === '1' ? '' : 's'}${m.statuses ? ` · ${m.statuses.replace(/×(d+)/g, (_, n) => `×${count(+n)}`)}` : ''}`)
  else if (m.seen && m.seen !== '0') out.push(`Ran in tests: ${count(+m.seen)} time${m.seen === '1' ? '' : 's'}`)
  if (m.tables) out.push(`Tables: ${m.tables}`)
  if (!out.length) return []
  const p = el('p', cls)
  p.append(...out.flatMap((s, k) => (k ? [el('br'), s] : [s])))
  p.title = `From ${t.command}, run ${new Date(t.at).toLocaleString()}`
  return [p]
}
