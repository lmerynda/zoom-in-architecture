import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph.mjs'
import { buildModel } from './map.mjs'
import { buildRequests } from './requests.mjs'
import { endpoints } from './routes.mjs'

const fixture = name => buildGraph(join(import.meta.dirname, `../test/fixtures/${name}`))
const brief = eps => eps.map(e => `${e.method} ${e.path} ${e.name}: ${e.steps.map(s => s.split('/').pop()).join(' > ')}${e.views.length ? ` | ${e.views.map(v => v.split('/').pop()).join(', ')}` : ''}`)

describe('endpoints', () => {
  it('reads Spring endpoints under their class prefix, through fields, constants and views', () => {
    const eps = endpoints(fixture('mvc'))
    expect(brief(eps)).toEqual([
      'GET / welcome: OrderController.java | welcome.html',
      'GET /api/orders all: OrderApi.java > OrderRepository.java',
      'POST /api/orders/{id}/pay pay: OrderApi.java',
      'POST /api/orders/{id}/refund-to-card refund: OrderApi.java',
      'POST /cart add: CartController.java',
      // The handler reaches the repository through the field it calls, and names its view by a constant.
      'GET /cart/items items: CartController.java > OrderRepository.java | list.html',
      'GET /orders list: OrderController.java | list.html',
    ])
    expect(eps.find(e => e.path === '/cart').response).toEqual({ redirect: '/cart/items' })
    // A REST handler's answer is the type inside ResponseEntity and Optional; a wildcard says nothing.
    expect(eps.filter(e => e.path.startsWith('/api')).map(e => e.response)).toEqual([{ model: 'List<Order>', json: true }, {}, {}])
  })

  it('follows a service only through the method the handler calls on it', () => {
    const add = endpoints(fixture('crowd')).find(e => e.path === '/account/add-card')
    // AccountService also writes the audit log, but not in addCard: that store is not on this path.
    expect(brief([add])).toEqual(['POST /account/add-card addCard: AccountApi.java > AccountService.java > CardRepository.java'])
  })

  it('reads FastAPI endpoints under the prefixes of the routers that mount them', () => {
    const eps = endpoints(fixture('api'))
    expect(brief(eps)).toEqual([
      // The calls in order down to the store, where the path stops; then the types the handler only names.
      'GET /api/v1/items/{id} read_item: items.py > crud.py > db.py > models.py',
      'GET /api/v1/items/health health: items.py',
    ])
    expect(eps[0].response).toEqual({ model: 'Item', json: true })
  })
})

describe('endpoints of Express and Gin routers', () => {
  it('reads Express routes under the prefixes their routers are mounted at, inline handlers and named ones', () => {
    const eps = endpoints(fixture('express'))
    // .use('/api', api) on the exported router, and api.use(orders) down a chain; the path is on the next line.
    expect(brief(eps)).toEqual([
      'GET /api/orders : orders.controller.js > orders.service.js',
      // A named handler is the function the route passes; the service is reached by its require name.
      'POST /api/orders create: orders.controller.js > orders.service.js',
    ])
    expect(eps.map(e => e.response)).toEqual([{ json: true }, { json: true }])
  })

  it('reads Gin routes under the group their register function is called with, handlers anywhere in the package', () => {
    const eps = endpoints(fixture('gin'))
    // router.GET("") and router.GET("/") are one endpoint; Pay lives in another file of the package.
    expect(brief(eps)).toEqual(['GET /api/orders List: routers.go > models.go', 'POST /api/orders/:id/pay Pay: pay.go > models.go'])
    expect(eps.every(e => e.response.json)).toBe(true)
  })
})

