// What a project's own end-to-end tests really execute: run them with an OpenTelemetry agent
// attached, receive the spans (otlp.mjs), and sum them up per endpoint: how often it ran, with
// which statuses, which tables it read and wrote, which repositories and handlers it went through.
// The map then marks what it inferred from code as seen in tests, or not. Request level: what
// crosses a boundary (HTTP in, SQL and calls out) and the named data-access and handler spans.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { receive } from './otlp.mjs'

/** Where the Java agent is kept (gitignored), and where to fetch it from. */
export const JAVA_AGENT = join(import.meta.dirname, '../.cache/otel/opentelemetry-javaagent.jar')
export const JAVA_AGENT_URL = 'https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar'

/** Loaded into the command's Node processes, to tell which test made a request (trace-preload.mjs). */
const PRELOAD = join(import.meta.dirname, 'trace-preload.mjs')

/**
 * The environment that makes every JVM the command starts export its spans to `endpoint`:
 * JAVA_TOOL_OPTIONS reaches a JVM however a test harness launches it. Controller spans are on, so
 * a request names its handler; statements stay sanitized (the agent's default), so no value from
 * a test leaves the project. A request's Referer header is kept: a browser's request names the page
 * that made it. Spans go to `endpoint` only: exporter settings the shell already has (a CI's own
 * collector, its headers) are dropped, so nothing the trace records leaves this machine. With
 * `tests` (a file), a Node test runner's files name themselves to the servers they start and write
 * when each test ran there (trace-preload.mjs); it needs Node 18.19 or later in every Node the
 * command starts, so `trace --no-tests` leaves it out. With `methods` (an agent configuration
 * file naming the project's own methods, see projectMethods), each of those methods is a span too,
 * and the export queue is made long enough to carry them; a method list the shell already has
 * (OTEL_INSTRUMENTATION_METHODS_INCLUDE) is dropped, so only the project's own are listed. Paths in
 * JAVA_TOOL_OPTIONS are quoted, so a folder with a space in its name works.
 */
export function tracingEnv(endpoint, base = process.env, { tests = null, methods = null } = {}) {
  if (!existsSync(JAVA_AGENT)) throw new Error(`no OpenTelemetry Java agent at ${JAVA_AGENT}; fetch it from ${JAVA_AGENT_URL}`)
  const own = Object.fromEntries(Object.entries(base).filter(([k]) => !/^OTEL_EXPORTER_|^OTEL_INSTRUMENTATION_METHODS_INCLUDE$/i.test(k)))
  const quoted = p => `"${p.replace(/\\/g, '/')}"`
  return {
    ...own,
    JAVA_TOOL_OPTIONS: [base.JAVA_TOOL_OPTIONS, `-javaagent:${quoted(JAVA_AGENT)}`, methods && `-Dotel.javaagent.configuration-file=${quoted(methods)}`].filter(Boolean).join(' '),
    OTEL_SERVICE_NAME: base.OTEL_SERVICE_NAME ?? 'traced',
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_BSP_SCHEDULE_DELAY: '200',
    ...(methods ? { OTEL_BSP_MAX_QUEUE_SIZE: '262144', OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '4096' } : {}),
    OTEL_INSTRUMENTATION_COMMON_EXPERIMENTAL_CONTROLLER_TELEMETRY_ENABLED: 'true',
    OTEL_INSTRUMENTATION_COMMON_DB_STATEMENT_SANITIZER_ENABLED: 'true',
    OTEL_INSTRUMENTATION_HTTP_SERVER_CAPTURE_REQUEST_HEADERS: 'referer',
    ...(tests ? { ZOOM_TRACE_TESTS: tests, NODE_OPTIONS: [base.NODE_OPTIONS, `--import="${pathToFileURL(PRELOAD).href}"`].filter(Boolean).join(' ') } : {}),
  }
}

/**
 * Runs `command` (an argv array) in `cwd` with tracing attached and sums up what it ran as the spans
 * arrive (observer). With `methods`, the project's own methods (projectMethods(cwd)) are traced too
 * and each endpoint gets its call tree. Resolves with what was observed (the tests named, files
 * relative to `cwd`), the exit code and how long it took; the command's output goes to `log`.
 */
