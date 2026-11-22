import { describe, expect, it } from 'vitest'
import { Tree, type ModelJson } from '../model'
import { fuzzy, match, same, searchMap } from './logic'

const el = (id: string, parent: string | null) => ({ id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
// web → api → db, and ops → api (so db reaches ops only against direction).
const model: ModelJson = {
  name: 'm',
  elements: [el('web', null), el('svc', null), el('svc.api', 'svc'), el('svc.db', 'svc'), el('ops', null), el('lone', null)],
  relations: [
    { source: 'web', target: 'svc.api', title: 'calls' },
    { source: 'svc.api', target: 'svc.db', title: 'queries' },
    { source: 'ops', target: 'svc.api', title: 'deploys' },
  ],
}
const tree = new Tree(model)
const id = (s: string) => tree.byId.get(s)!

describe('same', () => {
  it('reads views close together as one place', () => {
    expect(same({ x: 0, y: 0, z: 1, selected: null }, { x: 10, y: 0, z: 1.05, selected: null }, 1000)).toBe(true)
    expect(same({ x: 0, y: 0, z: 1, selected: null }, { x: 5000, y: 0, z: 1, selected: null }, 1000)).toBe(false)
    expect(same({ x: 0, y: 0, z: 1, selected: 'a' }, { x: 0, y: 0, z: 1, selected: null }, 1000)).toBe(false)
  })
})

describe('fuzzy', () => {
  it('needs every character in order', () => {
    expect(fuzzy('srt', 'SectorRuntime')).toBeGreaterThan(0)
    expect(fuzzy('xyz', 'SectorRuntime')).toBe(-1)
  })

  it('reads a space as any separator, or none', () => {
    expect(fuzzy('sign in', 'Accounts and sign-in')).toBeGreaterThan(0)
    expect(fuzzy('sign in', 'SignInPage')).toBeGreaterThan(0)
  })

  it('prefers word starts and runs', () => {
    expect(fuzzy('sr', 'SectorRuntime')).toBeGreaterThan(fuzzy('sr', 'Snapshot Broadcaster Rx'))
    expect(fuzzy('sector', 'SectorRuntime')).toBeGreaterThan(fuzzy('sector', 'SnapshotEncoderTor'))
  })

})

describe('searchMap', () => {
  const el = (id: string, title: string, extra = {}) => ({ id, title, ...extra })
  const els = [
    el('', 'root'),
    el('backend.military.intel', 'Intel', { features: ['Spies'] }),
    el('backend.military', 'War'),
    el('backend.misc.spyglass', 'Spyglass helpers'),
    el('backend.misc.sp', 'StepPolicy'),
    el('backend.k.reports', 'SpyReportDto', { metadata: { path: 'backend/src/intel/SpyReportDto.java' } }),
    el('web.x', 'index', { metadata: { path: 'web/src/pages/index.ts' }, features: ['Spies'] }),
    el('docs', 'Docs', { description: 'How sign-in works.' }),
  ]
  it('ranks whole names, then starts, then word starts, then letters in order', () => {
    expect(match('war', 'War')).toBe(100)
    expect(match('spy', 'Spies and reports')).toBeGreaterThanOrEqual(80)
    expect(match('report', 'Spies and reports')).toBeGreaterThanOrEqual(60)
    expect(match('spy', 'StepPolicy')).toBeLessThan(20)
    expect(match('xyz', 'War')).toBe(-1)
  })
  it('folds plurals and separators', () => {
    expect(match('spies', 'Spy')).toBe(100)
    expect(match('sign in', 'SignInPage')).toBeGreaterThanOrEqual(80)
  })
  it('puts a feature and a named part above a loose match', () => {
    const f = searchMap(els, 'spy')
    expect(f.features.map(x => x.name)).toEqual(['Spies'])
    expect(f.parts[0].i).toBe(3)
    expect(f.parts.at(-1)?.i).toBe(4)
  })
  it('lets an exact file path win', () => {
    expect(searchMap(els, 'web/src/pages/index.ts').files[0]).toEqual({ i: 6, score: 110 })
    expect(searchMap(els, 'pages/index.ts').files[0].i).toBe(6)
  })
  it('finds a description last, and never the landscape', () => {
    expect(searchMap(els, 'sign-in').parts).toEqual([{ i: 7, score: 5 }])
    expect(searchMap(els, 'root').parts).toEqual([])
  })
})
