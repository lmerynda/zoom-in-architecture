import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph.mjs'
import { folderText, graphText } from './zoom.mjs'

const g = buildGraph(join(import.meta.dirname, '../test/fixtures/polyglot'))
const paths = g.files.map(f => f.path)
const edge = (from, to) => g.edges.find(e => e.from === from && e.to === to)

describe('buildGraph', () => {
  it('keeps only application code: entry-reached JS/TS and what non-test projects compile', () => {
    expect(paths.sort()).toEqual([
      'engine/src/lib.rs', 'engine/src/physics.rs', 'examples/demo/index.js', 'game/src/main.rs',
      'game/www/hud.js', 'game/www/index.html', 'game/www/sw.js', 'goapp/cmd/server/handler.go',
      'goapp/cmd/server/main.go', 'goapp/internal/store/orders.go', 'goapp/internal/store/store.go', 'py/scripts/seed.py',
      'py/src/shopkit/__init__.py', 'py/src/shopkit/api.py', 'py/src/shopkit/cli.py', 'py/src/shopkit/models.py',
      'py/src/shopkit/orders.py', 'server/src/main/java/com/shop/ShopApplication.java', 'server/src/main/java/com/shop/orders/OrderController.java', 'server/src/main/java/com/shop/orders/OrderRepository.java',
      'server/src/main/java/com/shop/orders/model/Order.java', 'shared/index.js', 'src/Api/Controllers/OrdersController.cs', 'src/Api/wwwroot/app.js',
      'src/Api/wwwroot/sw.js', 'src/Core/Order.cs', 'src/Core/OrderService.cs', 'unity/Assets/Scripts/ShopView.cs',
      'web/src/api.ts', 'web/src/main.ts', 'web/src/ui/cart.ts', 'web/src/ui/index.ts',
      'web/src/ui/types.ts',
    ])
  })

  it('drops tests, build configs, dead code and generated migrations', () => {
    // scripts/stats.mjs runs from a build:stats npm script: tooling, not an entry point.
    expect(g.dropped.unreached).toEqual(['py/scripts/lint_helper.py', 'web/eslint.config.mjs', 'web/scripts/stats.mjs', 'web/src/orphan.ts', 'web/vite.config.ts'])
    // e2e/checkout.ts, src/test-utils.ts, OrdersTest.java, the xunit project's file, test_orders.py, store_test.go, and the Go mock package.
    expect(g.dropped.tests).toBe(7)
    expect(paths.some(p => p.includes('migrations'))).toBe(false)
    expect(paths.some(p => p.includes('Migrations'))).toBe(false)
  })

  it('finds entry points: index.html scripts, package entries and main methods', () => {
    expect(g.entries).toEqual(['examples/demo/index.js', 'game/src/main.rs', 'game/www/index.html', 'goapp/cmd/server/main.go', 'py/scripts/seed.py', 'py/src/shopkit/cli.py', 'server/src/main/java/com/shop/ShopApplication.java', 'shared/index.js', 'src/Api/wwwroot/app.js', 'web/src/main.ts'])
  })

  it('follows pages: inline module scripts, wasm-pack output back to its crate, service workers', () => {
    expect(g.files.find(f => f.path === 'game/www/index.html')).toMatchObject({ lang: 'html', doc: 'Game' })
    expect(edge('game/www/index.html', 'engine/src/lib.rs').names).toEqual(['game_engine'])
    expect(edge('game/www/index.html', 'game/www/hud.js')).toBeTruthy()
    expect(edge('game/www/hud.js', 'game/www/sw.js')).toBeTruthy()
  })

  it('reads Python: packages, entry scripts, relative imports, __init__ re-exports, TYPE_CHECKING', () => {
    expect(edge('py/src/shopkit/__init__.py', 'py/src/shopkit/orders.py').names).toEqual(['place_order'])
    // from shopkit import place_order: through the package's re-export to the defining module.
    expect(edge('py/src/shopkit/api.py', 'py/src/shopkit/orders.py').names).toEqual(['place_order'])
    expect(edge('py/src/shopkit/api.py', 'py/src/shopkit/__init__.py')).toBeUndefined()
    expect(edge('py/src/shopkit/cli.py', 'py/src/shopkit/api.py').names).toEqual(['app'])
    expect(edge('py/src/shopkit/orders.py', 'py/src/shopkit/models.py')).toMatchObject({ names: ['Order'], types: true })
    expect(edge('py/scripts/seed.py', 'py/src/shopkit/models.py').names).toEqual(['engine'])
    const hints = p => g.files.find(f => f.path === p).hints.map(h => `:${h.line} ${h.kind}`)
    expect([hints('py/src/shopkit/api.py'), hints('py/src/shopkit/models.py'), hints('py/src/shopkit/orders.py')]).toEqual([[':7 route'], [':3 store'], [':10 call']])
    expect(g.files.find(f => f.path === 'py/src/shopkit/orders.py').doc).toBe('Placing orders.')
  })

  it('reads Go: imported package names to the declaring file, and names shared within a package', () => {
    expect(edge('goapp/cmd/server/main.go', 'goapp/internal/store/store.go').names).toEqual(['Open'])
    expect(edge('goapp/cmd/server/handler.go', 'goapp/internal/store/store.go').names).toEqual(['Store'])
    expect(edge('goapp/cmd/server/main.go', 'goapp/cmd/server/handler.go').names).toEqual(['handler'])
    expect(edge('goapp/internal/store/orders.go', 'goapp/internal/store/store.go').names).toEqual(['Store'])
    expect(edge('goapp/cmd/server/handler.go', 'goapp/cmd/server/main.go')).toBeUndefined()
    const hints = p => g.files.find(f => f.path === p).hints.map(h => `:${h.line} ${h.kind}`)
    expect([hints('goapp/cmd/server/main.go'), hints('goapp/internal/store/store.go')]).toEqual([[':12 route', ':13 route'], [':10 store']])
    expect(g.files.find(f => f.path === 'goapp/internal/store/store.go').doc).toBe('Package store keeps orders.')
  })

  it('lets Unity see only its manifest’s file: packages, and no file see another’s nested types', () => {
    const from = p => g.edges.filter(e => e.from === p).map(e => e.to)
    // ShopView names OrderService (Core, a package), OrdersController (Api, not a package) and Rect (private, nested in Api).
    expect(from('unity/Assets/Scripts/ShopView.cs')).toEqual(['src/Core/OrderService.cs'])
  })

  it('resolves a leading slash against the web root of a served folder', () => {
    expect(edge('src/Api/wwwroot/app.js', 'src/Api/wwwroot/sw.js')).toBeTruthy()
    expect(g.files.find(f => f.path === 'src/Api/wwwroot/app.js').hints.map(h => h.kind)).toEqual(['call'])
  })

  it('lists config and deploy files, which name the other processes', () => {
    expect(g.config).toEqual(['server/src/main/resources/application.properties'])
  })

  it('marks the lines where one process talks to another', () => {
    const hints = p => g.files.find(f => f.path === p).hints.map(h => `:${h.line} ${h.kind} ${h.text}`)
    expect(hints('server/src/main/java/com/shop/orders/OrderController.java')).toEqual([':11 route @GetMapping("/api/orders")'])
    expect(hints('server/src/main/java/com/shop/orders/OrderRepository.java')).toEqual([':5 store extends JpaRepository<Order, Long> {}'])
    expect(hints('web/src/api.ts')).toEqual([":1 call fetch('/api/orders')).json()"])
    expect(hints('web/src/ui/cart.ts')).toEqual([":3 store localStorage.setItem('cart', JSON.stringify(items)))"])
    expect(hints('game/www/hud.js')).toEqual([":3 message .postMessage('ready', '*')"])
  })

  it('takes deployable hints from manifests', () => {
    const p = Object.fromEntries(g.projects.map(x => [x.dir, `${x.kind} ${x.technology}`]))
    expect(g.unmapped).toEqual([{ dir: 'docs', name: 'docs', reason: 'no source files' }])
    expect(p).toEqual({
      'examples/demo': 'library ', goapp: 'app Go 1.22', py: 'app Python · FastAPI · SQLAlchemy',
      server: 'app Java · Spring Boot', engine: 'library Rust', game: 'app Rust', shared: 'library ',
      'src/Api': 'app C# · net10.0', 'src/Core': 'library C# · net10.0', web: 'app ', unity: 'app Unity 6000 · C#',
    })
  })

  it('resolves references in every language', () => {
    // JS/TS: relative, tsconfig alias, workspace package.
    expect(edge('web/src/main.ts', 'web/src/api.ts')).toBeTruthy()
    // A named import through a barrel goes to the file that defines the name.
    expect(edge('web/src/main.ts', 'web/src/ui/cart.ts')).toEqual({ from: 'web/src/main.ts', to: 'web/src/ui/cart.ts', names: ['cart'] })
    expect(edge('web/src/main.ts', 'web/src/ui/index.ts')).toBeUndefined()
    // The barrel's own edges are re-exports: it passes modules on rather than using them.
    expect(edge('web/src/ui/index.ts', 'web/src/ui/cart.ts')).toMatchObject({ reexport: true })
    // A type-only import is kept, marked, and not drawn in maps.
    expect(edge('web/src/main.ts', 'web/src/ui/types.ts')).toMatchObject({ names: ['Item'], types: true })
    expect(edge('web/src/main.ts', 'shared/index.js').names).toEqual(['money'])
    // C#: through a ProjectReference.
    expect(edge('src/Api/Controllers/OrdersController.cs', 'src/Core/OrderService.cs').names).toEqual(['OrderService'])
    // Java: same package, explicit import, wildcard import.
    expect(edge('server/src/main/java/com/shop/orders/OrderController.java', 'server/src/main/java/com/shop/orders/OrderRepository.java')).toBeTruthy()
    expect(edge('server/src/main/java/com/shop/orders/OrderController.java', 'server/src/main/java/com/shop/orders/model/Order.java').names).toEqual(['Order'])
    expect(edge('server/src/main/java/com/shop/orders/OrderRepository.java', 'server/src/main/java/com/shop/orders/model/Order.java')).toBeTruthy()
    // Rust: module path and another crate.
    expect(edge('engine/src/lib.rs', 'engine/src/physics.rs')).toBeTruthy()
    expect(edge('game/src/main.rs', 'engine/src/lib.rs').names).toEqual(['game_engine'])
  })

  it('takes each file’s doc comment', () => {
    const doc = p => g.files.find(f => f.path === p).doc
    expect(doc('server/src/main/java/com/shop/orders/model/Order.java')).toBe('An order as stored.')
    expect(doc('src/Api/Controllers/OrdersController.cs')).toBe('Takes orders over HTTP.')
    expect(doc('web/src/ui/cart.ts')).toBe('The cart shown on every page.')
  })

  it('prints a compact text listing for agents', () => {
    const text = graphText(g)
    expect(text).toContain('33 application files, 29 references (3 type-only). Left out: 7 test files; 5 files no entry point reaches')
    expect(text).toContain('  main.ts · 7 · → api.ts, cart.ts, shared/index.js · types → types.ts · Starts the shop front end.')
    expect(text).toContain('      :11 route @GetMapping("/api/orders")')
  })

  it('prints a folder overview for large repos', () => {
    const text = folderText(g)
    expect(text).toContain('18 folders.')
    expect(text).toContain('game/www/ · 3 · 19 · 1 message · → engine/src (1)')
    expect(text).toContain('server/src/main/java/com/shop/orders/ · 2 · 20 · 1 route, 1 store · → server/src/main/java/com/shop/orders/model (2)')
  })
})
