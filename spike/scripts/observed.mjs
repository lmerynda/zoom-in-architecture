// Folding what a project's own end-to-end tests executed (trace.mjs observe) into its models, so
// the viewer can tell what was seen running from what was only inferred from code. Request level:
// endpoints (by method and route), the classes spans name (handlers, repositories), and the tables
// SQL touched. What tests did not reach is said too: an endpoint no test called is "seen 0".
import { posix } from 'node:path'
import { javaCode, normalRoute } from './trace.mjs'

/**
 * Java source with its Unicode escapes read (A is A), as the compiler reads them before anything
 * else. An escaped line break stays escaped, so every line keeps its number.
 */
const unescapeJava = text => text.replace(/(?<!\\)((?:\\\\)*)\\u+([0-9a-fA-F]{4})/g, (m, run, hex) => (/^000[aAdD]$/.test(hex) ? m : run + String.fromCharCode(parseInt(hex, 16))))

/** A Java identifier's characters (JLS 3.8): letters, currency signs, connectors, then also digits and combining marks. */
const ID_START = '\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}', ID_PART = `${ID_START}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Cf}`
const TYPE_DECL = new RegExp(`(?<![${ID_PART}])(?:class|interface|enum|record)\\s+([${ID_START}][${ID_PART}]*)[^;{}]*$`, 'u')

/** The name a "{" at i opens a type of, from the declaration before it (back to the last ";", "{" or "}" outside parentheses), or null. */
function typeAt(code, i) {
  let j = i - 1
  for (let depth = 0; j >= 0; j--) {
    const c = code[j]
    if (c === ')') depth++
    else if (c === '(') { if (!depth) break; depth-- }
    else if (!depth && (c === ';' || c === '{' || c === '}')) break
  }
  // What is in parentheses (annotations' values, a record's components) is never the declaration.
  let depth = 0
  const head = code.slice(j + 1, i).split('').map(c => { if (c === '(') depth++; const out = depth ? ' ' : c; if (c === ')') depth--; return out }).join('')
  return TYPE_DECL.exec(head)?.[1] ?? null
}

/**
 * The types a Java source declares, from its code with escapes read and comments and strings
 * blanked: its package and each type with its name in the file ("Offer.Builder"), its binary name
 * as the JVM names it ("Offer$Builder"), and where its body opens and closes. Top-level and member
 * types; a local or anonymous class, in a method or an initializer, is not one.
 */
function javaTypes(code) {
  const pkg = /^\s*package\s+([^;]+);/m.exec(code)?.[1].replace(/\s+/g, '') ?? ''
  const types = [], open = []
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') {
      // A type is declared at the top or straight in a type's body.
      const parent = open.length ? open[open.length - 1] : { name: '', binary: '' }
      const own = parent.name !== null ? typeAt(code, i) : null
      const block = own
        ? { name: parent.name ? `${parent.name}.${own}` : own, binary: parent.binary ? `${parent.binary}$${own}` : own, open: i, close: code.length }
        : { name: null, binary: null, open: i, close: code.length }
      open.push(block)
      if (own) types.push(block)
    } else if (code[i] === '}' && open.length) open.pop().close = i
  }
  return { pkg, types }
}

/** A Java source's code as javaTypes and placeTree read it: escapes read, comments and strings blanked. */
const javaRead = text => javaCode(unescapeJava(text))

/**
 * The types the Java files of `texts` ({ path: source }) declare: a Map of each type's full name to
 * every file that declares it (one, unless two modules share a package, or a top-level class's name
 * with a "$" is another's member type). A member type is there under its binary name, as the agent
 * names it ('com.x.Foo$Inner'), and its name in the source ('com.x.Foo.Inner'). Classes, interfaces,
 * enums, records and annotations, package-private ones too. Only Java: the Java agent's spans name no
 * other language's code, so a polyglot model's shop/Order.py or Order.cs never takes shop.Order's calls.
 */
