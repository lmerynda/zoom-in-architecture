import { describe, expect, it } from 'vitest'
import { searchMap } from './controls/logic'
import { buildApi, callsIn, clientParts, endpointOf, featureFacts, filterApi, groupApi, declLine, handlerParams, isPage, markedEntries, mergeTables, methodCounts, routeParams, servedBy, takenTypes, topCounts } from './endpoints'
import type { ElementJson, ModelJson } from './model'
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
  it('counts each marked route and job once per file and line, with its top-level part', () => {
    const m = markedEntries(requests.elements)
    expect(m.route.map(r => `${r.path}:${r.line}`)).toEqual([`${ctrl}:34`, `${ctrl}:66`, 'src/Zélan.java:8'])
    expect(m.schedule).toEqual([{ path: 'src/Zélan.java', line: 20, top: 'server' }])
    expect(markedEntries([])).toEqual({ route: [], schedule: [] })
    // A timer in a page is no way in.
    expect(markedEntries([el('web', null), el('web.p', 'web', { metadata: { path: 'web/Collab.tsx', marks: '841:schedule 9:route' } })]).schedule).toEqual([])
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
