import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changeCount, changesBetween, endpointsOf, pairsOf, sameShape } from './changes.mjs'
import { storeBundle } from './store.mjs'

const el = (id, parent, extra = {}) => ({ id, parent, title: extra.title ?? id.split('.').pop(), kind: 'component', ...extra })
const file = (id, parent, path) => el(id, parent, { metadata: { path } })
const rel = (source, target, kind = 'code') => ({ source, target, title: '', kind })

/** A web app calling an API that stores in a database; components hold files. */
const v1 = () => ({
  model: {
    name: 'shop',
    elements: [
      el('web', null), el('web.pages', 'web'), file('web.pages.home', 'web.pages', 'web/home.ts'),
      el('api', null), el('api.orders', 'api'), file('api.orders.ctl', 'api.orders', 'api/OrderController.java'), file('api.orders.repo', 'api.orders', 'api/OrderRepo.java'),
      el('api.users', 'api'), file('api.users.ctl', 'api.users', 'api/UserController.java'),
      el('db', null, { kind: 'database' }),
    ],
    relations: [rel('web.pages.home', 'api.orders.ctl', 'runtime'), rel('api.orders.ctl', 'api.orders.repo'), rel('api.orders.repo', 'db', 'runtime'), rel('api.users.ctl', 'api.orders.repo', 'types')],
  },
  requests: {
    name: 'shop · requests',
    elements: [
      el('api', null), el('api.orders', 'api'),
      el('api.orders.e1', 'api.orders', { title: 'GET /orders', metadata: { method: 'GET', route: '/orders' } }),
      el('api.orders.e1.s1', 'api.orders.e1', { metadata: { role: 'step', step: '1', path: 'api/OrderController.java' } }),
      el('api.orders.e2', 'api.orders', { title: 'DELETE /orders/{id}', metadata: { method: 'DELETE', route: '/orders/:id' } }),
      el('db', null, { kind: 'database' }),
    ],
    relations: [rel('api.orders.e1.s1', 'db', 'runtime')],
  },
})

describe('changes between two uploads', () => {
  it('lists endpoints by the process that serves them, method and route, with the file that serves each', () => {
    expect([...endpointsOf(v1().requests)]).toEqual([
      ['api GET /orders', { id: 'api.orders.e1', title: 'GET /orders', path: 'api/OrderController.java', parents: ['api.orders', 'api'] }],
      // Express-style ":id" reads as the map's "{id}".
      ['api DELETE /orders/{id}', { id: 'api.orders.e2', title: 'DELETE /orders/{id}', path: null, parents: ['api.orders', 'api'] }],
    ])
    expect(endpointsOf(null).size).toBe(0)
  })

  it('tells one route served by two processes apart', () => {
    const a = v1(), b = v1()
    b.requests.elements.push(el('admin', null), el('admin.e1', 'admin', { title: 'GET /orders', metadata: { method: 'GET', route: '/orders' } }))
    expect(changesBetween(a, b, 'requests').endpoints.added).toEqual([{ title: 'GET /orders', at: 'admin.e1' }])
  })

  it('ends a walk up a stored model whose parents loop', () => {
    const m = { elements: [el('a', 'b'), el('b', 'a'), el('c', null)], relations: [rel('a', 'c')] }
    expect([...pairsOf(m).crossings.keys()]).toEqual(['b>c'])
  })

  it('rolls arrows up to crossings between processes and dependencies between components, leaving type-only imports out', () => {
    const p = pairsOf(v1().model)
    expect([...p.crossings.keys()]).toEqual(['web>api', 'api>db'])
    expect(p.crossings.get('web>api').title).toBe('web → api')
    // web.pages → api.orders crosses processes and is a component dependency too; api.orders → db
    // ends on a top-level part, so it is only a crossing. users → orders is a type-only import.
    expect([...p.dependencies.keys()]).toEqual(['web.pages>api.orders', 'api.orders>db'])
  })

  it('finds nothing between an upload and itself, or one that only edits inside files', () => {
    const a = v1(), b = v1()
    b.model.elements[2].metadata.lines = '99'
    b.requests.elements[2].metadata.seen = '4'
    expect(changeCount(changesBetween(a, b, 'architecture'))).toBe(0)
    expect(changeCount(changesBetween(a, b, 'requests'))).toBe(0)
    expect(sameShape(a, b)).toBe(true)
    expect(changeCount(null)).toBe(0)
  })

  it('names new and removed endpoints, crossings and dependencies, each by the card it marks in that view', () => {
    const a = v1(), b = v1()
    // A new endpoint served by the users controller, one endpoint gone, users now reach the store.
    b.requests.elements.push(
      el('api.users', 'api'),
      el('api.users.e1', 'api.users', { title: 'GET /users', metadata: { method: 'GET', route: '/users' } }),
      el('api.users.e1.s1', 'api.users.e1', { metadata: { role: 'step', step: '1', path: 'api/UserController.java' } }),
    )
    b.requests.elements = b.requests.elements.filter(e => !e.id.startsWith('api.orders.e2'))
    b.model.relations.push(rel('api.users.ctl', 'api.orders.repo'), rel('api.users.ctl', 'db', 'runtime'))
    // The web app no longer calls the API.
    b.model.relations = b.model.relations.filter(r => r.source !== 'web.pages.home')
    const arch = changesBetween(a, b, 'architecture')
    // A removed endpoint is marked where it was: no handler file known here, so nowhere in the architecture.
    expect(arch.endpoints).toEqual({ added: [{ title: 'GET /users', at: 'api.users.ctl' }], removed: [{ title: 'DELETE /orders/{id}', at: null }] })
    expect(arch.crossings).toEqual({ added: [], removed: [{ from: 'web', to: 'api', title: 'web → api' }] })
    expect(arch.dependencies).toEqual({
      added: [{ from: 'api.users', to: 'api.orders', title: 'users → orders' }, { from: 'api.users', to: 'db', title: 'users → db' }],
      removed: [{ from: 'web.pages', to: 'api.orders', title: 'pages → orders' }],
    })
    // The requests view marks the endpoint itself; its components are endpoints, so no dependencies.
    const req = changesBetween(a, b, 'requests')
    expect(req.endpoints.added).toEqual([{ title: 'GET /users', at: 'api.users.e1' }])
    // In the requests view, at its resource, which is still there.
    expect(req.endpoints.removed).toEqual([{ title: 'DELETE /orders/{id}', at: 'api.orders' }])
    expect(req.dependencies).toEqual({ added: [], removed: [] })
    expect(changeCount(arch)).toBe(6)
    expect(sameShape(a, b)).toBe(false)
  })

  it('compares a map with no requests view, and one that gains it', () => {
    const a = { ...v1(), requests: null }, b = v1()
    const c = changesBetween(a, b, 'architecture')
    expect(c.endpoints.added.map(e => e.title)).toEqual(['GET /orders', 'DELETE /orders/{id}'])
    expect(changesBetween(a, a, 'requests').crossings).toEqual({ added: [], removed: [] })
  })
})

