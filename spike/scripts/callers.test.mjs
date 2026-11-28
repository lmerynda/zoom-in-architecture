import { describe, expect, it } from 'vitest'
import { declaredTypes, markCallers, pageFor, pageRoutes, placeTree, TESTS_KEPT } from './observed.mjs'

const file = (id, path, parent = 'app') => ({ id, parent, title: id, kind: 'code', metadata: { path } })

describe('pageRoutes', () => {
  const app = `import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Register, SignIn as Login } from "./pages/Auth";
import Build from "./pages/Build";
import { GameShell } from "./shell/GameShell";
import { GameProvider } from "./game/GameState";
const Wars = React.lazy(() => import("./pages/War"));
export const App = () => (
  <Routes>
    <Route path="/" element={signedIn ? <Navigate to="/kingdom/overview" replace /> : <Landing />} />
    <Route path="/sign-in" element={<Login />} />
    <Route path='/register' element={<Register />} />
    <Route
      path="/kingdom"
      element={
        signedIn ? (<GameProvider fallback={e => <p>{e > 1 ? "x" : "y"}</p>}><GameShell /></GameProvider>) : (<Navigate to="/sign-in" replace />)
      }
    >
      <Route index element={<Navigate to="build" replace />} />
      <Route path="build" element={<Build />} />
      <Route path={"war/:id"} element={<Wars />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);`
  const sources = {
    'web/src/App.tsx': app, 'web/src/pages/Landing.tsx': '', 'web/src/pages/Auth.tsx': '', 'web/src/pages/Build.tsx': '', 'web/src/pages/War.tsx': '',
    'web/src/shell/GameShell.tsx': '', 'web/src/game/GameState.tsx': '',
    'web/src/routes.ts': `import Prices from './pages/Prices/index'\nexport const routes = [{ path: '/prices', component: Prices }, { path: 'about', element: <Missing /> }]`,
    'web/src/pages/Prices/index.tsx': '',
  }

  it('reads nested JSX routes, index routes and route objects, each page by the file it imports', () => {
    expect(pageRoutes(sources)).toEqual([
      { route: '/', path: 'web/src/pages/Landing.tsx' },
      { route: '/sign-in', path: 'web/src/pages/Auth.tsx' },
      { route: '/register', path: 'web/src/pages/Auth.tsx' },
      // A layout route is its last own component; a Navigate-only index has no page of its own.
      { route: '/kingdom', path: 'web/src/shell/GameShell.tsx' },
      { route: '/kingdom/build', path: 'web/src/pages/Build.tsx' },
      { route: '/kingdom/war/:id', path: 'web/src/pages/War.tsx' },
      { route: '/prices', path: 'web/src/pages/Prices/index.tsx' },
    ])
    expect(pageRoutes({})).toEqual([])
    expect(pageRoutes({ 'a.ts': 'const path = 1' })).toEqual([])
  })

  it('gives a route a layout and its index page share to the page, and ignores routes commented out', () => {
    const src = {
      'w/App.tsx': [
        "import { Shell } from './Shell'", "import { Home } from './Home'", "import { Old } from './Old'", "import { New } from './New'",
        '<Route path="/app" element={<Shell />}>', '  <Route index element={<Home />} />', '</Route>',
        '{/* <Route path="/x" element={<Old />} /> */}', '// <Route path="/y" element={<Old />} />', '<Route path="/x" element={<New />} />',
      ].join('\n'),
      'w/Shell.tsx': '', 'w/Home.tsx': '', 'w/Old.tsx': '', 'w/New.tsx': '',
    }
    expect(pageRoutes(src)).toEqual([{ route: '/app', path: 'w/Home.tsx' }, { route: '/x', path: 'w/New.tsx' }])
  })

  it('joins nested route objects, each page from its own object, not its children', () => {
    const src = {
      'w/routes.tsx': [
        "import { Account } from './Account'", "import { Login } from './Login'", "import { Profile } from './Profile'",
        "export const routes = [{ path: '/account', element: <Account />, children: [",
        "  { path: 'login', element: <Login /> },",
        "  { path: 'me', element: <Profile style={{ wide: true }} /> },",
        ']}]',
      ].join('\n'),
      'w/Account.tsx': '', 'w/Login.tsx': '', 'w/Profile.tsx': '',
    }
    expect(pageRoutes(src)).toEqual([{ route: '/account', path: 'w/Account.tsx' }, { route: '/account/login', path: 'w/Login.tsx' }, { route: '/account/me', path: 'w/Profile.tsx' }])
  })

  it('finds the page an address is on, the most specific route first', () => {
    const routes = [{ route: '/kingdom/:tab', path: 'a' }, { route: '/kingdom/build', path: 'b' }, { route: '/', path: 'c' }]
    expect(pageFor(routes, '/kingdom/build')).toEqual({ route: '/kingdom/build', path: 'b' })
    expect(pageFor(routes, '/kingdom/war')).toEqual({ route: '/kingdom/:tab', path: 'a' })
    expect(pageFor(routes, '/')).toEqual({ route: '/', path: 'c' })
    expect(pageFor(routes, '/kingdom/build/1')).toBe(null)
    expect(pageFor([], '/x')).toBe(null)
  })
})

