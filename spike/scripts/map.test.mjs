import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph.mjs'
import { auditPlacement, buildModel, compareMaps, publish, toName, writeAtomic } from './map.mjs'

const graph = buildGraph(join(import.meta.dirname, '../test/fixtures/polyglot'))
const map = JSON.parse(readFileSync(join(import.meta.dirname, '../test/fixtures/polyglot-map.json'), 'utf8'))
const edit = f => { const m = structuredClone(map); f(m); return m }
const build = (m = map, opts = {}) => buildModel(graph, m, { name: 'shop', ...opts })
const at = (r, path) => r.model.elements.find(e => e.metadata?.path === path)

describe('buildModel', () => {
  const r = build()

  it('publishes a clean map without errors or warnings', () => {
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.stats).toEqual({ nodes: 15, files: 39, relations: 34, links: 3, unplaced: 0 })
  })

  it('nests nodes by id and files under the node that holds them', () => {
    const el = id => r.model.elements.find(e => e.id === id)
    expect(el('web.shopping').parent).toBe('web')
    expect(el('customer')).toMatchObject({ parent: null, kind: 'actor', shape: 'person' })
    expect(at(r, 'web/src/main.ts')).toMatchObject({ id: 'web.shopping.main', parent: 'web.shopping', kind: 'code', title: 'main', description: 'Starts the shop front end.' })
    expect(at(r, 'web/src/main.ts').metadata).toMatchObject({ lines: '7' })
  })

  it('lets an exact path beat a glob, and a longer glob beat a shorter one', () => {
    expect(at(r, 'web/src/api.ts').parent).toBe('web.orders')
    expect(at(r, 'web/src/ui/cart.ts').parent).toBe('web.shopping')
  })

  it('tells same-named files in one node apart by folder', () => {
    // game/src/main.rs and engine/src/lib.rs are fine; give the game two mains.
    const twin = build(edit(m => { m.nodes.find(n => n.id === 'web.shopping').files.push('game/src/main.rs') }))
    expect(at(twin, 'web/src/main.ts').title).toBe('src/main')
    expect(at(twin, 'game/src/main.rs').title).toBe('src/main')
    expect(at(twin, 'web/src/main.ts').id).not.toBe(at(twin, 'game/src/main.rs').id)
  })

  it('draws relations between files from the graph only, and links from the map', () => {
    const rel = (a, b) => r.model.relations.find(x => x.source === a && x.target === b)
    expect(rel(at(r, 'web/src/main.ts').id, at(r, 'web/src/ui/cart.ts').id).title).toBe('cart')
    expect(rel('customer', 'web').title).toBe('shops in a browser')
    expect(rel(at(r, 'web/src/api.ts').id, at(r, 'server/src/main/java/com/shop/orders/OrderController.java').id).evidence).toHaveLength(2)
  })

  it('carries each cited line into the model, so the viewer can show it', () => {
    const rel = r.model.relations.find(x => x.title === 'GET /api/orders')
    expect(rel.evidence).toEqual([
      { at: 'web/src/api.ts:1', line: 1, code: "export const load = async () => (await fetch('/api/orders')).json()" },
      { at: 'server/src/main/java/com/shop/orders/OrderController.java:11', line: 11, code: '@GetMapping("/api/orders")' },
    ])
    // A range drops its shared indentation and keeps its own.
    const ranged = build(edit(m => { m.links[1].evidence[1] = 'server/src/main/java/com/shop/orders/OrderController.java:11-12' }))
    expect(ranged.model.relations.find(x => x.title === 'GET /api/orders').evidence[1].code).toBe('@GetMapping("/api/orders")\npublic List<Order> all() { return repository.findAll(); }')
    // Graph relations are their own proof and carry none.
    expect(r.model.relations.find(x => x.title === 'cart').evidence).toBeUndefined()
  })

  it('refuses links without evidence, with broken evidence, or to unknown ends', () => {
    const bad = build(edit(m => {
      m.links.push({ from: 'web.orders', to: 'db', title: 'guess' })
      m.links.push({ from: 'web.orders', to: 'db', evidence: ['web/src/api.ts:99'] })
      m.links.push({ from: 'web.orders', to: 'web/eslint.config.mjs', evidence: ['web/src/api.ts:1'] })
    }))
    expect(bad.errors).toEqual([
      'link web.orders → db needs evidence: file:line where the code makes the call',
      'link web.orders → db: evidence "web/src/api.ts:99" is past the end of the file (4 lines)',
      'link web.orders → web/eslint.config.mjs: web/eslint.config.mjs is neither a node id nor an application file',
    ])
  })

  it('warns about evidence in a file at neither end of the link', () => {
    // A real route line, but in the Api, which this link does not touch.
    const r2 = build(edit(m => { m.links[1].evidence = ['web/src/api.ts:1', 'src/Api/Controllers/OrdersController.cs:2'] }))
    expect(r2.errors).toEqual([])
    expect(r2.warnings).toEqual(['link web/src/api.ts → server/src/main/java/com/shop/orders/OrderController.java: evidence "src/Api/Controllers/OrdersController.cs:2" is in src/Api/Controllers/OrdersController.cs, which is at neither end of the link'])
    // Under a node end, and in config, evidence is fine.
    const r3 = build(edit(m => { m.links.push({ from: 'server.orders', to: 'db', evidence: ['server/src/main/java/com/shop/orders/OrderRepository.java:5', 'server/src/main/resources/application.properties:1'] }) }))
    expect(r3.warnings).toEqual([])
  })

  it('lists marked lines that no link cites, leaving out timers', () => {
    expect(r.uncited.map(u => `${u.path}:${u.line} ${u.kind}`)).toEqual(['game/www/hud.js:3 message', 'goapp/cmd/server/main.go:13 route', 'goapp/cmd/server/main.go:15 route', 'goapp/internal/store/store.go:10 store', 'goapp/web/assets/app.js:2 call', 'py/src/shopkit/api.py:7 route', 'py/src/shopkit/api.py:9 store', 'py/src/shopkit/api.py:13 route', 'py/src/shopkit/models.py:3 store', 'py/src/shopkit/orders.py:10 call', 'src/Api/wwwroot/app.js:3 call', 'web/src/api.ts:2 call', 'web/src/ui/cart.ts:3 store'])
  })

  it('accepts evidence from a direct caller of a file end', () => {
    // main.ts imports api.ts, the link's start: supporting evidence, though not a marked line.
    const r2 = build(edit(m => { m.links[1].evidence.push('web/src/main.ts:2') }))
    expect(r2.warnings.filter(w => w.includes('neither end'))).toEqual([])
  })

  it('accepts evidence two references from a file end, such as the router that mounts a route', () => {
    // index.ts re-exports cart.ts, which imports api.ts, the link's start.
    const r2 = build(edit(m => { m.links[1].evidence.push('web/src/ui/index.ts:1') }))
    expect(r2.warnings.filter(w => w.includes('neither end'))).toEqual([])
  })

  it('names the nearest marked line when evidence has drifted', () => {
    const r2 = build(edit(m => { m.links[1].evidence = ['web/src/api.ts:1', 'server/src/main/java/com/shop/orders/OrderController.java:12'] }))
    expect(r2.warnings).toHaveLength(1)
    expect(r2.warnings[0]).toContain('(nearest marked line: server/src/main/java/com/shop/orders/OrderController.java:11 route @GetMapping("/api/orders"))')
  })

  it('refuses bad nodes and files that are not application code', () => {
    const bad = build(edit(m => {
      m.nodes.push({ id: 'web.x.y', kind: 'component', title: 'Orphan' })
      m.nodes.push({ id: 'Bad Id', kind: 'component', title: 'x' })
      m.nodes.push({ id: 'tools', kind: 'gadget', title: 'Tools', files: ['web/vite.config.ts'] })
    }))
    expect(bad.errors).toEqual([
      'node id "Bad Id" must be dot-separated segments like "web.checkout"',
      'node "tools" has kind "gadget"; use one of actor, system, app, webapp, library, component, database, queue, external',
      'node "web.x.y" has no parent node "web.x"',
      'node "tools" lists web/vite.config.ts, which is not an application file (no entry point reaches it)',
    ])
  })

  it('places files the map misses beside their neighbours, an error unless loose', () => {
    const partial = edit(m => { m.nodes.find(n => n.id === 'web.shopping').files = ['shared/index.js', 'web/src/main.ts'] })
    const strict = build(partial)
    expect(strict.tree.find(n => n.id === 'web')).toMatchObject({ files: 6, voted: 3 })
    expect(strict.errors).toEqual(['3 application files are not in the map: web/src/ui/cart.ts, web/src/ui/index.ts, web/src/ui/types.ts'])
    const loose = build(partial, { loose: true })
    expect(loose.errors).toEqual([])
    // cart.ts imports api.ts (Orders client) and is imported by main.ts (Shopping): a tie goes to the first vote.
    expect(['web.shopping', 'web.orders']).toContain(at(loose, 'web/src/ui/cart.ts').parent)
  })

  it('lets live re-imports publish through code drift, as warnings', () => {
    const drifted = edit(m => {
      m.nodes.find(n => n.id === 'web.orders').files.push('web/src/deleted.ts')
      m.links.push({ from: 'web/src/deleted.ts', to: 'db', evidence: ['web/src/api.ts:1'] })
      m.links[1].evidence = ['web/src/api.ts:40']
    })
    expect(build(drifted).errors).toHaveLength(3)
    const loose = build(drifted, { loose: true })
    expect(loose.errors).toEqual([])
    expect(loose.warnings).toHaveLength(3)
    // The link to a deleted file is skipped; the one with a stale line still draws, its line marked as gone.
    expect(loose.stats.relations).toBe(34)
    expect(loose.model.relations.find(x => x.title === 'GET /api/orders').evidence[0]).toEqual({ at: 'web/src/api.ts:40', line: 40, code: null })
  })

  it('collects files with no placed neighbour under Unplaced', () => {
    const r2 = build(edit(m => { m.nodes = m.nodes.filter(n => n.id !== 'game') }), { loose: true })
    expect(at(r2, 'game/src/main.rs').parent).toBe('unplaced')
    expect(r2.model.elements.find(e => e.id === 'unplaced').title).toBe('Unplaced')
  })

  it('marks each node with the features it carries, so readers can travel to them', () => {
    const el = id => r.model.elements.find(e => e.id === id)
    expect(el('server.orders').features).toEqual(['Order tracking'])
    expect(el('server').features).toEqual([])
  })

  it('holds the map to its features: declared nodes, near the top, and no top-level app without one', () => {
    const bad = build(edit(m => {
      m.features.push({ title: 'Ghost', nodes: ['nowhere'] }, { title: 'Empty', nodes: [] }, { nodes: ['web'] })
      m.nodes.push({ id: 'web.shopping.cart', kind: 'component', title: 'Cart' }, { id: 'web.shopping.cart.lines', kind: 'component', title: 'Lines', files: ['web/src/ui/cart.ts'] })
      m.features.push({ title: 'Cart lines', nodes: ['web.shopping.cart.lines'] })
      m.features = m.features.filter(f => f.title !== 'Shop kit')
    }))
    expect(bad.errors).toEqual(['feature "Ghost" names "nowhere", which is neither a node the map declares nor an application file', 'feature "Empty" names no nodes', 'a feature has no title'])
    expect(bad.warnings.filter(w => w.includes('feature'))).toEqual([
      'feature "Cart lines" sits at "web.shopping.cart.lines", 4 levels down: give it a node in the top 3 levels',
      'top-level app "py" carries no feature: put it under a system node if it is a tool, or name the feature it serves',
      'top-level app "goapp" carries no feature: put it under a system node if it is a tool, or name the feature it serves',
    ])
    expect(build(edit(m => { delete m.features })).warnings).toEqual(['the map lists no features: name the product’s headline features and the nodes that carry them'])
  })

  it('keeps the top level to libraries two product parts share, dev tools not counted', () => {
    const libs = w => w.filter(s => s.includes('librar'))
    // The engine only the game uses, and the helpers the storefront and a demo use, are not shared.
    const split = m => {
      m.nodes.find(n => n.id === 'game').files = ['game/**']
      m.nodes.find(n => n.id === 'web.shopping').files = ['web/src/**']
      m.nodes.push({ id: 'engine', kind: 'library', title: 'Engine', files: ['engine/**'] }, { id: 'shared', kind: 'library', title: 'Shared', files: ['shared/**'] })
    }
    const unpublished = { ...graph, projects: graph.projects.map(p => ({ ...p, published: false })) }
    // One the tools use too stays a library, inside the shared-library node, so they don't seem to reach into the app.
    expect(libs(buildModel(unpublished, edit(split), { name: 'shop' }).warnings)).toEqual([
      'top-level library "engine" is used only by "game": fold it into "game"',
      'top-level library "shared" is used by one product part, "web", and dev tools: make it a component of the shared-library node',
    ])
    // As the only library, it is the shared-library node.
    const alone = edit(m => { split(m); m.nodes = m.nodes.filter(n => n.id !== 'engine'); m.nodes.find(n => n.id === 'game').files.push('engine/**') })
    expect(libs(buildModel(unpublished, alone, { name: 'shop' }).warnings)).toEqual([])
    // A published package is a deliverable, whoever uses it.
    expect(libs(build(edit(split)).warnings)).toEqual(['top-level library "engine" is used only by "game": fold it into "game"'])
    // Libraries that ship together belong in one node.
    const many = build(edit(m => { split(m); m.nodes.push(...['a', 'b'].map(id => ({ id, kind: 'library', title: id.toUpperCase() }))) }))
    expect(libs(many.warnings)).toContain('the top level holds 4 libraries: make libraries that ship together one library node, with a component each')
  })

  it('lets a feature name files, when a layered app spreads it across layers', () => {
    const r2 = build(edit(m => { m.features.push({ title: 'Order list', nodes: ['web/src/api.ts', 'server/src/main/java/com/shop/orders/OrderController.java'] }) }))
    expect(r2.errors).toEqual([])
    expect(at(r2, 'web/src/api.ts').features).toEqual(['Order list'])
    // A top-level app carries the features of the files it holds.
    const py = build(edit(m => { m.features = m.features.filter(f => f.title !== 'Shop kit'); m.features.push({ title: 'Kit', nodes: ['py/src/shopkit/cli.py'] }) }))
    expect(py.warnings.filter(w => w.includes('"py"'))).toEqual([])
  })

  it('names models after the repo folder', () => {
    expect(toName('C:/code/KnightsOfDarkness')).toBe('knights-of-darkness')
    expect(toName('/src/my_shop')).toBe('my-shop')
  })

  it('refuses a model name the viewer could not serve, before writing anything', () => {
    expect(() => publish(graph.repo, map, { name: 'shop/' })).toThrow('is not a model name')
  })
})

