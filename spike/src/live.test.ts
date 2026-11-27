import { describe, expect, it } from 'vitest'
import { CARD_H, layoutJobs, placeWorld, TYPE_H, type LocalLayout } from './layout'
import { describeDiff, diffModels, reuseLayouts, stableOrder, startRects } from './live'
import { Tree, type ModelJson } from './model'

const el = (id: string, parent: string | null, title = id) => ({ id, parent, title, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
const v1: ModelJson = {
  name: 'm',
  elements: [el('a', null), el('a.x', 'a'), el('a.y', 'a'), el('b', null), el('b.z', 'b'), el('gone', null)],
  relations: [{ source: 'a.x', target: 'b.z', title: '' }],
}
// b gains a child, a.y is renamed, gone is removed; a's children are unchanged.
const v2: ModelJson = {
  name: 'm',
  elements: [el('a', null), el('a.x', 'a'), el('a.y', 'a', 'Y renamed'), el('b', null), el('b.z', 'b'), el('b.new', 'b')],
  relations: [{ source: 'a.x', target: 'b.z', title: '' }],
}

/** Fake layouts: children in a row, so a container's layout depends only on its children. */
function fakeLocal(t: Tree) {
  const m = new Map<number, LocalLayout>()
  for (const j of layoutJobs(t)) m.set(j.id, { id: j.id, w: 300 * j.children.length + 50, h: 200, children: j.children, pos: j.children.flatMap((_, k) => [25 + 300 * k, 25]), spans: j.spans, heights: j.heights, routes: [] })
  return m
}

describe('diffModels', () => {
  it('finds added, removed and changed elements by id', () => {
    const a = new Tree(v1), b = new Tree(v2)
    const d = diffModels(a, b)
    const ids = (xs: number[]) => xs.map(i => b.els[i].id).sort()
    expect(ids(d.added)).toEqual(['b.new'])
    expect(d.removed).toEqual(['gone'])
    expect(ids(d.changed)).toEqual(['a.y', 'b'])
    expect(a.els[d.oldIndex[b.byId.get('b.z')!]].id).toBe('b.z')
  })

  it('counts arrows added and removed, and cited lines that moved, and says it all by name', () => {
    const ev = (line: number) => [{ at: `x.ts:${line}`, line, code: 'call()' }]
    const a = new Tree({ ...v1, relations: [{ source: 'a.x', target: 'b.z', title: 'calls', evidence: ev(3) }, { source: 'a.y', target: 'b.z', title: '' }] })
    const b = new Tree({ ...v2, relations: [{ source: 'a.x', target: 'b.z', title: 'calls', evidence: ev(4) }, { source: 'b.new', target: 'a.x', title: '' }] })
    const d = diffModels(a, b)
    expect([d.arrowsAdded, d.arrowsRemoved, d.evidenceChanged, d.viaChanged]).toEqual([1, 1, 1, 0])
    expect(describeDiff(d, b)).toBe('added b.new · changed Y renamed, b · removed gone · +1 arrow · −1 arrow · 1 citation moved')
  })

  it('says when only how an arrow travels changed', () => {
    const rel = (via: string) => ({ ...v1, relations: [{ source: 'a.x', target: 'b.z', title: 'calls', kind: 'runtime' as const, via, evidence: [] }] })
    const d = diffModels(new Tree(rel('HTTP')), new Tree(rel('WebSocket')))
    expect([d.arrowsAdded, d.arrowsRemoved, d.evidenceChanged, d.viaChanged]).toEqual([0, 0, 0, 1])
    expect(describeDiff(d, new Tree(rel('WebSocket')))).toBe('1 arrow travels another way')
  })
})

describe('reuseLayouts', () => {
  it('keeps layouts of containers whose children and edges did not change', () => {
    const a = new Tree(v1), b = new Tree(v2)
    const { reused, rerun } = reuseLayouts(a, layoutJobs(a), fakeLocal(a), b, layoutJobs(b))
    const ids = (xs: number[]) => xs.map(i => b.els[i].id).sort()
    expect(ids([...reused.keys()])).toEqual(['a'])
    // The root lost "gone" and b gained a child: both lay out again.
    expect(ids(rerun.map(j => j.id))).toEqual(['', 'b'])
  })

  it('laid out by coupling, lays a level out again when its children\'s importance changed', () => {
    // a's children and its own edges stay the same; a.y gains a relation to b, so it outranks a.x.
    const c: ModelJson = { ...v1, relations: [...v1.relations, { source: 'a.y', target: 'b.z', title: '' }, { source: 'a.y', target: 'gone', title: '' }] }
    const a = new Tree(v1), b = new Tree(c)
    const { reused, rerun } = reuseLayouts(a, layoutJobs(a, true), fakeLocal(a), b, layoutJobs(b, true))
    expect(rerun.map(j => b.els[j.id].id)).toContain('a')
    expect([...reused.keys()].map(i => b.els[i].id)).not.toContain('a')
  })
})

describe('stableOrder', () => {
  it('keeps existing children in their old order and appends new ones', () => {
    const a = new Tree(v1)
    // b.new is declared before b.z in the file, yet lays out after it.
    const b = new Tree({ ...v2, elements: [el('a', null), el('a.x', 'a'), el('a.y', 'a'), el('b', null), el('b.new', 'b'), el('b.z', 'b')] })
    const jobs = layoutJobs(b)
    stableOrder(a, layoutJobs(a), b, jobs)
    const job = jobs.find(j => b.els[j.id].id === 'b')!
    expect(job.children.map(c => b.els[c].id)).toEqual(['b.z', 'b.new'])
  })

  it('moves every per-child array with its child: a step keeps its height, a type its own', () => {
    const step = (id: string, n: number) => ({ ...el(id, 'e'), metadata: { role: 'step', step: String(n) } })
    const type = (id: string) => ({ ...el(id, 'e'), metadata: { role: 'type' } })
    const a = new Tree({ name: 'm', elements: [el('e', null), step('e.s1', 1), type('e.t1')], relations: [] })
    // The new version declares the type first; the old order is kept, and each card's height with it.
    const b = new Tree({ name: 'm', elements: [el('e', null), type('e.t1'), step('e.s1', 1)], relations: [] })
    const jobs = layoutJobs(b)
    stableOrder(a, layoutJobs(a), b, jobs)
    const job = jobs.find(j => b.els[j.id].id === 'e')!
    expect(job.children.map(c => b.els[c].id)).toEqual(['e.s1', 'e.t1'])
    expect(job.heights).toEqual([CARD_H, TYPE_H])
    expect(job.lane).toEqual([0, -1])
  })
})

describe('startRects', () => {
  it('starts survivors where they were and new elements at their parent centre', () => {
    const a = new Tree(v1), b = new Tree(v2)
    const wa = placeWorld(a, fakeLocal(a)), wb = placeWorld(b, fakeLocal(b))
    const d = diffModels(a, b)
    const s = startRects(wa, b, wb, d.oldIndex)
    const x = b.byId.get('a.x')!, ox = a.byId.get('a.x')!
    expect([...s.rect.subarray(x * 4, x * 4 + 4)]).toEqual([...wa.rect.subarray(ox * 4, ox * 4 + 4)])
    const n = b.byId.get('b.new')!, pb = a.byId.get('b')!
    const r = wa.rect.subarray(pb * 4, pb * 4 + 4)
    expect([...s.rect.subarray(n * 4, n * 4 + 4)]).toEqual([r[0] + r[2] / 2, r[1] + r[3] / 2, 0, 0])
  })
})
