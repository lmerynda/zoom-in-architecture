import { describe, expect, it } from 'vitest'
import { callsInto, classFiles, markObserved, tableVerbs } from './observed.mjs'

const file = (id, path, parent = 'app') => ({ id, parent, title: id, kind: 'code', metadata: { path } })

describe('classFiles', () => {
  it('finds a class’s file by its package path, and never a longer name', () => {
    const paths = ['src/main/java/shop/MarketController.java', 'src/main/java/shop/MarketControllerTest.java', 'web/shop/Offer.kt']
    expect(classFiles(paths, ['shop.MarketController', 'shop.Offer', 'other.Missing'])).toEqual(new Map([
      ['shop.MarketController', 'src/main/java/shop/MarketController.java'],
      ['shop.Offer', 'web/shop/Offer.kt'],
    ]))
  })

  it('places inner, anonymous, lambda and proxy classes ($) in their top-level class’s file', () => {
    const paths = ['src/shop/Offer.java']
    expect(classFiles(paths, ['shop.Offer$Builder', 'shop.Offer$1', 'shop.Offer$Builder$2', 'shop.Offer$$Lambda/0x01', 'shop.Offer$$SpringCGLIB$$0'])).toEqual(new Map([
      ['shop.Offer$Builder', 'src/shop/Offer.java'], ['shop.Offer$1', 'src/shop/Offer.java'], ['shop.Offer$Builder$2', 'src/shop/Offer.java'],
      ['shop.Offer$$Lambda/0x01', 'src/shop/Offer.java'], ['shop.Offer$$SpringCGLIB$$0', 'src/shop/Offer.java'],
    ]))
  })

  it('places a nested class written with a dot in its outer class’s file, the longest name that is a file winning, and never drops a package to find one', () => {
    const paths = ['src/shop/Offer.java', 'src/shop/Offer/Price.java', 'src/shop.ts']
    expect(classFiles(paths, ['shop.Offer.Builder', 'shop.Offer.Builder.Step', 'shop.Offer.Price', 'shop.Missing', 'shop.Missing.Inner'])).toEqual(new Map([
      ['shop.Offer.Builder', 'src/shop/Offer.java'], ['shop.Offer.Builder.Step', 'src/shop/Offer.java'],
      // A file of that exact name is the class's own, not its outer one's.
      ['shop.Offer.Price', 'src/shop/Offer/Price.java'],
    ]))
  })

  it('tells classes of one name in two packages apart, and places none that two files fit equally', () => {
    const paths = ['a/src/shop/Offer.java', 'a/src/market/Offer.java', 'b/src/shop/Cart.java', 'c/src/shop/Cart.java', 'd/Main.java', 'e/Main.java']
    expect(classFiles(paths, ['shop.Offer', 'market.Offer$1', 'shop.Cart', 'Main', 'Offer'])).toEqual(new Map([
      ['shop.Offer', 'a/src/shop/Offer.java'], ['market.Offer$1', 'a/src/market/Offer.java'],
    ]))
  })

  it('places nothing from nothing, and reads names in any script', () => {
    expect(classFiles([], ['shop.MarketController'])).toEqual(new Map())
    expect(classFiles(['src/shop/Offer.java'], [])).toEqual(new Map())
    expect(classFiles(['src/shop/Offer.java'], [''])).toEqual(new Map())
    expect(classFiles(['src/läden/Größe.java', 'src/läden/Ölmühle.kt'], ['läden.Größe$Maß', 'läden.Ölmühle.Rad', 'läden.Größe'])).toEqual(new Map([
      ['läden.Größe$Maß', 'src/läden/Größe.java'], ['läden.Ölmühle.Rad', 'src/läden/Ölmühle.kt'], ['läden.Größe', 'src/läden/Größe.java'],
    ]))
  })
})