export function declaredTypes(texts) {
  const out = new Map()
  const put = (name, path) => out.set(name, [...new Set([...(out.get(name) ?? []), path])].sort())
  for (const [path, text] of Object.entries(texts)) {
    if (!path.endsWith('.java')) continue
    const { pkg, types } = javaTypes(javaRead(text))
    const full = n => (pkg ? `${pkg}.${n}` : n)
    for (const t of types) { put(full(t.binary), path); if (t.name !== t.binary) put(full(t.name), path) }
  }
  return out
}

/**
 * Each class's file, among `types` (declaredTypes): the file that declares a type of that very name.
 * The agent names an anonymous or local class com.x.Foo$1 or com.x.Foo$1Local, a lambda
 * com.x.Foo$$Lambda/…, a proxy com.x.Foo$$SpringCGLIB$$0: with no type of its name, it is cut at
 * its "$"s from the end until one is declared; a "$" with a dot after it is in a package's name,
 * never cut. A class no file declares (a library's), or two files do, has none: which file ran is
 * not known.
 */
export function classFiles(types, classes) {
  const out = new Map()
  for (const c of classes) {
    for (let k = c.length; k > 0; k = c.lastIndexOf('$', k - 1)) {
      if (c.slice(k).includes('.')) break
      const hits = types.get(c.slice(0, k))
      if (!hits) continue
      if (hits.length === 1) out.set(c, hits[0])
      break
    }
  }
  return out
}

/**
 * Calls into each file's code, from `codeCalls` (trace.mjs: each class's spans by the class of the
 * nearest span of code above them) and `fileOf` (classFiles). What is counted is spans, so only what
 * the agent makes a span for: a span naming one of the file's classes whose nearest span of code
 * above is not of that file, either none (the request itself, '') or another file's or a library's.
 * One method of the file calling another, its nested and anonymous classes, and the agent's
 * controller span over the method's own span are one call, not more. The agent's spans start where
 * the call is made: a controller's as Spring hands the request to it (a request refused while its
 * arguments are read still counts), a Spring Data repository's at the interface, whose methods the
 * library runs. A call back into the file through code with no span of its own is inside the first.
 * Returns path → calls; a file nothing called is not in it.
 */
