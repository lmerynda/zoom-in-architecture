// What a project's own end-to-end tests really execute: run them with an OpenTelemetry agent
// attached, receive the spans (otlp.mjs), and sum them up per endpoint: how often it ran, with
// which statuses, which tables it read and wrote, which repositories and handlers it went through.
// The map then marks what it inferred from code as seen in tests, or not. Request level: what
// crosses a boundary (HTTP in, SQL and calls out) and the named data-access and handler spans.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { receive } from './otlp.mjs'

/** Where the Java agent is kept (gitignored), and where to fetch it from. */
export const JAVA_AGENT = join(import.meta.dirname, '../.cache/otel/opentelemetry-javaagent.jar')
export const JAVA_AGENT_URL = 'https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar'

/**
 * The environment that makes every JVM the command starts export its spans to `endpoint`:
 * JAVA_TOOL_OPTIONS reaches a JVM however a test harness launches it. Controller spans are on, so
 * a request names its handler; statements stay sanitized (the agent's default), so no value from
 * a test leaves the project.
 */
export function tracingEnv(endpoint, base = process.env) {
  if (!existsSync(JAVA_AGENT)) throw new Error(`no OpenTelemetry Java agent at ${JAVA_AGENT}; fetch it from ${JAVA_AGENT_URL}`)
  return {
    ...base,
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
  }
}

/**
 * Runs `command` (an argv array) in `cwd` with tracing attached and collects every span it exports.
 * Resolves with the spans, the exit code and how long it took; the command's output goes to `log`.
 */
export async function runTraced(cwd, command, { log = s => process.stderr.write(s), settleMs = 2500 } = {}) {
  const spans = []
  const r = await receive(s => spans.push(...s))
  const t0 = Date.now()
  try {
    const child = spawn(command[0], command.slice(1), { cwd, env: tracingEnv(r.endpoint), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    child.stdout.on('data', d => log(String(d)))
    child.stderr.on('data', d => log(String(d)))
    const code = await new Promise(res => child.on('exit', c => res(c ?? 1)))
    // The last batches leave a JVM as it exits; give them a moment to arrive.
    await new Promise(res => setTimeout(res, settleMs))
    return { spans, code, ms: Date.now() - t0 }
  } finally { await r.close() }
}

const method = s => s.attrs['http.request.method'] ?? s.attrs['http.method'] ?? s.name.split(' ')[0]
const route = s => s.attrs['http.route'] ?? null
const status = s => s.attrs['http.response.status_code'] ?? s.attrs['http.status_code'] ?? null
const table = s => s.attrs['db.sql.table'] ?? s.attrs['db.collection.name'] ?? null
const operation = s => String(s.attrs['db.operation'] ?? s.attrs['db.operation.name'] ?? '').toUpperCase().split(' ')[0] || null
const codeAt = s => (s.attrs['code.namespace'] && s.attrs['code.function'] ? `${s.attrs['code.namespace']}.${s.attrs['code.function']}` : null)

/** A route template as the map writes paths: `{id}` for any parameter, no trailing slash. */
export const normalRoute = p => (p.replace(/:([A-Za-z_]\w*)/g, '{$1}').replace(/<[^>]*>/g, '{p}').replace(/\/+$/, '') || '/')

/**
 * Sums spans up per endpoint (method and route template, from server spans): how many requests,
 * their statuses, the tables each read or wrote (from SQL spans under it), the code it went
 * through (spans naming a class and method: handlers, repositories), and outgoing calls. Spans
 * outside any request (startup, schedules) are summed apart as background work.
 */
export function observe(spans) {
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
      const e = endpoints.get(key) ?? { method: method(s), route: normalRoute(route(s)), count: 0, statuses: new Map(), tables: new Map(), code: new Map(), calls: new Map() }
      e.count++
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
      code: sorted(e.code), calls: sorted(e.calls),
    })),
    background: sorted(background),
    spans: spans.length,
  }
}
