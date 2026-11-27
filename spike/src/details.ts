import { clientParts, endpointOf, featureFacts, filterApi, groupApi, declLine, handlerParams, isPage, methodCounts, routeParams, servedBy, takenTypes, wordRe, type Api, type ApiFilter, type Endpoint, type Marks } from './endpoints'
import { kindName, type ElementJson, type EvidenceJson, type Tree } from './model'
import { count } from './render'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** What the panel can ask of the page: travel, select, open code, and open the surface. */
export interface PanelActions extends ApiActions {
  /** Selects element i and frames it, recording the place left behind. */
  go: (i: number) => void
  /** Opens a file of the map at a line; `near` picks among cards showing the same file. */
  openPath: (path: string, line: number, near: number) => void
  /** Opens element i's own code at its start. */
  read: (i: number) => void
  /** Lists every relation between element a and element b, as a picked arrow does. */
  inspect: (a: number, b: number) => void
  /** Goes into container i: framed open, nothing selected, the panel its outline. */
  enter: (i: number) => void
  /** A file's source as uploaded, to read a handler's parameters; null when the viewer has none. */
  source: (path: string) => Promise<string | null>
  /** The pages whose code calls an endpoint (by its Requests id), as Architecture cards. */
  callingPages: (endpoint: string) => Promise<{ id: string; title: string }[]>
  /** Goes to an Architecture card by id: selected here, or across to Architecture from Requests. */
  part: (id: string) => void}

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

/**
 * A card's part in a request: its role, or in maps built before cards carried one, what its title
 * says ("2 · OwnerRepository" a step, "6 · Response" the response).
 */
export function stepRole(e: Pick<ElementJson, 'title' | 'metadata'>): string | undefined {
  if (e.metadata?.role) return e.metadata.role
  if (/^\d+ · Response$/.test(e.title)) return 'response'
  return /^\d+ · /.test(e.title) && e.metadata?.path ? 'step' : undefined
}
const stepNumber = (e: Pick<ElementJson, 'title' | 'metadata'>) => Number(e.metadata?.step ?? e.title.match(/^(\d+) · /)?.[1] ?? 0)

