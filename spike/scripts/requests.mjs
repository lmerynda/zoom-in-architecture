// The Requests view of a published map: the edge of each backend and what happens behind it.
// The landscape holds who calls the backend, the backend, and the stores and services its
// requests reach. Inside the backend sit its route groups, inside a group its endpoints, and
// inside an endpoint the request's path as numbered steps: the handler, the files it uses, down to
// the ones that reach a store, and the response. Built from code (routes.mjs) and the map's
// placement and links; the agent writes nothing for it.
import { posix } from 'node:path'
import { endpoints } from './routes.mjs'

const CODE = { color: 'sky', shape: 'rectangle' }
const RESPONSE = { color: 'green', shape: 'rectangle' }
const TYPE = { color: 'gray', shape: 'rectangle' }
const stem = p => posix.basename(p).replace(/\.[^.]+$/, '')
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root'

/** One way an endpoint answers, in words: "renders owners/ownersList", "redirects to /owners/{id}". */
const said = r => r.kind === 'view' ? `renders ${r.name}` : r.kind === 'redirect' ? `redirects to ${r.redirect}` : r.model ? `returns ${r.model} as JSON` : r.json ? 'returns JSON' : 'returns what the handler returns'
/** What the endpoint answers with, in words: each of its answers. */
const answer = ep => ep.responses.map(said).join(', or ')
const sentence = s => `${s[0].toUpperCase()}${s.slice(1)}.`

/**
 * Groups of endpoints that act on the same thing, read from the words of their route names at
 * `depth`: send-attack and withdraw-attack share "attack", buy-land and land-quote share "land".
 * A word that only ever leads a name (send, add, build) is the action, so it never groups. Words
 * held by the same endpoints read as one label ("special building"). Larger groups take their
 * endpoints first; a group needs two endpoints and fewer than all of them.
 */
