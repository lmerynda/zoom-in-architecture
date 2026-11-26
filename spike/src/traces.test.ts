import { describe, expect, it } from 'vitest'
import { Tree, type ModelJson } from './model'
import { callerRows } from './traces'

const tree = (metadata: Record<string, string>) => new Tree({ name: 'm', elements: [{ id: 'a', parent: null, title: 'A', kind: 'component', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle', metadata }], relations: [] } as ModelJson)

describe('callerRows', () => {
  it('reads the pages, calls and tests a trace left, with the counts beside them', () => {
    const t = tree({
      pages: JSON.stringify([{ page: '/ö', path: 'web/Ö.tsx', count: 3 }]),
      pageCalls: JSON.stringify([{ endpoint: 'GET /x', count: 2, path: null }]),
      tests: JSON.stringify([{ test: 'a.test.ts › buys', count: 1 }]), testCount: '41', untimed: '2', otherPages: '7',
    })
    expect(callerRows(t, 1)).toEqual({
      pages: [{ page: '/ö', path: 'web/Ö.tsx', count: 3 }], calls: [{ endpoint: 'GET /x', count: 2, path: null }],
      tests: [{ test: 'a.test.ts › buys', count: 1 }], testCount: 41, untimed: 2, otherPages: 7,
    })
  })

  it('keeps only rows of the right shape, whatever an upload put in metadata', () => {
    const t = tree({ tests: '["smoke", null, {"test": 1, "count": 2}, {"test": "ok", "count": 1}]', pages: '{"not": "a list"}', pageCalls: 'cut off [' })
    expect(callerRows(t, 1)).toEqual({ pages: [], calls: [], tests: [{ test: 'ok', count: 1 }], testCount: 1, untimed: 0, otherPages: 0 })
    expect(callerRows(tree({}), 1)).toEqual({ pages: [], calls: [], tests: [], testCount: 0, untimed: 0, otherPages: 0 })
  })
})
