import { describe, expect, it } from 'vitest'
import { Camera } from './camera'
import { CARD_H, CARD_W, contentBox, placeWorld, type LocalLayout } from './layout'
import { aggregateEdges, Tree, type ModelJson } from './model'
import { clipToScreen, shortText } from './render'
import { synthetic } from './synthetic'

const el = (id: string, parent: string | null) => ({
  id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle',
})

// a{a1, a2{x}} and b{b1}; relations cross containers and include a parent-to-child one.
const model: ModelJson = {
  name: 'm',
  elements: [el('a', null), el('a.a1', 'a'), el('a.a2', 'a'), el('a.a2.x', 'a.a2'), el('b', null), el('b.b1', 'b')],
  relations: [
    { source: 'a.a1', target: 'b.b1', title: 'r1' },
    { source: 'a.a2.x', target: 'b.b1', title: 'r2' },
    { source: 'a.a1', target: 'a.a2.x', title: 'r3' },
    { source: 'a', target: 'a.a1', title: 'parent-child' },
  ],
}

describe('Tree', () => {
  const tree = new Tree(model)
  const id = (s: string) => tree.byId.get(s)!

  it('puts top-level elements under a virtual root and drops parent-child relations', () => {
    expect(tree.children[0]).toEqual([id('a'), id('b')])
    expect(tree.depth[id('a.a2.x')]).toBe(3)
    expect(tree.rels.length / 2).toBe(3)
  })

  it('rolls relations up to edges between the children of their common container', () => {
    const e = tree.siblingEdges()
    expect(e.get(0)).toEqual([{ s: id('a'), t: id('b'), count: 2 }])
    expect(e.get(id('a'))).toEqual([{ s: id('a.a1'), t: id('a.a2'), count: 1 }])
  })

  it('merges both directions into one edge with two heads', () => {
    const m: ModelJson = { ...model, relations: [{ source: 'a', target: 'b', title: '' }, { source: 'b.b1', target: 'a.a1', title: '' }] }
    const t = new Tree(m)
    const e = aggregateEdges(t, i => t.childUnder(0, i))
    expect(e).toEqual([{ s: t.byId.get('a'), t: t.byId.get('b'), count: 2, both: true, rel: 0, out: false, in: false, focusCount: 0, focusRel: -1 }])
  })

  it('lights a rolled-up edge only for relations that cross the focus', () => {
    // Focus a.a1: r1 (a.a1 → b.b1) leaves it; r2 (a.a2.x → b.b1) also rolls up to a→b but does not.
    const tree = new Tree(model)
    const id = (s: string) => tree.byId.get(s)!
    const focus = id('a.a1')
    const inFocus = (i: number) => i === focus
    const top = (i: number) => tree.childUnder(0, i)
    const [e] = aggregateEdges(tree, top, inFocus)
    expect([e.out, e.in]).toEqual([true, false])
    // Focus a.a2 (holding x): r2 leaves through x, so the same rolled-up edge lights; r1 alone would not.
    const a2 = id('a.a2')
    const viaA2 = aggregateEdges(tree, top, i => i === a2 || tree.isAncestor(a2, i))
    expect([viaA2[0].out, viaA2[0].in]).toEqual([true, false])
    // A focus no relation crosses leaves the edge dark.
    const dark = aggregateEdges(tree, top, () => false)
    expect([dark[0].out, dark[0].in]).toEqual([false, false])
  })

  it('aggregates shown edges and drops ones that collapse onto one node', () => {
    // Only top level shown: two relations merge into a→b, the internal one vanishes.
    const top = (i: number) => tree.childUnder(0, i)
    expect(aggregateEdges(tree, top).map(e => [e.s, e.t, e.count])).toEqual([[id('a'), id('b'), 2]])
    // a opened: its children carry their own edges.
    const open = (i: number) => (tree.isAncestor(id('a'), i) ? tree.childUnder(id('a'), i) : top(i))
    expect(aggregateEdges(tree, open).map(e => [e.s, e.t, e.count]).sort()).toEqual(
      [[id('a.a1'), id('b'), 1], [id('a.a2'), id('b'), 1], [id('a.a1'), id('a.a2'), 1]].sort(),
    )
  })
})

