// Turns a codebase's file graph (scripts/graph.mjs) and a map into a viewer model.
// The map is written by an agent (see .claude/skills/map-repo): it names the architecture,
// which is nodes (apps, components, actors, stores) and the files each one holds, plus the links
// code references cannot show (HTTP calls, the database), each with file:line evidence.
// Relations between files come only from the graph, never from the map.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'
import { buildGraph } from './graph.mjs'
import { buildRequests } from './requests.mjs'

/** Node kinds a map may use, and how the viewer draws them. */
export const KINDS = {
  actor: { color: 'green', shape: 'person' },
  system: { color: 'primary', shape: 'rectangle' },
  app: { color: 'primary', shape: 'rectangle' },
  webapp: { color: 'secondary', shape: 'browser' },
  library: { color: 'amber', shape: 'rectangle' },
  component: { color: 'indigo', shape: 'rectangle' },
  database: { color: 'slate', shape: 'storage' },
  queue: { color: 'slate', shape: 'queue' },
  external: { color: 'muted', shape: 'rectangle' },
}
const CODE = { color: 'sky', shape: 'rectangle' }
// Links touching one of these are judgement, not code facts, so they need no evidence.
const NO_EVIDENCE = new Set(['actor'])
const ID = /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)*$/

export const toName = repo => basename(resolve(repo)).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
const humanize = s => s.replace(/[-_.]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase())
// Cited lines as the panel shows them: shared indentation removed, long ranges and lines cut short.
const SNIPPET_LINES = 8, SNIPPET_WIDTH = 160
/** A feature should be findable without digging: its node sits in the top three levels. */
const FEATURE_DEPTH = 3
const snippet = lines => {
  const ls = lines.map(s => s.replace(/\r$/, '').replace(/\t/g, '  ').trimEnd())
  const pad = Math.min(...ls.filter(Boolean).map(s => s.match(/^ */)[0].length))
  const cut = ls.slice(0, SNIPPET_LINES).map(s => s.slice(Number.isFinite(pad) ? pad : 0)).map(s => (s.length > SNIPPET_WIDTH ? `${s.slice(0, SNIPPET_WIDTH - 1)}…` : s))
  if (ls.length > SNIPPET_LINES) cut.push(`… ${ls.length - SNIPPET_LINES} more lines`)
  return cut.join('\n')
}
const globRe = g => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?|\*|\?/g, m => (m === '?' ? '[^/]' : m === '*' ? '[^/]*' : '.*'))}$`)

/**
 * Checks a map against the graph and builds the viewer model from both.
 * Errors make a map unpublishable; files the map does not place are placed by their neighbours
 * (an error too, unless `loose`, which live re-imports use so new files still show up).
 */
export function buildModel(graph, map, { name, loose = false } = {}) {
  const errors = [], warnings = []
  // Problems the code moving under a map causes; live re-imports report them but still publish.
  const drift = msg => (loose ? warnings : errors).push(msg)
  const nodes = new Map()
  for (const n of map.nodes ?? []) {
    if (!ID.test(n.id ?? '')) { errors.push(`node id "${n.id}" must be dot-separated segments like "web.checkout"`); continue }
    if (nodes.has(n.id)) errors.push(`node "${n.id}" is declared twice`)
    if (!KINDS[n.kind]) errors.push(`node "${n.id}" has kind "${n.kind}"; use one of ${Object.keys(KINDS).join(', ')}`)
    if (!n.title) errors.push(`node "${n.id}" has no title`)
    nodes.set(n.id, n)
  }
  const parentOf = id => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null)
  for (const id of nodes.keys()) if (parentOf(id) && !nodes.has(parentOf(id))) errors.push(`node "${id}" has no parent node "${parentOf(id)}"`)

  // Features: what the product does, in its own words, each pointing at the nodes or files that
  // carry it (files, when a layered app spreads a feature across layers). They keep a map honest
  // about the essence: a top-level app that carries no feature is usually tooling.
  const featured = new Map() // node id or file path → feature titles
  const isFile = new Set(graph.files.map(x => x.path))
  if (!map.features?.length) warnings.push('the map lists no features: name the product’s headline features and the nodes that carry them')
  for (const f of map.features ?? []) {
    if (!f.title) { errors.push('a feature has no title'); continue }
    if (!f.nodes?.length) errors.push(`feature "${f.title}" names no nodes`)
    for (const id of f.nodes ?? []) {
      if (isFile.has(id)) { featured.set(id, [...(featured.get(id) ?? []), f.title]); continue }
      if (!nodes.has(id)) { errors.push(`feature "${f.title}" names "${id}", which is neither a node the map declares nor an application file`); continue }
      if (id.split('.').length > FEATURE_DEPTH) warnings.push(`feature "${f.title}" sits at "${id}", ${id.split('.').length} levels down: give it a node in the top ${FEATURE_DEPTH} levels`)
      featured.set(id, [...(featured.get(id) ?? []), f.title])
    }
  }

  // Files to nodes: an exact path beats a glob, a longer glob beats a shorter one.
  const app = new Map(graph.files.map(f => [f.path, f]))
  const claims = new Map() // path → [{ node, pattern, exact }]
  for (const n of nodes.values()) {
    for (const pattern of n.files ?? []) {
      const exact = !/[*?]/.test(pattern)
      const hits = exact ? (app.has(pattern) ? [pattern] : []) : [...app.keys()].filter(p => globRe(pattern).test(p))
      if (!hits.length) (exact ? drift : m => warnings.push(m))(exact ? `node "${n.id}" lists ${pattern}, which is not an application file${graph.dropped.unreached.includes(pattern) ? ' (no entry point reaches it)' : ''}` : `node "${n.id}" pattern ${pattern} matches no application file`)
      for (const p of hits) claims.set(p, [...(claims.get(p) ?? []), { node: n.id, pattern, exact }])
    }
  }
  const placed = new Map()
  for (const [p, cs] of claims) {
    const rank = c => (c.exact ? 1e6 : c.pattern.length)
    cs.sort((a, b) => rank(b) - rank(a))
    if (cs.length > 1 && rank(cs[0]) === rank(cs[1]) && cs[0].node !== cs[1].node) errors.push(`${p} is claimed equally by "${cs[0].node}" (${cs[0].pattern}) and "${cs[1].node}" (${cs[1].pattern})`)
    placed.set(p, cs[0].node)
  }
  // Unplaced files go where most of their neighbours are, repeatedly, so chains of new files
  // follow the placed ones; whatever is left over gets an Unplaced node.
  const neighbours = new Map()
  for (const e of graph.edges) {
    neighbours.set(e.from, [...(neighbours.get(e.from) ?? []), e.to])
    neighbours.set(e.to, [...(neighbours.get(e.to) ?? []), e.from])
  }
  const unplaced = [...app.keys()].filter(p => !placed.has(p))
  for (let changed = true; changed;) {
    changed = false
    for (const p of unplaced) {
      if (placed.has(p)) continue
      const votes = new Map()
      for (const q of neighbours.get(p) ?? []) if (placed.has(q)) votes.set(placed.get(q), (votes.get(placed.get(q)) ?? 0) + 1)
      const best = [...votes].sort((a, b) => b[1] - a[1])[0]
      if (best) { placed.set(p, best[0]); changed = true }
    }
  }
  if (unplaced.length) (loose ? warnings : errors).push(`${unplaced.length} application files are not in the map: ${unplaced.slice(0, 12).join(', ')}${unplaced.length > 12 ? ', …' : ''}`)
  if (unplaced.some(p => !placed.has(p))) nodes.set('unplaced', { id: 'unplaced', kind: 'component', title: 'Unplaced', description: 'Files the map does not cover yet.' })
  for (const p of unplaced) if (!placed.has(p)) placed.set(p, 'unplaced')
  if (map.features?.length) {
    // A node carries a feature named on it, on a node inside it, or on a file it holds.
    const carried = [...featured.keys()].map(k => placed.get(k) ?? k)
    for (const n of nodes.values()) {
      const carries = carried.some(id => id === n.id || id.startsWith(`${n.id}.`))
      if (!parentOf(n.id) && (n.kind === 'app' || n.kind === 'webapp') && !carries) warnings.push(`top-level ${n.kind} "${n.id}" carries no feature: put it under a system node if it is a tool, or name the feature it serves`)
    }
  }

  // Elements: the map's nodes, then each file under its node.
  const elements = []
  for (const n of nodes.values()) {
    const style = KINDS[n.kind] ?? KINDS.component
    elements.push({ id: n.id, parent: parentOf(n.id), title: n.title ?? n.id, kind: n.kind, description: n.description ?? '', technology: n.technology ?? '', tags: [], features: featured.get(n.id) ?? [], ...style, metadata: {} })
  }
  const fileId = new Map()
  const byNode = new Map()
  for (const [p, id] of placed) byNode.set(id, [...(byNode.get(id) ?? []), p])
  for (const [id, paths] of byNode) {
    const stem = p => posix.basename(p).replace(/\.[^.]+$/, '')
    const used = new Set([...nodes.keys()].filter(k => parentOf(k) === id).map(k => k.slice(id.length + 1)))
    for (const p of paths.sort()) {
      // Same-named files (index.ts in two folders) are told apart by their folder.
      const twin = paths.some(q => q !== p && stem(q) === stem(p))
      const title = twin ? `${posix.basename(posix.dirname(p))}/${stem(p)}` : stem(p)
      let base = title.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '') || 'file'
      base = base[0].toLowerCase() + base.slice(1)
      let seg = base, k = 2
      while (used.has(seg)) seg = `${base}${k++}`
      used.add(seg)
      fileId.set(p, `${id}.${seg}`)
      const f = app.get(p)
      elements.push({ id: `${id}.${seg}`, parent: id, title, kind: 'code', description: f.doc, technology: '', tags: [], features: featured.get(p) ?? [], ...CODE, metadata: { path: p, lines: String(f.lines), churn: String(f.churn), marks: f.hints.map(h => `${h.line}:${h.kind}`).join(' ') } })
    }
  }

  // Relations: the graph's, between files, then the map's links.
  // Type-only imports are compile-time coupling, not runtime use, so the map does not draw them.
  const relations = graph.edges.filter(e => !e.types).map(e => ({ source: fileId.get(e.from), target: fileId.get(e.to), title: e.names.length > 3 ? `${e.names.slice(0, 3).join(', ')} +${e.names.length - 3}` : e.names.join(', ') }))
  const endOf = s => (nodes.has(s) ? s : fileId.get(s))
  const kindOf = s => nodes.get(s)?.kind ?? 'code'
  // Whether a file is a link end, or under the node that is one.
  const atEnd = (end, path) => end === path || (nodes.has(end) && (placed.get(path) === end || placed.get(path)?.startsWith(`${end}.`)))
  // A file up to two references from a file end can back its link too: the line that builds the URL
  // a helper fetches, or the router that mounts a route file under a prefix.
  const near = new Map()
  for (const e of graph.edges) if (!e.types) { near.set(e.from, [...(near.get(e.from) ?? []), e.to]); near.set(e.to, [...(near.get(e.to) ?? []), e.from]) }
  const nearEnd = (end, path) => (near.get(end) ?? []).some(n => n === path || (near.get(n) ?? []).includes(path))
  const cited = new Set()
  for (const l of map.links ?? []) {
    const a = endOf(l.from), b = endOf(l.to)
    if (!a || !b) { drift(`link ${l.from} → ${l.to}: ${!a ? l.from : l.to} is neither a node id nor an application file`); continue }
    const evidence = l.evidence ?? []
    if (!evidence.length && !NO_EVIDENCE.has(kindOf(l.from)) && !NO_EVIDENCE.has(kindOf(l.to))) errors.push(`link ${l.from} → ${l.to} needs evidence: file:line where the code makes the call`)
    // The viewer cannot read the repository, so each cited line travels with the model.
    // Evidence that no longer resolves (loose re-publish) is kept without code, so the viewer can say so.
    const proof = []
    for (const ev of evidence) {
      const m = String(ev).match(/^(.+?):(\d+)(?:-(\d+))?$/)
      const file = m && join(graph.repo, m[1])
      if (!m || !existsSync(file)) { drift(`link ${l.from} → ${l.to}: evidence "${ev}" is not an existing file:line`); proof.push({ at: String(ev), line: 0, code: null }); continue }
      const text = readFileSync(file, 'utf8').split('\n')
      const [from, to] = [Number(m[2]), Number(m[3] ?? m[2])]
      if (to > text.length) { drift(`link ${l.from} → ${l.to}: evidence "${ev}" is past the end of the file (${text.length} lines)`); proof.push({ at: String(ev), line: from, code: null }); continue }
      proof.push({ at: String(ev), line: from, code: snippet(text.slice(from - 1, to)) })
      // In application code, evidence should land on a route, call, store, schedule or socket,
      // in a file at one end of the link (config and other non-code files can back any link).
      const hints = app.get(m[1])?.hints
      for (let k = from; k <= to; k++) cited.add(`${m[1]}:${k}`)
      if (hints && !atEnd(l.from, m[1]) && !atEnd(l.to, m[1]) && !nearEnd(l.from, m[1]) && !nearEnd(l.to, m[1])) warnings.push(`link ${l.from} → ${l.to}: evidence "${ev}" is in ${m[1]}, which is at neither end of the link`)
      else if (hints && !hints.some(h => h.line >= from && h.line <= to)) {
        // Code moves under a map; the nearest marked line is usually where the evidence went.
        const near = hints.filter(h => Math.abs(h.line - from) <= 20).sort((x, y) => Math.abs(x.line - from) - Math.abs(y.line - from))[0]
        warnings.push(`link ${l.from} → ${l.to}: evidence "${ev}" is not a line the graph recognised; it reads: ${text[from - 1].trim().slice(0, 100)}${near ? ` (nearest marked line: ${m[1]}:${near.line} ${near.kind} ${near.text.slice(0, 60)})` : ''}`)
      }
    }
    relations.push({ source: a, target: b, title: l.title ?? '', evidence: proof })
  }
  for (const n of nodes.values()) if (byNode.has(n.id) && [...nodes.keys()].some(k => parentOf(k) === n.id)) warnings.push(`node "${n.id}" has child nodes and also holds ${byNode.get(n.id).length} files; move them into a child`)
  for (const n of nodes.values()) if (!['actor', 'database', 'queue', 'external', 'system'].includes(n.kind) && !byNode.has(n.id) && ![...nodes.keys()].some(k => parentOf(k) === n.id)) warnings.push(`node "${n.id}" holds no files and no nodes`)

  // Top-level libraries: shared means two product parts use it. Dev tools don't count, or every
  // library a profiler touches would crowd the top level. A published package is a deliverable.
  const top = id => id.split('.')[0]
  const product = id => ['app', 'webapp', 'library'].includes(nodes.get(top(id))?.kind)
  const published = new Set((graph.projects ?? []).filter(p => p.published).map(p => p.dir))
  const libraries = [...nodes.values()].filter(n => !parentOf(n.id) && n.kind === 'library')
  for (const lib of libraries) {
    const own = graph.files.filter(f => placed.get(f.path) && top(placed.get(f.path)) === lib.id)
    if (own.some(f => published.has(f.project))) continue
    const mine = new Set(own.map(f => f.path))
    const users = new Set(graph.edges.filter(e => !e.types && mine.has(e.to) && !mine.has(e.from) && placed.get(e.from)).map(e => top(placed.get(e.from))))
    const apps = [...users].filter(product)
    // Folded into the app, a library dev tools also use would show the tools reaching into the app.
    if (apps.length === 1 && users.size === 1) warnings.push(`top-level library "${lib.id}" is used only by "${apps[0]}": fold it into "${apps[0]}"`)
    else if (apps.length === 1 && libraries.length > 1) warnings.push(`top-level library "${lib.id}" is used by one product part, "${apps[0]}", and dev tools: make it a component of the shared-library node`)
    else if (!apps.length && users.size) warnings.push(`top-level library "${lib.id}" is used only by dev tools: put it in their group`)
  }
  if (libraries.length > 3) warnings.push(`the top level holds ${libraries.length} libraries: make libraries that ship together one library node, with a component each`)

  // Each node with the files under it, for judging component sizes.
  // Files placed by neighbour votes rather than by the map are counted apart, so sizes don't mislead.
  const voted = new Set(unplaced)
  const under = (n, id) => id === n.id || id.startsWith(`${n.id}.`)
  const tree = [...nodes.values()].map(n => ({ id: n.id, title: n.title, kind: n.kind, files: [...byNode].filter(([id]) => under(n, id)).reduce((s, [, ps]) => s + ps.length, 0), voted: [...byNode].filter(([id]) => under(n, id)).reduce((s, [, ps]) => s + ps.filter(p => voted.has(p)).length, 0) }))
  // Marked lines no link cites, for re-maps after the code or the hints changed. Timers are not links.
  const uncited = graph.files.flatMap(f => f.hints.filter(h => h.kind !== 'schedule' && !cited.has(`${f.path}:${h.line}`)).map(h => ({ path: f.path, ...h })))
  const files = graph.files.length
  return {
    model: { name, title: map.title ?? humanize(basename(graph.repo)), elements, relations },
    errors, warnings, tree, unplaced, uncited,
    stats: { nodes: nodes.size, files, relations: relations.length, links: (map.links ?? []).length, unplaced: unplaced.length },
  }
}

/** Every model the viewer can open: the samples extracted from model/ and the imports. */
export function writeIndex() {
  const list = root => (existsSync(root) ? readdirSync(root).filter(n => statSync(join(root, n)).isDirectory()) : [])
  const title = name => { try { return JSON.parse(readFileSync(join('imports', name, 'source.json'), 'utf8')).title } catch { return humanize(name) } }
  const entries = [
    ...list('imports').filter(n => existsSync(join('public/models', `${n}.json`))).map(n => ({ name: n, title: title(n), source: 'import', ...(existsSync(join('public/models', `${n}.requests.json`)) ? { views: ['requests'] } : {}) })),
    ...list('model').filter(n => existsSync(join('public/models', `${n}.json`))).map(n => ({ name: n, title: n, source: 'sample' })),
  ]
  writeAtomic(join('public/models', 'index.json'), JSON.stringify(entries))
}

// The dev server watches public/models; a half-written file must never be read, and one cut off by a crash must never replace a good one.
export const writeAtomic = (file, text) => { const fd = openSync(`${file}.tmp`, 'w'); try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) } renameSync(`${file}.tmp`, file) }

/**
 * Publishes a map of `repo` as model `name`: imports/<name>/ keeps the map and where it came
 * from (for live re-imports), public/models/<name>.json is what the viewer opens.
 */
export function publish(repo, map, { name = toName(repo), loose = false } = {}) {
  // The viewer serves models/<name>.json only for plain names.
  if (!/^[\w.-]+$/.test(name)) throw new Error(`"${name}" is not a model name: use letters, digits, ".", "-" and "_"`)
  if (existsSync(join('model', name))) throw new Error(`"${name}" is a sample model's name; pass --name`)
  const t0 = Date.now()
  const graph = buildGraph(repo)
  const built = buildModel(graph, map, { name, loose })
  if (built.errors.length) return { name, ...built, published: false }
  const dir = join('imports', name)
  mkdirSync(dir, { recursive: true })
  mkdirSync('public/models', { recursive: true })
  // The dev server watches imports/ too, and reads these as soon as they change.
  writeAtomic(join(dir, 'map.json'), `${JSON.stringify(map, null, 2)}\n`)
  writeAtomic(join(dir, 'source.json'), `${JSON.stringify({ repo: graph.repo, title: built.model.title }, null, 2)}\n`)
  writeAtomic(join('public/models', `${name}.json`), JSON.stringify({ ...built.model, buildMs: Date.now() - t0 }))
  // The Requests view: the backend's endpoints and each request's path, when the code has endpoints.
  const requests = buildRequests(graph, map, built.model)
  if (requests) writeAtomic(join('public/models', `${name}.requests.json`), JSON.stringify({ ...requests, buildMs: Date.now() - t0 }))
  else rmSync(join('public/models', `${name}.requests.json`), { force: true })
  writeIndex()
  return { name, ...built, published: true, ms: Date.now() - t0 }
}

