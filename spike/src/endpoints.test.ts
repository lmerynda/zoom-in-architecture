import { describe, expect, it } from 'vitest'
import { searchMap } from './controls/logic'
import { buildApi, callsIn, clientParts, endpointOf, featureFacts, filterApi, groupApi, declLine, handlerParams, isPage, markedEntries, mergeTables, methodCounts, namedWords, routeParams, servedBy, takenTypes, topCounts } from './endpoints'
import type { ElementJson, EntryPointJson, ModelJson } from './model'
import { placeUrl } from './places'

const el = (id: string, parent: string | null, extra: Partial<ElementJson> = {}): ElementJson => ({ id, parent, title: id.split('.').pop()!, kind: 'component', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle', ...extra })
const ctrl = 'src/MarketController.java', repo = 'src/KingdomRepository.java'
/** A Requests model: a server with two resources, three endpoints, a client calling two of them. */
const requests: ModelJson = {
  name: 'm.requests',
  published: { at: '2026-11-25T00:00:00Z', traced: { at: '2026-11-25T00:00:00Z', command: 'npm test', exit: 0, seen: 2, total: 3 } },
  elements: [
    el('client', null, { title: 'Game client', kind: 'webapp' }),
    el('server', null, { title: 'Game server', kind: 'app' }),
    el('db', null, { title: 'Database', kind: 'database' }),
    el('server.market', 'server', { title: '/market' }),
    el('server.market.e1', 'server.market', { title: 'POST /market/{id}/buy', description: 'POST /market/{id}/buy: MarketController.buyOffer returns ActionResult<MarketPurchaseDto> as JSON.', metadata: { method: 'POST', route: '/market/{id}/buy', seen: '6675', statuses: '200 ×6654 · 401 ×5', tables: 'kingdom_entity: UPDATE · user_entity: SELECT' } }),
    el('server.market.e1.s1', 'server.market.e1', { title: '1 · buyOffer()', technology: 'MarketController', kind: 'code', metadata: { path: ctrl, role: 'step', step: '1', span: '67-76', marks: '34:route 66:route' } }),
    el('server.market.e1.s2', 'server.market.e1', { title: '2 · KingdomRepository', kind: 'code', metadata: { path: repo, role: 'step', step: '2', span: '36-39' } }),
    el('server.market.e1.response', 'server.market.e1', { title: '3 · Response', metadata: { role: 'response', answer: 'body', model: 'ActionResult<MarketPurchaseDto>' } }),
    el('server.market.e2', 'server.market', { title: 'GET /market/allies', metadata: { method: 'GET', route: '/market/allies', seen: '0' } }),
    el('server.market.e2.s1', 'server.market.e2', { title: '1 · allies()', technology: 'MarketController', kind: 'code', metadata: { path: ctrl, role: 'step', step: '1', span: '34-40', marks: '34:route 66:route' } }),
    el('server.zlast', 'server', { title: '/zélan' }),
    el('server.zlast.e1', 'server.zlast', { title: 'DELETE /zélan/{slug}', metadata: { method: 'DELETE', route: '/zélan/{slug}', seen: '12' } }),
    el('server.zlast.e1.s1', 'server.zlast.e1', { title: '1 · drop()', technology: 'ZelanController', kind: 'code', metadata: { path: 'src/Zélan.java', role: 'step', step: '1', span: '9-12', marks: '8:route 20:schedule' } }),
  ],
  relations: [
    { source: 'client', target: 'server.market.e1.s1', title: 'buy', kind: 'runtime' },
    { source: 'client', target: 'server.zlast.e1.s1', title: 'drop', kind: 'runtime' },
    { source: 'server.market.e1.s1', target: 'server.market.e1.s2', title: 'KingdomRepository' },
    { source: 'server.market.e1.s2', target: 'db', title: 'kingdoms (JPA)', kind: 'runtime' },
  ],
}

describe('endpointOf', () => {
  it('reads method and path from metadata, or from a title in maps built before metadata', () => {
    expect(endpointOf({ title: 'x', metadata: { method: 'post', route: '/a' } })).toEqual({ method: 'POST', route: '/a' })
    expect(endpointOf({ title: 'GET /owners/find' })).toEqual({ method: 'GET', route: '/owners/find' })
    expect(endpointOf({ title: '/owners' })).toBeNull()
    expect(endpointOf({ title: '' })).toBeNull()
    expect(endpointOf({ title: 'GETTER /x' })).toBeNull()
  })
})

describe('older maps', () => {
  it('give back a path shortened under its group', () => {
    expect(endpointOf({ title: 'GET …/edit' }, '/owners/{ownerId}')).toEqual({ method: 'GET', route: '/owners/{ownerId}/edit' })
    expect(endpointOf({ title: 'POST …/pets/new' }, '/owners/{ownerId}/ · x')).toEqual({ method: 'POST', route: '/owners/{ownerId}/pets/new' })
    expect(endpointOf({ title: 'GET …/edit' })).toEqual({ method: 'GET', route: '…/edit' })
    const api = buildApi({ name: 'p', elements: [el('app', null), el('app.o', 'app', { title: '/owners/{ownerId}' }), el('app.o.e', 'app.o', { title: 'GET …/edit' }), el('app.o.e.s1', 'app.o.e', { title: '1 · initUpdateOwnerForm()', metadata: { path: 'Owner.java' } })], relations: [] })
    expect(api.endpoints.map(ep => ep.title)).toEqual(['GET /owners/{ownerId}/edit'])
    // A step with no span: where the handler starts is not known, not line 1.
    expect(api.endpoints[0].handler).toEqual({ path: 'Owner.java', line: 0, name: 'Owner.initUpdateOwnerForm' })
  })
})

describe('handlerParams and takenTypes', () => {
  const java = ['class C {', '  @PostMapping("/auth/authenticate")', '  public ResponseEntity<AuthResponseDto> login(', '      @RequestBody AuthRequestDto req,', '      Map<String, List<Integer>> extra) {', '    return new AuthResponseDto(x);', '  }', '}'].join('\n')
  it('reads a handler\'s parameters over several lines, nested generics and all', () => {
    expect(handlerParams(java, 2, 'login')).toBe('\n      @RequestBody AuthRequestDto req,\n      Map<String, List<Integer>> extra')
    expect(handlerParams(java, 0, 'login')).toContain('AuthRequestDto')
    expect(handlerParams(java, 2, 'nope')).toBeNull()
    expect(handlerParams('', 1, 'login')).toBeNull()
    expect(handlerParams(java, 2, '')).toBeNull()
  })
  it('tells a taken type from one only named, and how it is taken', () => {
    const params = handlerParams(java, 2, 'login')!
    expect([...takenTypes(params, ['AuthRequestDto', 'AuthResponseDto'])]).toEqual([['AuthRequestDto', 'the request body']])
    expect([...takenTypes('@PathVariable UUID id, UserData user, @RequestParam Página p', ['UserData', 'Página', 'UUID'])]).toEqual([['UserData', 'a parameter of the handler'], ['Página', 'a query parameter'], ['UUID', 'in the path']])
    expect(takenTypes('', ['X']).size).toBe(0)
  })
})

describe('callsIn', () => {
  it('finds the endpoints a page calls by its handlers\' names, in either case style', () => {
    const api = buildApi(requests)
    expect(callsIn('const r = await api.buyOffer(id, n)', api.endpoints)).toEqual(['server.market.e1'])
    const snake = { ...api.endpoints[1], id: 'x', handler: { path: 'login.py', line: 1, name: 'login.reset_password' } }
    expect(callsIn('LoginService.resetPassword({ requestBody })', [snake])).toEqual(['x'])
    // Named, not called; too short or too common to tell an endpoint.
    expect(callsIn('// buyOffer is elsewhere', api.endpoints)).toEqual([])
    expect(callsIn('drop(x); list()', api.endpoints)).toEqual([])
    expect(callsIn('', api.endpoints)).toEqual([])
  })
})

describe('isPage and declLine', () => {
  it('calls a page what is in a pages folder or a template, not a piece of one', () => {
    expect(isPage('browser/src/pages/Market.tsx')).toBe(true)
    expect(isPage('browser/src/pages/MonumentPanel.tsx')).toBe(false)
    expect(isPage('browser/src/game/plans.ts')).toBe(false)
    expect(isPage('src/main/resources/templates/owners/createOrUpdateOwnerForm.html')).toBe(true)
    expect(isPage('')).toBe(false)
    // A routes folder holds pages in a web client, handlers in a server; a layout frames pages.
    expect(isPage('frontend/src/routes/login.tsx')).toBe(true)
    expect(isPage('backend/app/api/routes/login.py')).toBe(false)
    expect(isPage('frontend/src/routes/__root.tsx')).toBe(false)
    expect(isPage('frontend/src/routes/_layout.tsx')).toBe(false)
  })
  it('finds where a method is declared, not where it is called', () => {
    const src = ['class C {', '  void a() { this.initFindForm(); }', '  @GetMapping("/owners/find")', '  public String initFindForm(Model m) {', '  }'].join('\n')
    expect(declLine(src, 'initFindForm')).toBe(4)
    expect(declLine(src, 'nope')).toBe(0)
    expect(declLine('', 'x')).toBe(0)
  })
  it('takes a caller from another part in an older map, whose links carry no kind, but not a person', () => {
    const api = buildApi({ name: 'o', elements: [el('dev', null, { kind: 'actor' }), el('web', null), el('api', null), el('api.e', 'api', { title: 'GET /users' }), el('api.e.s1', 'api.e', { title: '1 · list()', metadata: { path: 'u.py' } }), el('api.x', 'api')], relations: [{ source: 'web', target: 'api.e.s1', title: 'users' }, { source: 'api.x', target: 'api.e.s1', title: 'same part' }, { source: 'dev', target: 'api.e.s1', title: 'builds and runs it' }] })
    expect(api.callers.get('api.e')?.map(c => c.from)).toEqual(['web'])
  })
})

describe('routeParams', () => {
  it('names the parameters of every route style', () => {
    expect(routeParams('/market/{id}/buy')).toEqual(['id'])
    expect(routeParams('/a/{id:int}/b/{slug}')).toEqual(['id', 'slug'])
    expect(routeParams('/articles/:slug/comments/:id')).toEqual(['slug', 'id'])
    expect(routeParams('/u/<int:user_id>')).toEqual(['user_id'])
    expect(routeParams('/')).toEqual([])
    expect(routeParams('/zélan/{slüg}')).toEqual(['slüg'])
  })
})

describe('buildApi', () => {
  const api = buildApi(requests)
  it('lists every endpoint, ordered by app, resource and path, with its handler, return type and trace', () => {
    expect(api.endpoints.map(ep => ep.title)).toEqual(['GET /market/allies', 'POST /market/{id}/buy', 'DELETE /zélan/{slug}'])
    const buy = api.endpoints[1]
    expect(buy).toMatchObject({ app: 'server', group: 'server.market', groupTitle: '/market', returns: 'ActionResult<MarketPurchaseDto>', seen: 6675 })
    expect(buy.handler).toEqual({ path: ctrl, line: 67, name: 'MarketController.buyOffer' })
    expect(buy.cards.map(c => c.path)).toEqual([ctrl, repo])
    expect(api.endpoints[0].seen).toBe(0)
  })
  it('records who calls each endpoint at runtime, by the calling part', () => {
    expect(api.callers.get('server.market.e1')).toEqual([{ from: 'client', top: 'client', title: 'buy' }])
    expect(api.callers.has('server.market.e2')).toBe(false)
    expect([...clientParts(api)]).toEqual(['client'])
  })
  it('says untraced as unknown, not as unseen', () => {
    const plain = buildApi({ ...requests, published: undefined })
    expect(plain.traced).toBe(false)
    expect(plain.endpoints.every(ep => ep.seen === null)).toBe(true)
    expect(filterApi(plain, { unseen: true })).toEqual([])
  })
  it('is empty for a model without endpoints', () => {
    expect(buildApi({ name: 'x', elements: [], relations: [] }).endpoints).toEqual([])
  })
})

describe('filterApi, groupApi and methodCounts', () => {
  const api = buildApi(requests)
  it('filters by method, by unseen, by words and by a given set', () => {
    expect(filterApi(api, { method: 'POST' }).map(ep => ep.id)).toEqual(['server.market.e1'])
    expect(filterApi(api, { unseen: true }).map(ep => ep.id)).toEqual(['server.market.e2'])
    expect(filterApi(api, { query: 'purchase' }).map(ep => ep.id)).toEqual(['server.market.e1'])
    expect(filterApi(api, { query: 'ZÉLAN' }).map(ep => ep.id)).toEqual(['server.zlast.e1'])
    expect(filterApi(api, { ids: [] })).toEqual([])
    expect(filterApi(api, { app: 'client' })).toEqual([])
  })
  it('groups by resource with counts, and counts methods in a fixed order', () => {
    expect(groupApi(api.endpoints, false).map(g => `${g.title}:${g.endpoints.length}`)).toEqual(['/market:2', '/zélan:1'])
    expect(groupApi(api.endpoints, true)[0].title).toBe('Game server · /market')
    expect(groupApi([], false)).toEqual([])
    expect(methodCounts(api.endpoints)).toEqual([['GET', 1], ['POST', 1], ['DELETE', 1]])
  })
  it('lists what a file serves in the order its handlers stand', () => {
    expect(servedBy(api, ctrl).map(ep => ep.route)).toEqual(['/market/allies', '/market/{id}/buy'])
    expect(servedBy(api, 'nowhere')).toEqual([])
  })
})

describe('markedEntries', () => {
  it('counts each marked route once per file and line, and the map’s entry points by kind, each with its top-level part', () => {
    // A scanner's schedule mark (20:schedule) no longer counts: the map's entry points say what starts work.
    const starts: EntryPointJson[] = [
      { kind: 'schedule', element: 'server.zlast.e1.s1', line: 20, text: '@Scheduled(cron = "0 0 * * * *")', name: 'nightly' },
      { kind: 'message', element: 'server.zlast.e1.s1', line: 30, text: '@KafkaListener(topics = "orders")', name: 'onOrder' },
      { kind: 'main', element: 'server.zlast.e1.s1', line: 2, text: 'public static void main(String[] args)', name: 'main' },
      // An element the model does not have is left out, not guessed.
      { kind: 'socket', element: 'server.gone', line: 1, text: 'new WebSocketServer({ port: 1 })' },
    ]
    const m = markedEntries(requests.elements, starts)
    expect(m.route.map(r => `${r.path}:${r.line}`)).toEqual([`${ctrl}:34`, `${ctrl}:66`, 'src/Zélan.java:8'])
    expect(m.schedule).toEqual([{ path: 'src/Zélan.java', line: 20, top: 'server', name: 'nightly' }])
    expect(m.message).toEqual([{ path: 'src/Zélan.java', line: 30, top: 'server', name: 'onOrder' }])
    expect(m.main.map(x => x.line)).toEqual([2])
    expect(m.socket).toEqual([])
    expect(markedEntries([], [])).toEqual({ route: [], schedule: [], message: [], socket: [], main: [] })
    // A timer or a handler in a page is the page's own, no way in; a page's route still counts.
    const page = [el('web', null), el('web.p', 'web', { metadata: { path: 'web/Collab.tsx', marks: '841:schedule 9:route' } })]
    const inPage = markedEntries(page, [{ kind: 'schedule', element: 'web.p', line: 841, text: 'setInterval(poll, 5000)', name: 'poll' }, { kind: 'message', element: 'web.p', line: 850, text: 'socket.onmessage = show' }])
    expect([inPage.schedule, inPage.message, inPage.route.map(r => r.line)]).toEqual([[], [], [9]])
    // A browser app's timers are its own even in a .ts file; a worker's handler and its start stay, whatever it calls.
    const parts = [el('web', null, { kind: 'webapp' }), el('web.api', 'web', { metadata: { path: 'web/src/api/client.ts' } }), el('worker', null, { kind: 'app' }), el('worker.q', 'worker', { metadata: { path: 'worker/src/consumer.ts' } })]
    const both = markedEntries(parts, [
      { kind: 'schedule', element: 'web.api', line: 133, text: 'refreshTimer = window.setInterval(async () => {' },
      { kind: 'message', element: 'worker.q', line: 12, text: "parentPort.on('message', dispatch)" },
      { kind: 'main', element: 'worker.q', line: 1, text: '#!/usr/bin/env node' },
    ])
    expect([both.schedule, both.message.map(m => m.top), both.main.map(m => m.top)]).toEqual([[], ['worker'], ['worker']])
  })
})

describe('featureFacts', () => {
  const arch = [
    el('client', null, { kind: 'webapp' }), el('client.market', 'client', { title: 'Market', features: ['Market'], metadata: { path: 'web/pages/Market.tsx' } }),
    el('server', null, { kind: 'app' }), el('server.offers', 'server', { title: 'Market', features: ['Market'] }),
    el('server.offers.c', 'server.offers', { title: 'MarketController', metadata: { path: ctrl } }),
    el('db', null, { kind: 'database', features: ['Market'] }),
  ]
  it('meets a feature’s pages, its endpoints and the tables they touched', () => {
    const f = featureFacts(arch, buildApi(requests), 'Market')
    expect(f.pages).toEqual(['client.market'])
    expect(f.parts).toEqual(['server.offers', 'db'])
    expect(f.endpoints.map(ep => ep.route)).toEqual(['/market/allies', '/market/{id}/buy'])
    expect(f.tables).toBe('kingdom_entity: UPDATE · user_entity: SELECT')
  })
  it('gives a feature only the endpoints it names when their handler carries several, and calls only page files pages', () => {
    const shared = [
      el('app', null, { kind: 'webapp' }), el('app.owner', 'app', { features: ['Find owners', 'Add owner'] }),
      el('app.owner.c', 'app.owner', { metadata: { path: 'Owner.java' } }),
      el('app.owner.t', 'app.owner', { features: ['Find owners'], metadata: { path: 'templates/owners/findOwners.html' } }),
      el('app.owner.h', 'app.owner', { features: ['Find owners'], metadata: { path: 'src/graph.ts' } }),
    ]
    const ep = (id: string, title: string, handler: string) => [el(id, 'app', { title }), el(`${id}.s`, id, { title: `1 · ${handler}()`, metadata: { path: 'Owner.java' } })]
    const api = buildApi({ name: 'p', elements: [el('app', null), ...ep('app.e1', 'GET /owners/find', 'initFindForm'), ...ep('app.e2', 'POST /owners/new', 'processCreationForm'), ...ep('app.e3', 'GET /owners', 'processFindForm')], relations: [] })
    const f = featureFacts(shared, api, 'Find owners')
    expect(f.endpoints.map(e => e.title)).toEqual(['GET /owners', 'GET /owners/find'])
    expect(f.pages).toEqual(['app.owner.t'])
    expect(f.parts).toEqual(['app.owner', 'app.owner.h'])
    expect(f.shared.map(e => e.title)).toEqual(['POST /owners/new'])
    // Words that name none of them: none is claimed, all are said as shared.
    const add = featureFacts(shared, api, 'Add owner')
    expect(add.endpoints).toEqual([])
    expect(add.shared.length).toBe(3)
    // A route whose path renders a page carrying the feature serves it.
    const shown = [...shared, el('app.owner.d', 'app.owner', { features: ['Owner information'], metadata: { path: 'templates/owners/ownerDetails.html' } })]
    const api2 = buildApi({ name: 'p', elements: [el('app', null), ...ep('app.e1', 'GET /owners/{ownerId}', 'showOwner'), el('app.e1.v', 'app.e1', { title: '2 · ownerDetails', metadata: { path: 'templates/owners/ownerDetails.html' } }), ...ep('app.e2', 'POST /owners/new', 'processCreationForm')], relations: [] })
    expect(featureFacts(shown, api2, 'Owner information').endpoints.map(e => e.title)).toEqual(['GET /owners/{ownerId}'])
  })
  /**
   * A handler file `path` carrying `features`, and its routes: [title, method, the type its description
   * says it returns, extra card paths, its responses' models].
   */
  const handler = (path: string, features: string[], routes: [string, string, string?, string[]?, string[]?][], more: ElementJson[] = []) => {
    const arch = [el('app', null, { kind: 'app' }), el('app.c', 'app', { features, metadata: { path } }), ...more]
    const elements = [el('api', null), ...routes.flatMap(([title, m, ret, cards, models], k) => [
      el(`api.e${k}`, 'api', { title, description: ret ? `${title}: C.${m} returns ${ret} as JSON.` : '' }),
      el(`api.e${k}.s1`, `api.e${k}`, { title: `1 · ${m}()`, metadata: { path } }),
      ...(cards ?? []).map((p, j) => el(`api.e${k}.s${j + 2}`, `api.e${k}`, { title: `${j + 2} · ${p}`, metadata: { path: p } })),
      ...(models ?? []).map((model, j) => el(`api.e${k}.r${j}`, `api.e${k}`, { title: `${j + 9} · Response`, metadata: { role: 'response', model } })),
    ])]
    return { arch, api: buildApi({ name: 'r', elements, relations: [] }) }
  }
  const own = (f: ReturnType<typeof featureFacts>) => f.endpoints.map(e => e.title)
  const apart = (f: ReturnType<typeof featureFacts>) => f.shared.map(e => e.title)
  it('names a route by a feature’s words joined as code writes them, and by none of its parameters', () => {
    expect(namedWords('Sign up', '/api/v1/users/signup', 'register_user')).toBe(1)
    expect(namedWords('Signup', '/sign-up', '')).toBe(1)
    expect(namedWords('Log in', '/auth', 'logIn')).toBe(1)
    expect(namedWords('Find owners', '/owners/find', 'initFindForm')).toBe(2)
    // Up to three words joined: four are not read as one.
    expect(namedWords('Reset user password', '/resetuserpassword', '')).toBe(3)
    expect(namedWords('Reset my user password', '/resetmyuserpassword', '')).toBe(0)
    // A route of parameters only, in any style and script, is named by its method alone.
    expect(namedWords('Owner', '/{owner}', '')).toBe(0)
    expect(namedWords('Owner', '/:owner/<int:owner>/{owner:int}', 'show')).toBe(0)
    expect(namedWords('Übung', '/:Übung', '')).toBe(0)
    expect(namedWords('Show article', '/{slug}', 'showArticle')).toBe(2)
    // No words of its own: nothing to name.
    expect(namedWords('', '/a', 'b')).toBe(0)
    expect(namedWords('UI', '/ui', 'ui')).toBe(0)
  })
  it('reads words in any script and either Unicode form, acronyms split, plurals folded only where they are plurals', () => {
    expect(namedWords('Página de pedidos', '/pedido/{id}', 'verPágina')).toBe(2)
    expect(namedWords('Zélan', '/zélan/{slug}', '')).toBe(1)
    expect(namedWords('Zélan', '/lan', '')).toBe(0)
    // A decomposed á (a + U+0301) is the same word as a composed one, and not a split before "gina".
    expect(namedWords('Página', '/página', '')).toBe(1)
    expect(namedWords('Gina', '/página', '')).toBe(0)
    expect(namedWords('Search', '/x', 'getXMLSearch')).toBe(1)
    expect(namedWords('XML export', '/x', 'getXMLExport')).toBe(2)
    // News, status and class are no plurals of new, statu and clas.
    expect(namedWords('News', '/new', '')).toBe(0)
    expect(namedWords('Status', '/statu', '')).toBe(0)
    expect(namedWords('Owners', '/owner', '')).toBe(1)
  })
  it('names the parameters of a route in any script', () => {
    expect(routeParams('/:Übung/<int:größe>')).toEqual(['Übung', 'größe'])
  })
  it('gives Sign up its signup route and leaves the users file’s others apart', () => {
    const { arch, api } = handler('users.py', ['User administration', 'Sign up', 'User settings'], [['GET /users', 'read_users'], ['POST /users/signup', 'register_user'], ['PATCH /users/me', 'update_user_me']])
    const up = featureFacts(arch, api, 'Sign up')
    expect(own(up)).toEqual(['POST /users/signup'])
    expect(up.shared.map(e => e.title)).toEqual(['GET /users', 'PATCH /users/me'])
    // "user" names every route alike: User settings claims none.
    expect(own(featureFacts(arch, api, 'User settings'))).toEqual([])
  })
  it('claims nothing for a feature with no words, even a handler’s only route', () => {
    const one = handler('ui.py', ['UI', 'Admin'], [['GET /ui', 'ui']])
    expect(own(featureFacts(one.arch, one.api, 'UI'))).toEqual([])
    expect(featureFacts(one.arch, one.api, 'UI').shared.length).toBe(1)
    const two = handler('ui.py', ['UI', 'Admin'], [['GET /x', 'x'], ['GET /y', 'y']])
    expect(own(featureFacts(two.arch, two.api, 'UI'))).toEqual([])
  })
  it('lists apart a route whose word matches two features, giving it to the one that tells it from the rest', () => {
    const { arch, api } = handler('orders.py', ['Export orders', 'Order history'], [['GET /orders', 'list_orders'], ['GET /orders/export', 'export_orders']])
    expect(own(featureFacts(arch, api, 'Export orders'))).toEqual(['GET /orders/export'])
    const hist = featureFacts(arch, api, 'Order history')
    expect(own(hist)).toEqual([])
    expect(apart(hist)).toEqual(['GET /orders', 'GET /orders/export'])
    // Two features whose words each tell the same route from the rest: neither claims it.
    const two = handler('users.py', ['Sign up form', 'Sign up email'], [['GET /health', 'health'], ['POST /users/signup', 'register']])
    for (const f of ['Sign up form', 'Sign up email']) {
      expect(own(featureFacts(two.arch, two.api, f))).toEqual([])
      expect(apart(featureFacts(two.arch, two.api, f))).toEqual(['GET /health', 'POST /users/signup'])
    }
  })
  it('gives non-ASCII features the routes their words name', () => {
    const { arch, api } = handler('Reservas.java', ['Página de reservas', 'Anulación'], [['GET /reservas', 'verPágina'], ['POST /anulación/{id}', 'anular']])
    expect(own(featureFacts(arch, api, 'Página de reservas'))).toEqual(['GET /reservas'])
    expect(own(featureFacts(arch, api, 'Anulación'))).toEqual(['POST /anulación/{id}'])
  })
  it('gives a feature the route whose answer is a type only it carries among the handler’s features', () => {
    const vets = 'vet/Vets.java', page = 'templates/vets/vetList.html'
    const more = [el('app.v', 'app', { features: ['Vets as JSON or XML'], metadata: { path: vets } }), el('app.l', 'app', { features: ['Veterinarians'], metadata: { path: page } })]
    const { arch, api } = handler('vet/VetController.java', ['Veterinarians', 'Vets as JSON or XML'], [['GET /vets', 'showResourcesVetList', 'Vets', [vets]], ['GET /vets.html', 'showVetList', '', [vets, page]]], more)
    expect(api.endpoints.map(e => e.answers)).toEqual([['Vets'], []])
    const json = featureFacts(arch, api, 'Vets as JSON or XML')
    expect(own(json)).toEqual(['GET /vets'])
    expect(apart(json)).toEqual(['GET /vets.html'])
    const list = featureFacts(arch, api, 'Veterinarians')
    expect(own(list)).toEqual(['GET /vets.html'])
    expect(apart(list)).toEqual(['GET /vets'])
  })
  describe('an answer tells a route’s feature only when it is unambiguous', () => {
    const thing = (features: string[], path = 'Thing.java') => [el('app.t', 'app', { features, metadata: { path } })]
    const owns = (h: ReturnType<typeof handler>) => ['A list', 'B view'].map(f => own(featureFacts(h.arch, h.api, f)))
    it('counts a type in a generic, and one the route’s responses name', () => {
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'List<Thing>', ['Thing.java']], ['GET /y', 'y']], thing(['A list'])))).toEqual([['GET /x'], []])
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', '', ['Thing.java'], ['Thing']], ['GET /y', 'y']], thing(['B view'])))).toEqual([[], ['GET /x']])
    })
    it('tells nothing by a type both features carry, or two types of different features, in either order', () => {
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'Thing', ['Thing.java']], ['GET /y', 'y']], thing(['A list', 'B view'])))).toEqual([[], []])
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'Either<Foo, Bar>', ['Foo.java', 'Bar.java']], ['GET /y', 'y']], [el('app.f', 'app', { features: ['A list'], metadata: { path: 'Foo.java' } }), el('app.b', 'app', { features: ['B view'], metadata: { path: 'Bar.java' } })]))).toEqual([[], []])
      const cards = ['Foo.java', 'Bar.java'], types = [el('app.f', 'app', { features: ['A list'], metadata: { path: 'Foo.java' } }), el('app.b', 'app', { features: ['B view'], metadata: { path: 'Bar.java' } })]
      const fooFirst = handler('C.java', ['A list', 'B view'], [['GET /x', 'x', '', cards, ['Foo', 'Bar']], ['GET /y', 'y']], types)
      const barFirst = handler('C.java', ['A list', 'B view'], [['GET /x', 'x', '', cards, ['Bar', 'Foo']], ['GET /y', 'y']], types)
      expect(fooFirst.api.endpoints[0].answers).toEqual(['Foo', 'Bar'])
      expect([owns(fooFirst), owns(barFirst)]).toEqual([[[], []], [[], []]])
    })
    it('tells nothing by a type only named, display text, a type in another folder, or a file no feature lists', () => {
      // Not a card of the route.
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'Thing'], ['GET /y', 'y']], thing(['A list'])))).toEqual([[], []])
      // "what the handler returns" says no type: a handler.py card is not its answer.
      const said = handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'what the handler returns', ['handler.py']], ['GET /y', 'y']], thing(['A list'], 'handler.py'))
      expect(said.api.endpoints[0].answers).toEqual([])
      expect(owns(said)).toEqual([[], []])
      // a.Result is a/Result, not b/Result; it is a/Result.
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'a.Result', ['b/Result.java']], ['GET /y', 'y']], thing(['A list'], 'b/Result.java')))).toEqual([[], []])
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'a.Result', ['src/a/Result.java']], ['GET /y', 'y']], thing(['A list'], 'src/a/Result.java')))).toEqual([['GET /x'], []])
      // Result in two folders of the route: which one is not known.
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'Result', ['a/Result.java', 'b/Result.java']], ['GET /y', 'y']], thing(['A list'], 'a/Result.java')))).toEqual([[], []])
      // Report.java lists no feature; the folder it sits in carrying one does not make it that feature's answer.
      const folder = [el('app.k', 'app', { features: ['A list'] }), el('app.k.r', 'app.k', { metadata: { path: 'Report.java' } })]
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /x', 'x', 'Report', ['Report.java']], ['GET /y', 'y']], folder))).toEqual([[], []])
    })
    it('lists apart a route one feature’s words claim and another’s answer does', () => {
      expect(owns(handler('C.java', ['A list', 'B view'], [['GET /list', 'x', 'Thing', ['Thing.java']], ['GET /y', 'y']], thing(['B view'])))).toEqual([[], []])
    })
  })
  it('has nothing for an unknown feature or a map without endpoints', () => {
    expect(featureFacts(arch, buildApi(requests), 'Nope')).toEqual({ parts: [], pages: [], endpoints: [], shared: [], tables: '' })
    expect(featureFacts(arch, null, 'Market').endpoints).toEqual([])
  })
})