export async function runTraced(cwd, command, { log = s => process.stderr.write(s), settleMs = 2500, testNames = true, methods = false } = {}) {
  // The project's own methods first: nothing is started when it has none.
  const m = methods ? projectMethods(cwd) : null
  if (m && !m.classes) throw new Error(`no Java classes with methods in the repository of ${cwd}: --methods traces a JVM project's own code`)
  if (m) log(`tracing ${m.methods} methods of ${m.classes} classes${m.skipped ? ` (${m.skipped} more have names the agent does not take)` : ''}\n`)
  // Only those classes are named in a tree: the agent also traces a subclass elsewhere that overrides one.
  const o = observer({ methods, own: m?.names ?? null })
  const r = await receive(s => o.add(s))
  const scratch = mkdtempSync(join(tmpdir(), 'zoom-trace-')), tests = join(scratch, 'tests.jsonl')
  const t0 = Date.now()
  try {
    let config = null
    if (m) {
      config = join(scratch, 'methods.properties')
      writeFileSync(config, `otel.instrumentation.methods.include=${m.include}\n`)
    }
    const child = spawn(command[0], command.slice(1), { cwd, env: tracingEnv(r.endpoint, process.env, { tests: testNames ? tests : null, methods: config }), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    child.stdout.on('data', d => log(String(d)))
    child.stderr.on('data', d => log(String(d)))
    const code = await new Promise(res => child.on('exit', c => res(c ?? 1)))
    // The last batches leave a JVM as it exits; give them a moment to arrive.
    await new Promise(res => setTimeout(res, settleMs))
    return { observed: o.result(testRuns(existsSync(tests) ? readFileSync(tests, 'utf8') : ''), { root: cwd }), code, ms: Date.now() - t0 }
  } finally {
    await r.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The tests the preload saw run, from its JSON lines: { file, test, start, end } (ms). A line cut off is skipped. */
export function testRuns(text) {
  return text.split('\n').flatMap(l => { try { const t = JSON.parse(l); return t.file && t.test && t.start <= t.end ? [t] : [] } catch { return [] } })
}

const method = s => s.attrs['http.request.method'] ?? s.attrs['http.method'] ?? s.name.split(' ')[0]
const route = s => s.attrs['http.route'] ?? null
const status = s => s.attrs['http.response.status_code'] ?? s.attrs['http.status_code'] ?? null
const table = s => s.attrs['db.sql.table'] ?? s.attrs['db.collection.name'] ?? null
const operation = s => String(s.attrs['db.operation'] ?? s.attrs['db.operation.name'] ?? '').toUpperCase().split(' ')[0] || null
/** The path of the page a browser's request came from (its Referer), or null. */
const pageOf = s => {
  const r = s.attrs['http.request.header.referer']
  const v = Array.isArray(r) ? r[0] : r
  if (!v) return null
  // A browser sends the path percent-encoded ("/%C3%B6"); routes are written plain.
  try { return decodeURIComponent(new URL(v).pathname).replace(/\/+$/, '') || '/' } catch { return null }
}
/** The test file whose server a span came from (trace-preload.mjs), or null. */
const testFileOf = s => { const f = s.resource?.['zoom.test.file']; try { return f ? decodeURIComponent(f) : null } catch { return f } }
/** The method a span ran, "com.x.Foo.bar": the older code.namespace and code.function, or the stable code.function.name. */
const codeAt = s => {
  if (s.attrs['code.namespace'] && s.attrs['code.function']) return `${s.attrs['code.namespace']}.${s.attrs['code.function']}`
  const f = s.attrs['code.function.name']
  return typeof f === 'string' && f.includes('.') ? f.replace(/::/g, '.') : null
}
/** The class of a method codeAt names: "com.x.Foo" of "com.x.Foo.bar". */
const classOf = at => at.slice(0, at.lastIndexOf('.'))

/** A route template as the map writes paths: `{id}` for any parameter, no trailing slash. */
export const normalRoute = p => (p.replace(/:([A-Za-z_]\w*)/g, '{$1}').replace(/<[^>]*>/g, '{p}').replace(/\/+$/, '') || '/')

/**
 * Which test made a request: { file, test } for the test running in the span's test file when it
 * started; a subtest running inside its parent is the one named. test is null when no single test was
 * running there (a file's set-up, tests side by side); null when no test file's server made it.
 */
export function testOf(span, byFile) {
  const file = testFileOf(span)
  if (!file) return null
  const running = (byFile.get(file) ?? []).filter(t => t.start <= span.start && span.start <= t.end).sort((a, b) => a.start - b.start)
  const inner = running[running.length - 1]
  // Each running test holds the next (node:test names a subtest "parent > child"): the innermost made it.
  const nested = running.every((t, k) => k === running.length - 1 || inner.test.startsWith(`${t.test} > `))
  return { file, test: running.length && nested ? inner.test : null }
}

/** The most calls a call tree keeps under one call, and the deepest it goes; past that, one "N more". */
export const TREE_KIDS = 25, TREE_DEPTH = 12
/** How many distinct calls a tree holds under one caller while it is built, so a wide fan-out stays cheap. */
const TREE_HOLD = 200

/**
 * A request's call tree, from its server span: each named span under it with the named spans under
 * that, in the order they started. Named are the methods of `own` classes (the project's, when given)
 * and the tables touched; any other span passes its children up. A span that is its caller's only
 * child and names the same method is the same call seen twice (the agent's controller span over the
 * method's own span) and is folded into it; a method calling itself among other calls is kept.
 */
export function callTree(root, kids, own = null, depth = 0) {
  if (depth >= TREE_DEPTH) return []
  const name = s => { const c = codeAt(s); if (c) return !own || own.has(c.slice(0, c.lastIndexOf('.'))) ? c : null; return table(s) && operation(s) ? `${operation(s)} ${table(s)}` : null }
  const named = s => (kids.get(s.id) ?? []).flatMap(c => {
    const n = name(c)
    if (n && !(n === name(s) && (kids.get(s.id) ?? []).length === 1)) return [c]
    return named(c)
  })
  return named(root).map(c => ({ at: name(c), count: 1, kids: callTree(c, kids, own, depth + 1) }))
}

/** Folds call trees into one: calls of one name under one caller add up, in the order first seen. */
export function mergeTrees(into, list) {
  into.index ??= new Map(into.map(n => [n.at, n]))
  for (const n of list) {
    const m = into.index.get(n.at)
    if (m) { m.count += n.count; mergeTrees(m.kids, n.kids) } else if (into.length < TREE_HOLD) {
      const fresh = { at: n.at, count: n.count, kids: mergeTrees([], n.kids) }
      into.push(fresh)
      into.index.set(n.at, fresh)
    } else into.dropped = (into.dropped ?? 0) + n.count
  }
  return into
}

/** A merged tree cut to size: past TREE_KIDS calls under one caller, the rest is one "N more" with their count. */
export function pruneTree(list) {
  const kept = list.slice(0, TREE_KIDS).map(n => ({ at: n.at, count: n.count, ...(n.kids.length ? { kids: pruneTree(n.kids) } : {}) }))
  const rest = list.slice(TREE_KIDS), more = rest.length + (list.dropped ? 1 : 0)
  if (more) kept.push({ at: `${list.dropped ? `${rest.length}+` : rest.length} more`, count: rest.reduce((k, n) => k + n.count, 0) + (list.dropped ?? 0) })
  return kept
}

/**
 * Sums spans up per endpoint (method and route template, from server spans) as they arrive: how
 * many requests, their statuses, the tables each read or wrote (from SQL spans under it), the code
 * it went through (codeCalls: for each class a span of code names, as the agent names it, so
 * com.x.Foo$Inner apart from com.x.Foo, its spans by the class of the nearest span of code above
 * them, '' when there is none but the request: { 'com.x.Repo': { 'com.x.Ctl': 2 }, 'com.x.Ctl':
 * { '': 1 } }; observed.mjs decides from it which spans are calls into a file), outgoing calls, the
 * pages a browser made them from (Referer), and with `methods` its call tree (of `own` classes when
 * given). A trace is summed once it has had a root span and no new span for `quietMs` (a JVM exports
 * a span when it ends, a child sometimes after its parent), or once it has had no new span for
 * `staleMs` whatever came (a root in another process never comes here), and then dropped, so a long
 * run with method spans does not hold them all. Spans outside any request (startup, schedules) are
 * summed apart as background work. result(tests, { root }) sums what is left and names the tests
 * that made each request ("file › test", the file relative to `root`; `untimed` counts those a test
 * file's server got while no single test ran).
 */
export function observer({ methods = false, own = null, now = Date.now, quietMs = 5000, staleMs = 60000 } = {}) {
  const endpoints = new Map(), background = new Map()
  const pending = new Map()
  let count = 0, swept = 0
  const add = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
  const sum = group => {
    const byId = new Map(group.map(s => [s.id, s]))
    const kids = new Map()
    for (const s of group) if (s.parent && byId.has(s.parent)) { const k = kids.get(s.parent); if (k) k.push(s); else kids.set(s.parent, [s]) }
    for (const k of kids.values()) k.sort((a, b) => a.start - b.start)
    // Every span under s, each with the class of the nearest span of code above it ('' none).
    const below = s => { const out = []; const walk = (x, by) => { for (const c of kids.get(x.id) ?? []) { out.push([c, by]); walk(c, codeAt(c) ? classOf(codeAt(c)) : by) } }; walk(s, ''); return out }
    for (const s of group) {
      if (s.kind === 'server' && route(s)) {
        const key = `${method(s)} ${normalRoute(route(s))}`
        const e = endpoints.get(key) ?? { method: method(s), route: normalRoute(route(s)), count: 0, statuses: new Map(), tables: new Map(), codeCalls: new Map(), calls: new Map(), pages: new Map(), at: [], tree: [] }
        e.count++
        if (pageOf(s)) add(e.pages, pageOf(s))
        // When and from which test file's server: the test is named once the run is over.
        const file = testFileOf(s)
        if (file) e.at.push([s.start, file])
        if (status(s) != null) add(e.statuses, String(status(s)))
        for (const [c, by] of below(s)) {
          if (table(c) && operation(c)) { const ops = e.tables.get(table(c)) ?? new Set(); ops.add(operation(c)); e.tables.set(table(c), ops) }
          if (codeAt(c)) { const cls = classOf(codeAt(c)), m = e.codeCalls.get(cls) ?? new Map(); add(m, by); e.codeCalls.set(cls, m) }
          if (c.kind === 'client' && (c.attrs['url.full'] || c.attrs['server.address']) && !c.attrs['db.system']) add(e.calls, `${method(c)} ${c.attrs['server.address'] ?? new URL(c.attrs['url.full']).host}`)
        }
        if (methods) mergeTrees(e.tree, callTree(s, kids, own))
        endpoints.set(key, e)
      } else if (!s.parent || !byId.has(s.parent)) {
        // A root span that is no request: work the process does on its own (startup, a schedule).
        if (s.kind !== 'server') add(background, codeAt(s) ?? s.name)
      }
    }
  }
  const sweep = all => {
    const t = now()
    for (const [id, g] of pending) if (all || (g.rooted && t - g.last >= quietMs) || t - g.last >= staleMs) { sum(g.spans); pending.delete(id) }
    swept = t
  }
  return {
    add(spans) {
      count += spans.length
      const t = now()
      for (const s of spans) {
        let g = pending.get(s.trace)
        if (!g) pending.set(s.trace, (g = { spans: [], rooted: false, last: t }))
        g.spans.push(s)
        g.last = t
        if (!s.parent) g.rooted = true
      }
      // At most once a second: a sweep walks every pending trace.
      if (t - swept >= 1000) sweep(false)
    },
    /** How many traces wait to be summed: for tests, and to watch memory. */
    get pending() { return pending.size },
    result(tests = [], { root = null } = {}) {
      sweep(true)
      const byFile = new Map()
      for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t])
      const fileName = f => (root ? relative(root, f).replace(/\\/g, '/') : f)
      const sorted = m => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))
      return {
        endpoints: [...endpoints.values()].sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method)).map(e => {
          const named = new Map()
          let untimed = 0
          for (const [start, file] of e.at) {
            const t = testOf({ start, resource: { 'zoom.test.file': encodeURIComponent(file) } }, byFile)
            if (t?.test) add(named, `${fileName(t.file)} › ${t.test}`); else if (t) untimed++
          }
          return {
            method: e.method, route: e.route, count: e.count, statuses: sorted(e.statuses),
            tables: Object.fromEntries([...e.tables].sort().map(([t, ops]) => [t, [...ops].sort()])),
            codeCalls: Object.fromEntries([...e.codeCalls].sort(([a], [b]) => a.localeCompare(b)).map(([c, by]) => [c, sorted(by)])), calls: sorted(e.calls), pages: sorted(e.pages), tests: sorted(named), untimed,
            ...(methods ? { tree: pruneTree(e.tree) } : {}),
          }
        }),
        background: sorted(background),
        spans: count,
      }
    },
  }
}