describe('callsInto', () => {
  const fileOf = classFiles(['src/shop/MarketController.java', 'src/shop/Offer.java', 'src/shop/OfferRepository.java'], ['shop.MarketController', 'shop.Offer', 'shop.Offer$Builder', 'shop.OfferHelper', 'shop.OfferRepository', 'lib.Proxy'])
  // Two classes in one file: OfferHelper beside Offer in Offer.java.
  fileOf.set('shop.OfferHelper', 'src/shop/Offer.java')

  it('counts a call into a file once: a span under one of that file’s own is the same call or a call inside it', () => {
    // Three requests: the agent's controller span over the method's own span (both MarketController), which calls the repository twice.
    const codeCalls = { 'shop.MarketController': { '': 3, 'shop.MarketController': 3 }, 'shop.OfferRepository': { 'shop.MarketController': 6 } }
    expect(callsInto(codeCalls, fileOf)).toEqual(new Map([['src/shop/MarketController.java', 3], ['src/shop/OfferRepository.java', 6]]))
  })

  it('adds up a file’s classes called from outside it, and never counts its classes calling each other', () => {
    const codeCalls = {
      'shop.Offer': { 'shop.MarketController': 4, 'shop.Offer$Builder': 9 },
      'shop.Offer$Builder': { 'shop.MarketController': 2, 'shop.Offer': 5 },
      'shop.OfferHelper': { 'shop.Offer': 7, 'lib.Proxy': 1, 'lib.Unplaced': 1 },
    }
    expect(callsInto(codeCalls, fileOf)).toEqual(new Map([['src/shop/Offer.java', 8]]))
  })

  it('counts nothing for no calls, and nothing for classes no file is', () => {
    expect(callsInto({}, fileOf)).toEqual(new Map())
    expect(callsInto({ 'lib.Proxy': { '': 5 }, 'other.Thing': { 'shop.Offer': 1 } }, fileOf)).toEqual(new Map())
  })
})