describe('buildRequests', () => {
  const graph = fixture('mvc')
  const map = {
    nodes: [
      { id: 'buyer', kind: 'actor', title: 'Buyer' },
      { id: 'web', kind: 'webapp', title: 'Shop', files: ['src/**'] },
      { id: 'db', kind: 'database', title: 'Orders DB' },
    ],
    features: [{ title: 'Orders', nodes: ['web'] }],
    links: [
      { from: 'buyer', to: 'web', title: 'shops' },
      { from: 'src/main/java/shop/OrderRepository.java', to: 'db', title: 'JPA', evidence: ['src/main/java/shop/OrderRepository.java:3'] },
    ],
  }
  const built = buildModel(graph, map, { name: 'shop' })
  const r = buildRequests(graph, map, built.model)
  const el = id => r.elements.find(e => e.id === id)
  const kids = id => r.elements.filter(e => e.parent === id).map(e => e.title)

  it('puts the callers, the backend and the stores its requests reach on the landscape, in that order', () => {
    expect(built.errors).toEqual([])
    expect(r.elements.filter(e => !e.parent).map(e => e.title)).toEqual(['Buyer', 'Shop', 'Orders DB'])
    expect(kids('web')).toEqual(['/api', '/cart', '/', '/orders'])
  })

  it('titles the endpoints of a group alike: below the group once one of them is too long for its card', () => {
    expect(kids('web.api')).toEqual(['GET …/orders', 'POST …/orders/{id}/pay', 'POST …/orders/{id}/refund-to-card'])
    expect(kids('web.cart')).toEqual(['POST /cart', 'GET /cart/items'])
  })

  it('lays an endpoint out as its request path: numbered steps, then the response', () => {
    const ep = r.elements.find(e => e.parent === 'web.cart' && e.title === 'GET /cart/items')
    expect(kids(ep.id)).toEqual(['1 · CartController.items', '2 · OrderRepository', '3 · list', '4 · Response'])
    expect(el(`${ep.id}.response`).description).toBe('Renders list.')
    // The handler's card marks its route line, so its code opens at the endpoint.
    expect(el(`${ep.id}.s1`).metadata.marks.split(' ')[0]).toBe('15:route')
    const rel = (a, b) => r.relations.find(x => x.source === a && x.target === b)
    expect(rel(`${ep.id}.s1`, `${ep.id}.s2`).title).toBe('OrderRepository')
    expect(rel(`${ep.id}.s3`, `${ep.id}.response`).title).toBe('HTML page')
    // Out to the store with the map's own evidence, and in from the caller.
    expect(rel(`${ep.id}.s2`, 'db').evidence.map(e => e.at)).toEqual(['src/main/java/shop/OrderRepository.java:3'])
    // The buyer's link names the app, not an endpoint: it reaches the app once, not every endpoint.
    expect(rel('buyer', 'web').title).toBe('shops')
    expect(r.relations.filter(x => x.source === 'buyer')).toHaveLength(1)
  })

  it('splits a crowded group by its next path segment, then by the object words its routes share', () => {
    const g = fixture('crowd')
    const m = { nodes: [{ id: 'web', kind: 'app', title: 'Shop', files: ['src/**'] }], links: [] }
    const c = buildRequests(g, m, buildModel(g, m, { name: 'shop' }).model)
    const under = id => c.elements.filter(e => e.parent === id).map(e => e.title)
    // Verbs (add, remove, redeem) never group; the things they act on do, nouns-first names included.
    expect(under('web.account')).toEqual([
      'GET /account', 'POST /account/close', 'GET /account/details',
      '/account/messages', '/account · address', '/account · card', '/account · loyalty points',
    ])
    expect(under('web.account.card')).toEqual(['POST /account/add-card', 'POST /account/remove-card'])
    expect(under('web.account.address')).toEqual(['POST /account/add-address', 'GET /account/address-book', 'POST /account/remove-address'])
    expect(under('web.account.loyalty-points')).toEqual(['GET …/loyalty-points-balance', 'POST …/redeem-loyalty-points'])
    expect(c.elements.find(e => e.id === 'web.account.card').description).toBe('2 endpoints, handled in AccountApi')
  })

  it('has no Requests view for code without endpoints', () => {
    const g = fixture('polyglot')
    expect(buildRequests({ ...g, files: g.files.map(f => ({ ...f, hints: f.hints.filter(h => h.kind !== 'route') })) }, { nodes: [], links: [] }, { name: 'x', title: 'X', elements: [], relations: [] })).toBe(null)
  })
})