/** The endpoints at or under element i of this tree (the Requests view), by id. */
export function endpointDescendants(tree: Tree, i: number): string[] {
  const out: string[] = []
  const walk = (n: number) => { if (endpointOf(tree.els[n])) out.push(tree.els[n].id); else for (const k of tree.children[n]) walk(k) }
  walk(i)
  return out
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
export function renderDetails(panel: HTMLElement, tree: Tree, relationsOf: (i: number) => { out: Rel[]; inn: Rel[] }, i: number, act: PanelActions, rank?: string, surface: Surface | null = null): PanelRows {
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
    inBtn.onclick = () => act.enter(i)
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
      const across = relationsAcross(tree, i, r.other), n = across.length
      // A partly tested arrow says so: how many of the calls the trace could see it saw.
      const tally = traceTally(tree, across)
      if (tally.unseen) b.append(partTag(tally))
      else if (r.seen) b.append(seenTag(r.seen))
      b.onclick = () => act.go(r.other)
      li.append(b)
      // The arrow's own evidence, by keyboard as well as by clicking the arrow on the map.
      const why = el('button', 'd-inspect', `Inspect ${n} relation${n === 1 ? '' : 's'}`)
      why.setAttribute('aria-label', `Inspect the ${n} relation${n === 1 ? '' : 's'} between ${e.title} and ${tree.els[r.other].title}`)
      why.title = 'Every relation between the two, both directions, and the lines that make it'
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
  const kids = tree.children[i], roleOf = (k: number) => stepRole(tree.els[k])
  const path2: HTMLElement[] = []
  if (kids.some(k => roleOf(k) === 'step')) {
    const box = el('section', 'd-steps')
    const order = (k: number) => (roleOf(k) === 'step' ? stepNumber(tree.els[k]) : 1e3 + ['view', 'response', 'type'].indexOf(roleOf(k) ?? '') )
    const steps = [...kids].sort((a, b) => order(a) - order(b))
    const onPath = (k: number) => roleOf(k) === 'step' || (roleOf(k) === 'response' && /^\d+ · /.test(tree.els[k].title))
    box.append(el('h3', '', 'The request, in order'))
    const ol = el('ol'), aside = el('ul')
    for (const k of steps) {
      const li = el('li', roleOf(k) === 'step' ? '' : 'beside')
      const b = el('button', 'd-rel')
      const note = roleOf(k) === 'step' ? tree.els[k].technology || '' : kindName(tree.els[k])
      b.append(el('b', '', tree.els[k].title), ...(note && !tree.els[k].title.includes(note) ? [el('span', '', note)] : []))
      b.onclick = () => act.go(k)
      li.append(b)
      ;(onPath(k) ? ol : aside).append(li)
    }
    box.append(ol)
    if (aside.children.length) box.append(el('h3', 'd-beside', `Beside it · ${aside.children.length}`), aside)
    path2.push(box)
  }
  // An endpoint is told by its effect first, its steps one expand away; a file that handles
  // requests leads with what it serves; a part with a surface says what it offers.
  const endpoint = !!endpointOf(e) && tree.children[i].length > 0
  const api = surface?.api ?? null
  const lead = surface && !endpoint ? surfaceLead(tree, i, surface, act) : []
  panel.replaceChildren(
    head,
    ...(path.length ? [crumbs] : []),
    ...fileBox,
    ...(rank ? [el('p', 'd-rank', rank)] : []),
    ...lead,
    ...seenLines(tree, i, !endpoint),
    ...(lead.length ? [] : unseenList(tree, i, act)),
    ...(tags.childElementCount ? [tags] : []),
    ...(e.description && !endpoint ? [el('p', '', e.description.replace(/\s+/g, ' ').trim())] : []),
    // What the scanner saw here but could not follow: the map has no arrow for it.
    ...(e.metadata?.missed ? [el('p', 'd-missed', `Not followed by the scanner, so not on the map: ${e.metadata.missed.split('; ').map(x => { const [line, ...spec] = x.split(' '); return `${spec.join(' ')} (line ${line})` }).join(', ')}`)] : []),
    ...(endpoint ? endpointEffects(tree, i, act, api, path2) : path2),
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
export function renderOutline(panel: HTMLElement, tree: Tree, here: number, relationsOf: (i: number) => { out: Rel[]; inn: Rel[] }, select: (i: number) => void, lead: HTMLElement[] = []) {
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
  // The same counts the panel heads its Uses and Used by lists with, once the card is selected.
  const count = (i: number) => { const r = relationsOf(i); return { uses: relationRows(tree, i, r.out).length, usedBy: relationRows(tree, i, r.inn).length } }
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
    const cov = tree.traced ? endpointCover(tree, r.k) : null
    if (cov?.total) {
      const tag = el('em', cov.seen < cov.total ? 'd-seen-tag none' : 'd-seen-tag', k.metadata?.method ? (cov.seen ? 'seen in tests' : 'not seen in tests') : `${cov.seen} of ${cov.total} endpoints seen`)
      b.append(tag)
    }
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
  panel.replaceChildren(head, ...(e.description ? [el('p', '', e.description.replace(/\s+/g, ' ').trim())] : []), ...lead, el('p', 'd-hint', 'Nothing selected: click a card, or pick one here, to see what it uses and what uses it.'), box)
  panel.classList.add('outline')
  panel.hidden = false
}

/** Of the endpoints at or under i, how many the project's own tests called. */
export function endpointCover(tree: Tree, i: number): { seen: number; total: number; unseen: number[] } {
  const unseen: number[] = []
  let seen = 0, total = 0
  const walk = (n: number) => {
    const m = tree.els[n].metadata
    if (m?.method && m.seen != null) { total++; if (m.seen === '0') unseen.push(n); else seen++; return }
    for (const k of tree.children[n]) walk(k)
  }
  walk(i)
  return { seen, total, unseen }
}

/** What a relation is, in words. */
const KIND_WORD = { runtime: 'calls at runtime', code: 'uses in code', types: 'type-only import' } as const
const KIND_ONE = { runtime: 'call at runtime', code: 'use in code', types: 'type-only import' } as const

/**
 * The panel for a click on a stretch several arrows share: which arrows run there, heaviest first,
 * each a button that opens that one arrow's panel. The hover tooltip names the same set.
 */
/** An arrow's name, pointing the way its relations run: → when all go one way, ↔ only when both ways have some. */
export function arrowTitle(tree: Tree, s: number, t: number, rels: number[]): string {
  const inside = (root: number, n: number) => n === root || tree.isAncestor(root, n)
  const fwd = rels.some(k => inside(s, tree.rels[k * 2]) && inside(t, tree.rels[k * 2 + 1])), rev = rels.some(k => inside(t, tree.rels[k * 2]) && inside(s, tree.rels[k * 2 + 1]))
  const [a, b] = rev && !fwd ? [t, s] : [s, t]
  return `${tree.els[a].title} ${fwd && rev ? '↔' : '→'} ${tree.els[b].title}`
}

export function renderLines(panel: HTMLElement, tree: Tree, lines: { s: number; t: number; count: number; rels: number[] }[], choose: (l: { s: number; t: number }, k: number) => void) {
  panel.classList.remove('outline')
  panel.hidden = false
  const head = el('div', 'd-head')
  const total = lines.reduce((a, l) => a + l.count, 0)
  head.append(el('span', 'd-kind', 'Arrows'), el('h2', '', `${lines.length} arrows share this line`))
  const p = el('p', '', `They carry ${total} relation${total === 1 ? '' : 's'} between them. Pick one to see what it carries and why.`)
  const box = el('section', 'd-rels d-lines')
  const ul = el('ul')
  for (const [k, l] of lines.entries()) {
    const li = el('li')
    const b = el('button', 'd-rel')
    b.append(el('b', '', arrowTitle(tree, l.s, l.t, l.rels)), el('span', '', `${l.count} relation${l.count === 1 ? '' : 's'}`))
    b.onclick = () => choose(l, k)
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
  const summary = (['runtime', 'code', 'types'] as const).filter(k => count(k)).map(k => `${count(k)} ${count(k) === 1 ? KIND_ONE[k] : KIND_WORD[k]}`).join(' · ')
  const files = new Set(tree.els.flatMap(f => (f.metadata?.path ? [f.metadata.path] : [])))
  const inside = (root: number, n: number) => n === root || tree.isAncestor(root, n)
  head.querySelector('h2')!.textContent = arrowTitle(tree, s, t, rels)
  // Lines every relation cites (the config that wires all of a server's stores) are said once, above the list.
  const shared = new Set<string>()
  if (rels.length > 2) {
    const [first, ...rest] = rels.map(k => new Set((tree.relEvidence[k] ?? []).map(ev => ev.at)))
    for (const at of first) if (rest.every(r => r.has(at))) shared.add(at)
  }
  const sharedBox: HTMLElement[] = []
  if (shared.size) {
    const box = el('div', 'd-why d-shared')
    box.append(el('span', 'd-kindtag', `Cited by all ${rels.length}:`))
    const evs = (tree.relEvidence[rels[0]] ?? []).filter(ev => shared.has(ev.at))
    for (const ev of evs) {
      const file = ev.at.replace(/:\d+(-\d+)?$/, '')
      if (ev.code == null || !files.has(file)) { box.append(el('span', 'd-names', ev.at)); continue }
      const b2 = el('button', 'cite', ev.at.split('/').pop()!)
      b2.title = `${ev.at}: ${ev.code.trim()}`
      b2.onclick = () => act.openPath(file, ev.line, s)
      box.append(b2)
    }
    sharedBox.push(box)
  }
  const tally = traceTally(tree, rels)
  const traceLine = tally.unseen ? [partLine(tally)] : []
  const section = (from: number, to: number) => {
    const mine = rels.filter(k => inside(from, tree.rels[k * 2]) && inside(to, tree.rels[k * 2 + 1]))
    if (!mine.length) return []
    const box = el('section', 'd-rels d-edge')
    box.append(el('h3', '', `${tree.els[from].title} → ${tree.els[to].title} · ${mine.length}`))
    const ul = el('ul')
    // Calls no test made first (the exceptions), then runtime calls, uses, type-only imports; by file name within each.
    const order = { runtime: 0, code: 1, types: 2 }, unseen = (k: number) => (tree.relTraceable[k] && !tree.relSeen[k] ? 0 : 1)
    mine.sort((a, b) => unseen(a) - unseen(b) || order[tree.relKind[a]] - order[tree.relKind[b]] || tree.els[tree.rels[a * 2]].title.localeCompare(tree.els[tree.rels[b * 2]].title))
    for (const k of mine) {
      const a = tree.rels[k * 2], b = tree.rels[k * 2 + 1], kind = tree.relKind[k]
      const li = el('li', `k-${kind}`)
      li.dataset.rel = String(k)
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
        if (shared.has(ev.at)) continue
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
  panel.replaceChildren(head, el('p', 'd-rank', summary || 'nothing on this map'), ...traceLine, ...sharedBox, ...section(s, t), ...section(t, s), el('p', 'd-hint', 'Esc puts the arrow down.'))
  panel.hidden = false
}

/**
 * A call the project's own tests made, as a tag. The count stays in the tooltip: it is what the
 * trace recorded for the link (spans of its code, or its endpoint's requests), not a count of this
 * one call, and the row needs its room for what the call reaches.
 */
/** Of some relations, how many the trace could judge, and how many of those the tests made. */
export function traceTally(tree: Tree, rels: number[]): { seen: number; unseen: number } {
  let seen = 0, unseen = 0
  for (const k of rels) if (tree.relSeen[k]) seen++; else if (tree.relTraceable[k]) unseen++
  return { seen, unseen }
}

/** A partly tested arrow's tag: "14/15 seen", light red, with the exceptions in its tooltip. */
function partTag(t: { seen: number; unseen: number }): HTMLElement {
  const tag = el('em', 'd-seen-tag none', `${t.seen}/${t.seen + t.unseen} seen`)
  tag.title = `The project's own tests made ${t.seen} of the ${t.seen + t.unseen} calls here the trace could see; ${t.unseen} not seen. Inspect lists them first.`
  return tag
}

/** The same, as a line under an arrow panel's title. */
function partLine(t: { seen: number; unseen: number }): HTMLElement {
  return el('p', 'd-missed', `${t.seen} of ${t.seen + t.unseen} calls seen in tests · ${t.unseen} not seen, listed first`)
}

export function seenTag(n: number): HTMLElement {
  const tag = el('em', 'd-seen-tag', 'seen in tests')
  tag.title = `Seen in the project's own end-to-end tests. The trace counted ${count(n)} for it: the requests of its endpoint, or the calls into the code that makes it, not calls across this one link`
  return tag
}

/**
 * What the project's own end-to-end tests showed of element i, on a traced map: an app's endpoint
 * coverage, an endpoint's requests (statuses, tables) or that no test called it, a file that ran,
 * the tables seen in a store. On an untraced map, nothing: absence there means not looked at.
 */
/**
 * The lines seenLines shows, as text: what the trace counted, each count with the unit it counts.
 * A step of a request says only that its code ran in that endpoint's tested requests: the count the
 * trace has for it is not this step's own.
 */
export function seenText(tree: Tree, i: number): { lines: string[]; unseen: boolean } {
  const m = tree.els[i].metadata
  if (!tree.traced || !m) return { lines: [], unseen: false }
  const lines: string[] = []
  let unseen = false
  if (m.seen?.includes('/')) lines.push(`Seen in tests: ${m.seen.split('/').map(n => count(+n)).join(' of ')} endpoints`)
  else if (m.method && m.seen === '0') { lines.push('Not seen in tests: no test called it, so its path is inferred from code only'); unseen = true }
  else if (m.method && m.seen) lines.push(`Seen in tests: ${count(+m.seen)} HTTP request${m.seen === '1' ? '' : 's'}${m.statuses ? ` · ${m.statuses.replace(/×(\d+)/g, (_, n) => `×${count(+n)}`)}` : ''}`)
  else if (m.role === 'step' && m.seen && m.seen !== '0') lines.push('Ran in tests: its code ran during this endpoint’s tested requests')
  else if (m.seen && m.seen !== '0') lines.push(`Ran in tests: ${count(+m.seen)} call${m.seen === '1' ? '' : 's'} into its code`)
  return { lines, unseen }
}

/** "kingdom_entity: SELECT, UPDATE · user_entity: SELECT" as rows of a table and what was done to it, writes first. */
export function tableRows(text: string): { table: string; ops: string }[] {
  const VERB: Record<string, string> = { SELECT: 'reads', INSERT: 'inserts', UPDATE: 'updates', DELETE: 'deletes', MERGE: 'writes' }
  const rows = text.split(' · ').map(s => s.trim()).filter(Boolean).map(s => {
    const at = s.lastIndexOf(': ')
    const table = at < 0 ? s : s.slice(0, at), sql = at < 0 ? [] : s.slice(at + 2).split(',').map(o => o.trim()).filter(Boolean)
    const verbs = [...new Set(sql.map(o => VERB[o] ?? o.toLowerCase()))].sort((a, b) => Number(a === 'reads') - Number(b === 'reads'))
    return { table, ops: verbs.join(', '), writes: verbs.some(v => v !== 'reads') }
  })
  return rows.sort((a, b) => Number(b.writes) - Number(a.writes) || a.table.localeCompare(b.table)).map(({ table, ops }) => ({ table, ops }))
}

/** Under a part's coverage, the endpoints no test called: a disclosure whose rows go to each. */
function unseenList(tree: Tree, i: number, act: PanelActions): HTMLElement[] {
  if (!tree.traced || tree.els[i].metadata?.method || !tree.children[i].length) return []
  const { unseen } = endpointCover(tree, i)
  if (!unseen.length) return []
  const box = el('section', 'd-unseen')
  const toggle = el('button', 'd-more', `List the ${unseen.length} endpoint${unseen.length === 1 ? '' : 's'} no test called`)
  toggle.setAttribute('aria-expanded', 'false')
  const ul = el('ul')
  ul.hidden = true
  for (const k of unseen) {
    const li = el('li'), b = el('button', 'd-rel')
    b.append(el('b', '', tree.els[k].title), el('span', '', pathOf(tree, k)))
    b.onclick = () => act.go(k)
    li.append(b)
    ul.append(li)
  }
  toggle.onclick = () => { ul.hidden = !ul.hidden; toggle.setAttribute('aria-expanded', String(!ul.hidden)) }
  box.append(toggle, ul)
  return [box]
}

/** Where a card sits, by its parents' names below the whole map. */
function pathOf(tree: Tree, i: number): string {
  const out: string[] = []
  for (let a = tree.parent[i]; a > 0; a = tree.parent[a]) out.unshift(tree.els[a].title)
  return out.join(' › ')
}

export function seenLines(tree: Tree, i: number, tables = true): HTMLElement[] {
  const t = tree.traced, m = tree.els[i].metadata
  if (!t || !m) return []
  const { lines, unseen } = seenText(tree, i)
  const out: HTMLElement[] = []
  if (lines.length) {
    const p = el('p', unseen ? 'd-seen none' : 'd-seen')
    p.append(...lines.flatMap((s, k) => (k ? [el('br'), s] : [s])))
    p.title = `From ${t.command}, run ${new Date(t.at).toLocaleString()}`
    out.push(p)
    // On the part that holds the endpoints, the run itself: what ran, when, how it ended.
    if (m.seen?.includes('/')) out.push(el('p', 'd-run', `Test run: ${t.command} · ${new Date(t.at).toLocaleString()} · exit ${t.exit}`))
  }
  // The tables the tests touched: one row each, what was done to it beside its name, writes first;
  // a long list shows its first rows and opens on request.
  if (m.tables && tables) {
    const rows = tableRows(m.tables), FIRST = 4
    const box = el('section', 'd-tables')
    box.append(el('h3', '', `Tables touched in tests · ${rows.length}`))
    const ul = el('ul')
    rows.forEach((r, k) => { const li = el('li', r.ops === 'reads' ? 'reads' : 'writes'); li.append(el('code', '', r.table), el('span', '', r.ops)); if (k >= FIRST) li.hidden = true; ul.append(li) })
    box.append(ul)
    if (rows.length > FIRST) {
      const more = el('button', 'd-more', `Show all ${rows.length}`)
      more.setAttribute('aria-expanded', 'false')
      more.onclick = () => {
        const open = more.getAttribute('aria-expanded') !== 'true'
        ul.querySelectorAll('li').forEach((li, k) => { if (k >= FIRST) li.hidden = !open })
        more.setAttribute('aria-expanded', String(open))
        more.textContent = open ? 'Show fewer' : `Show all ${rows.length}`
      }
      box.append(more)
    }
    out.push(box)
  }
  return out
}

// --- The surface: endpoints, what an endpoint does, what a file serves, where a feature meets them.

/** What the panel's surface asks of the page. */
export interface ApiActions {
  /** Opens an endpoint by its Requests id: selected here in Requests, across to Requests from Architecture. */
  endpoint: (id: string) => void
  /** Lists the endpoints, filtered. */
  list: (f: ApiFilter) => void
}

/** What the panel knows of the map's surface: its endpoints, if the map has a Requests model, and the marks behind them. */
export interface Surface {
  api: Api | null
  /** The open view is Requests: an endpoint is a card here. */
  requests: boolean
  /** Routes and scheduled jobs marked in the map's code (the Architecture model's, when it is loaded). */
  marks: Marks
}

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

/** A method as a small tag, coloured by what it does. */
function methodTag(m: string): HTMLElement {
  const t = el('span', 'd-m', m)
  t.setAttribute('aria-hidden', 'true')
  return t
}

/** One endpoint as a row: method, path, handler and what it answers; light red when no test called it. */
function endpointRow(ep: Endpoint, open: () => void, sub = ''): HTMLLIElement {
  const li = el('li')
  const b = el('button', 'd-ep')
  const line = sub || [ep.handler?.name, ep.returns && `→ ${ep.returns}`].filter(Boolean).join(' ')
  b.append(methodTag(ep.method), el('b', '', ep.route), el('span', '', line))
  if (ep.seen === 0) { b.append(el('em', 'd-seen-tag none', 'untested')); b.classList.add('unseen') }
  b.setAttribute('aria-label', `${ep.method} ${ep.route}${ep.seen === 0 ? ', not seen in tests' : ''}${line ? `: ${line.replace('→', 'returns')}` : ''}`)
  b.onclick = open
  li.append(b)
  return li
}

/** Arrow keys walk a list's buttons, as in the outline. */
function arrowKeys(list: HTMLElement, sel = 'button') {
  list.addEventListener('keydown', ev => {
    const items = [...list.querySelectorAll<HTMLElement>(sel)], at = items.indexOf(document.activeElement as HTMLElement)
    if (ev.key === 'ArrowDown') { items[Math.min(items.length - 1, at + 1)]?.focus(); ev.preventDefault() }
    if (ev.key === 'ArrowUp') { items[Math.max(0, at - 1)]?.focus(); ev.preventDefault() }
  })
}

/**
 * The endpoint list: every endpoint, grouped by the resource it is under with each group's count,
 * filterable by method, by "no test called it" and by words; each row opens the endpoint. A line
 * under the title says how many the tests saw and how many routes the code marks, so a route the
 * map missed is not simply absent.
 */
export function renderApi(panel: HTMLElement, s: Surface, f: ApiFilter, act: ApiActions & { filter: (f: ApiFilter) => void; close: () => void }) {
  const api = s.api!
  panel.classList.remove('outline')
  const scope = filterApi(api, { app: f.app, ids: f.ids })
  const head = el('div', 'd-head')
  const where = f.label ?? (f.app ? api.title.get(f.app) ?? '' : '')
  head.append(el('span', 'd-kind', 'Endpoints'), el('h2', '', `${where ? `${where} · ` : ''}Endpoints · ${scope.length}`))
  const tested = scope.filter(ep => ep.seen != null), unseen = tested.filter(ep => ep.seen === 0)
  const routes = f.ids ? 0 : s.marks.route.filter(m => !f.app || m.top === f.app).length
  const facts = [
    api.traced && tested.length ? `${count(tested.length - unseen.length)} of ${count(tested.length)} seen in tests` : '',
    routes ? `${plural(routes, 'route')} marked in code, ${count(scope.length)} placed` : '',
  ].filter(Boolean).join(' · ')
  const bar = el('div', 'd-filters')
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Show')
  const chip = (label: string, on: boolean, next: ApiFilter, cls = '') => {
    const b = el('button', cls, label)
    b.setAttribute('aria-pressed', String(on))
    b.onclick = () => act.filter(next)
    return b
  }
  bar.append(chip(`All · ${scope.length}`, !f.method && !f.unseen, { ...f, method: null, unseen: false }))
  for (const [m, n] of methodCounts(scope)) bar.append(chip(`${m} · ${n}`, f.method === m, { ...f, method: f.method === m ? null : m }))
  if (unseen.length) bar.append(chip(`Unseen · ${unseen.length}`, !!f.unseen, { ...f, unseen: !f.unseen }, 'unseen'))
  const input = el('input')
  input.type = 'search'
  input.placeholder = 'Filter by path, handler or type'
  input.setAttribute('aria-label', 'Filter the endpoints')
  input.value = f.query ?? ''
  const box = el('section', 'd-api')
  const fill = () => {
    const shown = filterApi(api, { ...f, query: input.value })
    const groups = groupApi(shown, new Set(scope.map(ep => ep.app)).size > 1)
    const status = el('p', 'd-count', shown.length === scope.length ? `${groups.length} resource${groups.length === 1 ? '' : 's'}` : `${shown.length} of ${scope.length} shown`)
    status.setAttribute('role', 'status')
    const lists = groups.map(g => {
      const sec = el('section', 'd-group')
      sec.append(el('h3', '', `${g.title} · ${g.endpoints.length}`))
      const ul = el('ul')
      for (const ep of g.endpoints) ul.append(endpointRow(ep, () => act.endpoint(ep.id)))
      sec.append(ul)
      return sec
    })
    box.replaceChildren(status, ...(lists.length ? lists : [el('div', 'd-none', 'No endpoint matches')]))
  }
  input.oninput = () => { f.query = input.value; fill() }
  // Esc in the words clears them first, then puts the list down, as it does anywhere else in the panel.
  input.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return
    ev.preventDefault()
    if (input.value) { input.value = ''; f.query = ''; fill() } else act.close()
  })
  arrowKeys(box, 'button.d-ep')
  fill()
  panel.replaceChildren(head, ...(facts ? [el('p', 'd-rank', facts)] : []), bar, input, box)
  panel.hidden = false
}

/**
 * What can be done to a part from outside it, at the head of its panel: its endpoints (with how many
 * no test called), the endpoints a client part calls, and its scheduled jobs, each opening its list.
 * `ids`: only these endpoints (a component's, by the handlers inside it).
 */
export function surfaceBox(s: Surface, act: ApiActions & PanelActions, scope: { app?: string; ids?: string[]; label: string; calls?: string[]; pages?: { i: number; title: string }[] }): HTMLElement[] {
  const api = s.api
  const eps = api ? filterApi(api, { app: scope.app, ids: scope.ids }) : []
  const calls = api && scope.calls ? api.endpoints.filter(ep => (api.callers.get(ep.id) ?? []).some(c => scope.calls!.includes(c.top))) : []
  const marks = { route: s.marks.route.filter(m => !scope.app || m.top === scope.app), schedule: s.marks.schedule.filter(m => !scope.app || m.top === scope.app) }
  const clients = api ? clientParts(api) : new Set<string>()
  const jobs = scope.ids ? [] : marks.schedule.filter(m => !clients.has(m.top))
  const routesOnly = !eps.length && !scope.ids && marks.route.length > 0
  const pages = scope.pages ?? []
  if (!eps.length && !calls.length && !jobs.length && !routesOnly && !pages.length) return []
  const box = el('section', 'd-surface')
  box.append(el('h3', '', 'Surface'))
  const row = el('div', 'd-actions')
  const label = scope.ids ? scope.label : undefined
  if (eps.length) {
    const b = el('button', 'primary', `Endpoints · ${eps.length}`)
    b.onclick = () => act.list({ app: scope.app ?? null, ids: scope.ids, label })
    row.append(b)
    const unseen = eps.filter(ep => ep.seen === 0).length
    if (unseen) {
      const u = el('button', 'unseen', `Unseen · ${unseen}`)
      u.title = 'The endpoints the project’s own tests never called'
      u.onclick = () => act.list({ app: scope.app ?? null, ids: scope.ids, label, unseen: true })
      row.append(u)
    }
  }
  if (calls.length) {
    const b = el('button', '', `Calls ${plural(calls.length, 'endpoint')}`)
    b.onclick = () => act.list({ ids: calls.map(ep => ep.id), label: `Called by ${scope.label}` })
    row.append(b)
  }
  if (row.childElementCount) box.append(row)
  if (routesOnly) box.append(el('p', 'd-facts', `${plural(marks.route.length, 'route')} marked in code; this map has no Requests view to list them`))
  // A disclosure of short rows: a client's pages, a part's scheduled jobs.
  const fold = (title: string, rows: { text: string; title: string; run: () => void }[]) => {
    const toggle = el('button', 'd-more', `${title} · ${rows.length}`)
    toggle.setAttribute('aria-expanded', 'false')
    const ul = el('ul', 'd-jobs')
    ul.hidden = true
    for (const r of rows) { const li = el('li'), b = el('button', 'cite', r.text); b.title = r.title; b.onclick = r.run; li.append(b); ul.append(li) }
    toggle.onclick = () => { ul.hidden = !ul.hidden; toggle.setAttribute('aria-expanded', String(!ul.hidden)) }
    box.append(toggle, ul)
  }
  if (pages.length) fold('Pages', pages.map(p => ({ text: p.title, title: `${p.title}: select it`, run: () => act.go(p.i) })))
  if (jobs.length) fold('Scheduled jobs', jobs.map(j => ({ text: `${j.path.split('/').pop()}:${j.line}`, title: `${j.path}:${j.line}: open the code here`, run: () => act.openPath(j.path, j.line, -1) })))
  return [box]
}

/**
 * A file that handles requests says first what it serves: its routes, in the order they stand in
 * it, each opening that endpoint. Without a Requests model, the lines its routes are marked at.
 */
export function servesBox(s: Surface, path: string, act: ApiActions & PanelActions, near: number): HTMLElement[] {
  const eps = s.api ? servedBy(s.api, path) : []
  const marked = s.marks.route.filter(m => m.path === path)
  if (!eps.length && !marked.length) return []
  const box = el('section', 'd-rels d-serves')
  box.append(el('h3', '', `Serves · ${eps.length || marked.length}`))
  const ul = el('ul')
  if (eps.length) for (const ep of eps) ul.append(endpointRow(ep, () => act.endpoint(ep.id), [ep.handler!.line ? `line ${ep.handler!.line}` : ep.handler!.name, ep.returns ? `returns ${ep.returns}` : ''].filter(Boolean).join(' · ')))
  else for (const m of marked) {
    const li = el('li'), b = el('button', 'd-rel')
    b.append(el('i', '', '⇠'), el('b', '', `Route at line ${m.line}`))
    b.onclick = () => act.openPath(path, m.line, near)
    li.append(b)
    ul.append(li)
  }
  arrowKeys(ul)
  box.append(ul)
  return [box]
}

/**
 * What leads a card's panel about its surface: a file's Serves; a top-level part's endpoints,
 * calls and jobs; a component's endpoints (by the handlers inside it); the whole map's, at 0.
 */
export function surfaceLead(tree: Tree, i: number, surface: Surface, act: PanelActions): HTMLElement[] {
  const e = tree.els[i], file = e.metadata?.path
  if (file) return servesBox(surface, file, act, i)
  if (i === 0) return surfaceBox(surface, act, { label: e.title })
  if (!tree.children[i].length) return []
  const top = tree.parent[i] === 0
  const ids = top ? undefined : surface.requests ? endpointDescendants(tree, i) : endpointsUnder(tree, i, surface.api)
  // A client's pages: its files in a pages (screens, views, templates) folder.
  const pages: { i: number; title: string }[] = []
  if (top && surface.api && clientParts(surface.api).has(e.id)) {
    const walk = (n: number) => { const p = tree.els[n].metadata?.path; if (p && isPage(p)) pages.push({ i: n, title: tree.els[n].title }); for (const k of tree.children[n]) walk(k) }
    walk(i)
  }
  return top || ids?.length ? surfaceBox(surface, act, { app: top ? e.id : undefined, ids, label: e.title, calls: top ? [e.id] : undefined, pages }) : []
}

/** The ids of the endpoints whose handler is a file at or under element i. */
export function endpointsUnder(tree: Tree, i: number, api: Api | null): string[] {
  if (!api) return []
  const files = new Set<string>()
  const walk = (n: number) => { const p = tree.els[n].metadata?.path; if (p) files.add(p); for (const k of tree.children[n]) walk(k) }
  walk(i)
  return api.endpoints.filter(ep => ep.handler && files.has(ep.handler.path)).map(ep => ep.id)
}

/**
 * The tables tests saw that no store call on the code path names: a call named "kingdoms (JPA)"
 * or "reads kingdom_entity" covers kingdom_entity; market_offer_entity it does not.
 */
export function offPath(tables: string[], callTitles: string[]): string[] {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const said = callTitles.map(flat).join(' ')
  return tables.filter(t => !said.includes(flat(t.replace(/_(entity|table|tbl)$/i, ''))))
}

/** Whether a disclosure was left open, so a redraw keeps it. */
const disclosed = { steps: false }

/**
 * An endpoint told by its effect: what it takes, what it reads and writes, what it returns (the
 * type as written, generics and all), and who calls it, each from the map; the steps that do it are
 * one expand away. Tested tables and the store calls the code path reaches are kept apart, and a
 * line says when they differ.
 */
export function endpointEffects(tree: Tree, i: number, act: PanelActions, api: Api | null, steps: HTMLElement[]): HTMLElement[] {
  const e = tree.els[i], mr = endpointOf(e)!
  const ep = api?.endpoints.find(x => x.id === e.id) ?? null
  const kids = tree.children[i], role = (k: number) => stepRole(tree.els[k])
  const inside = (n: number) => n === i || tree.isAncestor(i, n)
  const out: HTMLElement[] = []
  const section = (cls: string, title: string) => { const s = el('section', `d-rels d-effect ${cls}`); s.append(el('h3', '', title)); out.push(s); return s }
  const rowBtn = (title: string, sub: string, go: (() => void) | null, glyph = '') => {
    const li = el('li')
    const b = el(go ? 'button' : 'div', 'd-rel')
    b.append(el('i', '', glyph), el('b', '', title), ...(sub ? [el('span', '', sub)] : []))
    if (go) (b as HTMLButtonElement).onclick = go
    li.append(b)
    return li
  }

  // Who handles it: opened where the handler is declared (found in its source when the map does not say).
  const first = kids.find(k => role(k) === 'step' && stepNumber(tree.els[k]) === 1) ?? kids.find(k => tree.els[k].metadata?.path)
  const handler = ep?.handler
  if (handler && first != null) {
    const p = el('p', 'd-handler')
    const b = el('button', 'cite', handler.name)
    b.title = `${handler.path}${handler.line ? `:${handler.line}` : ''}: read the handler`
    b.onclick = () => {
      if (handler.line) return act.read(first)
      void act.source(handler.path).then(src => act.openPath(handler.path, (src && declLine(src, handler.name.split('.').pop()!)) || 1, first))
    }
    p.append('Handled by ', b)
    out.push(p)
  }

  // What it takes: the path's parameters, and the types in the handler's parameter list, read from
  // its source (a type it returns can be taken too: an offer sent and sent back); the other types
  // it names are listed apart, not as taken.
  const returns = ep?.returns ?? ''
  const types = kids.filter(k => role(k) === 'type')
  const params = routeParams(ep?.route ?? mr.route)
  {
    const s = section('takes', 'Takes')
    const fill = (taken: Map<string, string> | null, failed = false) => {
      const ul = el('ul')
      for (const p of params) ul.append(rowBtn(p, 'in the path', null))
      for (const k of types) if (taken?.has(tree.els[k].title)) ul.append(rowBtn(tree.els[k].title, taken.get(tree.els[k].title)!, () => act.go(k)))
      // Not taken: what it names besides; before its parameters are read, the types it does not return.
      const rest = types.filter(k => (taken ? !taken.has(tree.els[k].title) : true) && !wordRe(tree.els[k].title).test(returns))
      s.querySelector('h3')!.textContent = taken ? `Takes · ${ul.childElementCount}` : 'Takes'
      const parts: HTMLElement[] = [ul.childElementCount ? ul : el('div', 'd-none', taken ? 'nothing: no path parameters, and no type of the map in its parameters' : 'no path parameters')]
      if (rest.length) {
        const also = el('ul')
        for (const k of rest) also.append(rowBtn(tree.els[k].title, taken ? 'named, not a parameter' : 'named by the handler', () => act.go(k)))
        parts.push(el('div', 'd-sub', taken ? 'Also names' : failed ? 'Names (its parameters could not be read)' : 'Names'), also)
      }
      s.replaceChildren(s.querySelector('h3')!, ...parts)
    }
    fill(null)
    if (handler && types.length) void act.source(handler.path).then(src => {
      const list = src ? handlerParams(src, handler.line, handler.name.split('.').pop()!) : null
      if (s.isConnected) fill(list == null ? null : takenTypes(list, types.map(k => tree.els[k].title)), list == null)
    })
  }

  // What it reads and writes: the tables the tests saw, and the store calls on the code path.
  {
    const tested = e.metadata?.tables ? tableRows(e.metadata.tables) : []
    const calls: { k: number; target: number }[] = []
    for (let k = 0; k < tree.rels.length; k += 2) {
      const a = tree.rels[k], b = tree.rels[k + 1]
      if (inside(a) && !inside(b) && tree.relKind[k >> 1] === 'runtime') calls.push({ k: k >> 1, target: b })
    }
    const s = section('data', `Reads and writes · ${tested.length || calls.length}`)
    if (tested.length) {
      const writes = tested.filter(r => r.ops !== 'reads'), reads = tested.filter(r => r.ops === 'reads')
      const ul = el('ul', 'd-table-rows')
      for (const r of [...writes, ...reads]) { const li = el('li', r.ops === 'reads' ? 'reads' : 'writes'); li.append(el('code', '', r.table), el('span', '', r.ops)); ul.append(li) }
      // A table written and read counts in both: "writes 4 tables, reads 4".
      const read = tested.filter(r => r.ops.split(', ').includes('reads')).length
      s.append(el('div', 'd-sub', `In tests: writes ${plural(writes.length, 'table')}, reads ${count(read)}`), ul)
    }
    if (calls.length) {
      s.append(el('div', 'd-sub', 'On the code path'))
      const ul = el('ul')
      for (const c of calls) {
        const src = tree.rels[c.k * 2]
        const li = rowBtn(tree.els[c.target].title, [tree.relTitles[c.k], `from ${tree.els[src].title}`].filter(Boolean).join(' · '), () => act.inspect(i, c.target), '⇢')
        const b = li.firstElementChild as HTMLElement
        if (tree.relSeen[c.k]) b.append(seenTag(tree.relSeen[c.k]))
        else if (tree.relTraceable[c.k]) b.append(el('em', 'd-seen-tag none', 'not seen in tests'))
        ul.append(li)
      }
      s.append(ul)
    }
    if (!tested.length && !calls.length) s.append(el('div', 'd-none', tree.traced && ep?.seen === 0 ? 'none known: no test called it and its code path reaches no store' : 'none found: its code path reaches no store'))
    // The two accounts differ: say which tables the tests saw that no store call on the path names,
    // rather than let one account pass for the other.
    const off = offPath(tested.map(r => r.table), calls.map(c => tree.relTitles[c.k]))
    if (tested.length && off.length) {
      const them = off.length === 1 ? 'it' : 'them'
      s.append(el('p', 'd-note', off.length === tested.length
        ? `No store call on the code path the map follows names the ${tested.length === 1 ? 'table' : 'tables'} the tests saw: the code that reaches ${them} was not followed.`
        : `${off.length} of the ${tested.length} tables the tests saw ${off.length === 1 ? 'is' : 'are'} not on the code path the map follows (${off.join(', ')}): the code that reaches ${them} was not followed.`))
    }
    else if (!tested.length && calls.length && tree.traced) s.append(el('p', 'd-note', ep?.seen === 0 ? 'No test called it: these store calls are read from code only.' : 'The tests recorded no table for it: these store calls are read from code only.'))
  }

  // What it returns: the response as written, and the statuses the tests saw.
  {
    const answers = kids.filter(k => role(k) === 'response' || role(k) === 'view')
    const s = section('returns', 'Returns')
    const ul = el('ul')
    for (const k of answers) {
      const m = tree.els[k].metadata ?? {}
      // The type as written; else what the map says it answers ("Renders findOwners"); else its name.
      const what = m.model || (role(k) === 'response' && returns) || tree.els[k].description.replace(/\.$/, '') || tree.els[k].title.replace(/^\d+ · /, '')
      ul.append(rowBtn(what, [m.answer === 'body' ? 'as the response body' : m.answer ?? '', role(k) === 'view' ? 'a view' : ''].filter(Boolean).join(' · '), () => act.go(k)))
    }
    if (!answers.length && returns) ul.append(rowBtn(returns, '', null))
    if (ul.childElementCount) s.append(ul)
    else s.append(el('div', 'd-none', 'not known from the code'))
    if (e.metadata?.statuses) s.append(el('div', 'd-sub', `Statuses in tests: ${e.metadata.statuses.replace(/×(\d+)/g, (_, n) => `×${count(+n)}`)}`))
  }

  // Who calls it.
  {
    const by = new Map<number, number[]>()
    for (let k = 0; k < tree.rels.length; k += 2) if (inside(tree.rels[k + 1]) && !inside(tree.rels[k])) by.set(tree.rels[k], [...(by.get(tree.rels[k]) ?? []), k >> 1])
    const s = section('callers', `Called by · ${by.size}`)
    const ul = el('ul')
    for (const [src, rels] of by) {
      const li = rowBtn(tree.els[src].title, [...new Set(rels.map(k => tree.relTitles[k]).filter(Boolean))].join(' · '), () => act.go(src), '←')
      const b = li.firstElementChild as HTMLElement
      const seen = rels.find(k => tree.relSeen[k]), unseen = rels.some(k => tree.relTraceable[k] && !tree.relSeen[k])
      if (seen != null) b.append(seenTag(tree.relSeen[seen]))
      else if (unseen) b.append(el('em', 'd-seen-tag none', 'not seen in tests'))
      else if (tree.traced && rels.some(k => tree.relKind[k] === 'runtime')) { const t = el('em', 'd-seen-tag outside', 'outside the trace'); t.title = 'The trace watched only the apps the tests ran; this caller is outside them'; b.append(t) }
      ul.append(li)
    }
    const none = el('div', 'd-none', 'no caller on this map')
    if (ul.childElementCount) s.append(ul)
    else s.append(none)
    // The pages whose code calls it, read from their source once it is here.
    void act.callingPages(e.id).then(pages => {
      if (!pages.length || !s.isConnected) return
      none.remove()
      const list = el('ul')
      for (const p of pages) list.append(rowBtn(p.title, 'its code calls this endpoint', () => act.part(p.id), '←'))
      s.querySelector('h3')!.textContent = `Called by · ${by.size + pages.length}`
      s.append(el('div', 'd-sub', `Pages · ${pages.length}`), list)
    })
  }

  // The steps that do it, one expand away.
  if (steps.length) {
    const n = kids.filter(k => role(k) === 'step').length
    const box = el('section', 'd-impl')
    const toggle = el('button', 'd-more', `Implementation steps · ${n}`)
    toggle.setAttribute('aria-expanded', String(disclosed.steps))
    const body = el('div')
    body.hidden = !disclosed.steps
    body.append(...steps)
    toggle.onclick = () => { disclosed.steps = !disclosed.steps; body.hidden = !disclosed.steps; toggle.setAttribute('aria-expanded', String(disclosed.steps)) }
    box.append(toggle, body)
    out.push(box)
  }
  return out
}

/**
 * A feature where the parts meet the surface: the pages that show it, the endpoints that serve it
 * with what each returns, the tables those touched in tests, and the parts that carry it. Rows in
 * this view go there; the rest cross to the view that has them.
 */
export function renderFeature(panel: HTMLElement, name: string, facts: ReturnType<typeof featureFacts>, titles: (id: string) => string, act: { part: (id: string) => void } & ApiActions) {
  panel.classList.remove('outline')
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', 'Feature'), el('h2', '', name))
  const parts: HTMLElement[] = []
  const list = (cls: string, title: string, ids: string[]) => {
    if (!ids.length) return
    const s = el('section', `d-rels ${cls}`)
    s.append(el('h3', '', `${title} · ${ids.length}`))
    const ul = el('ul')
    for (const id of ids) { const li = el('li'), b = el('button', 'd-rel'); b.append(el('i', '', ''), el('b', '', titles(id))); b.onclick = () => act.part(id); li.append(b); ul.append(li) }
    arrowKeys(ul)
    s.append(ul)
    parts.push(s)
  }
  list('d-pages', 'Pages', facts.pages)
  const endpoints = (cls: string, title: string, eps: Endpoint[], note = '') => {
    if (!eps.length) return
    const s = el('section', `d-rels d-serves ${cls}`)
    s.append(el('h3', '', `${title} · ${eps.length}`), ...(note ? [el('p', 'd-note', note)] : []))
    const ul = el('ul')
    for (const ep of eps) ul.append(endpointRow(ep, () => act.endpoint(ep.id)))
    arrowKeys(ul)
    s.append(ul)
    parts.push(s)
  }
  endpoints('', 'Endpoints', facts.endpoints)
  // A handler shared with other features: its endpoints are said apart, not claimed for this one.
  endpoints('d-shared', 'Its handlers also serve', facts.shared, 'These handlers carry other features too, and these routes do not name this one: which of them belong to it the map does not say.')
  if (facts.tables) {
    const rows = tableRows(facts.tables)
    const s = el('section', 'd-tables')
    s.append(el('h3', '', `Data its endpoints touched in tests · ${rows.length}`))
    const ul = el('ul')
    for (const r of rows) { const li = el('li', r.ops === 'reads' ? 'reads' : 'writes'); li.append(el('code', '', r.table), el('span', '', r.ops)); ul.append(li) }
    s.append(ul)
    parts.push(s)
  }
  list('d-parts', 'Parts that carry it', facts.parts)
  const hint = facts.endpoints.length || facts.pages.length ? [] : [el('p', 'd-hint', 'No page or endpoint of this map carries it.')]
  panel.replaceChildren(head, ...hint, ...parts, el('p', 'd-hint', 'Esc puts the feature down.'))
  panel.hidden = false
}