describe('compareMaps', () => {
  it('scores a map against itself as identical', () => {
    const c = compareMaps(graph, map, map)
    expect([c.topLevel, c.leaf]).toEqual([1, 1])
    expect(c.processLinks).toMatchObject({ shared: 3, onlyA: [], onlyB: [] })
  })

  it('sees regrouping inside a process, renamed ids, and a missing link', () => {
    // Same processes under other ids; the storefront split differently; one link dropped.
    const b = edit(m => {
      for (const n of m.nodes) n.id = n.id.replace(/^web/, 'shop')
      m.nodes.find(n => n.id === 'shop.shopping').files = ['shared/index.js', 'web/src/main.ts']
      m.nodes.find(n => n.id === 'shop.orders').files = ['web/src/api.ts', 'web/src/ui/**']
      m.links = m.links.filter(l => l.to !== 'db').map(l => ({ ...l, to: l.to.replace(/^web$/, 'shop') }))
    })
    const c = compareMaps(graph, map, b)
    expect(c.topLevel).toBe(1)
    expect(c.leaf).toBeLessThan(1)
    expect(c.pairs.find(p => p.a === 'Shopping')).toMatchObject({ b: 'Orders client', files: 5 })
    expect(c.processLinks.onlyA).toEqual(['Orders server → [database]'])
    expect(c.fileLinks).toEqual({ a: 1, b: 1, shared: 1 })
  })
})