/** observer() over spans already collected. */
export function observe(spans, tests = [], { root = null, methods = false, own = null } = {}) {
  const o = observer({ methods, own })
  o.add(spans)
  return o.result(tests, { root })
}

/** Java's words that a call or a statement starts with, never a method's name or its type. */
const JAVA_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'throw', 'else', 'case', 'yield', 'try', 'do', 'super', 'this', 'assert', 'record', 'class', 'interface', 'enum', 'permits', 'extends', 'implements', 'throws'])

/** Java source with comments, text blocks, strings and characters blanked out (same length, lines kept). */
export function javaCode(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?(?<!\\)"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '))
}

/** An identifier the agent's method list takes: plain ASCII Java names only, or it drops the whole list. */
const AGENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The methods a Java source file's top-level types declare, for the agent's method spans:
 * [{ class: 'com.x.Foo', methods: ['bar', …] }], one per top-level class, enum or record with any.
 * Interfaces and annotations have no bodies of their own to trace, and nested, local and anonymous
 * classes are left out. So are constructors, getters and setters that only return or set a field,
 * and equals, hashCode and toString: they would only add noise.
 */
export function javaMethods(text) {
  const code = javaCode(text)
  const pkg = /^\s*package\s+([\p{L}\p{N}_$.]+)\s*;/mu.exec(code)?.[1]
  const out = []
  let depth = 0, current = null
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '{') {
      // A top-level type starts: the declaration just before this brace names it.
      if (depth === 0) {
        const decl = /\b(class|interface|enum|record|@interface)\s+([\p{L}_$][\p{L}\p{N}_$]*)[^;{}]*$/u.exec(code.slice(Math.max(0, i - 500), i))
        current = decl && decl[1] !== 'interface' && decl[1] !== '@interface' ? { class: pkg ? `${pkg}.${decl[2]}` : decl[2], name: decl[2], methods: new Set() } : null
        if (current) out.push(current)
      }
      depth++
    } else if (c === '}') depth--
    else if (depth === 1 && current && c === '(') {
      // A declaration at the type's own level: a name before "(", a type before the name, a body after.
      const head = code.slice(Math.max(0, i - 300), i)
      const before = /([\p{L}\p{N}_$<>\[\],.?]+)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*$/u.exec(head)
      if (!before || JAVA_WORDS.has(before[1]) || JAVA_WORDS.has(before[2]) || before[2] === current.name) continue
      // "new <T> Type(" makes an object, it declares nothing.
      if (/\bnew\s*$/.test(head.slice(0, before.index))) continue
      let j = i, open = 0
      for (; j < code.length; j++) { if (code[j] === '(') open++; else if (code[j] === ')' && --open === 0) break }
      const after = /^\)\s*(?:throws\s+[\p{L}\p{N}_$.,\s]+?)?\s*\{/u.exec(code.slice(j))
      if (!after) continue
      let k = j + after[0].length, d = 1
      for (; k < code.length && d; k++) { if (code[k] === '{') d++; else if (code[k] === '}') d-- }
      const body = code.slice(j + after[0].length, k - 1).trim(), name = before[2]
      const accessor = (/^(get|is)[A-Z]/.test(name) && /^return\s+(this\.)?[\p{L}_$][\p{L}\p{N}_$]*\s*;$/u.test(body)) || (/^set[A-Z]/.test(name) && /^this\.[\p{L}_$][\p{L}\p{N}_$]*\s*=\s*[\p{L}_$][\p{L}\p{N}_$]*\s*;$/u.test(body))
      if (!accessor && !['equals', 'hashCode', 'toString'].includes(name)) current.methods.add(name)
      i = k - 1
    }
  }
  return out.filter(t => t.methods.size).map(t => ({ class: t.class, methods: [...t.methods].sort() }))
}