describe('markCallers', () => {
  const sources = { 'web/App.tsx': 'import { Shop } from "./Shop"\nimport { Ö } from "./Ö"\n<Route path="/shop/:id" element={<Shop />} />\n<Route path="/ö" element={<Ö />} />\n<Route path="/sign-in" element={<Ö />} />', 'web/Shop.tsx': '', 'web/Ö.tsx': '' }
  const models = () => ({
    model: { elements: [{ id: 'web', parent: null }, file('web.shop', 'web/Shop.tsx', 'web'), file('web.oe', 'web/Ö.tsx', 'web'), file('app.ctl', 'src/shop/MarketController.java')], relations: [] },
    requests: {
      elements: [
        { id: 'app.e1', parent: 'app', title: 'POST /market/{id}/buy', metadata: { method: 'POST', route: '/market/{id}/buy' } },
        { id: 'app.e1.s1', parent: 'app.e1', metadata: { role: 'step', step: '1', path: 'src/shop/MarketController.java' } },
        { id: 'app.e2', parent: 'app', title: 'GET /market', metadata: { method: 'GET', route: '/market' } },
      ],
      relations: [],
    },
  })
  const observed = { endpoints: [
    { method: 'POST', route: '/market/{id}/buy', count: 8, pages: { '/shop/1': 2, '/shop/22': 1, '/ö': 1, '/sign-in': 2, '/reset/t0ken': 1 }, tests: { 'a.test.ts › buys': 3 }, untimed: 2 },
    { method: 'GET', route: '/market', count: 1, pages: {}, tests: {} },
    { method: 'GET', route: '/unmapped', count: 1, pages: { '/shop/1': 1 }, tests: { 'b.test.ts › x': 1 } },
  ] }

  it('lists an endpoint’s pages, two addresses of one route as one page, and the tests that made it; an address no route names is only counted', () => {
    const { model, requests } = models()
    expect(markCallers(model, requests, observed, sources, declaredTypes(sources))).toEqual({ pages: 2 })
    const ep = requests.elements[0].metadata
    expect(JSON.parse(ep.pages)).toEqual([
      { page: '/shop/:id', path: 'web/Shop.tsx', count: 3 },
      { page: '/sign-in', path: 'web/Ö.tsx', count: 2 },
      { page: '/ö', path: 'web/Ö.tsx', count: 1 },
    ])
    // An address no route of the app matches may hold a value (a token): never kept, only counted.
    expect(ep.otherPages).toBe('1')
    expect(JSON.stringify(requests)).not.toContain('t0ken')
    expect(JSON.parse(ep.tests)).toEqual([{ test: 'a.test.ts › buys', count: 3 }])
    expect(ep.testCount).toBe('1')
    expect(ep.untimed).toBe('2')
    // No page and no test: nothing said.
    expect(requests.elements[2].metadata).toEqual({ method: 'GET', route: '/market' })
  })

  it('lists a page’s endpoints on its file, with the file that serves each', () => {
    const { model, requests } = models()
    markCallers(model, requests, observed, sources, declaredTypes(sources))
    const shop = model.elements.find(e => e.id === 'web.shop').metadata
    expect(shop.page).toBe('/shop/:id')
    expect(JSON.parse(shop.pageCalls)).toEqual([{ endpoint: 'POST /market/{id}/buy', count: 3, path: 'src/shop/MarketController.java' }])
    // Two routes of one file add up.
    const oe = model.elements.find(e => e.id === 'web.oe').metadata
    expect(oe.page).toBe('/sign-in · /ö')
    expect(JSON.parse(oe.pageCalls)[0].count).toBe(3)
  })

  it('keeps the busiest tests by name and counts them all', () => {
    const { model, requests } = models()
    const tests = Object.fromEntries(Array.from({ length: TESTS_KEPT + 5 }, (_, k) => [`t${String(k).padStart(2, '0')}`, k + 1]))
    markCallers(model, requests, { endpoints: [{ method: 'GET', route: '/market', count: 1, pages: {}, tests }] }, sources, declaredTypes(sources))
    const m = requests.elements[2].metadata
    expect(JSON.parse(m.tests)).toHaveLength(TESTS_KEPT)
    expect(JSON.parse(m.tests)[0]).toEqual({ test: `t${TESTS_KEPT + 4}`, count: TESTS_KEPT + 5 })
    expect(m.testCount).toBe(String(TESTS_KEPT + 5))
  })

  it('does nothing without a requests view', () => {
    const { model } = models()
    expect(markCallers(model, null, observed, sources, declaredTypes(sources))).toEqual({ pages: 0 })
    expect(model.elements.every(e => !e.metadata?.pageCalls)).toBe(true)
  })
})

