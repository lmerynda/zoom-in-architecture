import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGraph, entryPointsOf, hintsOf, summary, useLines } from './graph.mjs'
import { folderText, graphText } from './zoom.mjs'

const g = buildGraph(join(import.meta.dirname, '../test/fixtures/polyglot'))
const paths = g.files.map(f => f.path)
const edge = (from, to) => g.edges.find(e => e.from === from && e.to === to)

describe('buildGraph', () => {
  it('keeps only application code: entry-reached JS/TS and what non-test projects compile', () => {
    expect(paths.sort()).toEqual([
      'engine/src/lib.rs', 'engine/src/physics.rs', 'examples/demo/index.js', 'game/src/main.rs',
      'game/www/hud.js', 'game/www/index.html', 'game/www/sw.js', 'goapp/cmd/server/handler.go',
      'goapp/cmd/server/main.go', 'goapp/internal/store/orders.go', 'goapp/internal/store/store.go', 'goapp/internal/view/assets_dev.go',
      'goapp/internal/view/assets_prod.go', 'goapp/internal/view/view.go', 'goapp/web/assets/app.js', 'goapp/web/embed.go',
      'py/alembic/env.py', 'py/scripts/seed.py', 'py/src/shopkit/__init__.py', 'py/src/shopkit/api.py',
      'py/src/shopkit/cli.py', 'py/src/shopkit/models.py', 'py/src/shopkit/orders.py', 'server/src/main/java/com/shop/ShopApplication.java',
      'server/src/main/java/com/shop/orders/OrderController.java', 'server/src/main/java/com/shop/orders/OrderRepository.java', 'server/src/main/java/com/shop/orders/model/Order.java', 'shared/index.js',
      'src/Api/Controllers/OrdersController.cs', 'src/Api/wwwroot/app.js', 'src/Api/wwwroot/sw.js', 'src/Core/Order.cs',
      'src/Core/OrderService.cs', 'unity/Assets/Scripts/ShopView.cs', 'web/src/api.ts', 'web/src/main.ts',
      'web/src/ui/cart.ts', 'web/src/ui/index.ts', 'web/src/ui/types.ts',
    ])
  })

  it('drops tests, build configs, dead code and generated migrations', () => {
    // scripts/stats.mjs runs from a build:stats npm script: tooling, not an entry point.
    // tools.go has a build tag the normal build never sets; release.py only runs in CI.
    expect(g.dropped.unreached).toEqual(['goapp/tools.go', 'py/scripts/lint_helper.py', 'py/scripts/release.py', 'web/eslint.config.mjs', 'web/scripts/stats.mjs', 'web/src/orphan.ts', 'web/vite.config.ts'])
    // e2e/checkout.ts, src/test-utils.ts, OrdersTest.java, the xunit project's file, test_orders.py, store_test.go, and the Go mock package.
    expect(g.dropped.tests).toBe(7)
    expect(paths.some(p => /migrations|versions/.test(p))).toBe(false)
    // Two EF Core migrations, a Django-style migration and an alembic revision.
    expect(g.dropped.generated).toBe(4)
    expect(paths.some(p => p.includes('Migrations'))).toBe(false)
  })

  it('finds entry points: index.html scripts, package entries and main methods', () => {
    expect(g.entries).toEqual(['examples/demo/index.js', 'game/src/main.rs', 'game/www/index.html', 'goapp/cmd/server/main.go', 'goapp/web/assets/app.js', 'py/alembic/env.py', 'py/scripts/seed.py', 'py/src/shopkit/api.py', 'py/src/shopkit/cli.py', 'server/src/main/java/com/shop/ShopApplication.java', 'shared/index.js', 'src/Api/wwwroot/app.js', 'web/src/main.ts'])
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
    expect([hints('py/src/shopkit/api.py'), hints('py/src/shopkit/models.py'), hints('py/src/shopkit/orders.py')]).toEqual([[':7 route', ':9 store', ':13 route'], [':3 store'], [':10 call']])
    // A decorator split over lines keeps its path; alembic's env.py is an entry point.
    expect(g.files.find(f => f.path === 'py/src/shopkit/api.py').hints[2].text).toBe('@app.get( "/orders/{order_id}"')
    expect(edge('py/alembic/env.py', 'py/src/shopkit/models.py').names).toEqual(['engine'])
    // A pyproject with only tool config (a uv workspace root) is no project.
    expect(g.projects.some(p => p.lang === 'py' && p.dir === '')).toBe(false)
    expect(g.files.find(f => f.path === 'py/src/shopkit/orders.py').doc).toBe('Placing orders.')
  })

  it('reads Go: imported package names to the declaring file, and names shared within a package', () => {
    expect(edge('goapp/cmd/server/main.go', 'goapp/internal/store/store.go').names).toEqual(['Open'])
    expect(edge('goapp/cmd/server/handler.go', 'goapp/internal/store/store.go').names).toEqual(['Store'])
    expect(edge('goapp/cmd/server/main.go', 'goapp/cmd/server/handler.go').names).toEqual(['handler'])
    expect(edge('goapp/internal/store/orders.go', 'goapp/internal/store/store.go').names).toEqual(['Store'])
    expect(edge('goapp/cmd/server/handler.go', 'goapp/cmd/server/main.go')).toBeUndefined()
    const hints = p => g.files.find(f => f.path === p).hints.map(h => `:${h.line} ${h.kind}`)
    expect([hints('goapp/cmd/server/main.go'), hints('goapp/internal/store/store.go')]).toEqual([[':13 route', ':15 route'], [':10 store']])
    // Build-tag variants are both dependencies; a name only generated code declares still reaches its package.
    expect(edge('goapp/cmd/server/main.go', 'goapp/internal/view/assets_dev.go').names).toEqual(['Assets'])
    expect(edge('goapp/cmd/server/main.go', 'goapp/internal/view/assets_prod.go').names).toEqual(['Assets'])
    expect(edge('goapp/cmd/server/main.go', 'goapp/internal/view/view.go').names).toEqual(['IndexTemplate'])
    // //go:embed makes the embedded script application code.
    expect(edge('goapp/web/embed.go', 'goapp/web/assets/app.js').names).toEqual(['go:embed'])
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
    expect(g.config).toEqual(['.github/workflows/release.yml', 'py/alembic.ini', 'server/src/main/resources/application.properties'])
  })

  it('marks no line where a pattern only names a call (a scanner’s own rules)', () => {
    expect(hintsOf(String.raw`  ['schedule', /@Scheduled.*|setIntervals*(.*/],`)).toEqual([])
    expect(hintsOf(String.raw`const re = /fetchs*(.*/`)).toEqual([])
    // The calls themselves still are.
    expect(hintsOf("@Scheduled(fixedRate = 5000)
fetch('/api/orders')").map(h => h.kind)).toEqual(['schedule', 'call'])
  })

  it('marks the lines where one process talks to another', () => {
    const hints = p => g.files.find(f => f.path === p).hints.map(h => `:${h.line} ${h.kind} ${h.text}`)
    expect(hints('server/src/main/java/com/shop/orders/OrderController.java')).toEqual([':11 route @GetMapping("/api/orders")'])
    expect(hints('server/src/main/java/com/shop/orders/OrderRepository.java')).toEqual([':5 store extends JpaRepository<Order, Long> {}'])
    // A helper called with a type argument is still a call.
    expect(hints('web/src/api.ts')).toEqual([":1 call fetch('/api/orders')).json()", ':2 call post<{ paid: boolean }>(`/api/orders/${id}/pay`, {})'])
    // url: in a type literal is a type, not a call.
    expect(hints('web/src/ui/types.ts')).toEqual([])
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
    // A named import through a barrel goes to the file that defines the name; the edge keeps the
    // lines that name it, its import and its use, as the reason it exists.
    expect(edge('web/src/main.ts', 'web/src/ui/cart.ts')).toEqual({ from: 'web/src/main.ts', to: 'web/src/ui/cart.ts', names: ['cart'], lines: [3, 6] })
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

  it('keeps the relative imports it could not follow, with their lines, so the map can say so', () => {
    const m = buildGraph(join(import.meta.dirname, '../test/fixtures/misses'))
    const misses = Object.fromEntries(m.files.filter(f => f.misses).map(f => [f.path, f.misses]))
    expect(misses).toEqual({ 'src/main.ts': [{ line: 2, spec: './gone' }], 'tools/run.py': [{ line: 1, spec: '.helpers' }] })
  })

  it('takes each file’s doc comment', () => {
    const doc = p => g.files.find(f => f.path === p).doc
    expect(doc('server/src/main/java/com/shop/orders/model/Order.java')).toBe('An order as stored.')
    expect(doc('src/Api/Controllers/OrdersController.cs')).toBe('Takes orders over HTTP.')
    expect(doc('web/src/ui/cart.ts')).toBe('The cart shown on every page.')
  })

  it('reads Javadoc markup as plain words', () => {
    const src = ['/**', ' * Simple <code>Validator</code> for {@link Pet} names &amp; dates.', ' * @author Ken', ' */', 'public class PetValidator {}'].join('\n')
    expect(summary(src, 'java')).toBe('Simple Validator for Pet names & dates.')
  })

  it('prints a compact text listing for agents', () => {
    const text = graphText(g)
    expect(text).toContain('39 application files, 34 references (3 type-only). Left out: 7 test files; 4 generated files (migrations, protobuf, designer code); 7 files no entry point reaches')
    expect(text).toContain('  main.ts · 7 · → api.ts, cart.ts, shared/index.js · types → types.ts · Starts the shop front end.')
    expect(text).toContain('      :11 route @GetMapping("/api/orders")')
  })

  it('prints a folder overview for large repos', () => {
    const text = folderText(g)
    expect(text).toContain('22 folders.')
    expect(text).toContain('game/www/ · 3 · 19 · 1 message · → engine/src (1)')
    expect(text).toContain('server/src/main/java/com/shop/orders/ · 2 · 20 · 1 route, 1 store · → server/src/main/java/com/shop/orders/model (2)')
  })

  it('keeps server-side views, linked from the controller that renders them and to their layouts', () => {
    const m = buildGraph(join(import.meta.dirname, '../test/fixtures/mvc'))
    const t = 'src/main/resources/templates/'
    expect(m.files.filter(f => f.lang === 'view').map(f => f.path).sort()).toEqual([`${t}error.html`, `${t}fragments/layout.html`, `${t}orders/list.html`, `${t}welcome.html`])
    const has = (from, to) => m.edges.some(e => e.from === from && e.to === to)
    expect(has('src/main/java/shop/OrderController.java', `${t}orders/list.html`)).toBe(true)
    expect(has('src/main/java/shop/OrderController.java', `${t}welcome.html`)).toBe(true)
    expect(has(`${t}orders/list.html`, `${t}fragments/layout.html`)).toBe(true)
    // "error" is a flash key in the controller and a menu label in the layout, not a view either renders.
    expect(m.edges.filter(e => e.to === `${t}error.html`)).toEqual([])
  })

  it('resolves a C# type of two homes to the file’s own namespace, and skips members after a variable', () => {
    const m = buildGraph(join(import.meta.dirname, '../test/fixtures/csharp'))
    // Carts.Create, not Orders.Create; items.Add is a call, not the Lists.Add type; a qualified name still counts.
    expect(m.edges.map(e => `${e.from} > ${e.to}`)).toEqual(['Program.cs > Carts/CartsController.cs', 'Carts/CartsController.cs > Carts/Create.cs'])
  })

  it('leaves out Java package docs, which hold no code', () => {
    const m = buildGraph(join(import.meta.dirname, '../test/fixtures/mvc'))
    expect(m.files.some(f => f.path.endsWith('package-info.java'))).toBe(false)
  })

  it('marks a Spring Data repository on the plain Repository interface as a store', () => {
    const m = buildGraph(join(import.meta.dirname, '../test/fixtures/mvc'))
    expect(m.files.find(f => f.path.endsWith('OrderRepository.java')).hints.map(h => `${h.line} ${h.kind}`)).toEqual(['3 store'])
  })

  it('reads Spring Security paths as rules for incoming requests, not calls', () => {
    const m = buildGraph(join(import.meta.dirname, '../test/fixtures/mvc'))
    expect(m.files.find(f => f.path.endsWith('SecurityConfig.java')).hints).toEqual([])
  })
})


describe('useLines', () => {
  it('finds the lines that name what an edge brings in: each name’s first two, comments skipped', () => {
    const src = ['// uses Cart', "import { Cart, total } from './cart'", 'const c = new Cart()', 'total(c)', 'total(c)', 'new Cart()'].join('\n')
    expect(useLines(src, ['Cart', 'total'], 'src/cart.ts')).toEqual([2, 3, 4])
  })
  it('falls back to the target file’s name when the edge names nothing, and to comments when they are all there is', () => {
    expect(useLines("import './polyfills'\nrun()", [], 'src/polyfills.ts')).toEqual([1])
    expect(useLines('package web\n//go:embed assets/app.js\nvar fs embed.FS', ['go:embed'], 'web/assets/app.js')).toEqual([2])
  })
})

describe('entryPointsOf', () => {
  const starts = buildGraph(join(import.meta.dirname, '../test/fixtures/starts'))
  const of = p => starts.files.find(f => f.path === p).entryPoints.map(e => `:${e.line} ${e.kind} ${e.name ?? '-'}`)

  it('finds where code starts work without an HTTP request, in every language, with what it starts', () => {
    expect(of('server/src/main/java/jobs/JobsApplication.java')).toEqual([':5 main main'])
    // A commented-out schedule is not one; each annotation names the method below it.
    expect(of('server/src/main/java/jobs/Cleanup.java')).toEqual([':6 schedule sweep', ':11 schedule hourly'])
    expect(of('server/src/main/java/jobs/Events.java')).toEqual([':5 message onOrder', ':10 message ready'])
    // An annotation on a class names the class.
    expect(of('server/src/main/java/jobs/ChatEndpoint.java')).toEqual([':4 socket ChatEndpoint'])
    expect(of('gosvc/cmd/sync/main.go')).toEqual([':6 main main', ':7 schedule -'])
    expect(of('py/importer.py')).toEqual([':8 main -'])
    expect(of('tools/cli.mjs')).toEqual([':1 main -'])
    // A client socket the page opens is not a start; its timer and the messages it hears are.
    expect(of('web/src/main.ts')).toEqual([':4 schedule -'])
    expect(of('web/src/live.ts')).toEqual([':3 message -', ':4 message -'])
    // A socket server and the handler it is given on the next line are one start.
    expect(of('web/src/server.ts')).toEqual([':3 socket -'])
  })

  it('counts only code: not comments, strings or patterns, and not a handler being compared or cleared', () => {
    const kinds = (src, o) => entryPointsOf(src, o).map(e => `${e.line} ${e.kind}`)
    expect(kinds("cleanup(); // old setInterval(task, 10)\nconsole.log('example: setInterval(task, 10)')")).toEqual([])
    expect(kinds('x = 1  # schedule.every(10).minutes', { lang: 'py' })).toEqual([])
    expect(kinds('if (socket.onmessage === previous) return\nsocket.onmessage = null')).toEqual([])
    // An RxJS subject named consumer is no queue; a worker hearing its parent is a message handler.
    expect(kinds("consumer.subscribe(x => show(x))\nparentPort.on('message', dispatch)")).toEqual(['2 message'])
  })

  it('gives a compiled program a main only where the graph found one, and reads a C# top-level program', () => {
    expect(entryPointsOf('package utils\n\nfunc main() {}', { lang: 'go' })).toEqual([])
    expect(entryPointsOf('pub fn main() {}', { lang: 'rs' })).toEqual([])
    expect(entryPointsOf('fn main() {}', { lang: 'rs', main: true }).map(e => e.kind)).toEqual(['main'])
    const cs = buildGraph(join(import.meta.dirname, '../test/fixtures/csharp'))
    expect(cs.files.find(f => f.path === 'Program.cs').entryPoints).toEqual([{ line: 1, kind: 'main', text: 'var app = new Shop.Carts.CartsController();' }])
    // A main that starts a ticker on its own line is both.
    expect(entryPointsOf('func main() { t := time.NewTicker(time.Second); defer t.Stop() }', { lang: 'go', main: true }).map(e => `${e.kind} ${e.name ?? '-'}`)).toEqual(['main main', 'schedule -'])
  })

  it('tells socket servers apart, keeping a server and its handler as one, and keeps the whole line', () => {
    const two = "const a = new WebSocketServer({ port: 1 })\nconst b = new WebSocketServer({ port: 2 })\nb.on('connection', accept)"
    expect(entryPointsOf(two).map(e => `${e.line} ${e.kind}`)).toEqual(['1 socket', '2 socket'])
    // Another receiver's handler is a start of its own, written as the line reads.
    const other = entryPointsOf("const a = new WebSocketServer({ port: 1 })\nwss.on('connection', accept)")
    expect(other.map(e => e.text)).toEqual(['const a = new WebSocketServer({ port: 1 })', "wss.on('connection', accept)"])
  })

  it('names what a start starts: the method an annotation marks, past its arguments, never a call in its body; a timer’s callback', () => {
    const name = (src, o) => entryPointsOf(src, o).map(e => e.name ?? '-')
    expect(name('@Scheduled(fixedRate = 5000) public void sweep() { audit(); }', { lang: 'java' })).toEqual(['sweep'])
    expect(name('@Scheduled(\n    cron = "0 0 * * * *",\n    zone = "UTC")\n@Transactional\npublic void nightly() {\n  audit();\n}', { lang: 'java' })).toEqual(['nightly'])
    expect(name('@Scheduled(fixedRate = 5000)\npublic void sweep() {\n  audit();\n}', { lang: 'java' })).toEqual(['sweep'])
    expect(name('const timer = window.setInterval(load, 5000);')).toEqual(['load'])
    expect(name('setInterval(() => refresh(), 1000)')).toEqual(['-'])
  })

  it('reads arguments as a command only in a file a project starts from, and gives a program one main', () => {
    const argv = ['const [job] = process.argv.slice(2)', 'console.log(process.argv.length)'].join('\n')
    expect(entryPointsOf(argv, { entry: true }).map(e => `${e.line} ${e.kind}`)).toEqual(['1 main'])
    expect(entryPointsOf(argv, { entry: false })).toEqual([])
    expect(entryPointsOf(['#!/usr/bin/env python3', 'if __name__ == "__main__":', '    run()'].join('\n')).map(e => `${e.line} ${e.kind}`)).toEqual(['1 main'])
    expect(entryPointsOf('')).toEqual([])
    // A scanner's own patterns, and a string that opens with a start's words, are not one.
    expect(entryPointsOf(String.raw`  ['schedule', /@Scheduled\b.*|\bsetInterval\s*\(.*/],` + '\n' + `const help = '@Scheduled runs it'`)).toEqual([])
    // A non-ASCII name is read whole; a long line is kept to 140 characters.
    const [e] = entryPointsOf([`    @Scheduled(cron = "${'0 '.repeat(100)}")`, '    void nächtlich() {}'].join('\n'))
    expect([e.kind, e.text.length, e.name]).toEqual(['schedule', 140, 'nächtlich'])
  })
})
