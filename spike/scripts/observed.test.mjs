import { describe, expect, it } from 'vitest'
import { classFiles, markObserved } from './observed.mjs'

const file = (id, path, parent = 'app') => ({ id, parent, title: id, kind: 'code', metadata: { path } })

describe('classFiles', () => {
  it('finds a class’s file by its package path, inner classes too, and never a longer name', () => {
    const paths = ['src/main/java/shop/MarketController.java', 'src/main/java/shop/MarketControllerTest.java', 'web/shop/Offer.kt']
    expect(classFiles(paths, ['shop.MarketController', 'shop.Offer$Builder', 'other.Missing'])).toEqual(new Map([
      ['shop.MarketController', 'src/main/java/shop/MarketController.java'],
      ['shop.Offer$Builder', 'web/shop/Offer.kt'],
    ]))
    expect(classFiles([], ['shop.MarketController'])).toEqual(new Map())
  })
})

describe('markObserved', () => {
  const observed = {
    endpoints: [
      { method: 'POST', route: '/market/{id}/buy', count: 3, statuses: { 200: 2, 401: 1 }, tables: { offers: ['SELECT', 'UPDATE'] }, code: { 'shop.MarketController.buy': 3, 'shop.OfferRepository.save': 2 }, calls: {} },
      { method: 'POST', route: '/market/create', count: 1, statuses: { 200: 1 }, tables: { offers: ['INSERT'] }, code: {}, calls: {} },
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

  it('marks the steps whose classes ran, and leaves the others unclaimed rather than unseen', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed)
    const at = id => requests.elements.find(e => e.id === id).metadata.seen
    expect([at('app.e1.s1'), at('app.e1.s2'), at('app.e1.s3')]).toEqual(['3', undefined, '3'])
  })

  it('marks a store link seen, and adds one a request needed but the code reading missed', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed)
    expect(requests.relations[0].seen).toBe(3)
    expect(requests.relations[1]).toEqual({ source: 'app.e2.s1', target: 'db', title: 'writes offers', kind: 'runtime', seen: 1 })
  })

  it('marks the architecture: files that ran, their runtime links, and the tables of the one store reached', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed)
    const at = id => model.elements.find(e => e.id === id).metadata
    expect([at('app.ctl').seen, at('app.repo').seen, at('app.svc').seen]).toEqual(['3', '2', undefined])
    expect(model.relations.map(r => r.seen)).toEqual([2, undefined])
    expect(at('db').tables).toBe('offers: INSERT, SELECT, UPDATE')
  })

  it('works with no Requests view and no observations', () => {
    const { model } = build()
    expect(markObserved(model, null, { endpoints: [], background: {} })).toEqual({ seen: 0, total: 0 })
    expect(model.elements.every(e => e.metadata?.seen === undefined)).toBe(true)
  })
})