describe('placeTree', () => {
  it('places each method of a call tree at its file and the line it is declared on; tables and "more" stay as they are', () => {
    const sources = { 'src/shop/OrderService.java': 'package shop;\nclass OrderService {\n  // list() is called below\n  public List<Order> list() {\n    return repo.findAll();\n  }\n}\n' }
    const tree = [{ at: 'shop.OrderService.list', count: 2, kids: [{ at: 'SELECT orders', count: 2, kids: [] }, { at: 'shop.Missing.run', count: 1, kids: [] }, { at: '3 more', count: 4 }] }]
    expect(placeTree(tree, declaredTypes(sources), sources)).toEqual([{ at: 'shop.OrderService.list', count: 2, path: 'src/shop/OrderService.java', line: 4, kids: [
      { at: 'SELECT orders', count: 2 }, { at: 'shop.Missing.run', count: 1 }, { at: '3 more', count: 4 },
    ] }])
    expect(placeTree([], new Map(), {})).toEqual([])
  })

  it('finds a method in its own class: two classes of one file, and a nested class, each with a method of one name', () => {
    const sources = { 'src/shop/OrderController.java': [
      'package shop;', '', 'public class OrderController {', '  static class Page {', '    List<Order> all() { return List.of(); }', '  }', '', '  public List<Order> all() {', '    return helper.all();', '  }', '}', '', 'class Helper {', '  List<Order> all() { return List.of(); }', '}', '',
    ].join('\n') }
    const tree = [{ at: 'shop.OrderController.all', count: 1, kids: [{ at: 'shop.Helper.all', count: 1, kids: [{ at: 'shop.OrderController$Page.all', count: 1 }, { at: 'shop.Helper.gone', count: 1 }] }] }]
    expect(placeTree(tree, declaredTypes(sources), sources)).toEqual([{ at: 'shop.OrderController.all', count: 1, path: 'src/shop/OrderController.java', line: 8, kids: [
      { at: 'shop.Helper.all', count: 1, path: 'src/shop/OrderController.java', line: 14, kids: [
        { at: 'shop.OrderController$Page.all', count: 1, path: 'src/shop/OrderController.java', line: 5 },
        // A method its class does not declare there has no line: never another class's.
        { at: 'shop.Helper.gone', count: 1, path: 'src/shop/OrderController.java' },
      ] },
    ] }])
  })

  it('finds a method where its class declares it: not in an anonymous class, a call, an escaped comment, or a top-level class whose name has a "$"', () => {
    const sources = {
      'src/p/Work.java': [
        'package p;', 'class Work {', '  Runnable r = new Runnable() {', '    public void run() { }', '  };', '  public void run() {', '    assert ready();', '  }', '  boolean ready() { return true; }', '  \\u002f\\u002f void list() { }', '  void list() { }', '}', '',
      ].join('\n'),
      'src/p/Cash$Box.java': ['package p;', 'class Cash$Box {', '  int get() { return 1; }', '  static class Inner {', '    int get() { return 2; }', '  }', '}', ''].join('\n'),
    }
    const tree = [{ at: 'p.Work.run', count: 1, kids: [{ at: 'p.Work.ready', count: 1 }, { at: 'p.Work.list', count: 1 }, { at: 'p.Work$1.run', count: 1 }, { at: 'p.Cash$Box$Inner.get', count: 1 }, { at: 'p.Cash$Box.get', count: 1 }] }]
    const at = placeTree(tree, declaredTypes(sources), sources)
    // Work$1 is the anonymous Runnable: its file is Work's, but which of Work's bodies it is the trace does not say, so no line.
    expect([at[0].line, ...at[0].kids.map(k => k.line)]).toEqual([6, 9, 11, undefined, 5, 3])
    expect(at[0].kids[2].path).toBe('src/p/Work.java')
  })

  it('folds an endpoint’s call tree into the requests view', () => {
    const requests = { elements: [{ id: 'e', parent: 'app', title: 'GET /x', metadata: { method: 'GET', route: '/x' } }], relations: [] }
    markCallers({ elements: [], relations: [] }, requests, { endpoints: [{ method: 'GET', route: '/x', count: 1, pages: {}, tests: {}, untimed: 0, tree: [{ at: 'a.B.c', count: 1 }] }] }, {}, new Map())
    expect(JSON.parse(requests.elements[0].metadata.callTree)).toEqual([{ at: 'a.B.c', count: 1 }])
  })
})
