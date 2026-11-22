import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph.mjs'
import { buildModel } from './map.mjs'
import { buildRequests } from './requests.mjs'
import { endpoints } from './routes.mjs'

const fixture = name => buildGraph(join(import.meta.dirname, `../test/fixtures/${name}`))
// Steps in order (>), then the types the handler only names (+), then the views (|).
const viewsOf = e => e.responses.filter(r => r.kind === 'view').map(r => r.view)
const brief = eps => eps.map(e => `${e.method} ${e.path} ${e.name}: ${e.steps.map(s => s.split('/').pop()).join(' > ')}${e.types.length ? ` + ${e.types.map(s => s.split('/').pop()).join(', ')}` : ''}${viewsOf(e).length ? ` | ${viewsOf(e).map(v => v.split('/').pop()).join(', ')}` : ''}`)

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
    expect(eps.find(e => e.path === '/cart').responses).toEqual([{ kind: 'redirect', redirect: '/cart/items' }])
    // A REST handler's answer is the type inside ResponseEntity and Optional; a wildcard says nothing.
    expect(eps.filter(e => e.path.startsWith('/api')).map(e => e.responses)).toEqual([[{ kind: 'body', model: 'List<Order>', json: true }], [{ kind: 'body' }], [{ kind: 'body' }]])
  })

  it('follows a service only through the method the handler calls on it', () => {
    const add = endpoints(fixture('crowd')).find(e => e.path === '/account/add-card')
    // AccountService also writes the audit log, but not in addCard: that store is not on this path.
    expect(brief([add])).toEqual(['POST /account/add-card addCard: AccountApi.java > AccountService.java > CardRepository.java'])
  })

  it('lists the steps in the order the code calls them, not the order the fields are declared', () => {
    const close = endpoints(fixture('crowd')).find(e => e.path === '/account/close')
    // close() writes the audit log, then purges the cards; the service declares cards first.
    expect(brief([close])).toEqual(['POST /account/close close: AccountApi.java > AccountService.java > AuditRepository.java > CardRepository.java'])
  })

  it('reads uses from code alone: a word in a string or a comment is not a field the handler calls', () => {
    const eps = endpoints(fixture('clinic'))
    const of = path => brief([eps.find(e => e.path === path)])[0]
    // "owners/findOwners" and a comment saying owners.findAll() both name the owners field; neither runs it.
    expect(of('/owners/find')).toBe('GET /owners/find initFindForm: OwnerController.java | findOwners.html')
    // The view name still comes from the string, through the constant that holds it.
    expect(of('/owners/{ownerId}/edit')).toBe('GET /owners/{ownerId}/edit initUpdateOwnerForm: OwnerController.java | createOrUpdateOwnerForm.html')
  })

  it('stops at a file whose called method it cannot find, unless the file declares no code of its own', () => {
    const eps = endpoints(fixture('clinic'))
    const of = path => brief([eps.find(e => e.path === path)])[0]
    // forget() is inherited: ClinicService's own methods, and the stores only they reach, do not run.
    expect(of('/owners/{ownerId}/forget')).toBe('POST /owners/{ownerId}/forget forget: OwnerController.java > ClinicService.java')
    // PetRepository declares nothing (its queries are generated), so it is followed whole.
    expect(of('/owners/{ownerId}/pets')).toBe('GET /owners/{ownerId}/pets pets: OwnerController.java > PetRepository.java > PetQueries.java | ownersList.html')
  })

  it('keeps the types a handler only names out of its steps; a file whose methods do work is a step', () => {
    const create = endpoints(fixture('clinic')).find(e => e.path === '/owners/new')
    // The form and the owner only have their accessors read; Mailer reaches no store, but welcome() does work.
    expect(brief([create])).toEqual(['POST /owners/new processCreationForm: OwnerController.java > ClinicService.java > OwnerRepository.java > Mailer.java + OwnerForm.java, Owner.java'])
  })

  it('orders the handler\'s calls by where its body first uses each field, not by where the fields are declared', () => {
    const greet = endpoints(fixture('clinic')).find(e => e.path === '/owners/greet')
    // The controller declares clinic before mailer; greet() calls mailer first.
    expect(brief([greet])).toEqual(['POST /owners/greet greet: OwnerController.java > Mailer.java > ClinicService.java > OwnerRepository.java + Owner.java'])
  })

  it('reads each way a handler answers, in source order: the views it renders, its redirects, its body', () => {
    const eps = endpoints(fixture('clinic'))
    const find = eps.find(e => e.path === '/owners' && e.method === 'GET')
    // A page out of range, none found, one found (by its id), or the list a helper renders.
    expect(find.responses).toEqual([
      { kind: 'redirect', redirect: '/owners' },
      { kind: 'view', view: 'src/main/resources/templates/owners/findOwners.html', name: 'owners/findOwners' },
      { kind: 'redirect', redirect: '/owners/{id}' },
      { kind: 'view', view: 'src/main/resources/templates/owners/ownersList.html', name: 'owners/ownersList' },
    ])
    expect(eps.find(e => e.path === '/owners/find').responses).toEqual([{ kind: 'view', view: 'src/main/resources/templates/owners/findOwners.html', name: 'owners/findOwners' }])
  })

  it('gives each step the lines it is about: the handler past its route, then the method each caller calls', () => {
    const greet = endpoints(fixture('clinic')).find(e => e.path === '/owners/greet')
    // @PostMapping on 62, greet() on 63 to 67; Mailer.welcome and ClinicService.register; Owner is a type, declared whole.
    expect(greet.line).toBe(62)
    expect(Object.entries(greet.spans).map(([p, s]) => `${p.split('/').pop()} ${s}`)).toEqual(['OwnerController.java 63-67', 'Mailer.java 7-10', 'ClinicService.java 16-19', 'OwnerRepository.java 3-7', 'Owner.java 3-26'])
    // A call to a method the file does not declare (forget is inherited) opens the file at its first declaration.
    expect(endpoints(fixture('clinic')).find(e => e.path.endsWith('/forget')).spans['src/main/java/clinic/ClinicService.java']).toBe('5-24')
    // A Go route names a handler in another file of its package: the route's line is in routers.go.
    const note = endpoints(fixture('gin')).find(e => e.path.endsWith('/note'))
    expect([note.routeFile, note.line, note.file, note.spans[note.file], note.spans['orders/notes.go']]).toEqual(['orders/routers.go', 9, 'orders/pay.go', '9-11', '4-7'])
  })

  it('reads FastAPI endpoints under the prefixes of the routers that mount them', () => {
    const eps = endpoints(fixture('api'))
    expect(brief(eps)).toEqual([
      // The calls in order down to the store, where the path stops; apart from them (+), the types the handler only names.
      'GET /api/v1/items/{id} read_item: items.py > crud.py > db.py + models.py',
      'GET /api/v1/items/health health: items.py',
    ])
    expect(eps[0].responses).toEqual([{ kind: 'body', model: 'Item', json: true }])
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
    expect(eps.map(e => e.responses)).toEqual([[{ kind: 'body', json: true }], [{ kind: 'body', json: true }]])
  })

  it('reads Gin routes under the group their register function is called with, handlers anywhere in the package', () => {
    const eps = endpoints(fixture('gin'))
    // router.GET("") and router.GET("/") are one endpoint; Pay lives in another file of the package.
    // SaveNote(id string, meta interface{}) has a body past its signature's braces, and it reaches the store.
    expect(brief(eps)).toEqual(['GET /api/orders List: routers.go > models.go', 'POST /api/orders/:id/note Note: pay.go > notes.go > models.go', 'POST /api/orders/:id/pay Pay: pay.go > models.go'])
    expect(eps.every(e => e.responses.length === 1 && e.responses[0].json)).toBe(true)
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
    expect(kids(ep.id)).toEqual(['1 · items()', '2 · OrderRepository', '3 · list', '4 · Response'])
    expect(el(`${ep.id}.s1`).technology).toBe('CartController')
    // The view is named as the handler names it.
    expect(el(`${ep.id}.response`).description).toBe('Renders orders/list.')
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

describe('buildRequests of a request path', () => {
  const graph = fixture('clinic')
  const map = {
    nodes: [{ id: 'web', kind: 'webapp', title: 'Clinic', files: ['src/**'] }, { id: 'db', kind: 'database', title: 'Clinic DB' }],
    links: [{ from: 'src/main/java/clinic/OwnerRepository.java', to: 'db', title: 'JPA', evidence: ['src/main/java/clinic/OwnerRepository.java:3'] }],
  }
  const built = buildModel(graph, map, { name: 'clinic' })
  const r = buildRequests(graph, map, built.model)
  const ep = (method, path) => r.elements.find(e => e.parent && e.title === `${method} ${path}`)
  const kids = id => r.elements.filter(e => e.parent === id)
  const rel = (a, b) => r.relations.find(x => x.source === a && x.target === b)

  it('numbers the steps and sets the types the handler only names beside them, off the handler', () => {
    expect(built.errors).toEqual([])
    const create = ep('POST', '/owners/new')
    expect(kids(create.id).map(e => e.title)).toEqual(['1 · processCreationForm()', '2 · ClinicService', '3 · OwnerRepository', '4 · Mailer', 'OwnerForm', 'Owner', '5 · Response'])
    expect(kids(create.id).map(e => e.metadata.role)).toEqual(['step', 'step', 'step', 'step', 'type', 'type', 'response'])
    expect(rel(`${create.id}.s1`, `${create.id}.t1`).title).toBe('OwnerForm')
  })

  it('ends a handler with one answer at its view, then the response, with no store it never calls', () => {
    const find = ep('GET', '/owners/find')
    expect(kids(find.id).map(e => e.title)).toEqual(['1 · initFindForm()', '2 · findOwners', '3 · Response'])
    expect(rel(`${find.id}.s2`, `${find.id}.response`).title).toBe('HTML page')
    expect(r.relations.filter(x => x.source.startsWith(`${find.id}.`) && x.target === 'db')).toEqual([])
  })

  it('branches where the handler branches: one Response card per answer, off the step that gives it', () => {
    const list = ep('GET', '/owners')
    expect(kids(list.id).map(e => e.title)).toEqual([
      '1 · processFindForm()', '2 · OwnerRepository', 'Owner', 'findOwners', 'ownersList',
      'Response · redirect /owners', 'Response · renders owners/findOwners', 'Response · redirect /owners/{id}', 'Response · renders owners/ownersList',
    ])
    expect(kids(list.id).filter(e => e.metadata.role === 'response').map(e => [e.id.slice(list.id.length), e.metadata.answer, e.metadata.redirect ?? e.metadata.view])).toEqual([
      ['.response-1', 'redirect', '/owners'], ['.response-2', 'view', 'owners/findOwners'], ['.response-3', 'redirect', '/owners/{id}'], ['.response-4', 'view', 'owners/ownersList'],
    ])
    // Redirects come from the handler; a page from the view the handler renders.
    expect(rel(`${list.id}.s1`, `${list.id}.response-3`).title).toBe('redirect')
    expect(rel(`${list.id}.s1`, `${list.id}.v2`)).toBeTruthy()
    expect(rel(`${list.id}.v2`, `${list.id}.response-4`).title).toBe('HTML page')
  })

  it('names on every card the lines it is about, and marks the route on the handler', () => {
    const greet = ep('POST', '/owners/greet'), el = id => r.elements.find(e => e.id === id)
    expect(kids(greet.id).filter(e => e.metadata.role !== 'response').map(e => `${e.title} ${e.metadata.span}`)).toEqual(['1 · greet() 63-67', '2 · Mailer 7-10', '3 · ClinicService 16-19', '4 · OwnerRepository 3-7', 'Owner 3-26'])
    expect(el(`${greet.id}.s1`).metadata.marks.split(' ')[0]).toBe('62:route')
    const list = ep('GET', '/owners')
    expect(el(`${list.id}.v1`).metadata.span).toBe('1-4')
  })
})