describe('zoom why', () => {
  it('shows where a file sits and who uses it, by node', () => {
    const out = execFileSync(process.execPath, ['scripts/zoom.mjs', 'why', 'test/fixtures/polyglot', 'test/fixtures/polyglot-map.json', 'web/src/api.ts'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' })
    expect(out.split('\n')).toEqual(['web/src/api.ts is in web.orders', 'Used by 2 files:', '  web.shopping  2  main.ts, cart.ts', 'Uses 0 files:', ''])
  })
})

describe('zoom check --uncited', () => {
  it('lists routes no link reaches apart from the lines still to link', () => {
    const out = execFileSync(process.execPath, ['scripts/zoom.mjs', 'check', 'test/fixtures/polyglot', 'test/fixtures/polyglot-map.json', '--uncited'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' })
    const gaps = out.slice(out.indexOf('marked lines no link cites:'), out.indexOf('routes no link reaches'))
    expect(gaps).toContain('web/src/ui/cart.ts:3 store')
    expect(gaps).not.toContain(' route ')
    expect(out).toContain('4 routes no link reaches')
    expect(out.slice(out.indexOf('routes no link reaches'))).toContain('py/src/shopkit/api.py:7 route')
  })
})

describe('re-map helpers', () => {
  it('leaves files one map does not place out of a comparison', () => {
    const partial = edit(m => { m.nodes.find(n => n.id === 'web.shopping').files = ['shared/index.js', 'web/src/main.ts'] })
    const c = compareMaps(graph, map, partial)
    expect(c.skipped).toBe(3)
    expect([c.topLevel, c.leaf]).toEqual([1, 1])
  })

  it('audits files used mostly from a sibling node that use nothing of their own', () => {
    expect(auditPlacement(graph, map)).toEqual([{ path: 'web/src/api.ts', own: 'web.orders', ownUsers: 0, top: 'web.shopping', topUsers: 2 }])
  })
})

describe('writeAtomic', () => {
  it('replaces a file whole, leaving no temporary file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoom-'))
    try {
      const file = join(dir, 'm.json')
      writeAtomic(file, '{"a":1}')
      writeAtomic(file, '{"a":2}')
      expect(readFileSync(file, 'utf8')).toBe('{"a":2}')
      expect(existsSync(`${file}.tmp`)).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('this repo\'s own map', () => {
  // Edits here move the lines the self-map cites; a drifted map must fail the tests, not wait to be noticed.
  it('still checks clean against the code', () => {
    const self = JSON.parse(readFileSync(join(import.meta.dirname, '../maps/zoom-in-architecture.json'), 'utf8'))
    const r = buildModel(buildGraph(join(import.meta.dirname, '../..')), self, { name: 'self' })
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.unplaced).toEqual([])
  })
})