/**
 * How alike two maps of one repo are. Node ids differ between runs, so files are compared by
 * how they are grouped: the adjusted Rand index of the two partitions (1 identical, 0 chance),
 * at the top level (which process holds a file) and at the leaf node holding it. Nodes are
 * paired by file overlap, and links are compared between paired processes and file to file.
 */
export function compareMaps(graph, a, b) {
  const top = id => (id.includes('.') ? id.slice(0, id.indexOf('.')) : id)
  const side = map => {
    const { model } = buildModel(graph, map, { name: 'compare', loose: true })
    const els = new Map(model.elements.map(e => [e.id, e]))
    const leaf = new Map(), process = new Map()
    for (const e of model.elements) if (e.metadata?.path) { leaf.set(e.metadata.path, e.parent); process.set(e.metadata.path, top(e.parent)) }
    // A link end as its process (or, for actors and stores, its kind), and as a file when it is one.
    const kindEnd = id => (['database', 'queue', 'external', 'actor'].includes(els.get(id)?.kind) ? `[${els.get(id).kind}]` : null)
    const ends = (map.links ?? []).map(l => [l.from, l.to].map(x => ({ file: process.has(x) ? x : null, proc: process.get(x) ?? kindEnd(x) ?? top(x) })))
    return { els, leaf, process, ends }
  }
  const A = side(a), B = side(b)
  // A file one map does not place itself (placed by neighbour votes) would skew the score: leave it out.
  const skipped = new Set([...buildModel(graph, a, { name: 'compare', loose: true }).unplaced, ...buildModel(graph, b, { name: 'compare', loose: true }).unplaced])
  const files = graph.files.map(f => f.path).filter(p => !skipped.has(p))
  for (const s of [A, B]) for (const p of skipped) { s.leaf.delete(p); s.process.delete(p) }
  const c2 = n => (n * (n - 1)) / 2
  const ari = (pa, pb) => {
    const cells = new Map(), ra = new Map(), rb = new Map()
    const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
    for (const f of files) { bump(cells, `${pa.get(f)} > ${pb.get(f)}`); bump(ra, pa.get(f)); bump(rb, pb.get(f)) }
    const sum = m => [...m.values()].reduce((t, n) => t + c2(n), 0)
    const index = sum(cells), sa = sum(ra), sb = sum(rb), expected = (sa * sb) / c2(files.length), max = (sa + sb) / 2
    return max === expected ? 1 : (index - expected) / (max - expected)
  }
  const groups = part => { const g = new Map(); for (const [file, n] of part) g.set(n, [...(g.get(n) ?? []), file]); return g }
  // Each group of A against the group of B sharing most of its files (Jaccard overlap).
  const pair = (pa, pb) => {
    const gb = groups(pb)
    return [...groups(pa)].map(([n, fs]) => {
      const set = new Set(fs)
      const [m, overlap] = [...gb].map(([m, gs]) => [m, gs.filter(x => set.has(x)).length / new Set([...fs, ...gs]).size]).sort((x, y) => y[1] - x[1])[0]
      return { a: n, b: m, files: fs.length, overlap }
    }).sort((x, y) => y.files - x.files)
  }
  const procPairs = new Map(pair(A.process, B.process).map(p => [p.a, p.b]))
  const title = (side, id) => side.els.get(id)?.title ?? id
  const linkSet = (side, translate) => new Set(side.ends.map(([x, y]) => `${translate(x.proc)} → ${translate(y.proc)}`))
  const la = linkSet(A, p => (p.startsWith('[') ? p : title(B, procPairs.get(p) ?? p))), lb = linkSet(B, p => (p.startsWith('[') ? p : title(B, p)))
  const fileLinks = side => new Set(side.ends.filter(([x, y]) => x.file && y.file).map(([x, y]) => `${x.file} → ${y.file}`))
  const fa = fileLinks(A), fb = fileLinks(B)
  return {
    skipped: skipped.size,
    topLevel: ari(A.process, B.process),
    leaf: ari(A.leaf, B.leaf),
    groups: { a: groups(A.leaf).size, b: groups(B.leaf).size },
    pairs: pair(A.leaf, B.leaf).map(p => ({ ...p, a: title(A, p.a), b: title(B, p.b) })),
    processLinks: { a: la.size, b: lb.size, shared: [...la].filter(l => lb.has(l)).length, onlyA: [...la].filter(l => !lb.has(l)), onlyB: [...lb].filter(l => !la.has(l)) },
    fileLinks: { a: fa.size, b: fb.size, shared: [...fa].filter(l => fb.has(l)).length },
  }
}

