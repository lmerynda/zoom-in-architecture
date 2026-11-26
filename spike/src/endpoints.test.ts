import { describe, expect, it } from 'vitest'
import { searchMap } from './controls/logic'
import { buildApi, clientParts, endpointOf, featureFacts, filterApi, groupApi, markedEntries, mergeTables, methodCounts, routeParams, servedBy, topCounts } from './endpoints'
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
  })
})

describe('featureFacts', () => {
  const arch = [
    el('client', null, { kind: 'webapp' }), el('client.market', 'client', { title: 'Market', features: ['Market'], metadata: { path: 'web/Market.tsx' } }),
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
  it('has nothing for an unknown feature or a map without endpoints', () => {
    expect(featureFacts(arch, buildApi(requests), 'Nope')).toEqual({ parts: [], pages: [], endpoints: [], tables: '' })
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
