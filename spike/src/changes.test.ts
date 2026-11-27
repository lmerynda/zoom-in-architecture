import { describe, expect, it } from 'vitest'
import { changeCount, changeCounts, changeLens, sinceText, type Changes } from './changes'
import { aggregateEdges, Tree, type ElementJson, type ModelJson } from './model'

const el = (id: string, parent: string | null, path?: string): ElementJson => ({ id, parent, title: id, kind: 'component', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle', ...(path ? { metadata: { path } } : {}) })
const none = { added: [], removed: [] }
const model = (changed?: Changes): ModelJson => ({
  name: 'shop',
  elements: [el('web', null), el('web.pages', 'web'), el('web.pages.home', 'web.pages', 'web/home.ts'), el('api', null), el('api.orders', 'api'), el('api.orders.ctl', 'api.orders', 'api/Ctl.java'), el('api.store', 'api'), el('api.store.repo', 'api.store', 'api/Repo.java'), el('db', null)],
  relations: [
    { source: 'web.pages.home', target: 'api.orders.ctl', title: 'GET /orders', kind: 'runtime' },
    { source: 'api.orders.ctl', target: 'api.store.repo', title: '', kind: 'code' },
    { source: 'api.store.repo', target: 'db', title: 'JPA', kind: 'runtime' },
  ],
  ...(changed ? { changed } : {}),
})
const changed: Changes = {
  since: { commit: 'abcdef0123', dirty: true, at: '2026-11-20T00:00:00.000Z' },
  endpoints: { added: [{ title: 'DELETE /orders/{id}', at: 'api.orders.ctl' }], removed: [{ title: 'GET /old' }] },
  crossings: { added: [], removed: [{ from: 'web', to: 'db', title: 'web → db' }] },
  dependencies: { added: [{ from: 'api.orders', to: 'api.store', title: 'orders → store' }, { from: 'api.store', to: 'db', title: 'store → db' }], removed: [] },
}

describe('what changed since the upload before', () => {
  it('has no lens and no new arrows on a map with no earlier upload', () => {
    const t = new Tree(model())
    expect(t.changed).toBe(null)
    expect(t.relNew).toEqual([false, false, false])
    expect(changeLens(t)).toBe(null)
    expect(changeCount(null)).toBe(0)
    // A list with nothing in it is no change either.
    expect(changeLens(new Tree(model({ since: null, endpoints: none, crossings: none, dependencies: none })))).toBe(null)
  })

  it('marks the arrows that make a new dependency or crossing, and the edges that fold them in', () => {
    const t = new Tree(model(changed))
    expect(t.relNew).toEqual([false, true, true])
    // Rolled up to the top level, api → db carries a new arrow; web → api does not.
    const top = (i: number) => { while (t.depth[i] > 1) i = t.parent[i]; return i }
    const edges = aggregateEdges(t, top).map(e => [t.els[e.s].id, t.els[e.t].id, e.fresh])
    expect(edges).toEqual([['web', 'api', false], ['api', 'db', true]])
  })

  it('counts each change once on every card it touches or sits inside', () => {
    const t = new Tree(model(changed))
    const c = changeCounts(t, changed), at = (id: string) => c[t.byId.get(id)!]
    // api holds the endpoint and both ends of orders → store, and one end of store → db: 3 changes.
    expect([at('api'), at('api.orders'), at('api.orders.ctl'), at('api.store'), at('db'), at('web'), at('web.pages')]).toEqual([3, 2, 1, 2, 2, 1, 0])
    const lens = changeLens(t)!
    expect(lens.name).toBe('changed')
    expect(lens.heat[t.byId.get('web.pages')!]).toBe(0)
    expect(lens.heat[t.byId.get('api.store')!]).toBe(1)
    expect(changeCount(changed)).toBe(5)
  })

  it('names what it compares with by commit and age, or says it does not know', () => {
    const now = Date.parse('2026-11-22T00:00:00.000Z')
    expect(sinceText(changed.since, now)).toBe('abcdef0+ · 2 days ago')
    expect(sinceText({ at: '2026-11-21T23:58:00.000Z' }, now)).toBe('2 min ago')
    expect(sinceText(null, now)).toBe('the upload before')
  })
})
