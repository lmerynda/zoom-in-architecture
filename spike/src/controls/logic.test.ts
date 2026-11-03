import { describe, expect, it } from 'vitest'
import { Tree, type ModelJson } from '../model'
import { findRoute, fuzzy, History } from './logic'

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

describe('findRoute', () => {
  it('follows relations in their direction', () => {
    const r = findRoute(tree, id('web'), id('svc.db'))!
    expect(r.map(h => [tree.els[h.from].id, tree.els[h.to].id, h.title, h.reversed])).toEqual([
      ['web', 'svc.api', 'calls', false],
      ['svc.api', 'svc.db', 'queries', false],
    ])
  })

  it('treats a container as everything inside it', () => {
    expect(findRoute(tree, id('web'), id('svc'))!.length).toBe(1)
  })

  it('walks backwards only when no directed path exists', () => {
    const r = findRoute(tree, id('svc.db'), id('ops'))!
    expect(r.every(h => h.reversed)).toBe(true)
    expect(r.length).toBe(2)
  })

  it('prefers a longer path along the arrows to a short one against them', () => {
    const chain: ModelJson = {
      name: 'c',
      elements: ['x', 'y', 'z', 'w'].map(n => el(n, null)),
      relations: [{ source: 'x', target: 'y', title: '' }, { source: 'y', target: 'z', title: '' }, { source: 'z', target: 'w', title: '' }, { source: 'w', target: 'x', title: '' }],
    }
    const t = new Tree(chain)
    const r = findRoute(t, t.byId.get('x')!, t.byId.get('w')!)!
    expect(r.map(h => h.reversed)).toEqual([false, false, false])
  })

  it('returns null when nothing connects', () => {
    expect(findRoute(tree, id('web'), id('lone'))).toBeNull()
  })
})

describe('History', () => {
  it('goes back and forward and drops forward on a new jump', () => {
    const h = new History()
    const v = (x: number, z = 1) => ({ x, y: 0, z, selected: null })
    h.push(v(0), 1000)
    h.push(v(5000), 1000)
    expect(h.goBack(v(9000))!.x).toBe(5000)
    expect(h.goBack(v(5000))!.x).toBe(0)
    expect(h.goForward(v(0))!.x).toBe(5000)
    h.push(v(7000), 1000)
    expect(h.forward).toEqual([])
  })

  it('does not record views close to the last one', () => {
    const h = new History()
    h.push({ x: 0, y: 0, z: 1, selected: null }, 1000)
    h.push({ x: 10, y: 0, z: 1.05, selected: null }, 1000)
    expect(h.back.length).toBe(1)
  })
})

describe('fuzzy', () => {
  it('needs every character in order', () => {
    expect(fuzzy('srt', 'SectorRuntime')).toBeGreaterThan(0)
    expect(fuzzy('xyz', 'SectorRuntime')).toBe(-1)
  })

  it('prefers word starts and runs', () => {
    expect(fuzzy('sr', 'SectorRuntime')).toBeGreaterThan(fuzzy('sr', 'Snapshot Broadcaster Rx'))
    expect(fuzzy('sector', 'SectorRuntime')).toBeGreaterThan(fuzzy('sector', 'SnapshotEncoderTor'))
  })
})