/**
 * Files whose runtime users sit mostly in a sibling node: candidates to move under the placement
 * rules, for the agent to judge (a feature's own interfaces stay put).
 */
export function auditPlacement(graph, map) {
  const { model } = buildModel(graph, map, { name: 'audit', loose: true })
  const nodeOf = new Map(model.elements.filter(e => e.metadata?.path).map(e => [e.metadata.path, e.parent]))
  const parentOf = id => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null)
  const users = new Map(), uses = new Map()
  // Re-exports are a barrel passing a module on, not using it.
  for (const e of graph.edges) if (!e.types && !e.reexport && e.from !== e.to) { users.set(e.to, [...(users.get(e.to) ?? []), e.from]); uses.set(e.from, [...(uses.get(e.from) ?? []), e.to]) }
  const out = []
  for (const f of graph.files) {
    const own = nodeOf.get(f.path)
    const count = new Map()
    for (const u of users.get(f.path) ?? []) count.set(nodeOf.get(u), (count.get(nodeOf.get(u)) ?? 0) + 1)
    const [top, n] = [...count].sort((x, y) => y[1] - x[1])[0] ?? []
    const mine = count.get(own) ?? 0
    // A feature's entry is imported only by the shell yet uses its own feature: that is normal.
    // Flag a file only when it also uses nothing in its own node.
    const usesOwn = (uses.get(f.path) ?? []).some(p => nodeOf.get(p) === own)
    if (top && top !== own && n >= 2 && n > mine && !usesOwn && parentOf(top) === parentOf(own)) out.push({ path: f.path, own, ownUsers: mine, top, topUsers: n })
  }
  return out
}