export function callsInto(codeCalls, fileOf) {
  const out = new Map()
  for (const [cls, by] of Object.entries(codeCalls)) {
    const path = fileOf.get(cls)
    if (!path) continue
    for (const [caller, n] of Object.entries(by)) if (fileOf.get(caller) !== path) out.set(path, (out.get(path) ?? 0) + n)
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
 * Elements get metadata.seen (a count, as a string): an endpoint its requests (with statuses and
 * tables), a file the calls into its code in all requests (callsInto), a step of a request the calls
 * into its file in that endpoint's requests. A runtime relation gets `seen`, a count of what the
 * trace measured near it, never of calls across that one link (the trace does not count those),
 * and `seenOf`, which count it is: `code` (the calls into its source file's code) or `requests` (the
 * requests of the endpoint it serves; a store arrow in the Requests view then also carries
 * `tables`, what those requests did to which tables). A request that touched a store with no store
 * link inferred from code gets one, `origin: 'trace'`: the map has no such link. `types` are the
 * model's Java declarations (declaredTypes). Returns the coverage: endpoints seen of all.
 */
export function markObserved(model, requests, observed, types) {
  if (observed.endpoints.some(e => !e.codeCalls)) throw new Error('this trace was summed before calls into code were counted by their caller (it has no codeCalls): run zoom trace again')
  const tables = {}
  for (const e of observed.endpoints) for (const [t, ops] of Object.entries(e.tables)) tables[t] = [...new Set([...(tables[t] ?? []), ...ops])].sort()
  // One file for each class, callers too.
  const classes = new Set()
  for (const e of observed.endpoints) for (const [c, by] of Object.entries(e.codeCalls)) { classes.add(c); for (const b of Object.keys(by)) if (b) classes.add(b) }
  const fileOf = classFiles(types, [...classes])

  // The architecture: files whose code was called, the runtime links they make, and the store they reach.
  const seenFile = new Map()
  for (const e of observed.endpoints) for (const [p, n] of callsInto(e.codeCalls, fileOf)) seenFile.set(p, (seenFile.get(p) ?? 0) + n)
  const byId = new Map(model.elements.map(e => [e.id, e]))
  for (const e of model.elements) if (e.metadata?.path && seenFile.has(e.metadata.path)) e.metadata.seen = String(seenFile.get(e.metadata.path))
  const stores = new Set()
  for (const r of model.relations) {
    const n = seenFile.get(byId.get(r.source)?.metadata?.path)
    if (r.kind === 'runtime' && n) { r.seen = n; r.seenOf = 'code'; if (byId.get(r.target)?.kind === 'database') stores.add(r.target) }
  }
  // One store reached: every table seen is its. More than one: which table lives where is not known here.
  if (stores.size === 1 && Object.keys(tables).length) { const s = byId.get([...stores][0]); s.metadata = { ...s.metadata, tables: tableText(tables) } }

  let seen = 0, total = 0
  if (requests) {
    const els = new Map(requests.elements.map(e => [e.id, e]))
    const obs = new Map(observed.endpoints.map(e => [`${e.method} ${e.route}`, e]))
    // The trace names tables, not which database holds them: with one store they are its; with more, no
    // store link is given tables or added (the endpoint keeps its tables either way).
    const dbs = requests.elements.filter(e => e.kind === 'database' && !e.parent)
    const db = dbs.length === 1 ? dbs[0] : null
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
      // Its steps whose code was called in this endpoint's requests, each with its own count: the calls
      // into its file, not the endpoint's requests (a request can stop before it reaches a later step).
      const ranCount = callsInto(o.codeCalls, fileOf)
      const steps = requests.elements.filter(s => s.parent === ep.id)
      for (const s of steps) if (s.metadata?.path && ranCount.has(s.metadata.path)) s.metadata.seen = String(ranCount.get(s.metadata.path))
      // Its store links are seen when it touched tables; none inferred but tables touched: add one.
      const mine = new Set(steps.map(s => s.id))
      const toStore = requests.relations.filter(r => mine.has(r.source) && els.get(r.target)?.kind === 'database')
      if (!Object.keys(o.tables).length) continue
      for (const r of toStore) { r.seen = o.count; r.seenOf = 'requests'; if (db) r.tables = tableVerbs(o.tables) }
      const handler = steps.find(s => s.metadata?.role === 'step' && s.metadata?.step === '1')
      if (!toStore.length && db && handler) {
        requests.relations.push({ source: handler.id, target: db.id, title: tableVerbs(o.tables), kind: 'runtime', seen: o.count, seenOf: 'requests', tables: tableVerbs(o.tables), origin: 'trace' })
      }
    }
    for (const [app, a] of apps) { const e = els.get(app); if (e) e.metadata = { ...e.metadata, seen: `${a.seen}/${a.total}` } }
  }
  return { seen, total }
}

/** Comments and strings blanked out (same length), so braces and tags inside them do not count. */
const code = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))

/** For each "{" outside strings, where its "}" is: [open, close] pairs. */
function braces(text) {
  const out = [], stack = []
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') stack.push(i)
    else if (c === '}' && stack.length) out.push([stack.pop(), i])
  }
  return out
}

/**
 * A browser app's page routes and the file each page is: React Router's <Route path element> (nested
 * routes join their parents' paths, an index route is its parent's) and route objects
 * ({ path, element | component | Component, children }). The page is the last component in the
 * element that the file imports from the app itself (a <Navigate> or a library's wrapper is not a
 * page). A route a layout and an index page share is the index page's. Commented-out routes do not
 * count. Returns [{ route: '/kingdom/build', path: 'browser/src/pages/Build.tsx' }], routes as
 * written (":id").
 */