/** Folders whose Java is not the application's own: tests, fixtures, samples, vendored code. */
const NOT_OWN = /(^|\/)(tests?|testFixtures|it|fixtures?|vendor|third[_-]?party|examples?|samples?|node_modules|build|target|out)\//

/**
 * The project's own Java methods, for `trace --methods`: every class its repository's tracked Java
 * sources declare outside tests, fixtures, samples and vendored code, as the agent's
 * otel.instrumentation.methods.include value: "com.x.Foo[bar,baz];com.x.Qux[run]". The agent takes
 * only plain ASCII names; a class or method with any other is counted in `skipped`, not listed.
 */
export function projectMethods(repo) {
  const top = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  // -z: names as they are, never quoted for non-ASCII.
  const files = execFileSync('git', ['-C', top, 'ls-files', '-z', '--', '*.java'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(p => p && !NOT_OWN.test(p) && !/(Tests?|IT)\.java$/.test(p))
  let skipped = 0
  const found = []
  for (const p of files) for (const t of javaMethods(readFileSync(join(top, p), 'utf8'))) {
    const methods = t.methods.filter(m => AGENT_NAME.test(m))
    const ok = t.class.split('.').every(s => AGENT_NAME.test(s))
    skipped += ok ? t.methods.length - methods.length : t.methods.length
    if (ok && methods.length) found.push({ class: t.class, methods })
  }
  return { include: found.map(f => `${f.class}[${f.methods.join(',')}]`).join(';'), classes: found.length, methods: found.reduce((n, f) => n + f.methods.length, 0), skipped, names: new Set(found.map(f => f.class)) }
}
