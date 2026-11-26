// Folding what a project's own end-to-end tests executed (trace.mjs observe) into its models, so
// the viewer can tell what was seen running from what was only inferred from code. Request level:
// endpoints (by method and route), the classes spans name (handlers, repositories), and the tables
// SQL touched. What tests did not reach is said too: an endpoint no test called is "seen 0".
import { normalRoute } from './trace.mjs'

/** A class's file among the model's files: com.x.Foo (or com.x.Foo$Inner) is …/com/x/Foo.<ext>. */
export function classFiles(paths, classes) {
  const out = new Map()
  for (const c of classes) {
    const tail = `/${c.replace(/\$.*$/, '').replace(/\./g, '/')}.`
    const hit = paths.find(p => `/${p}`.includes(tail) && `/${p}`.lastIndexOf(tail) + tail.length === `/${p}`.lastIndexOf('.') + 1)
    if (hit) out.set(c, hit)
  }
  return out
}

/** "200 ×8 · 401 ×1" */
const statusText = s => Object.entries(s).map(([k, n]) => `${k} ×${n}`).join(' · ')
/** "kingdom_entity: SELECT, UPDATE · user_entity: SELECT" */
const tableText = t => Object.entries(t).map(([k, ops]) => `${k}: ${ops.join(', ')}`).join(' · ')
/** SQL's verbs as a store arrow says them. */
const VERB = { SELECT: 'reads', INSERT: 'inserts', UPDATE: 'updates', DELETE: 'deletes', MERGE: 'writes' }
/** What a request did to each table, in words: "updates kingdom · deletes offer · reads user". Writes lead. */
export function tableVerbs(tables) {
  const rank = v => (v === 'reads' ? 1 : 0)
  return Object.entries(tables)
    .map(([t, ops]) => ({ t, verbs: [...new Set(ops.map(o => VERB[o] ?? o.toLowerCase()))].sort((a, b) => rank(a) - rank(b)) }))
    .sort((a, b) => rank(a.verbs[0]) - rank(b.verbs[0]) || a.t.localeCompare(b.t))
    .map(({ t, verbs }) => `${verbs.join(' and ')} ${t}`)
    .join(' · ')
}

/**
 * Marks `model` (the architecture) and `requests` (the Requests view, or null) with `observed`.
 * Elements get metadata.seen (a count, as a string), endpoints also statuses and tables; relations
 * get `seen` (a count). A request that touched a store with no store link inferred from code gets
 * one, marked as seen only. Returns the coverage: endpoints seen of all.
 */
export function markObserved(model, requests, observed) {
  const classCount = new Map()
  for (const e of observed.endpoints) for (const [c, n] of Object.entries(e.code)) {
    const cls = c.slice(0, c.lastIndexOf('.'))
    classCount.set(cls, (classCount.get(cls) ?? 0) + n)
  }
  const tables = {}
  for (const e of observed.endpoints) for (const [t, ops] of Object.entries(e.tables)) tables[t] = [...new Set([...(tables[t] ?? []), ...ops])].sort()

  // The architecture: files whose classes ran, the runtime links they make, and the store they reach.
  const paths = model.elements.flatMap(e => (e.metadata?.path ? [e.metadata.path] : []))
  const files = classFiles(paths, [...classCount.keys()])
  const seenFile = new Map([...files].map(([c, p]) => [p, classCount.get(c)]))
  const byId = new Map(model.elements.map(e => [e.id, e]))
  for (const e of model.elements) if (e.metadata?.path && seenFile.has(e.metadata.path)) e.metadata.seen = String(seenFile.get(e.metadata.path))
  const stores = new Set()
  for (const r of model.relations) {
    const n = seenFile.get(byId.get(r.source)?.metadata?.path)
    if (r.kind === 'runtime' && n) { r.seen = n; if (byId.get(r.target)?.kind === 'database') stores.add(r.target) }
  }
  // One store reached: every table seen is its. More than one: which table lives where is not known here.
  if (stores.size === 1 && Object.keys(tables).length) { const s = byId.get([...stores][0]); s.metadata = { ...s.metadata, tables: tableText(tables) } }

  let seen = 0, total = 0
  if (requests) {
    const els = new Map(requests.elements.map(e => [e.id, e]))
    const obs = new Map(observed.endpoints.map(e => [`${e.method} ${e.route}`, e]))
    const db = requests.elements.find(e => e.kind === 'database' && !e.parent)
    const apps = new Map()
    for (const ep of requests.elements.filter(e => e.metadata?.method && e.metadata?.route)) {
      total++
      const o = obs.get(`${ep.metadata.method} ${normalRoute(ep.metadata.route)}`)
      ep.metadata.seen = String(o?.count ?? 0)
      const app = ep.id.split('.')[0]
      const a = apps.get(app) ?? { seen: 0, total: 0 }
      a.total++
      if (!o) { apps.set(app, a); continue }
      seen++
      a.seen++
      apps.set(app, a)
      ep.metadata.statuses = statusText(o.statuses)
      if (Object.keys(o.tables).length) ep.metadata.tables = tableText(o.tables)
      // Its steps whose classes ran in this request, each with its own count: the spans of its class's
      // methods, not the endpoint's requests (a request can stop before it reaches a later step).
      const perClass = new Map()
      for (const [c, n] of Object.entries(o.code)) { const cls = c.slice(0, c.lastIndexOf('.')); perClass.set(cls, (perClass.get(cls) ?? 0) + n) }
      const ran = classFiles(requests.elements.filter(s => s.parent === ep.id && s.metadata?.path).map(s => s.metadata.path), [...perClass.keys()])
      const ranCount = new Map([...ran].map(([c, p]) => [p, perClass.get(c)]))
      const steps = requests.elements.filter(s => s.parent === ep.id)
      for (const s of steps) if (s.metadata?.path && ranCount.has(s.metadata.path)) s.metadata.seen = String(ranCount.get(s.metadata.path))
      // Its store links are seen when it touched tables; none inferred but tables touched: add one.
      const mine = new Set(steps.map(s => s.id))
      const toStore = requests.relations.filter(r => mine.has(r.source) && els.get(r.target)?.kind === 'database')
      if (!Object.keys(o.tables).length) continue
      for (const r of toStore) r.seen = o.count
      const handler = steps.find(s => s.metadata?.role === 'step' && s.metadata?.step === '1')
      if (!toStore.length && db && handler) {
        requests.relations.push({ source: handler.id, target: db.id, title: tableVerbs(o.tables), kind: 'runtime', seen: o.count })
      }
    }
    for (const [app, a] of apps) { const e = els.get(app); if (e) e.metadata = { ...e.metadata, seen: `${a.seen}/${a.total}` } }
  }
  return { seen, total }
}
