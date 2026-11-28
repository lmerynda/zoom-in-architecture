import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callTree, javaMethods, mergeTrees, observe, observer, projectMethods, pruneTree, TREE_DEPTH, TREE_KIDS } from './trace.mjs'

describe('javaMethods', () => {
  it('lists a class’s own methods, Allman braces and generics too, and leaves out constructors, accessors and noise', () => {
    const src = `package com.shop.orders;

/** Serves orders. { not a brace } */
@RestController
public class OrderController
{
    private final OrderRepository repository;
    private int count;
    private final String label = "nothing {";
    private final String block = """
        a "quoted" { brace \\""" still inside
        """;

    public OrderController(OrderRepository repository)
    {
        this.repository = repository;
    }

    @GetMapping("/api/orders/{id}")
    public ResponseEntity<List<Order>> all(@PathVariable long id) throws IOException
    {
        if (id > 0) { return ResponseEntity.ok(repository.findAll()); }
        String s = "a { b"; // }
        char c = '{';
        return null;
    }

    public int getCount() { return count; }
    public void setCount(int count) { this.count = count; }
    boolean authorize() { return false; }
    int answer() { return 42; }
    <T> T identity(T x) { return x; }
    @Override public String toString() { return "x"; }
    abstract void later();
    static <T> T pick(T a, T b) { return a != null ? a : b; }

    private final Runnable r = new Runnable() { public void run() { all(1); } };
    private final Object g = new <String> Generic() { };
    record Entry(int id) { int twice() { return id * 2; } }
    class Inner { void hidden() { } }
}`
    expect(javaMethods(src)).toEqual([{ class: 'com.shop.orders.OrderController', methods: ['all', 'answer', 'authorize', 'identity', 'pick'] }])
  })

  it('gives each top-level type its own methods, and has nothing for an interface, an annotation, or no type', () => {
    expect(javaMethods('package a;\nsealed class A permits B { void a() { go(); } }\nfinal class B extends A { void b() { go(); } }')).toEqual([{ class: 'a.A', methods: ['a'] }, { class: 'a.B', methods: ['b'] }])
    expect(javaMethods('package a;\npublic interface Repo extends JpaRepository<X, Long> { List<X> findAll(); default int n() { return 1 + 1; } }')).toEqual([])
    expect(javaMethods('package a;\npublic @interface Marker {}')).toEqual([])
    expect(javaMethods('// nothing here')).toEqual([])
    // A record and an enum keep their methods; no package, the plain name; non-ASCII names too.
    expect(javaMethods('package com.größe;\npublic record Größe(int w) { int doppelt() { return w * 2; } }')).toEqual([{ class: 'com.größe.Größe', methods: ['doppelt'] }])
    expect(javaMethods('enum Mode { A, B; Mode next() { return this == A ? B : A; } }')).toEqual([{ class: 'Mode', methods: ['next'] }])
  })
})