describe('placeWorld', () => {
  it('fits each container layout inside its card content area, below the header', () => {
    const tree = new Tree(model)
    const local = new Map<number, LocalLayout>()
    for (let i = 0; i < tree.size; i++) {
      const c = tree.children[i]
      if (!c.length) continue
      local.set(i, { id: i, w: 300 * c.length, h: 200, pos: c.flatMap((_, k) => [24 + 300 * k, 24]), routes: [] })
    }
    const w = placeWorld(tree, local)
    for (let i = 1; i < tree.size; i++) {
      const p = tree.parent[i]
      const [x, y, cw, ch] = w.rect.slice(i * 4, i * 4 + 4)
      expect(cw / ch).toBeCloseTo(CARD_W / CARD_H)
      if (p === 0) continue
      const b = contentBox(w.rect[p * 4], w.rect[p * 4 + 1], w.rect[p * 4 + 2], w.rect[p * 4 + 3])
      expect(x).toBeGreaterThanOrEqual(b.x - 1e-9)
      expect(y).toBeGreaterThanOrEqual(b.y - 1e-9)
      expect(x + cw).toBeLessThanOrEqual(b.x + b.w + 1e-9)
      expect(y + ch).toBeLessThanOrEqual(b.y + b.h + 1e-9)
    }
  })
})

describe('Camera', () => {
  it('keeps the world point under the cursor fixed through an eased wheel zoom', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(50, 20, 2)
    const before = cam.toWorld(800, 100)
    cam.zoomAt(800, 100, 40)
    for (let t = 0; t < 2000; t += 16) {
      cam.step(t, 16)
      const now = cam.toWorld(800, 100)
      expect(now[0]).toBeCloseTo(before[0], 9)
      expect(now[1]).toBeCloseTo(before[1], 9)
    }
    expect(cam.z).toBeCloseTo(80, 6)
  })

  it('stays exact at a million-fold zoom', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(1234.5678, 987.654321, 1e6)
    const [sx, sy] = cam.toScreen(1234.5678 + 0.0001, 987.654321)
    expect(sx).toBeCloseTo(600, 6)
    expect(sy).toBeCloseTo(300, 6)
  })

  it('flies to fit a rect', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    cam.flyTo(500, 500, 10, 6, 0, 1)
    for (let t = 0; t <= 800; t += 16) cam.step(t, 16)
    cam.step(800, 16)
    expect(cam.x).toBeCloseTo(505, 6)
    expect(cam.y).toBeCloseTo(503, 6)
    expect(cam.z).toBeCloseTo(100, 6)
  })
})

describe('clipToScreen', () => {
  it('cuts a line leaving the screen at the inset edge', () => {
    expect(clipToScreen([100, 100, 2100, 100], 1000, 600, true)).toEqual([100, 100, 990, 100])
    const c = clipToScreen([-900, 300, 500, 300], 1000, 600, false)!
    ;[10, 300, 500, 300].forEach((v, k) => expect(c[k]).toBeCloseTo(v, 9))
  })
})

describe('synthetic', () => {
  it('is deterministic and near the requested size', () => {
    const a = synthetic(1000), b = synthetic(1000)
    expect(a).toEqual(b)
    expect(a.elements.length).toBeGreaterThan(700)
    expect(a.elements.length).toBeLessThan(1400)
    const t = new Tree(a)
    expect(t.maxDepth).toBe(5)
    expect(t.rels.length / 2).toBeGreaterThan(a.elements.length * 0.5)
  })
})

describe('shortText', () => {
  it('collapses whitespace and keeps every letter', () => {
    expect(shortText('A customer of\n  the bank, with personal accounts.', 200)).toBe('A customer of the bank, with personal accounts.')
    expect(shortText('Sends emails using templates', 12)).toBe('Sends email…')
  })
})