export function objectWords(list, depth) {
  const wordsOf = e => {
    const s = e.path.split('/').filter(Boolean)[depth]
    if (!s || /^[{:]/.test(s)) return []
    return s.split(/[-_.]|(?<=[a-z0-9])(?=[A-Z])/).map(w => w.toLowerCase()).filter(Boolean)
  }
  const names = new Map(list.map(e => [e, wordsOf(e)]))
  const holders = new Map()
  for (const [e, ws] of names) ws.forEach((w, i) => {
    const h = holders.get(w) ?? { eps: new Set(), object: false, at: holders.size }
    h.eps.add(e)
    h.object ||= i > 0
    holders.set(w, h)
  })
  // Words held by exactly the same endpoints form one label, in the order a name spells them.
  const labels = new Map()
  for (const [w, h] of holders) {
    if (!h.object || h.eps.size < 2 || h.eps.size >= list.length) continue
    const key = list.filter(e => h.eps.has(e)).map(e => list.indexOf(e)).join(',')
    labels.set(key, { words: [...(labels.get(key)?.words ?? []), w], eps: [...h.eps], at: Math.min(labels.get(key)?.at ?? Infinity, h.at) })
  }
  const order = [...labels.values()].map(l => {
    const name = names.get(l.eps[0])
    return { ...l, label: [...l.words].sort((a, b) => name.indexOf(a) - name.indexOf(b)).join(' ') }
  }).sort((a, b) => b.eps.length - a.eps.length || a.at - b.at)
  const used = new Set(), out = []
  for (const l of order) {
    const free = list.filter(e => l.eps.includes(e) && !used.has(e))
    if (free.length < 2) continue
    free.forEach(e => used.add(e))
    out.push([l.label, free])
  }
  // Read in the order the routes first name them.
  return out.sort((a, b) => list.indexOf(a[1][0]) - list.indexOf(b[1][0]))
}

/**
 * The Requests model for `model` (built by map.mjs from `graph` and `map`), or null when the code
 * declares no endpoints.
 */
export function buildRequests(graph, map, model) {
  const eps = endpoints(graph)
  if (!eps.length) return null
  const els = new Map(model.elements.map(e => [e.id, e]))
  const fileEl = new Map(model.elements.filter(e => e.metadata?.path).map(e => [e.metadata.path, e]))
  const top = id => id.split('.')[0]
  const appOf = path => top(fileEl.get(path)?.parent ?? '')
  const copy = (e, extra = {}) => ({ ...e, ...extra, features: e.features ?? [], tags: e.tags ?? [], metadata: { ...e.metadata } })

  const elements = [], relations = []
  const landscape = new Map()
  const add = id => { if (!landscape.has(id) && els.has(id)) landscape.set(id, copy(els.get(id), { parent: null })) }
  // Links of the map, by the file or node they start from, with the built relation that proves them.
  const proven = new Map(model.relations.filter(r => r.evidence).map(r => [`${r.source}>${r.target}`, r]))
  const linksFrom = new Map()
  for (const l of map.links ?? []) {
    const from = fileEl.has(l.from) ? l.from : null
    if (from) linksFrom.set(from, [...(linksFrom.get(from) ?? []), l])
  }

  // Callers first: whoever the map links into an app that serves endpoints.
  const apps = [...new Set(eps.map(e => appOf(e.file)).filter(Boolean))]
  const inApp = (end, app) => end === app || end.startsWith(`${app}.`) || appOf(end) === app
  const callers = []
  for (const l of map.links ?? []) {
    const app = apps.find(a => inApp(l.to, a))
    const from = fileEl.has(l.from) ? appOf(l.from) : top(l.from)
    if (app && from && from !== app) callers.push({ link: l, app, from })
  }
  for (const c of callers) add(c.from)
  for (const app of apps) add(app)

  for (const app of apps) {
    const mine = eps.filter(e => appOf(e.file) === app)
    // Groups: the first path segment below what every endpoint of the app shares (/api/v1).
    const segs = mine.map(e => e.path.split('/').filter(Boolean))
    let common = 0
    // A root route (GET /, a health check) shares nothing, so it does not count against the others.
    const deep = segs.filter(s => s.length > 0)
    while (deep.length && deep.every(s => s.length > common + 1 && s[common] === deep[0][common] && !s[common].startsWith('{') && !s[common].startsWith(':'))) common++
    const groups = new Map()
    for (const [k, e] of mine.entries()) {
      const head = segs[k].slice(0, common + 1)
      const key = `/${head.join('/')}`.replace(/\.\w+$/, '')
      groups.set(key, [...(groups.get(key) ?? []), e])
    }
    const group = (gid, parent, key, list) => {
      const handlers = [...new Set(list.map(e => stem(e.file)))]
      elements.push({ id: gid, parent, title: key, kind: 'component', description: `${list.length} endpoint${list.length > 1 ? 's' : ''}, handled in ${handlers.join(', ')}`, technology: '', tags: [], features: [], color: 'indigo', shape: 'rectangle', metadata: {} })
    }
    // A group of more than 9 endpoints splits by the next path segment, so no card crowds; what is
    // still crowded then groups by the things its routes act on (objectWords).
    const place = (parent, prefix, depth, list) => {
      const subs = [], words = []
      if (list.length > 9) {
        const by = new Map()
        for (const e of list) { const s = e.path.split('/').filter(Boolean)[depth]; if (s !== undefined) by.set(s, [...(by.get(s) ?? []), e]) }
        for (const [s, sub] of by) if (sub.length >= 3 && sub.length < list.length) subs.push([s, sub])
        const rest = list.filter(e => !subs.some(([, sub]) => sub.includes(e)))
        if (rest.length > 9) words.push(...objectWords(rest, depth))
      }
      // The group's own endpoints first, then its sub-groups.
      const taken = [...subs, ...words].flatMap(([, sub]) => sub)
      const own = list.filter(e => !taken.includes(e))
      own.forEach((e, n) => endpoint(e, `${parent}.e${n + 1}`, parent))
      for (const [s, sub] of subs) {
        const key = `${prefix === '/' ? '' : prefix}/${s}`, gid = `${parent}.${slug(s)}`
        group(gid, parent, key, sub)
        place(gid, key, depth + 1, sub)
      }
      // A word group keeps its parent's path, so its endpoints read as siblings of the parent's own.
      for (const [label, sub] of words) {
        let gid = `${parent}.${slug(label)}`
        while (elements.some(x => x.id === gid)) gid += '-words'
        group(gid, parent, `${prefix} · ${label}`, sub)
        place(gid, prefix, depth, sub)
      }
    }
    // An endpoint's title is its method and full path, always; the viewer fits it to the card. Both
    // are in its metadata too (method, route).
    const endpoint = (e, eid, gid) => {
        const handler = `${stem(e.file)}${e.name ? `.${e.name}` : ''}`
        elements.push({ id: eid, parent: gid, title: `${e.method} ${e.path}`, kind: 'component', description: `${e.method} ${e.path}: ${handler} ${answer(e)}.`, technology: '', tags: [], features: [], color: 'indigo', shape: 'rectangle', metadata: { method: e.method, route: e.path } })
        // The request's path, in order: handler, the files it uses, and the view it renders when that
        // is its one answer. A handler that can answer more than one way branches: each view it may
        // render, and each answer, is a card of its own off the step that gives it, not a next step.
        const views = e.responses.filter(r => r.kind === 'view').map(r => r.view)
        const branches = e.responses.length > 1
        const steps = branches ? e.steps : [...e.steps, ...views]
        const sid = new Map()
        // Two files of one name (users/models.go, articles/models.go) are told apart by their folder.
        const shown = [...steps, ...e.types, ...(branches ? views : [])]
        const name = p => shown.some(q => q !== p && stem(q) === stem(p)) ? `${posix.basename(posix.dirname(p))}/${stem(p)}` : stem(p)
        steps.forEach((p, k) => {
          const base = fileEl.get(p)
          if (!base) return
          const id = `${eid}.s${k + 1}`
          sid.set(p, id)
          // The handler leads with its method, the one thing that differs between endpoints of one
          // controller; its class is the line below, so a cut title never loses the method.
          const title = `${k + 1} · ${k === 0 ? (e.name ? `${e.name}()` : stem(p)) : name(p)}`
          const technology = k === 0 && e.name ? stem(p) : base.technology
          // The handler's card marks its route line when the route sits in its file. Every card names
          // the lines it is about (`span`), so its code opens exactly there.
          const marks = k === 0 && e.routeFile === p ? [`${e.line}:route`, ...(base.metadata.marks ?? '').split(' ').filter(m => m && !m.startsWith(`${e.line}:`))].join(' ') : base.metadata.marks
          elements.push({ ...copy(base), id, parent: eid, title, technology, ...CODE, metadata: { ...base.metadata, marks, role: 'step', step: String(k + 1), span: e.spans[p] } })
        })
        // The types the handler only names (what it takes and gives back) do not run in sequence:
        // unnumbered cards beside the path, each hanging off the handler.
        e.types.forEach((p, k) => {
          const base = fileEl.get(p)
          if (!base) return
          const id = `${eid}.t${k + 1}`
          sid.set(p, id)
          elements.push({ ...copy(base), id, parent: eid, title: name(p), ...TYPE, metadata: { ...base.metadata, role: 'type', span: e.spans[p] } })
        })
        if (branches) views.forEach((p, k) => {
          const base = fileEl.get(p)
          if (!base) return
          const id = `${eid}.v${k + 1}`
          sid.set(p, id)
          elements.push({ ...copy(base), id, parent: eid, title: name(p), ...CODE, metadata: { ...base.metadata, role: 'view', span: e.spans[p] } })
        })
        for (const r of graph.edges) if (!r.types && sid.has(r.from) && sid.has(r.to)) relations.push({ source: sid.get(r.from), target: sid.get(r.to), title: r.names.length > 3 ? `${r.names.slice(0, 3).join(', ')} +${r.names.length - 3}` : r.names.join(', ') })
        // Back out: the page it renders, or the handler's own answer (a redirect, a body). One answer
        // ends the numbered path; each of several is a Response card of its own.
        e.responses.forEach((r, k) => {
          const rid = branches ? `${eid}.response-${k + 1}` : `${eid}.response`
          const title = branches ? `Response · ${r.kind === 'redirect' ? `redirect ${r.redirect}` : said(r)}` : `${steps.length + 1} · Response`
          const metadata = { role: 'response', answer: r.kind, ...(r.kind === 'view' ? { view: r.name } : {}), ...(r.redirect ? { redirect: r.redirect } : {}), ...(r.model ? { model: r.model } : {}) }
          elements.push({ id: rid, parent: eid, title, kind: 'component', description: sentence(said(r)), technology: '', tags: [], features: [], ...RESPONSE, metadata })
          const from = r.kind === 'view' ? sid.get(r.view) : sid.get(e.file)
          if (from) relations.push({ source: from, target: rid, title: r.kind === 'view' ? 'HTML page' : r.kind === 'redirect' ? 'redirect' : r.model ?? (r.json ? 'JSON' : 'returns') })
        })
        // The handler renders each view it may answer with.
        if (branches) for (const p of views) if (sid.has(p) && !relations.some(x => x.source === sid.get(e.file) && x.target === sid.get(p))) relations.push({ source: sid.get(e.file), target: sid.get(p), title: 'renders' })
        // Out to the stores and services: the map's own links from these files, with their evidence.
        for (const p of steps) for (const l of linksFrom.get(p) ?? []) {
          const to = fileEl.has(l.to) ? top(fileEl.get(l.to).parent) : top(l.to)
          if (to === app || !els.has(to)) continue
          add(to)
          const built = proven.get(`${fileEl.get(p).id}>${fileEl.has(l.to) ? fileEl.get(l.to).id : l.to}`)
          relations.push({ source: sid.get(p), target: to, title: l.title ?? '', ...(built ? { evidence: built.evidence } : {}) })
        }
        // In from the callers: a link that lands on this handler's file, or on a part of the app that
        // holds it. A link to the app as a whole names no endpoint, so it reaches the app once (below).
        for (const c of callers) {
          if (c.app !== app || c.link.to === app) continue
          const to = c.link.to, under = fileEl.get(e.file)?.parent ?? ''
          if (fileEl.has(to) ? to === e.file : under === to || under.startsWith(`${to}.`)) relations.push({ source: c.from, target: fileEl.has(to) ? sid.get(e.file) : eid, title: c.link.title ?? '' })
        }
    }
    for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      const gid = `${app}.${slug(key)}`
      group(gid, app, key, list)
      place(gid, key, common + 1, list)
    }
    for (const c of callers) if (c.app === app && c.link.to === app) relations.push({ source: c.from, target: app, title: c.link.title ?? '' })
  }
  // Callers, then the backends, then the stores they reach: the request's direction, left to right.
  const rank = id => { const e = els.get(id); return callers.some(c => c.from === id) ? 0 : apps.includes(id) ? 1 : ['database', 'queue', 'external'].includes(e?.kind) ? 2 : 3 }
  const first = [...landscape.values()].sort((a, b) => rank(a.id) - rank(b.id))
  const unique = new Map(relations.map(r => [`${r.source}>${r.target}`, r]))
  return { name: `${model.name}.requests`, title: `${model.title} · requests`, view: 'requests', elements: [...first, ...elements], relations: [...unique.values()] }
}