describe('the store keeps the previous upload', () => {
  const bundle = (v, at) => ({ name: 'shop', ...v, model: { ...v.model, title: 'Shop' }, sources: {}, map: { nodes: [] }, published: { commit: at.slice(0, 7), dirty: false, at } })
  const read = (root, f) => JSON.parse(readFileSync(join(root, 'public/models', f), 'utf8'))

  it('marks nothing on a first upload, then what the next one changed, and keeps the base through same-shape uploads', () => {
    const root = mkdtempSync(join(tmpdir(), 'zoom-changes-'))
    try {
      storeBundle(bundle(v1(), '2026-11-01T00:00:00.000Z'), root)
      expect(read(root, 'shop.json').changed).toBeUndefined()
      expect(existsSync(join(root, 'imports/shop/previous.json'))).toBe(false)

      const v2 = v1()
      v2.model.relations.push(rel('api.users.ctl', 'db', 'runtime'))
      v2.requests.elements = v2.requests.elements.filter(e => e.id !== 'api.orders.e2')
      storeBundle(bundle(v2, '2026-11-02T00:00:00.000Z'), root)
      const m = read(root, 'shop.json'), r = read(root, 'shop.requests.json')
      expect(m.changed.since).toEqual({ commit: '2026-11', dirty: false, at: '2026-11-01T00:00:00.000Z' })
      expect(m.changed.dependencies.added).toEqual([{ from: 'api.users', to: 'db', title: 'users → db' }])
      expect(m.changed.endpoints.removed).toEqual([{ title: 'DELETE /orders/{id}', at: null }])
      expect(r.changed.endpoints.removed).toEqual([{ title: 'DELETE /orders/{id}', at: 'api.orders' }])
      // The base is kept whole and plain: no marks of its own.
      const kept = JSON.parse(readFileSync(join(root, 'imports/shop/previous.json'), 'utf8'))
      expect(kept.model.changed).toBeUndefined()
      expect(kept.published.at).toBe('2026-11-01T00:00:00.000Z')

      // The same shape again (a re-publish, a new trace): the marks stay, against the same base.
      storeBundle(bundle(v2, '2026-11-03T00:00:00.000Z'), root)
      expect(read(root, 'shop.json').changed).toEqual(m.changed)

      // Back to the first shape: compared with the upload just before, everything reverses.
      storeBundle(bundle(v1(), '2026-11-04T00:00:00.000Z'), root)
      const back = read(root, 'shop.json').changed
      expect(back.since.at).toBe('2026-11-03T00:00:00.000Z')
      expect(back.dependencies.removed).toEqual([{ from: 'api.users', to: 'db', title: 'users → db' }])
      expect(back.endpoints.added).toEqual([{ title: 'DELETE /orders/{id}', at: null }])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
