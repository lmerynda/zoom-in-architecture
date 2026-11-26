// What changed between two uploads of one map, in the terms a reader asks about: endpoints that
// came or went, crossings between processes that came or went, and dependencies between components
// that came or went. The store works it out at upload, against the previous upload, and writes it
// into each model; the viewer only shows it.
import { normalRoute } from './trace.mjs'

/**
 * A model's parent links as a walk up from an element: its id, its parent's, and so on to the top.
 * A parent loop in a stored model ends the walk instead of running forever.
 */
const ancestry = model => {
  const byId = new Map(model.elements.map(e => [e.id, e]))
  return id => {
    const out = []
    for (let e = byId.get(id); e && !out.includes(e.id); e = byId.get(e.parent)) out.push(e.id)
    return out
  }
}

/**
 * The endpoints a requests model has, keyed by the process that serves them and their method and
 * route ("backend GET /kingdom/{id}"): its element's id, its title, its handler's file (step 1), so
 * the architecture can point at the file that serves it, and its ancestors, nearest first.
 */
export function endpointsOf(requests) {
  const out = new Map()
  if (!requests) return out
  const up = ancestry(requests)
  const handler = new Map(requests.elements.filter(e => e.metadata?.role === 'step' && e.metadata?.step === '1').map(e => [e.parent, e.metadata.path]))
  for (const e of requests.elements) {
    if (!e.metadata?.method || !e.metadata?.route) continue
    const chain = up(e.id)
    out.set(`${chain[chain.length - 1]} ${e.metadata.method} ${normalRoute(e.metadata.route)}`, { id: e.id, title: e.title, path: handler.get(e.id) ?? null, parents: chain.slice(1) })
  }
  return out
}

/**
 * A model's arrows rolled up two ways: crossings between its top-level parts (processes, stores,
 * people) and dependencies between components (the node that holds a file, or the node itself).
 * Type-only imports are left out, as the map leaves them out. Each pair is keyed by ids, with the
 * titles to name it by once it is gone.
 */
export function pairsOf(model) {
  const byId = new Map(model.elements.map(e => [e.id, e]))
  const up = ancestry(model)
  const top = id => up(id).pop() ?? null
  const component = id => { const e = byId.get(id); return e?.metadata?.path ? e.parent : e?.id ?? null }
  const under = (a, b) => up(b).includes(a)
  const title = id => byId.get(id)?.title ?? id
  const crossings = new Map(), dependencies = new Map()
  for (const r of model.relations) {
    if (r.kind === 'types' || !byId.has(r.source) || !byId.has(r.target)) continue
    const ts = top(r.source), tt = top(r.target)
    if (ts !== tt) crossings.set(`${ts}>${tt}`, { from: ts, to: tt, title: `${title(ts)} → ${title(tt)}` })
    const cs = component(r.source), ct = component(r.target)
    // Both ends top-level: that is a crossing, said once there.
    if (!cs || !ct || cs === ct || under(cs, ct) || under(ct, cs) || (!byId.get(cs).parent && !byId.get(ct).parent)) continue
    dependencies.set(`${cs}>${ct}`, { from: cs, to: ct, title: `${title(cs)} → ${title(ct)}` })
  }
  return { crossings, dependencies }
}

const diff = (before, after) => ({
  added: [...after].filter(([k]) => !before.has(k)).map(([, v]) => v),
  removed: [...before].filter(([k]) => !after.has(k)).map(([, v]) => v),
})

/**
 * What changed from `prev` to `next` (each { model, requests }), for one view: `view` is
 * 'architecture' or 'requests'. Endpoints are compared by method and route; an added one names the
 * card that stands for it in this view (the endpoint itself, or in the architecture the file that
 * serves it). Crossings come from this view's own model; dependencies between components from the
 * architecture only (the requests view's components are endpoints).
 */
export function changesBetween(prev, next, view) {
  const model = view === 'requests' ? next.requests : next.model, before = view === 'requests' ? prev.requests : prev.model
  const files = new Map(next.model.elements.filter(e => e.metadata?.path).map(e => [e.metadata.path, e.id]))
  const eps = diff(endpointsOf(prev.requests), endpointsOf(next.requests))
  const at = e => (view === 'requests' ? e.id : files.get(e.path) ?? null)
  // A removed endpoint is marked where it was: its handler's file, or the nearest of its parents still there.
  const ids = new Set((view === 'requests' ? next.requests?.elements ?? [] : []).map(e => e.id))
  const was = e => (view === 'requests' ? e.parents.find(p => ids.has(p)) ?? null : files.get(e.path) ?? null)
  const none = { elements: [], relations: [] }, a = pairsOf(before ?? none), b = pairsOf(model ?? none)
  return {
    endpoints: { added: eps.added.map(e => ({ title: e.title, at: at(e) })), removed: eps.removed.map(e => ({ title: e.title, at: was(e) })) },
    crossings: diff(a.crossings, b.crossings),
    dependencies: view === 'requests' ? { added: [], removed: [] } : diff(a.dependencies, b.dependencies),
  }
}

/** How many things a change list names. */
export const changeCount = c => (c ? ['endpoints', 'crossings', 'dependencies'].reduce((n, k) => n + c[k].added.length + c[k].removed.length, 0) : 0)

/**
 * Whether two uploads differ in anything the marks are about. An upload that changes none of it
 * (a re-publish, a new trace, an edit inside a file) keeps the earlier one as the base, so its
 * marks survive.
 */
export function sameShape(prev, next) {
  return changeCount(changesBetween(prev, next, 'architecture')) === 0 && changeCount(changesBetween(prev, next, 'requests')) === 0
}
