// The edge of a backend, from code: every endpoint with its full path, and the path a request takes
// through the code: the handler, the files its body actually uses, down to the files that reach a
// store or another service, and what it answers with (a rendered view, a redirect, JSON).
// Deterministic, like graph.mjs; scripts/map.mjs turns it into the Requests view.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BRACES = new Set(['java', 'cs', 'js', 'go', 'rs'])
/** Kinds of marked line that leave the process: where a request's path reaches the outside. */
const BOUNDARY = new Set(['store', 'call', 'queue', 'socket', 'message', 'process'])
/** How deep the path follows files below the ones a handler names. */
const DEPTH = 3

const strings = s => [...s.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map(m => m[2])
const words = s => new Set(s.match(/[A-Za-z_]\w*/g) ?? [])
/** Whether a body calls its own `name`: bare, or on this/self, not a same-named method of something else. */
const ownCall = (text, name) => new RegExp(`(?:^|[^\\w.$]|\\b(?:this|self)\\.)${name}\\s*\\(`, 'm').test(text)
const stemOf = p => p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
const join2 = (...parts) => {
  const p = `/${parts.filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/')
  return p.length > 1 ? p.replace(/\/$/, '') : p
}
const VERBS = { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH' }

/** What one marked route line declares: a prefix for its file, a mount of another router, or an endpoint. */
function classify(lines, i, lang) {
  // Decorators and annotations can span lines; read until the call closes.
  let text = lines[i], k = i
  while (k < lines.length - 1 && k - i < 6 && (text.match(/\(/g) ?? []).length > (text.match(/\)/g) ?? []).length) text += ` ${lines[++k].trim()}`
  const first = strings(text)[0]
  const arg = (name) => text.match(new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([\\w.]+))`))
  if (lang === 'java' || lang === 'cs') {
    const next = lines.slice(k + 1).find(l => l.trim() && !/^\s*(@|\[)/.test(l)) ?? ''
    const isClass = /\bclass\s+\w+/.test(next)
    let m = text.match(/@(Get|Post|Put|Delete|Patch)Mapping\b/) ?? text.match(/\[Http(Get|Post|Put|Delete|Patch)\b/)
    if (m) return { kind: 'endpoint', method: m[1].toUpperCase(), path: first ?? '', end: k }
    if (/@RequestMapping\b|\[Route\b/.test(text)) {
      if (isClass) return { kind: 'prefix', path: (first ?? '').replace('[controller]', (next.match(/class\s+(\w+?)(Controller)?\b/) ?? [])[1] ?? ''), end: k }
      const verb = text.match(/RequestMethod\.(\w+)/)
      return { kind: 'endpoint', method: verb ? verb[1] : 'ANY', path: first ?? '', end: k }
    }
    m = text.match(/\.Map(Get|Post|Put|Delete|Patch)\s*\(/)
    if (m) return { kind: 'endpoint', method: m[1].toUpperCase(), path: first ?? '', end: k }
    return null
  }
  if (/\bAPIRouter\s*\(|\bBlueprint\s*\(/.test(text)) { const p = arg('prefix') ?? arg('url_prefix'); return { kind: 'prefix', path: p ? p[1] ?? '' : '', ref: p?.[2], end: k } }
  let m = text.match(/\.(include_router|register_blueprint)\s*\(\s*([\w.]+)/)
  if (m) { const p = arg('prefix') ?? arg('url_prefix'); return { kind: 'mount', target: m[2], path: p?.[1] ?? '', ref: p?.[2], end: k } }
  m = text.match(/\.(get|post|put|delete|patch|all|route|api_route|websocket)\s*\(/i) ?? text.match(/\.(HandleFunc|Handle)\s*\(/)
  if (m && first != null) {
    const verb = VERBS[m[1].toLowerCase()] ?? (text.match(/methods\s*=\s*\[\s*["'](\w+)/i)?.[1]?.toUpperCase() ?? 'ANY')
    return { kind: 'endpoint', method: verb, path: first, end: k }
  }
  return null
}

/** A JS file's imported names, each with the application file it comes from. */
function importsOf(path, text, edges) {
  const names = new Map()
  const file = spec => {
    const base = spec.split('/').pop().replace(/\.[cm]?[jt]sx?$/, '')
    return edges.find(e => e.to.split('/').pop().replace(/\.[^.]+$/, '') === base || e.to.endsWith(`/${base}/index.ts`) || e.to.endsWith(`/${base}/index.js`))?.to
  }
  for (const m of text.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    const to = file(m[3])
    if (!to) continue
    if (m[1]) names.set(m[1], to)
    for (const n of (m[2] ?? '').split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)) names.set(n, to)
  }
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) { const to = file(m[2]); if (to) names.set(m[1], to) }
  return names
}

/** Where each function a file declares starts: methods, Python defs, Go funcs, JS functions. */
function declarations(lines, lang) {
  const declared = new Map()
  lines.forEach((l, j) => {
    const m = lang === 'py' ? l.match(/^\s*(?:async\s+)?def\s+(\w+)/)
      : lang === 'go' ? l.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/)
      : lang === 'js' ? l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/)
      : l.match(/^\s*(?:(?:public|private|protected|internal|static|final|async|override|virtual)\s+)+[\w<>[\],.?\s]*?\b(\w+)\s*\([^;]*$/)
        // A package-private method (Java's default): a return type, then the name.
        ?? l.match(/^\s*(?!(?:return|new|else|throw|if|for|while|switch|catch|case|await|yield)\b)[A-Za-z_][\w<>[\],.?]*\s+(\w+)\s*\([^;]*$/)
    const name = m && (m[1] ?? m[2])
    if (name && !declared.has(name)) declared.set(name, j)
  })
  return declared
}

/** The lines of the handler that follows a route line: a braced block, or an indented Python body. */
function bodyOf(lines, from, lang) {
  if (lang === 'py') {
    const def = lines.findIndex((l, j) => j >= from && /^\s*(async\s+)?def\s+\w+/.test(l))
    if (def < 0) return { start: from, end: from, name: '' }
    const indent = lines[def].match(/^\s*/)[0].length
    let end = def
    // The signature can span lines; the body is everything indented deeper than the def.
    for (let j = def + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      if (lines[j].match(/^\s*/)[0].length <= indent && !/^\s*[)\]]/.test(lines[j])) break
      end = j
    }
    return { start: from, end, name: lines[def].match(/def\s+(\w+)/)[1] }
  }
  if (!BRACES.has(lang)) return { start: from, end: from, name: '' }
  let depth = 0, opened = false, name = ''
  for (let j = from; j < lines.length; j++) {
    // Annotations ({ "/vets" }) carry braces of their own; the body starts after them.
    if (!opened && /^\s*(@|\[)/.test(lines[j])) continue
    const code = lines[j].replace(/\/\/.*$/, '').replace(/(["'])(?:(?!\1)[^\\]|\\.)*\1/g, '""')
    if (!name) name = code.match(/(\w+)\s*\(/)?.[1] ?? ''
    for (const c of code) {
      if (c === '{') { depth++; opened = true } else if (c === '}') depth--
      if (opened && depth === 0) return { start: from, end: j, name }
    }
    // A route line with a handler inline (app.get('/x', (req, res) => ...)) ends with its statement.
    if (!opened && j > from + 1 && /;\s*$/.test(code)) return { start: from, end: j, name }
  }
  return { start: from, end: lines.length - 1, name }
}

/**
 * Every endpoint of the application files in `graph`, with the path its requests take.
 * @returns {{ method: string, path: string, file: string, line: number, name: string, steps: string[], views: string[], response: { redirect?: string, model?: string, json?: boolean } }[]}
 */
export function endpoints(graph) {
  const read = new Map()
  const src = p => read.get(p) ?? read.set(p, readFileSync(join(graph.repo, p), 'utf8').split(/\r?\n/)).get(p)
  const byPath = new Map(graph.files.map(f => [f.path, f]))
  const out = new Map(), into = new Map()
  for (const e of graph.edges) if (!e.types) {
    out.set(e.from, [...(out.get(e.from) ?? []), e])
    into.set(e.to, [...(into.get(e.to) ?? []), e])
  }
  // String constants anywhere (API_V1_STR = "/api/v1"), so prefixes given by name resolve.
  const consts = new Map()
  for (const f of graph.files) if (f.lang !== 'view') for (const m of src(f.path).join('\n').matchAll(/\b([A-Z_][A-Z0-9_]*)\s*(?::\s*\w+)?\s*=\s*["']([^"'\n]*)["']/g)) if (!consts.has(m[1])) consts.set(m[1], m[2])
  const constant = ref => (ref ? consts.get(ref.split('.').pop()) ?? '' : '')

  // Each file's own prefix, the routers it mounts, and its endpoints.
  const files = new Map()
  for (const f of graph.files) {
    const routes = f.hints.filter(h => h.kind === 'route')
    if (!routes.length) continue
    const lines = src(f.path)
    const info = { prefix: '', mounts: [], endpoints: [] }
    for (const h of routes) {
      const c = classify(lines, h.line - 1, f.lang)
      if (!c) continue
      if (c.kind === 'prefix') info.prefix = c.path || constant(c.ref)
      else if (c.kind === 'mount') {
        // The mounted router is a name this file imports: follow the edge that brings it in.
        const head = c.target.split('.')[0]
        const edge = (out.get(f.path) ?? []).find(e => e.names.some(n => n.replace(/\W+$/, '') === head))
        if (edge) info.mounts.push({ file: edge.to, path: c.path || constant(c.ref) })
      } else info.endpoints.push({ ...c, line: h.line })
    }
    files.set(f.path, info)
  }
  // The prefix a file's routes sit under: what mounts it, all the way up.
  const mounted = new Map()
  for (const [path, info] of files) for (const m of info.mounts) if (!mounted.has(m.file)) mounted.set(m.file, { by: path, path: m.path })
  // JS routers mount each other with .use(prefix?, router), on a router variable or down a chain.
  const jsLocal = new Map() // file → router variable → its prefix within the file
  for (const f of graph.files) if (f.lang === 'js') {
    const lines = src(f.path), text = lines.join('\n')
    if (!/\.use\s*\(/.test(text)) continue
    const imported = importsOf(f.path, text, out.get(f.path) ?? [])
    const uses = []
    for (const m of text.matchAll(/\.use\s*\(\s*(?:(['"`])([^'"`]*)\1\s*,\s*)?([A-Za-z_$][\w$.]*)\s*\)/g)) {
      // The router the call hangs on: the head of its statement, which a chain continues line by line.
      let k = text.slice(0, m.index).split('\n').length - 1
      while (k > 0 && /^\s*\./.test(lines[k])) k--
      const head = lines[k]
      const holder = head.match(/(?:const|let|var)\s+(\w+)\s*=/)?.[1] ?? (/\bexport\s+default\b/.test(head) ? 'default' : head.match(/(\w+)\s*\.\s*use\b/)?.[1] ?? '')
      uses.push({ holder, path: m[2] ?? '', target: m[3] })
    }
    const local = new Map()
    for (let round = 0; round < 4; round++) for (const u of uses) if (!imported.has(u.target)) local.set(u.target, join2(local.get(u.holder) ?? '', u.path))
    for (const u of uses) if (imported.has(u.target) && !mounted.has(imported.get(u.target))) mounted.set(imported.get(u.target), { by: f.path, path: join2(local.get(u.holder) ?? '', u.path) })
    jsLocal.set(f.path, local)
  }
  // Go routers: groups held in variables (v1 := r.Group("/api")), and register functions that take a
  // group and add routes to it, called with one (users.Register(v1.Group("/users"))).
  const goVars = new Map(), registers = new Map()
  for (const f of graph.files) if (f.lang === 'go') {
    const text = src(f.path).join('\n')
    goVars.set(f.path, new Map([...text.matchAll(/\b(\w+)\s*:?=\s*(\w+)\.Group\(\s*"([^"]*)"/g)].map(m => [m[1], { base: m[2], path: m[3] }])))
    for (const m of text.matchAll(/^func\s+(\w+)\s*\(\s*(\w+)\s+\*?[\w.]*(?:RouterGroup|Group|Router|Engine|ServeMux|Mux)\b/gm)) registers.set(m[1], { file: f.path, param: m[2] })
  }
  const goVar = (file, v, d = 0) => {
    const g = goVars.get(file)?.get(v)
    return g && d < 8 ? join2(goVar(file, g.base, d + 1), g.path) : ''
  }
  const goParam = new Map()
  for (const f of graph.files) if (f.lang === 'go') {
    const text = src(f.path).join('\n')
    for (const [name] of registers) for (const m of text.matchAll(new RegExp(`\\b(?:\\w+\\.)?${name}\\(\\s*(\\w+)(?:\\.Group\\(\\s*"([^"]*)"\\s*\\))?\\s*\\)`, 'g'))) {
      if (!goParam.has(name)) goParam.set(name, join2(goVar(f.path, m[1]), m[2] ?? ''))
    }
  }
  const above = (path, seen = new Set()) => {
    const m = mounted.get(path)
    if (!m || seen.has(path)) return ''
    seen.add(path)
    return join2(above(m.by, seen), files.get(m.by)?.prefix ?? '', m.path)
  }

  // What a handler's file says: its lines, field types, string constants and declared functions.
  const contexts = new Map()
  const context = p => {
    if (contexts.has(p)) return contexts.get(p)
    const lang = byPath.get(p).lang, lines = src(p), whole = lines.join('\n')
    // Fields and constructor parameters name the types a handler reaches through (this.owners → OwnerRepository).
    const typeOf = new Map()
    if (BRACES.has(lang)) for (const m of whole.matchAll(/\b([A-Z]\w*)(?:<[^>\n]*>)?[ \t]+(\w+)[ \t]*[;=,)]/g)) if (!typeOf.has(m[2])) typeOf.set(m[2], m[1])
    const constOf = new Map([...whole.matchAll(/\b(\w+)\s*(?::\s*\w+)?\s*=\s*"([^"\n]*)"/g)].map(m => [m[1], m[2]]))
    const ctx = { lang, lines, whole, typeOf, constOf, declared: declarations(lines, lang) }
    contexts.set(p, ctx)
    return ctx
  }
  // A body's text, with the bodies of the same file's helpers it calls itself (name( or this.name(),
  // not a method of the same name on something else (repository.getKingdomByName().
  const withHelpers = (c, text, skip) => {
    let t = text
    for (const w of words(text)) {
      if (skip.includes(w) || !c.declared.has(w) || !ownCall(text, w)) continue
      const b = bodyOf(c.lines, c.declared.get(w), c.lang)
      t += `\n${c.lines.slice(b.start, b.end + 1).join('\n')}`
    }
    return t
  }
  /**
   * The part of file `p` a caller's text uses: the bodies of the methods it calls there, or null
   * when it calls none `p` declares. A call on a receiver counts when the caller's field or variable
   * of that name has `p`'s type, or a type the caller does not say (a module alias, a local).
   */
  const partOf = (p, callerText, caller) => {
    const c = context(p), typeOf = context(caller).typeOf, own = stemOf(p)
    const calls = new Set()
    for (const m of callerText.matchAll(/(?:\b(\w+)\s*\??\.\s*)?\b(\w+)\s*\(/g)) {
      const [, recv, name] = m
      if (!c.declared.has(name) || recv === 'this' || recv === 'self') continue
      // A chained call (notFound().build()) is on whatever the chain returned, never a bare call.
      if (!recv && /\.\s*$/.test(callerText.slice(Math.max(0, m.index - 4), m.index))) continue
      const type = recv ? typeOf.get(recv) : null
      if (!type || type === own) calls.add(name)
    }
    if (!calls.size) return null
    const bodies = [...calls].map(n => { const b = bodyOf(c.lines, c.declared.get(n), c.lang); return c.lines.slice(b.start, b.end + 1).join('\n') }).join('\n')
    return withHelpers(c, bodies, [...calls]).replace(/\/\*[\s\S]*?\*\//g, ' ')
  }
  /** Whether an edge out of `p` is one `part` of it uses: a name it imports, or the type of a field it reads. */
  const usedBy = (p, part) => {
    const c = context(p), used = words(part)
    for (const w of [...used]) if (c.typeOf.has(w)) used.add(c.typeOf.get(w))
    const local = c.lang === 'js' ? importsOf(p, c.whole, out.get(p) ?? []) : new Map()
    return e => [...e.names.map(n => n.replace(/\W+$/, '')), ...[...local].filter(([, to]) => to === e.to).map(([n]) => n)].some(n => used.has(n))
  }
  /** Where in `part` of file `p` an edge's target is first used: by a name it imports, or a field of its type. */
  const firstUse = (p, part) => {
    const c = context(p), first = new Map()
    for (const m of part.matchAll(/[A-Za-z_]\w*/g)) {
      for (const n of [m[0], c.typeOf.get(m[0])]) if (n && !first.has(n)) first.set(n, m.index)
    }
    return e => Math.min(...e.names.map(n => first.get(n.replace(/\W+$/, '')) ?? Infinity))
  }
  const dir = p => p.slice(0, p.lastIndexOf('/') + 1)
  const ROUTE_CALL = /([\w$]+)\s*\.\s*(?:get|post|put|delete|patch|all|route|HandleFunc|Handle)\s*\(/i

  const result = [], seen = new Set()
  for (const [path, info] of files) {
    const f = byPath.get(path), { lines } = context(path)
    for (const ep of info.endpoints) {
      const call = lines.slice(ep.line - 1, ep.end + 1).join(' ')
      // The prefix: a JS router's place in its file, a Go group's path, or the file's own.
      const recv = call.match(ROUTE_CALL)?.[1]
      let prefix = join2(above(path), info.prefix)
      if (f.lang === 'js') prefix = join2(above(path), jsLocal.get(path)?.get(recv) ?? '')
      else if (f.lang === 'go') {
        const fn = lines.slice(0, ep.line).reverse().find(l => /^func\s/.test(l))?.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)/)?.[1]
        prefix = fn && registers.get(fn)?.param === recv ? goParam.get(fn) ?? '' : goVar(path, recv)
      }
      const full = join2(prefix, ep.path)
      if (seen.has(`${ep.method} ${full}`)) continue
      seen.add(`${ep.method} ${full}`)
      // The handler: written inline after the route, or a function the route names, in this file,
      // its package (Go) or the module it was imported from (JS).
      let hp = path, from = ep.line - 1, name = null
      const inline = /=>|\bfunction\b|\bfunc\s*\(/.test(call)
      const ref = (f.lang === 'js' || f.lang === 'go') && !inline ? call.match(/,\s*([\w$.]+)\s*\)\s*;?\s*$/)?.[1] : null
      if (ref) {
        const last = ref.split('.').pop()
        const owner = ref.includes('.') && f.lang === 'js' ? importsOf(path, context(path).whole, out.get(path) ?? []).get(ref.split('.')[0]) : null
        const candidates = owner ? [owner] : [path, ...(f.lang === 'go' ? graph.files.filter(g => g.lang === 'go' && g.path !== path && dir(g.path) === dir(path)).map(g => g.path) : [])]
        for (const c of candidates) { const d = context(c).declared.get(last); if (d != null) { hp = c; from = d; name = last; break } }
      }
      const hc = context(hp)
      const body = bodyOf(hc.lines, from, hc.lang)
      if (name == null) name = (f.lang === 'js' || f.lang === 'go') && inline ? '' : body.name
      // A handler's helper functions in the same file count as part of its body.
      let text = hc.lines.slice(body.start, body.end + 1).join('\n')
      for (const w of words(text)) {
        if (w === name || !hc.declared.has(w) || !ownCall(text, w)) continue
        const helper = bodyOf(hc.lines, hc.declared.get(w), hc.lang)
        text += `\n${hc.lines.slice(helper.start, helper.end + 1).join('\n')}`
      }
      text = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
      const used = words(text)
      for (const w of [...used]) { if (hc.typeOf.has(w)) used.add(hc.typeOf.get(w)) }
      const said = [...strings(text), ...[...used].filter(w => hc.constOf.has(w)).map(w => hc.constOf.get(w))]
      // Files the handler names, in the order its body first names them. In JS a module is also
      // named by what the file imported it as (const service = require('./orders.service')).
      const local = hc.lang === 'js' ? importsOf(hp, hc.whole, out.get(hp) ?? []) : new Map()
      const namesOf = e => [...e.names.map(n => n.replace(/\W+$/, '')), ...[...local].filter(([, to]) => to === e.to).map(([n]) => n)]
      const at = e => Math.min(...namesOf(e).filter(n => used.has(n)).map(n => text.search(new RegExp(`\\b${n}\\b`))).filter(x => x >= 0), Infinity)
      const views = [], direct = []
      for (const e of out.get(hp) ?? []) {
        const t = byPath.get(e.to)
        if (t?.lang === 'view') {
          const key = e.to.replace(/^.*?(?:^|\/)(?:templates|views|Views)\//, ''), bare = key.replace(/\.[^./]+$/, '')
          if (said.some(s => s === key || s === bare)) views.push(e.to)
        } else if (namesOf(e).some(n => used.has(n))) direct.push(e)
      }
      direct.sort((a, b) => at(a) - at(b))
      const reaches = new Map()
      const leads = (p, d, seen) => {
        if (reaches.has(p)) return reaches.get(p)
        const own = byPath.get(p)?.hints.some(h => BOUNDARY.has(h.kind)) ?? false
        if (d >= DEPTH || seen.has(p)) return own
        seen.add(p)
        let any = own
        for (const e of out.get(p) ?? []) if (byPath.get(e.to)?.lang !== 'view' && leads(e.to, d + 1, seen)) any = true
        reaches.set(p, any)
        return any
      }
      // A file that reaches the outside itself is where the path ends: what else it imports
      // (a seeding helper next to the engine) is not part of this request.
      const own = p => byPath.get(p)?.hints.some(h => BOUNDARY.has(h.kind)) ?? false
      // The steps in call order: the handler, the files it calls that lead somewhere, what those
      // call in turn, and last the files it only names (request and response types).
      const lead = direct.filter(e => leads(e.to, 1, new Set())), data = direct.filter(e => !lead.includes(e))
      const steps = [hp]
      // Below the handler a file takes part through the methods its caller calls on it, so only
      // what those methods use goes on; a file whose called methods are not its own (an inherited
      // or generated API) is followed whole. Each file's calls follow it at once, in the order its
      // body makes them, so the steps read as the request runs.
      const visit = (p, d, callerText, caller) => {
        steps.push(p)
        if (own(p) || d >= DEPTH) return
        const part = partOf(p, callerText, caller)
        const uses = part == null ? () => true : usedBy(p, part)
        const at = firstUse(p, part ?? context(p).whole)
        const next = (out.get(p) ?? []).filter(e => !steps.includes(e.to) && byPath.get(e.to)?.lang !== 'view' && uses(e) && leads(e.to, d + 1, new Set()))
        for (const e of next.sort((a, b) => at(a) - at(b))) if (!steps.includes(e.to)) visit(e.to, d + 1, part ?? context(p).whole, p)
      }
      for (const e of lead) if (!steps.includes(e.to)) visit(e.to, 1, text, hp)
      for (const e of data) if (!steps.includes(e.to)) steps.push(e.to)
      const redirect = said.find(s => s.startsWith('redirect:'))
      // What comes back: FastAPI's response_model, the type a typed handler returns (Task<ArticleEnvelope>,
      // a @ResponseBody method's type), or JSON the body writes (c.JSON, res.json, jsonify).
      const sig = hc.lines.slice(body.start, Math.min(body.start + 4, hc.lines.length)).filter(l => !/^\s*(@|\[)/.test(l)).join(' ')
      const typed = sig.match(/\b(?:Value)?Task<(?:ActionResult<)?(\w+)>/)?.[1]
      const java = hc.lang === 'java' && /@ResponseBody|@RestController/.test(`${hc.lines.slice(body.start, body.start + 4).join(' ')} ${hc.whole}`) ? javaReturn(sig) : null
      // A framework's result type (IActionResult, ObjectResult) says how, not what: it is not the model.
      const model = call.match(/response_model\s*=\s*([\w.[\]]+)/)?.[1] ?? java ?? (typed && !/^(I?ActionResult|ObjectResult|JsonResult|String|Object|Void)$/.test(typed) ? typed : null)
      const json = !!model || /^(ObjectResult|JsonResult)$/.test(typed ?? '') || /\bc\.(JSON|IndentedJSON)\s*\(|\bres(?:\.status\([^)]*\))?\.json\s*\(|\bjsonify\s*\(|\bJSONResponse\s*\(|\bResults\.(Json|Ok|Created)\s*\(|\breturn\s+(Ok|Json|Created|CreatedAtAction|CreatedAtRoute)\s*\(|\bStatusCode\s*\(\s*[\w.]+\s*,/.test(text)
      const response = { ...(redirect ? { redirect: redirect.slice('redirect:'.length) || '/' } : {}), ...(model ? { model } : {}), ...(json ? { json } : {}) }
      result.push({ method: ep.method, path: full, file: hp, line: hp === path ? ep.line : from + 1, name, steps, views, response })
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/**
 * The type a Java handler returns, out of the wrappers that only say how it comes back:
 * `ResponseEntity<Optional<List<Order>>> all(` gives List<Order>; a wildcard or a plain String gives null.
 */
function javaReturn(sig) {
  let t = sig.match(/(?:^|\s)([A-Z][\w.]*(?:<[^()]*>)?(?:\[\])?)\s+\w+\s*\(/)?.[1]
  while (t && /^(ResponseEntity|HttpEntity|Optional|CompletableFuture|CompletionStage|Mono|Callable|DeferredResult)<.*>$/.test(t)) t = t.slice(t.indexOf('<') + 1, -1).trim()
  return t && !/^(\?|String|Object|Void|ResponseEntity|HttpEntity)$/.test(t) ? t : null
}
