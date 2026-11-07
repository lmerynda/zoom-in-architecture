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
 * @returns {{ method: string, path: string, file: string, line: number, name: string, steps: string[], views: string[], response: { redirect?: string, model?: string } }[]}
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
  const above = (path, seen = new Set()) => {
    const m = mounted.get(path)
    if (!m || seen.has(path)) return ''
    seen.add(path)
    return join2(above(m.by, seen), files.get(m.by)?.prefix ?? '', m.path)
  }

  const result = []
  for (const [path, info] of files) {
    const f = byPath.get(path), lines = src(path)
    // Fields and constructor parameters name the types a handler reaches through (this.owners → OwnerRepository).
    const whole = lines.join('\n')
    const typeOf = new Map()
    if (BRACES.has(f.lang)) for (const m of whole.matchAll(/\b([A-Z]\w*)(?:<[^>\n]*>)?[ \t]+(\w+)[ \t]*[;=,)]/g)) if (!typeOf.has(m[2])) typeOf.set(m[2], m[1])
    const constOf = new Map([...whole.matchAll(/\b(\w+)\s*(?::\s*\w+)?\s*=\s*"([^"\n]*)"/g)].map(m => [m[1], m[2]]))
    // Methods the file declares, so a handler's helper methods count as part of its body.
    const declared = new Map()
    lines.forEach((l, j) => {
      const m = f.lang === 'py' ? l.match(/^\s*(?:async\s+)?def\s+(\w+)/) : l.match(/^\s*(?:(?:public|private|protected|internal|static|final|async|override|virtual)\s+)+[\w<>[\],.?\s]*?\b(\w+)\s*\([^;]*$/)
      if (m && !declared.has(m[1])) declared.set(m[1], j)
    })
    for (const ep of info.endpoints) {
      const body = bodyOf(lines, ep.line - 1, f.lang)
      let text = lines.slice(body.start, body.end + 1).join('\n')
      for (const w of words(text)) {
        if (w === body.name || !declared.has(w) || !new RegExp(`\\b${w}\\s*\\(`).test(text)) continue
        const helper = bodyOf(lines, declared.get(w), f.lang)
        text += `\n${lines.slice(helper.start, helper.end + 1).join('\n')}`
      }
      text = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
      const used = words(text)
      for (const w of [...used]) { if (typeOf.has(w)) used.add(typeOf.get(w)) }
      const said = [...strings(text), ...[...used].filter(w => constOf.has(w)).map(w => constOf.get(w))]
      // Files the handler names, in the order its body first names them.
      const at = e => Math.min(...e.names.map(n => n.replace(/\W+$/, '')).filter(n => used.has(n)).map(n => text.search(new RegExp(`\\b${n}\\b`))).filter(x => x >= 0), Infinity)
      const views = [], direct = []
      for (const e of out.get(path) ?? []) {
        const t = byPath.get(e.to)
        if (t?.lang === 'view') {
          const key = e.to.replace(/^.*?(?:^|\/)(?:templates|views|Views)\//, ''), bare = key.replace(/\.[^./]+$/, '')
          if (said.some(s => s === key || s === bare)) views.push(e.to)
        } else if (e.names.some(n => used.has(n.replace(/\W+$/, '')))) direct.push(e)
      }
      direct.sort((a, b) => at(a) - at(b))
      // Below those, only files on the way to a store or another service.
      const steps = [path, ...direct.map(e => e.to)]
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
      const queue = direct.filter(e => !own(e.to)).map(e => [e.to, 1])
      while (queue.length) {
        const [p, d] = queue.shift()
        if (d >= DEPTH) continue
        for (const e of out.get(p) ?? []) {
          if (steps.includes(e.to) || byPath.get(e.to)?.lang === 'view' || !leads(e.to, d + 1, new Set())) continue
          steps.push(e.to)
          if (!own(e.to)) queue.push([e.to, d + 1])
        }
      }
      const redirect = said.find(s => s.startsWith('redirect:'))
      const model = lines.slice(ep.line - 1, ep.end + 1).join(' ').match(/response_model\s*=\s*([\w.[\]]+)/)?.[1]
      const response = { ...(redirect ? { redirect: redirect.slice('redirect:'.length) || '/' } : {}), ...(model ? { model } : {}) }
      result.push({ method: ep.method, path: join2(above(path), info.prefix, ep.path), file: path, line: ep.line, name: body.name, steps, views, response })
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}
