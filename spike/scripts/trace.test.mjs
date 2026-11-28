import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalRoute, observe, testOf, testRuns } from './trace.mjs'

let n = 0
const span = (kind, name, attrs = {}, parent = '') => ({ trace: 't', id: `s${++n}`, parent, name, kind, start: n, end: n + 1, attrs, status: 0, resource: {} })

describe('normalRoute', () => {
  it('writes every framework’s parameters as {name}, without a trailing slash', () => {
    expect(normalRoute('/market/:id/buy/')).toBe('/market/{id}/buy')
    expect(normalRoute('/users/<int:uid>')).toBe('/users/{p}')
    expect(normalRoute('/')).toBe('/')
    expect(normalRoute('/kingdom/{name}')).toBe('/kingdom/{name}')
  })
})

describe('observe', () => {
  it('sums requests per endpoint: statuses, tables read and written, code it went through', () => {
    const a = span('server', 'POST /market/{id}/buy', { 'http.request.method': 'POST', 'http.route': '/market/:id/buy', 'http.response.status_code': 200 })
    const h = span('internal', 'MarketController.buy', { 'code.namespace': 'shop.MarketController', 'code.function': 'buy' }, a.id)
    const r = span('internal', 'OfferRepository.findById', { 'code.namespace': 'shop.OfferRepository', 'code.function': 'findById' }, h.id)
    const q = span('client', 'SELECT shop.offers', { 'db.system': 'h2', 'db.sql.table': 'offers', 'db.operation': 'SELECT' }, r.id)
    const w = span('client', 'UPDATE shop.offers', { 'db.system': 'h2', 'db.sql.table': 'offers', 'db.operation': 'UPDATE' }, h.id)
    const b = span('server', 'POST /market/{id}/buy', { 'http.request.method': 'POST', 'http.route': '/market/{id}/buy', 'http.response.status_code': 401 })
    const out = span('client', 'GET', { 'http.request.method': 'GET', 'server.address': 'payments.example', 'url.full': 'https://payments.example/x' }, b.id)
    const boot = span('client', 'DROP table shop.offers', { 'db.system': 'h2', 'db.sql.table': 'offers', 'db.operation': 'DROP table' })
    const tick = span('internal', 'BotClock.tick', { 'code.namespace': 'shop.BotClock', 'code.function': 'tick' })
    const o = observe([a, h, r, q, w, b, out, boot, tick])
    expect(o.endpoints).toEqual([{
      method: 'POST', route: '/market/{id}/buy', count: 2,
      statuses: { 200: 1, 401: 1 },
      tables: { offers: ['SELECT', 'UPDATE'] },
      // Each class's spans by the class whose span they ran under: the handler under the request itself ('').
      codeCalls: { 'shop.MarketController': { '': 1 }, 'shop.OfferRepository': { 'shop.MarketController': 1 } },
      calls: { 'GET payments.example': 1 }, pages: {}, tests: {}, untimed: 0,
    }])
    // Work outside any request is kept apart: startup and schedules.
    expect(o.background).toEqual({ 'DROP table shop.offers': 1, 'shop.BotClock.tick': 1 })
    expect(o.spans).toBe(9)
  })

  it('names the page a browser made a request from, and the test that made it, by its file from the traced folder', () => {
    const file = 'F:/kod/acceptance/ui/pages.test.ts'
    const res = { 'zoom.test.file': encodeURIComponent(file) }
    const at = (start, attrs, resource = res) => ({ ...span('server', 'GET /kingdom', { 'http.request.method': 'GET', 'http.route': '/kingdom', ...attrs }), start, resource })
    const tests = testRuns([
      JSON.stringify({ file, test: 'pages > shows the kingdom', start: 100.25, end: 200.5 }),
      JSON.stringify({ file, test: 'pages > builds', start: 200.75, end: 300 }),
      JSON.stringify({ file: 'F:/kod/acceptance/other.test.ts', test: 'x', start: 100, end: 300 }),
      '{"file":"cut off',
      '',
    ].join('\n'))
    expect(tests).toHaveLength(3)
    const o = observe([
      // Query strings and fragments are never kept; a percent-encoded path reads plain.
      at(150, { 'http.request.header.referer': ['http://localhost:5173/kingdom/build/?token=s3cret#x'] }),
      at(250, { 'http.request.header.referer': 'http://localhost:5173/k%C3%B6nig' }),
      // Between two tests (a fraction of a millisecond apart): no single test. No test file's server: no test.
      at(200.6, { 'http.request.header.referer': ['not a url'] }),
      at(260, {}, {}),
    ], tests, { root: 'F:/kod/acceptance' })
    expect(o.endpoints[0].pages).toEqual({ '/kingdom/build': 1, '/könig': 1 })
    expect(o.endpoints[0].tests).toEqual({ 'ui/pages.test.ts › pages > shows the kingdom': 1, 'ui/pages.test.ts › pages > builds': 1 })
    expect(o.endpoints[0].untimed).toBe(1)
    expect(JSON.stringify(o)).not.toContain('s3cret')
  })

  it('names the innermost of nested tests, and no test when tests of one file ran side by side', () => {
    const t = (test, start, end) => ({ file: 'a.test.ts', test, start, end })
    const byFile = new Map([['a.test.ts', [t('suite', 0, 100), t('suite > one', 10, 40), t('suite > two', 30, 60), t('alone', 200, 300)]]])
    const s = start => ({ start, resource: { 'zoom.test.file': 'a.test.ts' } })
    expect(testOf(s(20), byFile)).toEqual({ file: 'a.test.ts', test: 'suite > one' })
    expect(testOf(s(35), byFile)).toEqual({ file: 'a.test.ts', test: null })
    expect(testOf(s(80), byFile)).toEqual({ file: 'a.test.ts', test: 'suite' })
    expect(testOf(s(250), byFile)).toEqual({ file: 'a.test.ts', test: 'alone' })
    expect(testOf(s(150), byFile)).toEqual({ file: 'a.test.ts', test: null })
    expect(testOf({ start: 1, resource: {} }, byFile)).toBe(null)
    expect(testRuns('')).toEqual([])
  })

  it('says under which class each span of code ran: one call seen as two spans, a call inside a class, a class nested in another, a library between', () => {
    const a = span('server', 'GET /offers', { 'http.request.method': 'GET', 'http.route': '/offers' })
    // The agent's controller span over the method's own span: one call, two spans of one class.
    const ctl = span('internal', 'OfferController.list', { 'code.namespace': 'shop.OfferController', 'code.function': 'list' }, a.id)
    const own = span('internal', 'OfferController.list', { 'code.namespace': 'shop.OfferController', 'code.function': 'list' }, ctl.id)
    // A span the trace names no class for (a transaction) passes its caller through.
    const tx = span('internal', 'Transaction', {}, own.id)
    const page = span('internal', 'Offer$Page.of', { 'code.function.name': 'shop.Offer$Page::of' }, tx.id)
    const inner = span('internal', 'Offer.sort', { 'code.namespace': 'shop.Offer', 'code.function': 'sort' }, page.id)
    // A library's class with a span of its own is a caller like any other.
    const lib = span('internal', 'Cache.get', { 'code.namespace': 'lib.Cache', 'code.function': 'get' }, own.id)
    const back = span('internal', 'Offer.load', { 'code.namespace': 'shop.Offer', 'code.function': 'load' }, lib.id)
    // Names in any script.
    const ü = span('internal', 'Größe.maß', { 'code.namespace': 'läden.Größe', 'code.function': 'maß' }, own.id)
    const o = observe([a, ctl, own, tx, page, inner, lib, back, ü])
    expect(o.endpoints[0].codeCalls).toEqual({
      'lib.Cache': { 'shop.OfferController': 1 },
      'läden.Größe': { 'shop.OfferController': 1 },
      'shop.Offer': { 'lib.Cache': 1, 'shop.Offer$Page': 1 },
      'shop.Offer$Page': { 'shop.OfferController': 1 },
      'shop.OfferController': { '': 1, 'shop.OfferController': 1 },
    })
  })

  it('adds up the spans of many requests per class and caller, the busiest caller first', () => {
    const spans = []
    for (let k = 0; k < 12; k++) {
      const s = span('server', 'GET /offers', { 'http.request.method': 'GET', 'http.route': '/offers' })
      const c = span('internal', 'OfferController.list', { 'code.namespace': 'shop.OfferController', 'code.function': 'list' }, s.id)
      const r = span('internal', 'OfferRepository.find', { 'code.namespace': 'shop.OfferRepository', 'code.function': 'find' }, c.id)
      spans.push({ ...s, trace: `t${k}` }, { ...c, trace: `t${k}` }, { ...r, trace: `t${k}` })
      if (k < 2) spans.push({ ...span('internal', 'OfferRepository.find', { 'code.namespace': 'shop.OfferRepository', 'code.function': 'find' }, s.id), trace: `t${k}` })
    }
    const { codeCalls } = observe(spans).endpoints[0]
    expect(codeCalls).toEqual({ 'shop.OfferController': { '': 12 }, 'shop.OfferRepository': { 'shop.OfferController': 12, '': 2 } })
    expect(Object.keys(codeCalls['shop.OfferRepository'])).toEqual(['shop.OfferController', ''])
  })

  it('observes nothing in no spans, and skips server spans with no route (static files, 404s)', () => {
    expect(observe([]).endpoints).toEqual([])
    expect(observe([span('server', 'GET /x', { 'http.request.method': 'GET', 'http.route': '/x' })]).endpoints[0].codeCalls).toEqual({})
    expect(observe([span('server', 'GET', { 'http.request.method': 'GET' })]).endpoints).toEqual([])
  })
})