describe('mergeTables and topCounts', () => {
  it('merges every operation each table saw', () => {
    expect(mergeTables(['a: SELECT · b: UPDATE', 'a: INSERT', '', 'c'])).toBe('a: INSERT, SELECT · b: UPDATE · c')
    expect(mergeTables([])).toBe('')
  })
  it('counts the top level as a reader names it, apps first, the rest as parts', () => {
    expect(topCounts(['actor', 'app', 'webapp', 'database', 'system', 'actor'])).toEqual(['2 apps', '1 database', '2 people', '1 system'])
    expect(topCounts(['thing', 'gizmo', 'database'])).toEqual(['1 database', '2 parts'])
    expect(topCounts([])).toEqual([])
  })
})

describe('searchMap groups a shared file', () => {
  it('shows a file once, before the cap, with every card that shows it', () => {
    const els = [el('', null), ...Array.from({ length: 30 }, (_, k) => el(`e${k}.s`, null, { title: `${k + 1} · KingdomRepository`, metadata: { path: repo } })), el('f', null, { title: 'KingdomService', metadata: { path: 'src/KingdomService.java' } })]
    const found = searchMap(els, 'Kingdom')
    expect(found.files.length).toBe(2)
    expect(found.files.find(f => els[f.i].metadata!.path === repo)!.same.length).toBe(30)
  })
})

describe('placeUrl', () => {
  it('names the place and the selection together, and carries the request only where asked', () => {
    expect(placeUrl('?model=m', { at: 'a.b', in: 'a' })).toBe('?model=m&in=a&at=a.b')
    expect(placeUrl('?model=m', { at: 'a', in: 'a' })).toBe('?model=m&at=a')
    expect(placeUrl('?model=m&req=r1', { at: null, in: 'a' })).toBe('?model=m&req=r1&in=a')
    expect(placeUrl('?model=m&req=r1', { at: null, req: null })).toBe('?model=m')
    expect(placeUrl('?model=m', { at: null, file: 'src/a b.ts', req: 'r2' })).toBe('?model=m&file=src/a+b.ts&req=r2')
  })
})
