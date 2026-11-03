import { describe, expect, it } from 'vitest'
import { layoutJobs, placeWorld, type LocalLayout } from './layout'
import { diffModels, reuseLayouts, stableOrder, startRects } from './live'
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
  for (const j of layoutJobs(t)) m.set(j.id, { id: j.id, w: 300 * j.children.length + 50, h: 200, children: j.children, pos: j.children.flatMap((_, k) => [25 + 300 * k, 25]), routes: [] })
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