describe('markObserved', () => {
  // As trace.mjs sums them: each class's spans by the class whose span they ran under ('' none: the request itself).
  // The controller's spans are two per request that reached it (the agent's controller span and the method's own).
  const observed = {
    endpoints: [
      { method: 'POST', route: '/market/{id}/buy', count: 3, statuses: { 200: 2, 401: 1 }, tables: { offers: ['SELECT', 'UPDATE'] }, codeCalls: { 'shop.MarketController': { '': 3, 'shop.MarketController': 3 }, 'shop.OfferRepository': { 'shop.MarketController': 2 } }, calls: {} },
      { method: 'POST', route: '/market/create', count: 1, statuses: { 200: 1 }, tables: { offers: ['INSERT'] }, codeCalls: {}, calls: {} },
    ],
    background: {},
  }
  const build = () => ({
    model: {
      elements: [{ id: 'app', parent: null, title: 'App', kind: 'app' }, { id: 'db', parent: null, title: 'DB', kind: 'database' }, file('app.ctl', 'src/shop/MarketController.java'), file('app.repo', 'src/shop/OfferRepository.java'), file('app.svc', 'src/shop/MarketService.java')],
      relations: [{ source: 'app.repo', target: 'db', title: 'offers (JPA)', kind: 'runtime' }, { source: 'app.svc', target: 'app.repo', title: 'save', kind: 'code' }],
    },
    requests: {
      elements: [
        { id: 'app', parent: null, title: 'App', kind: 'app', metadata: {} }, { id: 'db', parent: null, title: 'DB', kind: 'database', metadata: {} },
        { id: 'app.e1', parent: 'app', title: 'POST /market/{id}/buy', kind: 'component', metadata: { method: 'POST', route: '/market/{id}/buy' } },
        { id: 'app.e1.s1', parent: 'app.e1', title: '1 · buy()', metadata: { role: 'step', step: '1', path: 'src/shop/MarketController.java' } },
        { id: 'app.e1.s2', parent: 'app.e1', title: '2 · MarketService', metadata: { role: 'step', step: '2', path: 'src/shop/MarketService.java' } },
        { id: 'app.e1.s3', parent: 'app.e1', title: '3 · OfferRepository', metadata: { role: 'step', step: '3', path: 'src/shop/OfferRepository.java' } },
        { id: 'app.e2', parent: 'app', title: 'POST /market/create', kind: 'component', metadata: { method: 'POST', route: '/market/create' } },
        { id: 'app.e2.s1', parent: 'app.e2', title: '1 · create()', metadata: { role: 'step', step: '1', path: 'src/shop/MarketController.java' } },
        { id: 'app.e3', parent: 'app', title: 'GET /market/:id', kind: 'component', metadata: { method: 'GET', route: '/market/:id' } },
      ],
      relations: [{ source: 'app.e1.s3', target: 'db', title: 'offers (JPA)' }],
    },
  })

  it('marks endpoints seen or not, with statuses and tables, and gives coverage per app', () => {
    const { model, requests } = build()
    expect(markObserved(model, requests, observed)).toEqual({ seen: 2, total: 3 })
    const at = id => requests.elements.find(e => e.id === id).metadata
    expect(at('app.e1')).toMatchObject({ seen: '3', statuses: '200 ×2 · 401 ×1', tables: 'offers: SELECT, UPDATE' })
    // An endpoint no test called says so; its route written :id still matches the observed {id} form.
    expect(at('app.e3').seen).toBe('0')
    expect(at('app').seen).toBe('2/3')
  })

  it('marks the steps whose classes ran with their own counts, and leaves the others unclaimed rather than unseen', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed)
    const at = id => requests.elements.find(e => e.id === id).metadata.seen
    // The repository ran twice in three requests (one stopped at 401): its count is its own.
    expect([at('app.e1.s1'), at('app.e1.s2'), at('app.e1.s3')]).toEqual(['3', undefined, '2'])
  })

  it('marks a store link seen by its endpoint’s requests, with the tables they touched, and adds one a request needed but the code reading missed', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed)
    // The count is the endpoint's requests, said so, never calls across the link itself.
    expect(requests.relations[0]).toMatchObject({ seen: 3, seenOf: 'requests', tables: 'updates and reads offers' })
    // The added link says the map has none: the trace added it.
    expect(requests.relations[1]).toEqual({ source: 'app.e2.s1', target: 'db', title: 'inserts offers', kind: 'runtime', seen: 1, seenOf: 'requests', tables: 'inserts offers', origin: 'trace' })
  })

  it('gives no store tables it cannot place: with two databases, a mapped link keeps its count but no tables, and none is added', () => {
    const { model, requests } = build()
    requests.elements.push({ id: 'cache', parent: null, title: 'Cache', kind: 'database', metadata: {} })
    markObserved(model, requests, observed)
    expect(requests.relations).toHaveLength(1)
    expect(requests.relations[0]).toMatchObject({ seen: 3, seenOf: 'requests' })
    expect(requests.relations[0].tables).toBeUndefined()
    // The endpoint still says what its requests did to which tables.
    expect(requests.elements.find(e => e.id === 'app.e2').metadata.tables).toBe('offers: INSERT')
  })

  it('says what each table had done to it, writes first, never one verb for all', () => {
    expect(tableVerbs({ user_entity: ['SELECT'], market_offer_entity: ['SELECT', 'DELETE'], kingdom_entity: ['UPDATE', 'SELECT'] }))
      .toBe('updates and reads kingdom_entity · deletes and reads market_offer_entity · reads user_entity')
    expect(tableVerbs({ ü_tabelle: ['MERGE'] })).toBe('writes ü_tabelle')
    expect(tableVerbs({})).toBe('')
  })

  it('marks the architecture: files that ran, their runtime links, and the tables of the one store reached', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed)
    const at = id => model.elements.find(e => e.id === id).metadata
    expect([at('app.ctl').seen, at('app.repo').seen, at('app.svc').seen]).toEqual(['3', '2', undefined])
    expect(model.relations.map(r => r.seen)).toEqual([2, undefined])
    // In the architecture a runtime link's count is the calls into its source file's code.
    expect(model.relations.map(r => r.seenOf)).toEqual(['code', undefined])
    expect(at('db').tables).toBe('offers: INSERT, SELECT, UPDATE')
  })

  it('counts calls into a file, in the architecture and in a request: its classes called from outside it added up, never once per span or per class inside it', () => {
    const { model, requests } = build()
    model.elements.push(file('app.offer', 'src/shop/Offer.java'))
    requests.elements.push({ id: 'app.e1.s4', parent: 'app.e1', title: '4 · Offer', metadata: { role: 'step', step: '4', path: 'src/shop/Offer.java' } })
    const buy = { ...observed.endpoints[0], codeCalls: { ...observed.endpoints[0].codeCalls, 'shop.Offer': { 'shop.MarketController': 2 }, 'shop.Offer$Builder': { 'shop.MarketController': 1, 'shop.Offer': 4 }, 'shop.Offer.Price': { 'shop.Offer$Builder': 6 } } }
    const list = { method: 'GET', route: '/market/:id', count: 1, statuses: { 200: 1 }, tables: {}, codeCalls: { 'shop.Offer$1': { '': 1 } }, calls: {} }
    markObserved(model, requests, { endpoints: [buy, observed.endpoints[1], list], background: {} })
    expect(model.elements.find(e => e.id === 'app.offer').metadata.seen).toBe('4')
    expect(model.elements.find(e => e.id === 'app.ctl').metadata.seen).toBe('3')
    // In the request, only that endpoint's calls.
    expect(requests.elements.find(e => e.id === 'app.e1.s4').metadata.seen).toBe('3')
  })

  it('works with no Requests view and no observations', () => {
    const { model } = build()
    expect(markObserved(model, null, { endpoints: [], background: {} })).toEqual({ seen: 0, total: 0 })
    expect(model.elements.every(e => e.metadata?.seen === undefined)).toBe(true)
  })
})
