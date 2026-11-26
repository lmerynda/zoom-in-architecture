// What a project's own end-to-end tests really execute: run them with an OpenTelemetry agent
// attached, receive the spans (otlp.mjs), and sum them up per endpoint: how often it ran, with
// which statuses, which tables it read and wrote, which repositories and handlers it went through.
// The map then marks what it inferred from code as seen in tests, or not. Request level: what
// crosses a boundary (HTTP in, SQL and calls out) and the named data-access and handler spans.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
 * command starts, so `trace --no-tests` leaves it out.
 */
export function tracingEnv(endpoint, base = process.env, { tests = null } = {}) {
  if (!existsSync(JAVA_AGENT)) throw new Error(`no OpenTelemetry Java agent at ${JAVA_AGENT}; fetch it from ${JAVA_AGENT_URL}`)
  const own = Object.fromEntries(Object.entries(base).filter(([k]) => !/^OTEL_EXPORTER_/i.test(k)))
  return {
    ...own,
    JAVA_TOOL_OPTIONS: [base.JAVA_TOOL_OPTIONS, `-javaagent:${JAVA_AGENT.replace(/\\/g, '/')}`].filter(Boolean).join(' '),
    OTEL_SERVICE_NAME: base.OTEL_SERVICE_NAME ?? 'traced',
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_BSP_SCHEDULE_DELAY: '200',
    OTEL_INSTRUMENTATION_COMMON_EXPERIMENTAL_CONTROLLER_TELEMETRY_ENABLED: 'true',
    OTEL_INSTRUMENTATION_COMMON_DB_STATEMENT_SANITIZER_ENABLED: 'true',
    OTEL_INSTRUMENTATION_HTTP_SERVER_CAPTURE_REQUEST_HEADERS: 'referer',
    ...(tests ? { ZOOM_TRACE_TESTS: tests, NODE_OPTIONS: [base.NODE_OPTIONS, `--import="${pathToFileURL(PRELOAD).href}"`].filter(Boolean).join(' ') } : {}),
  }
}

/**
 * Runs `command` (an argv array) in `cwd` with tracing attached and collects every span it exports.
 * Resolves with the spans, when each Node test ran (see tracingEnv), the exit code and how long it
 * took; the command's output goes to `log`.
 */
export async function runTraced(cwd, command, { log = s => process.stderr.write(s), settleMs = 2500, testNames = true } = {}) {
  const spans = []
  const r = await receive(s => spans.push(...s))
  const scratch = mkdtempSync(join(tmpdir(), 'zoom-trace-')), tests = join(scratch, 'tests.jsonl')
  const t0 = Date.now()
  try {
    const child = spawn(command[0], command.slice(1), { cwd, env: tracingEnv(r.endpoint, process.env, { tests: testNames ? tests : null }), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    child.stdout.on('data', d => log(String(d)))
    child.stderr.on('data', d => log(String(d)))
    const code = await new Promise(res => child.on('exit', c => res(c ?? 1)))
    // The last batches leave a JVM as it exits; give them a moment to arrive.
    await new Promise(res => setTimeout(res, settleMs))
    return { spans, tests: testRuns(existsSync(tests) ? readFileSync(tests, 'utf8') : ''), code, ms: Date.now() - t0 }
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
const codeAt = s => (s.attrs['code.namespace'] && s.attrs['code.function'] ? `${s.attrs['code.namespace']}.${s.attrs['code.function']}` : null)

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

/**
 * Sums spans up per endpoint (method and route template, from server spans): how many requests,
 * their statuses, the tables each read or wrote (from SQL spans under it), the code it went
 * through (spans naming a class and method: handlers, repositories), outgoing calls, the pages a
 * browser made them from (Referer) and the tests that made them (`tests`, from runTraced: "file ›
 * test", the file relative to `root`; `untimed` counts those a test file's server got while no
 * single test ran). Spans outside any request (startup, schedules) are summed apart as background work.
 */
export function observe(spans, tests = [], { root = null } = {}) {
  const fileName = f => (root ? relative(root, f).replace(/\\/g, '/') : f)
  const byFile = new Map()
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t])
  const byId = new Map(spans.map(s => [s.id, s]))
  const kids = new Map()
  for (const s of spans) if (s.parent && byId.has(s.parent)) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s])
  const below = s => { const out = []; const walk = x => { for (const c of kids.get(x.id) ?? []) { out.push(c); walk(c) } }; walk(s); return out }
  const endpoints = new Map()
  const background = new Map()
  const add = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
  for (const s of spans) {
    if (s.kind === 'server' && route(s)) {
      const key = `${method(s)} ${normalRoute(route(s))}`
      const e = endpoints.get(key) ?? { method: method(s), route: normalRoute(route(s)), count: 0, statuses: new Map(), tables: new Map(), code: new Map(), calls: new Map(), pages: new Map(), tests: new Map(), untimed: 0 }
      e.count++
      if (pageOf(s)) add(e.pages, pageOf(s))
      const test = testOf(s, byFile)
      if (test?.test) add(e.tests, `${fileName(test.file)} › ${test.test}`)
      else if (test) e.untimed++
      if (status(s) != null) add(e.statuses, String(status(s)))
      for (const c of below(s)) {
        if (table(c) && operation(c)) { const ops = e.tables.get(table(c)) ?? new Set(); ops.add(operation(c)); e.tables.set(table(c), ops) }
        if (codeAt(c)) add(e.code, codeAt(c))
        if (c.kind === 'client' && (c.attrs['url.full'] || c.attrs['server.address']) && !c.attrs['db.system']) add(e.calls, `${method(c)} ${c.attrs['server.address'] ?? new URL(c.attrs['url.full']).host}`)
      }
      endpoints.set(key, e)
    } else if (!s.parent || !byId.has(s.parent)) {
      // A root span that is no request: work the process does on its own (startup, a schedule).
      if (s.kind !== 'server') add(background, codeAt(s) ?? s.name)
    }
  }
  const sorted = m => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))
  return {
    endpoints: [...endpoints.values()].sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method)).map(e => ({
      method: e.method, route: e.route, count: e.count, statuses: sorted(e.statuses),
      tables: Object.fromEntries([...e.tables].sort().map(([t, ops]) => [t, [...ops].sort()])),
      code: sorted(e.code), calls: sorted(e.calls), pages: sorted(e.pages), tests: sorted(e.tests), untimed: e.untimed,
    })),
    background: sorted(background),
    spans: spans.length,
  }
}