export function pageRoutes(sources) {
  const files = Object.keys(sources)
  const resolve = (from, spec) => {
    if (!spec.startsWith('.')) return null
    const base = posix.normalize(posix.join(posix.dirname(from), spec))
    return [base, ...['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte'].flatMap(x => [`${base}${x}`, `${base}/index${x}`])].find(f => files.includes(f)) ?? null
  }
  const join = (parent, p) => (p.startsWith('/') ? p : `${parent.replace(/\/$/, '')}/${p}`)
  // A page found where a layout's route already stood wins; a layout never replaces a page.
  const found = new Map()
  const put = (route, path, layout) => {
    if (route.includes('*')) return
    const had = found.get(route)
    if (!had || (had.layout && !layout)) found.set(route, { path, layout })
  }
  for (const [from, raw] of Object.entries(sources)) {
    if (!/\.[jt]sx?$/.test(from) || !/<Route\b|\bpath\s*:/.test(raw)) continue
    const text = code(raw)
    // What the file imports from the app itself: name → file.
    const local = new Map()
    for (const m of text.matchAll(/import\s+(?:([\p{L}\p{N}_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/gu)) {
      const f = resolve(from, m[3])
      if (!f) continue
      if (m[1]) local.set(m[1], f)
      for (const n of (m[2] ?? '').split(',')) { const [a, b] = n.trim().split(/\s+as\s+/); if (a) local.set(b ?? a, f) }
    }
    for (const m of text.matchAll(/([\p{L}\p{N}_$]+)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/gu)) { const f = resolve(from, m[2]); if (f) local.set(m[1], f) }
    const pageIn = s => [...s.matchAll(/<(\p{Lu}[\p{L}\p{N}_$]*)|(?:component|Component)\s*:\s*(\p{Lu}[\p{L}\p{N}_$]*)/gu)].map(m => m[1] ?? m[2]).filter(n => local.has(n)).pop()

    // JSX: walk the <Route> tags, keeping the paths of the open ones.
    const stack = ['']
    for (const m of text.matchAll(/<Route\b|<\/Route>/g)) {
      if (m[0] === '</Route>') { if (stack.length > 1) stack.pop(); continue }
      // The opening tag runs to the first ">" outside braces and quotes.
      let i = m.index + 6, depth = 0, quote = ''
      for (; i < text.length; i++) {
        const c = text[i]
        if (quote) { if (c === quote) quote = ''; continue }
        if (c === '"' || c === "'" || c === '`') quote = c
        else if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) break
      }
      const attrs = text.slice(m.index + 6, i), closed = text[i - 1] === '/'
      const p = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"`]([^'"`]*)['"`]\s*\})/.exec(attrs)
      const route = p ? join(stack[stack.length - 1], p[1] ?? p[2] ?? p[3]) : stack[stack.length - 1]
      const page = (p || /\bindex\b/.test(attrs)) && pageIn(attrs)
      if (page) put(route || '/', local.get(page), !closed)
      if (!closed) stack.push(route)
    }

    // Route objects: an object with a path of its own; its parent is the nearest object around it
    // that has one too (children: [...]). What it shows is in its own text, not its children's.
    const objects = braces(text).sort((a, b) => a[0] - b[0]).map(([open, close]) => ({ open, close }))
    // Only objects with a "path:" inside are looked at, so a large file stays quick.
    const paths = [...text.matchAll(/path\s*:/g)].map(m => m.index)
    for (const o of objects) {
      if (!paths.some(i => i > o.open && i < o.close)) continue
      const chars = [...text.slice(o.open + 1, o.close)]
      for (const inner of objects) if (inner.open > o.open && inner.close < o.close) for (let k = inner.open; k <= inner.close; k++) chars[k - o.open - 1] = ' '
      const own = chars.join('')
      const p = /(?:^|[,\s])path\s*:\s*['"`]([^'"`]+)['"`]/.exec(own)
      if (!p) continue
      o.path = p[1]
      o.page = pageIn(own)
      o.layout = /\bchildren\s*:/.test(own)
    }
    for (const o of objects.filter(x => x.path)) {
      // Its parents' paths, nearest last.
      const chain = objects.filter(x => x.path && x.open < o.open && x.close > o.close)
      const route = [...chain, o].reduce((at, x) => join(at, x.path), '')
      if (o.page) put(route.startsWith('/') ? route : `/${route}`, local.get(o.page), o.layout)
    }
  }
  return [...found].map(([route, { path }]) => ({ route, path }))
}

/** The page a browser was on (a Referer's path), among the app's routes: the most specific match, or null. */
export function pageFor(routes, at) {
  const parts = p => p.split('/').filter(Boolean)
  const want = parts(at)
  const hits = routes.filter(r => { const have = parts(r.route); return have.length === want.length && have.every((s, k) => s.startsWith(':') || s === want[k]) })
  return hits.sort((a, b) => parts(a.route).filter(s => s.startsWith(':')).length - parts(b.route).filter(s => s.startsWith(':')).length)[0] ?? null
}

/**
 * Folds what made each request into the models: the pages a browser made them from (Referer) and
 * the tests that made them. A page's file in the architecture lists the endpoints it called
 * (metadata.pageCalls: [{ endpoint, count, path }], path being the handler's file, and metadata.page
 * its routes); an endpoint in the requests view lists its pages (metadata.pages: [{ page, path,
 * count }]) and its tests (metadata.tests: [{ test, count }], the busiest first, at most TESTS_KEPT;
 * metadata.testCount all of them, metadata.untimed the requests no single test was running for). An
 * address no route of the app names is not kept, only counted (metadata.otherPages): it may hold a
 * value (an id, a token) the map should not show. JSON in metadata, as metadata holds only strings.
 * `sources` are the files the model shows, `types` its Java declarations (declaredTypes).
 */
export function markCallers(model, requests, observed, sources, types) {
  if (!requests) return { pages: 0 }
  const routes = pageRoutes(sources)
  const eps = new Map(requests.elements.filter(e => e.metadata?.method && e.metadata?.route).map(e => [`${e.metadata.method} ${normalRoute(e.metadata.route)}`, e]))
  const handler = new Map(requests.elements.filter(e => e.metadata?.role === 'step' && e.metadata?.step === '1').map(e => [e.parent, e.metadata.path]))
  const fileEl = new Map(model.elements.filter(e => e.metadata?.path).map(e => [e.metadata.path, e]))
  // Each file's types and methods are read once for all the endpoints' trees.
  const calls = new Map(), routeOf = new Map(), placed = new Map()
  for (const o of observed.endpoints) {
    const ep = eps.get(`${o.method} ${o.route}`)
    if (!ep) continue
    // Two addresses of one route (/war/1, /war/2) are one page.
    const merged = new Map()
    let other = 0
    for (const [at, count] of Object.entries(o.pages ?? {})) {
      const hit = pageFor(routes, at)
      if (!hit) { other += count; continue }
      const m = merged.get(hit.route)
      if (m) m.count += count; else merged.set(hit.route, { page: hit.route, path: hit.path, count })
    }
    if (merged.size) ep.metadata.pages = JSON.stringify([...merged.values()].sort((a, b) => b.count - a.count))
    if (other) ep.metadata.otherPages = String(other)
    for (const p of merged.values()) {
      routeOf.set(p.path, new Set([...(routeOf.get(p.path) ?? []), p.page]))
      const c = calls.get(p.path) ?? new Map()
      // Two routes of one file (/sign-in, /register) add up.
      const key = `${o.method} ${o.route}`
      c.set(key, { endpoint: key, count: (c.get(key)?.count ?? 0) + p.count, path: handler.get(ep.id) ?? null })
      calls.set(p.path, c)
    }
    const tests = Object.entries(o.tests ?? {}).sort((a, b) => b[1] - a[1])
    if (tests.length) {
      ep.metadata.tests = JSON.stringify(tests.slice(0, TESTS_KEPT).map(([test, count]) => ({ test, count })))
      ep.metadata.testCount = String(tests.length)
    }
    if (o.untimed) ep.metadata.untimed = String(o.untimed)
    // trace --methods: its call tree, each method with the file and line it is declared at.
    if (o.tree?.length) ep.metadata.callTree = JSON.stringify(placeTree(o.tree, types, sources, placed))
  }
  for (const [path, c] of calls) {
    const e = fileEl.get(path)
    if (!e) continue
    e.metadata.page = [...routeOf.get(path)].sort().join(' · ')
    e.metadata.pageCalls = JSON.stringify([...c.values()].sort((a, b) => b.count - a.count || a.endpoint.localeCompare(b.endpoint)))
  }
  return { pages: calls.size }
}
/** The most tests an endpoint lists by name; the count says how many there were. */
export const TESTS_KEPT = 40

/**
 * Where each method a Java source's type declares is: for the type `cls` (its full binary or dotted
 * name), the line of each method name declared straight in its body, the first of a name. Bodies of
 * methods, initializers and the types inside it do not count, so neither does a call, an anonymous
 * class's method or another class's of the file. Its name after a type (on this line or the one
 * before), not after "return", "new" or a dot. Null when the file declares no type of that name: an
 * anonymous or local class (Foo$1) is in its file, but which body it is the trace does not say.
 */
function methodLines(file, cls) {
  const name = file.pkg && cls.startsWith(`${file.pkg}.`) ? cls.slice(file.pkg.length + 1) : cls
  const t = file.types.find(x => x.binary === name || x.name === name)
  if (!t) return null
  // The body at its own level: what is inside any brace in it blanked, line breaks kept.
  let depth = 0
  const own = file.code.slice(t.open + 1, t.close).split('').map(c => { if (c === '}') depth--; const out = depth > 0 && c !== '\n' ? ' ' : c; if (c === '{') depth++; return out }).join('')
  const lines = new Map()
  let line = file.code.slice(0, t.open + 1).split('\n').length, at = 0
  for (const m of own.matchAll(new RegExp(`(?<![${ID_PART}.])([${ID_START}][${ID_PART}]*)\\s*\\(`, 'gu'))) {
    for (; at < m.index; at++) if (own[at] === '\n') line++
    const before = /([\p{L}\p{N}_$>\]]+)\s*$/u.exec(own.slice(Math.max(0, m.index - 200), m.index))
    if (!before || !/\s/.test(own[m.index - 1] ?? '') || /^(return|new|throw|else|case|yield|await)$/.test(before[1])) continue
    if (!lines.has(m[1])) lines.set(m[1], line)
  }
  return lines
}

/**
 * A call tree from `trace --methods` with each method placed: { at, count, path, line, kids }, path
 * being the file of its class (classFiles of the model's `types`) and line where its class declares
 * the method there (methodLines). Tables touched and "N more" stay as they are. `placed` keeps what
 * was read of each file and type across calls.
 */
export function placeTree(tree, types, sources, placed = new Map()) {
  const classes = new Set()
  const walk = ns => { for (const n of ns) { const k = n.at.lastIndexOf('.'); if (k > 0 && !/\s/.test(n.at)) classes.add(n.at.slice(0, k)); walk(n.kids ?? []) } }
  walk(tree)
  const fileOf = classFiles(types, [...classes])
  const lineOf = (path, cls, name) => {
    if (!placed.has(path)) { const code = javaRead(sources[path] ?? ''); placed.set(path, { code, ...javaTypes(code), lines: new Map() }) }
    const file = placed.get(path)
    if (!file.lines.has(cls)) file.lines.set(cls, methodLines(file, cls))
    return file.lines.get(cls)?.get(name) ?? null
  }
  const place = ns => ns.map(n => {
    const k = n.at.lastIndexOf('.'), path = k > 0 && !/\s/.test(n.at) ? fileOf.get(n.at.slice(0, k)) ?? null : null
    const line = path ? lineOf(path, n.at.slice(0, k), n.at.slice(k + 1)) : null
    return { at: n.at, count: n.count, ...(path ? { path } : {}), ...(line ? { line } : {}), ...(n.kids?.length ? { kids: place(n.kids) } : {}) }
  })
  return place(tree)
}
