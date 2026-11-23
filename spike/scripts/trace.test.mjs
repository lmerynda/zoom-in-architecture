import { describe, expect, it } from 'vitest'
import { normalRoute, observe } from './trace.mjs'

let n = 0
const span = (kind, name, attrs = {}, parent = '') => ({ trace: 't', id: `s${++n}`, parent, name, kind, start: n, end: n + 1, attrs, status: 0, resource: {} })

describe('normalRoute', () => {
  it('writes every framework’s parameters as {name}, without a trailing slash', () => {
    expect(normalRoute('/market/:id/buy/')).toBe('/market/{id}/buy')
    expect(normalRoute('/users/<int:uid>')).toBe('/users/{p}')
    expect(normalRoute('/')).toBe('/')
    expect(normalRoute('/kingdom/{name}')).toBe('/kingdom/{name}')
  })
})

describe('observe', () => {
  it('sums requests per endpoint: statuses, tables read and written, code it went through', () => {
    const a = span('server', 'POST /market/{id}/buy', { 'http.request.method': 'POST', 'http.route': '/market/:id/buy', 'http.response.status_code': 200 })
    const h = span('internal', 'MarketController.buy', { 'code.namespace': 'shop.MarketController', 'code.function': 'buy' }, a.id)
    const r = span('internal', 'OfferRepository.findById', { 'code.namespace': 'shop.OfferRepository', 'code.function': 'findById' }, h.id)
    const q = span('client', 'SELECT shop.offers', { 'db.system': 'h2', 'db.sql.table': 'offers', 'db.operation': 'SELECT' }, r.id)
    const w = span('client', 'UPDATE shop.offers', { 'db.system': 'h2', 'db.sql.table': 'offers', 'db.operation': 'UPDATE' }, h.id)
    const b = span('server', 'POST /market/{id}/buy', { 'http.request.method': 'POST', 'http.route': '/market/{id}/buy', 'http.response.status_code': 401 })
    const out = span('client', 'GET', { 'http.request.method': 'GET', 'server.address': 'payments.example', 'url.full': 'https://payments.example/x' }, b.id)
    const boot = span('client', 'DROP table shop.offers', { 'db.system': 'h2', 'db.sql.table': 'offers', 'db.operation': 'DROP table' })
    const tick = span('internal', 'BotClock.tick', { 'code.namespace': 'shop.BotClock', 'code.function': 'tick' })
    const o = observe([a, h, r, q, w, b, out, boot, tick])
    expect(o.endpoints).toEqual([{
      method: 'POST', route: '/market/{id}/buy', count: 2,
      statuses: { 200: 1, 401: 1 },
      tables: { offers: ['SELECT', 'UPDATE'] },
      code: { 'shop.MarketController.buy': 1, 'shop.OfferRepository.findById': 1 },
      calls: { 'GET payments.example': 1 },
    }])
    // Work outside any request is kept apart: startup and schedules.
    expect(o.background).toEqual({ 'DROP table shop.offers': 1, 'shop.BotClock.tick': 1 })
    expect(o.spans).toBe(9)
  })

  it('observes nothing in no spans, and skips server spans with no route (static files, 404s)', () => {
    expect(observe([]).endpoints).toEqual([])
    expect(observe([span('server', 'GET', { 'http.request.method': 'GET' })]).endpoints).toEqual([])
  })
})
