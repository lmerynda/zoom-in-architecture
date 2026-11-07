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
      'POST /cart add: CartController.java',
      // The handler reaches the repository through the field it calls, and names its view by a constant.
      'GET /cart/items items: CartController.java > OrderRepository.java | list.html',
      'GET /orders list: OrderController.java | list.html',
    ])
    expect(eps.find(e => e.method === 'POST').response).toEqual({ redirect: '/cart/items' })
  })

  it('reads FastAPI endpoints under the prefixes of the routers that mount them', () => {
    const eps = endpoints(fixture('api'))
    expect(brief(eps)).toEqual([
      // Below the files the handler names, the path follows only what leads to the store, and stops there.
      'GET /api/v1/items/{id} read_item: items.py > models.py > crud.py > db.py',
      'GET /api/v1/items/health health: items.py',
    ])
    expect(eps[0].response).toEqual({ model: 'Item' })
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
    expect(kids('web')).toEqual(['/cart', '/', '/orders'])
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
    expect(rel('buyer', ep.id).title).toBe('shops')
  })

  it('has no Requests view for code without endpoints', () => {
    const g = fixture('polyglot')
    expect(buildRequests({ ...g, files: g.files.map(f => ({ ...f, hints: f.hints.filter(h => h.kind !== 'route') })) }, { nodes: [], links: [] }, { name: 'x', title: 'X', elements: [], relations: [] })).toBe(null)
  })
})