describe('trace-preload', () => {
  it('in a node:test file, names the file to the processes it starts and writes when each test ran; a helper a test starts and a plain process are left alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoom-preload-'))
    try {
      // A helper prints JSON, as a test's tool would; a test starts it (as a test starts its server) and keeps what it said.
      writeFileSync(join(dir, 'helper.mjs'), 'console.log(JSON.stringify({ attrs: process.env.OTEL_RESOURCE_ATTRIBUTES }))\n')
      writeFileSync(join(dir, 'shop.test.mjs'), [
        "import { test } from 'node:test'",
        "import { execFileSync } from 'node:child_process'",
        "import { writeFileSync } from 'node:fs'",
        "test('buys bread', () => { writeFileSync('child.txt', execFileSync(process.execPath, ['helper.mjs'])) })",
        "test('sells bread', async t => { await t.test('to a baker', () => {}) })",
      ].join('\n'))
      const env = { ...process.env, ZOOM_TRACE_TESTS: join(dir, 'tests.jsonl'), NODE_OPTIONS: `--import="${pathToFileURL(join(import.meta.dirname, 'trace-preload.mjs')).href}"`, OTEL_RESOURCE_ATTRIBUTES: 'a=b' }
      delete env.ZOOM_TRACE_TEST_FILE
      delete env.NODE_TEST_CONTEXT
      const before = Date.now()
      execFileSync(process.execPath, ['--test', 'shop.test.mjs'], { cwd: dir, env, stdio: 'ignore' })
      const file = join(dir, 'shop.test.mjs').replace(/\\/g, '/')
      // The helper's output is only its own: one JSON line, carrying the test file it ran under.
      expect(JSON.parse(readFileSync(join(dir, 'child.txt'), 'utf8'))).toEqual({ attrs: `a=b,zoom.test.file=${encodeURIComponent(file)}` })
      const runs = testRuns(readFileSync(join(dir, 'tests.jsonl'), 'utf8'))
      expect(runs.map(r => r.test).sort()).toEqual(['buys bread', 'sells bread', 'sells bread > to a baker'])
      expect(runs.every(r => r.file === file && r.start >= before && r.start <= r.end)).toBe(true)
      // A plain Node process the command starts (a build, the runner itself) is left as it was.
      expect(execFileSync(process.execPath, ['helper.mjs'], { cwd: dir, env, encoding: 'utf8' }).trim()).toBe('{"attrs":"a=b"}')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