describe('projectMethods', () => {
  it('lists the repository’s own classes for the agent, leaving out tests, fixtures and names the agent does not take', () => {
    const repo = mkdtempSync(join(tmpdir(), 'zoom-methods-'))
    try {
      const put = (p, text) => { mkdirSync(join(repo, p, '..'), { recursive: true }); writeFileSync(join(repo, p), text) }
      put('app/src/main/java/shop/Orders.java', 'package shop;\nclass Orders { void place() { go(); } void run$task() { go(); } }')
      // A module with another layout is the project's own too.
      put('tools/Seed.java', 'class Seed { void plant() { go(); } }')
      put('app/src/test/java/shop/OrdersTest.java', 'package shop;\nclass OrdersTest { void works() { go(); } }')
      put('test/fixtures/clinic/src/main/java/Vet.java', 'class Vet { void heal() { go(); } }')
      put('app/src/main/java/shop/Größe.java', 'package shop;\nclass Größe { void wiegen() { go(); } }')
      execFileSync('git', ['init', '-q'], { cwd: repo })
      execFileSync('git', ['add', '.'], { cwd: repo })
      const m = projectMethods(join(repo, 'app'))
      expect(m.include).toBe('shop.Orders[place];Seed[plant]')
      expect([m.classes, m.methods, m.skipped]).toEqual([2, 2, 2])
      expect([...m.names]).toEqual(['shop.Orders', 'Seed'])
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })
})

let n = 0
const span = (name, parent = '', attrs = {}, kind = 'internal', at = null) => { const k = at ?? ++n; return { trace: attrs.trace ?? 't', id: `s${++n}`, parent, name, kind, start: k, end: k + 1, attrs, status: 0, resource: {} } }
const code = (cls, fn, parent, at) => span(`${cls}.${fn}`, parent, { 'code.namespace': `com.shop.${cls}`, 'code.function': fn }, 'internal', at)
const kidsOf = spans => { const m = new Map(); for (const s of spans) if (s.parent) m.set(s.parent, [...(m.get(s.parent) ?? []), s].sort((a, b) => a.start - b.start)); return m }

describe('call trees', () => {
  const request = () => {
    const s = span('GET /orders', '', { 'http.request.method': 'GET', 'http.route': '/orders' }, 'server')
    const c = code('OrderController', 'all', s.id)
    const v = code('OrderService', 'list', c.id)
    // A framework span with no name of its own passes its children up.
    const tx = span('Transaction', v.id)
    const r = code('OrderRepository', 'findAll', tx.id)
    const q = span('SELECT orders', r.id, { 'db.system': 'h2', 'db.sql.table': 'orders', 'db.operation': 'SELECT' }, 'client')
    // The newer attribute, one fully qualified name.
    const p = span('Prices.apply', v.id, { 'code.function.name': 'com.shop.Prices.apply' })
    return [q, r, tx, p, v, c, s]
  }

  it('nests a request’s named spans as they called each other, in the order they started', () => {
    const spans = request()
    expect(callTree(spans[6], kidsOf(spans))).toEqual([{ at: 'com.shop.OrderController.all', count: 1, kids: [{ at: 'com.shop.OrderService.list', count: 1, kids: [
      { at: 'com.shop.OrderRepository.findAll', count: 1, kids: [{ at: 'SELECT orders', count: 1, kids: [] }] },
      { at: 'com.shop.Prices.apply', count: 1, kids: [] },
    ] }] }])
  })

  it('names only the project’s own classes when told which they are', () => {
    const spans = request()
    const own = new Set(['com.shop.OrderController', 'com.shop.OrderRepository'])
    // OrderService and Prices are someone else's: their calls pass up to the project's.
    expect(callTree(spans[6], kidsOf(spans), own)).toEqual([{ at: 'com.shop.OrderController.all', count: 1, kids: [{ at: 'com.shop.OrderRepository.findAll', count: 1, kids: [{ at: 'SELECT orders', count: 1, kids: [] }] }] }])
  })

  it('folds the same call seen twice, and keeps a method that calls itself', () => {
    const s = span('GET /k', '', { 'http.request.method': 'GET', 'http.route': '/k' }, 'server')
    // The agent's controller span over the method's own: one call.
    const ctl = code('KingdomController', 'build', s.id), same = code('KingdomController', 'build', ctl.id), svc = code('KingdomService', 'build', same.id)
    expect(observe([svc, same, ctl, s], [], { methods: true }).endpoints[0].tree).toEqual([{ at: 'com.shop.KingdomController.build', count: 1, kids: [{ at: 'com.shop.KingdomService.build', count: 1 }] }])
    // A walk into itself beside other work: two calls, one inside the other.
    const r = span('GET /w', '', { 'http.request.method': 'GET', 'http.route': '/w' }, 'server')
    const w1 = code('Walker', 'walk', r.id), w2 = code('Walker', 'walk', w1.id), log = code('Log', 'write', w1.id)
    expect(observe([w2, log, w1, r], [], { methods: true }).endpoints[0].tree).toEqual([{ at: 'com.shop.Walker.walk', count: 1, kids: [{ at: 'com.shop.Walker.walk', count: 1 }, { at: 'com.shop.Log.write', count: 1 }] }])
  })

  it('keeps a request one endpoint makes to another out of its tree, and starts a tree at a server span that names its handler', () => {
    const front = span('GET /front', '', { 'http.request.method': 'GET', 'http.route': '/front' }, 'server')
    const f = code('Front', 'handle', front.id)
    const out = span('GET', f.id, { 'http.request.method': 'GET', 'server.address': 'localhost' }, 'client')
    const back = span('GET /back', out.id, { 'http.request.method': 'GET', 'http.route': '/back', 'code.function.name': 'com.shop.Back.handle' }, 'server')
    const q = span('SELECT orders', back.id, { 'db.system': 'h2', 'db.sql.table': 'orders', 'db.operation': 'SELECT' }, 'client')
    const o = observe([front, f, out, back, q], [], { methods: true })
    expect(o.endpoints.find(e => e.route === '/front').tree).toEqual([{ at: 'com.shop.Front.handle', count: 1 }])
    expect(o.endpoints.find(e => e.route === '/back').tree).toEqual([{ at: 'com.shop.Back.handle', count: 1, kids: [{ at: 'SELECT orders', count: 1 }] }])
  })

  it('folds a call seen twenty thousand times over itself without running out of stack', () => {
    const spans = [span('GET /deep', '', { 'http.request.method': 'GET', 'http.route': '/deep' }, 'server')]
    for (let k = 0; k < 20000; k++) spans.push(code('Walker', 'walk', spans[spans.length - 1].id))
    // Each is its caller's only call and the same method: one call seen many times.
    expect(observe(spans, [], { methods: true }).endpoints[0].tree).toEqual([{ at: 'com.shop.Walker.walk', count: 1 }])
  })

  it('adds up requests into one tree per endpoint, only when asked for', () => {
    const o = observe([...request(), ...request()], [], { methods: true })
    expect(o.endpoints[0].tree).toEqual([{ at: 'com.shop.OrderController.all', count: 2, kids: [{ at: 'com.shop.OrderService.list', count: 2, kids: [
      { at: 'com.shop.OrderRepository.findAll', count: 2, kids: [{ at: 'SELECT orders', count: 2 }] },
      { at: 'com.shop.Prices.apply', count: 2 },
    ] }] }])
    expect(observe(request()).endpoints[0].tree).toBeUndefined()
  })

  it('cuts a tree past its width and depth, and holds a wide fan-out cheaply', () => {
    const wide = Array.from({ length: TREE_KIDS + 3 }, (_, k) => ({ at: `m${k}`, count: k + 1, kids: [] }))
    const pruned = pruneTree(mergeTrees([], wide))
    expect(pruned).toHaveLength(TREE_KIDS + 1)
    expect(pruned[TREE_KIDS]).toEqual({ at: '3 more', count: (TREE_KIDS + 1) + (TREE_KIDS + 2) + (TREE_KIDS + 3) })
    // Ten thousand distinct calls under one caller: past what is held, they are counted, not kept.
    const many = mergeTrees([], Array.from({ length: 10000 }, (_, k) => ({ at: `c${k}`, count: 1, kids: [] })))
    expect(many.length).toBeLessThan(1000)
    const cut = pruneTree(many)
    expect(cut[TREE_KIDS].at).toMatch(/^\d+\+ more$/)
    expect(cut.reduce((k, x) => k + x.count, 0)).toBe(10000)
    // A chain of calls deeper than the limit stops there.
    const spans = [span('GET /r', '', { 'http.request.method': 'GET', 'http.route': '/r' }, 'server')]
    for (let k = 0; k < TREE_DEPTH + 5; k++) spans.push(code('Walker', `step${k}`, spans[spans.length - 1].id))
    let depth = 0
    for (let t = observe(spans, [], { methods: true }).endpoints[0].tree; t?.length; t = t[0].kids) depth++
    expect(depth).toBe(TREE_DEPTH)
  })
})

describe('observer', () => {
  it('waits for a trace to go quiet before summing it, so a child that ends after its root still counts', () => {
    let t = 0
    const o = observer({ methods: true, now: () => t, quietMs: 5000 })
    const [q, r, tx, p, v, c, s] = (() => {
      const root = span('GET /orders', '', { 'http.request.method': 'GET', 'http.route': '/orders', trace: 'one' }, 'server')
      const ctl = { ...code('OrderController', 'all', root.id), trace: 'one' }
      const rep = { ...code('OrderRepository', 'findAll', ctl.id), trace: 'one' }
      const sql = { ...span('SELECT orders', rep.id, { 'db.system': 'h2', 'db.sql.table': 'orders', 'db.operation': 'SELECT' }, 'client'), trace: 'one' }
      return [sql, rep, null, null, null, ctl, root]
    })()
    void tx; void p; void v
    // The root first, its children a moment later in another batch.
    o.add([s])
    t = 1000
    o.add([c, r, q])
    expect(o.pending).toBe(1)
    // Quiet long enough: summed and dropped.
    t = 7000
    o.add([])
    expect(o.pending).toBe(0)
    const res = o.result()
    expect(res.endpoints[0].tables).toEqual({ orders: ['SELECT'] })
    expect(res.endpoints[0].tree[0].kids[0].at).toBe('com.shop.OrderRepository.findAll')
    expect(res.background).toEqual({})
  })

  it('sums a trace whose root is in another process once it goes stale, and the rest at the end', () => {
    let t = 0
    const o = observer({ now: () => t, quietMs: 5000, staleMs: 60000 })
    // A request whose parent span (a gateway's) never comes here.
    const s = { ...span('GET /x', 'gateway', { 'http.request.method': 'GET', 'http.route': '/x' }, 'server'), trace: 'remote' }
    o.add([s])
    t = 30000
    o.add([])
    expect(o.pending).toBe(1)
    t = 61000
    o.add([])
    expect(o.pending).toBe(0)
    const late = { ...code('Late', 'run', 'elsewhere'), trace: 'two' }
    o.add([late])
    const res = o.result()
    expect(res.endpoints.map(e => `${e.method} ${e.route} ${e.count}`)).toEqual(['GET /x 1'])
    expect(res.background).toEqual({ 'com.shop.Late.run': 1 })
    expect(res.spans).toBe(2)
  })
})
