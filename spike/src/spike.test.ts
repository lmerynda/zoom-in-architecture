import { describe, expect, it } from 'vitest'
import { Camera, flight } from './camera'
import { CARD_H, CARD_W, cardH, cardW, centreOut, contentBox, GUTTER, importance, lanePlace, layoutJobs, openScale, TYPE_H, placeWorld, rankKey, ranks, siblingPartners, spans, STRETCH, toLocal, toWorldX, toWorldY, type LocalLayout } from './layout'
import { aggregateEdges, arrowLabel, plainDoc, ranInTests, Tree, type ModelJson } from './model'
import { citedLines, codeBox, codeLayout, holdMinimap, lineHtml, linePoint, parseMarks, splitLines, viewWindow } from './code'
import { langOf, tokenize, type LineState } from './syntax'
import { glyphOf } from './icons'
import { breaks, clipToScreen, dashes, fitText, junctions, repeatsNearby, shortText, titlePx, weightTier } from './render'
import { synthetic } from './synthetic'

const el = (id: string, parent: string | null) => ({
  id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle',
})

// a{a1, a2{x}} and b{b1}; relations cross containers and include a parent-to-child one.
const model: ModelJson = {
  name: 'm',
  elements: [el('a', null), el('a.a1', 'a'), el('a.a2', 'a'), el('a.a2.x', 'a.a2'), el('b', null), el('b.b1', 'b')],
  relations: [
    { source: 'a.a1', target: 'b.b1', title: 'r1', evidence: [{ at: 'a1.ts:3', line: 3, code: "fetch('/b1')" }] },
    { source: 'a.a2.x', target: 'b.b1', title: 'r2' },
    { source: 'a.a1', target: 'a.a2.x', title: 'r3' },
    { source: 'a', target: 'a.a1', title: 'parent-child' },
  ],
}

describe('plainDoc', () => {
  it('reads doc-comment markup as plain words, for maps uploaded before the scanner stripped it', () => {
    expect(plainDoc('Simple <code>Validator</code> for {@link Pet} names &amp; dates.')).toBe('Simple Validator for Pet names & dates.')
    expect(new Tree({ name: 'm', elements: [{ id: 'a', parent: null, title: 'A', kind: 'code', description: 'A <code>Pet</code>.', technology: '', tags: [], color: 'primary', shape: 'rectangle' }], relations: [] }).els[1].description).toBe('A Pet.')
  })
  it('keeps the generics of a type, which are not markup', () => {
    expect(plainDoc('Returns <code>ActionResult<MarketPurchaseDto></code> as JSON.')).toBe('Returns ActionResult<MarketPurchaseDto> as JSON.')
    expect(plainDoc('Map<A, B> of <b>Pets</b>, List<string>')).toBe('Map<A, B> of Pets, List<string>')
    const d = 'Returns ActionResult<MarketPurchaseDto> as JSON.'
    expect(new Tree({ name: 'm', elements: [{ id: 'a', parent: null, title: 'A', kind: 'code', description: d, technology: '', tags: [], color: 'primary', shape: 'rectangle' }], relations: [] }).els[1].description).toBe(d)
  })
})

describe('Tree', () => {
  const tree = new Tree(model)
  const id = (s: string) => tree.byId.get(s)!

  it('keeps each relation evidence beside its title', () => {
    expect(tree.relTitles).toEqual(['r1', 'r2', 'r3'])
    expect(tree.relEvidence).toEqual([[{ at: 'a1.ts:3', line: 3, code: "fetch('/b1')" }], undefined, undefined])
  })

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

  it('finds the counterpart at a container’s own level, for its details panel', () => {
    const counterpart = (i: string, o: string) => tree.els[tree.childUnder(tree.lca(id(i), id(o)), id(o))].id
    expect(counterpart('a.a2', 'b.b1')).toBe('b')
    expect(counterpart('a.a2', 'a.a1')).toBe('a.a1')
    expect(counterpart('a', 'b.b1')).toBe('b')
  })

  it('merges both directions into one edge with two heads', () => {
    const m: ModelJson = { ...model, relations: [{ source: 'a', target: 'b', title: '' }, { source: 'b.b1', target: 'a.a1', title: '' }] }
    const t = new Tree(m)
    const e = aggregateEdges(t, i => t.childUnder(0, i))
    expect(e).toEqual([{ s: t.byId.get('a'), t: t.byId.get('b'), count: 2, both: true, rel: 0, out: false, in: false, focusCount: 0, focusRel: -1, runtime: false, focusRuntime: false, focusTypesOnly: true, focusSeen: false, focusTraceable: false, typesOnly: false, seen: false, traceable: false, fresh: false, via: '', focusVia: '' }])
  })

  it('judges a runtime call against the trace only when a file inside a part where code ran makes it', () => {
    const traced = { at: '2026-11-23T00:00:00Z', command: 'mvn verify', exit: 0, seen: 1, total: 2 }
    // Code ran in a (a.a2.x); nothing ran in b, so b's calls say nothing either way.
    // Files have paths; a call from a component (a.a2.x's parent) has no file the trace could count it by.
    const file = (id: string) => ({ path: `${id}.ts` })
    const els = model.elements.map(e => (e.id === 'a.a2.x' ? { ...e, metadata: { seen: '12', ...file(e.id) } } : e.id === 'b.b1' ? { ...e, metadata: { seen: '0', ...file(e.id) } } : e.id === 'a.a1' ? { ...e, metadata: file(e.id) } : e))
    const relations = [
      { source: 'a.a1', target: 'b', title: 'reads', kind: 'runtime' as const, seen: 3 },
      { source: 'a.a2.x', target: 'b', title: 'writes', kind: 'runtime' as const },
      { source: 'a.a2', target: 'b', title: 'from a component', kind: 'runtime' as const },
      { source: 'b.b1', target: 'a.a1', title: 'calls', kind: 'runtime' as const },
      { source: 'b.b1', target: 'a.a2', title: 'imports' },
    ]
    const t = new Tree({ ...model, elements: els, relations, published: { at: traced.at, traced } })
    expect(t.relTraceable).toEqual([true, true, false, false, false])
    // Untraced, nothing is judged: absence there means not looked at.
    expect(new Tree({ ...model, elements: els, relations }).relTraceable).toEqual([false, false, false, false, false])
    const e = aggregateEdges(t, i => t.childUnder(0, i))
    expect(e.map(x => ({ seen: x.seen, traceable: x.traceable }))).toEqual([{ seen: true, traceable: true }])
  })

  it('says how an arrow travels first, when every relation on it says the same', () => {
    const rt = (source: string, target: string, via?: string) => ({ source, target, title: 'calls', kind: 'runtime' as const, evidence: [], ...(via ? { via } : {}) })
    const t = new Tree({ ...model, relations: [rt('a.a1', 'b', 'HTTP'), rt('a.a2.x', 'b.b1', 'HTTP'), rt('b.b1', 'a.a1', 'HTTP')] })
    expect(t.relVia).toEqual(['HTTP', 'HTTP', 'HTTP'])
    expect(aggregateEdges(t, i => t.childUnder(0, i)).map(e => e.via)).toEqual(['HTTP'])
    // Mixed ways, or a code use folded in, say no transport: the count alone.
    const mixed = new Tree({ ...model, relations: [rt('a.a1', 'b', 'HTTP'), rt('a.a2.x', 'b.b1', 'JPA')] })
    expect(aggregateEdges(mixed, i => mixed.childUnder(0, i)).map(e => e.via)).toEqual([''])
    const withCode = new Tree({ ...model, relations: [rt('a.a1', 'b', 'HTTP'), { source: 'a.a2.x', target: 'b.b1', title: 'B1' }] })
    expect(aggregateEdges(withCode, i => withCode.childUnder(0, i)).map(e => e.via)).toEqual([''])
    // A via on a code use is not a transport.
    expect(new Tree({ ...model, relations: [{ source: 'a.a1', target: 'b', title: 'B', via: 'HTTP' }] }).relVia).toEqual([''])
    // In focus, the transport is that of the relations crossing it: two HTTP calls beside an unrelated import.
    const focus = new Tree({ ...model, relations: [rt('a.a1', 'b', 'HTTP'), rt('a.a1', 'b.b1', 'HTTP'), { source: 'a.a2.x', target: 'b.b1', title: 'B1' }] })
    const [fe] = aggregateEdges(focus, i => focus.childUnder(0, i), i => i === focus.byId.get('a.a1'))
    expect([fe.count, fe.via, fe.focusCount, fe.focusVia]).toEqual([3, '', 2, 'HTTP'])
  })

  it('labels an arrow: transport and count, transport and title, or what it always said', () => {
    expect(arrowLabel(10, 'HTTP', 'kingdom actions', true)).toBe('HTTP ×10')
    expect(arrowLabel(3, '', 'User', true)).toBe('×3')
    expect(arrowLabel(1, 'JPA', 'accounts', true)).toBe('JPA · accounts')
    expect(arrowLabel(1, 'JPA', '', true)).toBe('JPA')
    expect(arrowLabel(1, 'JPA', 'JPA', true)).toBe('JPA')
    // A single import's name shows only when named (on the focused card's edges).
    expect(arrowLabel(1, '', 'User', false)).toBe('')
    expect(arrowLabel(1, '', 'User', true)).toBe('User')
    // A title that only repeats an end's name says nothing; a transport into a card of its own name still does.
    expect(arrowLabel(1, '', 'User', true, ['Users page', 'User'])).toBe('')
    expect(arrowLabel(1, 'Redis', '', true, ['Cache', 'Redis'])).toBe('Redis')
    expect(arrowLabel(1, 'Redis', 'Redis', true, ['Cache', 'Redis'])).toBe('Redis')
  })

  it('reads a trace mark as code that ran only when it counts something', () => {
    expect(['12', '63/67', '1/2'].map(ranInTests)).toEqual([true, true, true])
    expect([undefined, '', '0', '0/67'].map(ranInTests)).toEqual([false, false, false, false])
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

describe('coupling layout', () => {
  // Nine children: 1 is the hub, 2 and 3 talk to it a lot, 9 talks to nothing.
  const children = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const job = {
    id: 0, children, spans: children.map(c => (c === 1 ? 2 : 1)), heights: children.map(c => cardH(c === 1 ? 2 : 1)), headed: children.map(() => false),
    edges: [{ s: 1, t: 2, count: 20 }, { s: 1, t: 3, count: 15 }, { s: 4, t: 5, count: 8 }, { s: 1, t: 6, count: 2 }, { s: 7, t: 8, count: 1 }],
    weights: [37, 20, 15, 8, 8, 2, 1, 1, 0],
  }
  const { pos, w, h } = centreOut(job)
  const centre = (k: number) => [pos[k * 2] + cardW(job.spans[k]) / 2, pos[k * 2 + 1] + cardH(job.spans[k]) / 2]
  const from = (k: number, x: number, y: number) => Math.hypot(centre(k)[0] - x, centre(k)[1] - y)

  it('puts the most connected child nearest the middle and the unconnected one at the rim', () => {
    const d = children.map((_, k) => from(k, w / 2, h / 2))
    expect(Math.min(...d)).toBe(d[0])
    // The rim: its card touches the edge of the level's layout.
    const [x, y] = [pos[16], pos[17]]
    expect(x === GUTTER || y === GUTTER || x + CARD_W === w - GUTTER || y + CARD_H === h - GUTTER).toBe(true)
  })

  it('places a child beside what it is coupled with, on the card grid, without overlaps', () => {
    // 2 and 3 are the hub's heaviest partners: each touches the hub's 2 × 2 block.
    for (const k of [1, 2]) expect(from(k, ...centre(0) as [number, number])).toBeLessThan(cardW(2) / 2 + CARD_W + GUTTER + 1)
    const boxes = children.map((_, k) => [pos[k * 2], pos[k * 2 + 1], cardW(job.spans[k]), cardH(job.spans[k])])
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const [x1, y1, w1, h1] = boxes[a], [x2, y2, w2, h2] = boxes[b]
      expect(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1).toBe(true)
    }
    // Every card sits on a cell of the grid, so edges keep their gutters.
    for (let k = 0; k < children.length; k++) {
      expect((pos[k * 2] - GUTTER) % (CARD_W + GUTTER)).toBe(0)
      expect((pos[k * 2 + 1] - GUTTER) % (CARD_H + GUTTER)).toBe(0)
    }
  })

  it('puts #1 exactly at the centre, and reads outward in rank order, a ring at most out of turn', () => {
    // Nine children with a 2 × 2 #1 (as in a 9-component editor level), weights falling, a few couplings;
    // and seven single cards, for an odd grid.
    for (const spansOf of [(c: number) => (c === 1 ? 2 : 1), () => 1]) {
      const kids = spansOf(1) === 2 ? children : children.slice(0, 7)
      const j = { ...job, children: kids, spans: kids.map(spansOf), heights: kids.map(k => cardH(spansOf(k))), headed: kids.map(() => false), weights: kids.map((_, k) => 50 - 5 * k), edges: job.edges.filter(e => kids.includes(e.s) && kids.includes(e.t)) }
      const L = centreOut(j)
      const mid = (k: number) => [L.pos[k * 2] + cardW(j.spans[k]) / 2, L.pos[k * 2 + 1] + cardH(j.spans[k]) / 2]
      expect(mid(0)[0]).toBeCloseTo(L.w / 2)
      expect(mid(0)[1]).toBeCloseTo(L.h / 2)
      const d = kids.map((_, k) => Math.hypot(mid(k)[0] - L.w / 2, mid(k)[1] - L.h / 2) / (CARD_W + GUTTER))
      for (let a = 1; a < d.length; a++) for (let b = a + 1; b < d.length; b++) expect(d[a]).toBeLessThanOrEqual(d[b] + 0.3 + 1e-9)
    }
  })

  it('leaves no side of a small level empty', () => {
    // Four children: #1 takes a 2 × 2 card and the rest close the grid around it; a pair sits side by side.
    const el = (id: string, parent: string | null) => ({ id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
    for (const n of [2, 3, 4]) {
      const ids = ['a', 'b', 'c', 'd'].slice(0, n)
      const tree = new Tree({ name: 'm', elements: [el('p', null), ...ids.map(id => el(`p.${id}`, 'p'))], relations: ids.slice(1).map(id => ({ source: 'p.a', target: `p.${id}`, title: '' })) })
      const j = layoutJobs(tree, true).find(x => tree.els[x.id].id === 'p')!
      const L = centreOut(j)
      const cols = Math.round((L.w - GUTTER) / (CARD_W + GUTTER)), rows = Math.round((L.h - GUTTER) / (CARD_H + GUTTER))
      const used = j.spans.reduce((a, s) => a + s * s, 0)
      expect(cols * rows - used, `${n} children: ${cols} × ${rows}`).toBeLessThanOrEqual(n === 2 ? 0 : 1)
    }
  })

  it('ranks siblings by the relations crossing their boundary, map order breaking ties', () => {
    const tree = new Tree(model)
    const r = ranks(tree, importance(tree))
    const top = tree.children[0].map(i => [tree.els[i].id, r[i]])
    expect(new Set(top.map(t => t[1])).size).toBe(top.length)
    expect(top.map(t => t[1]).sort()).toEqual(top.map((_, k) => k + 1))
  })

  it('ranks breadth before volume: reaching more siblings beats more relations to fewer', () => {
    const el = (id: string, parent: string | null) => ({ id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
    // types is imported 6 times, by a only; hub talks once each to a, b and c.
    const rel = (s: string, t: string) => ({ source: `${s}.f`, target: `${t}.f`, title: '' })
    const t = new Tree({ name: 'r', elements: ['types', 'hub', 'a', 'b', 'c'].flatMap(x => [el(x, null), el(`${x}.f`, x)]), relations: [...Array(6).fill(0).map(() => rel('a', 'types')), rel('hub', 'a'), rel('hub', 'b'), rel('hub', 'c')] })
    const r = ranks(t, rankKey(t)), w = importance(t)
    expect(w[t.byId.get('types')!]).toBeGreaterThan(w[t.byId.get('hub')!])
    expect(r[t.byId.get('hub')!]).toBe(1)
  })

  it('still counts volume: a heavy part missing one sibling outranks a light one that touches them all', () => {
    const el = (id: string, parent: string | null) => ({ id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
    const rel = (s: string, t: string) => ({ source: `${s}.f`, target: `${t}.f`, title: '' })
    // war: 30 relations with a and b (misses light); light: one relation with each of war, a and b.
    const t = new Tree({ name: 'v', elements: ['war', 'light', 'a', 'b'].flatMap(x => [el(x, null), el(`${x}.f`, x)]), relations: [...Array(15).fill(0).flatMap(() => [rel('war', 'a'), rel('war', 'b')]), rel('light', 'war'), rel('light', 'a'), rel('light', 'b')] })
    const r = ranks(t, rankKey(t))
    expect(r[t.byId.get('war')!]).toBeLessThan(r[t.byId.get('light')!])
  })

  it('counts the siblings each node reaches, once per sibling however many relations', () => {
    const el = (id: string, parent: string | null) => ({ id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
    // a reaches b twice and c once; b and c do not meet.
    const t = new Tree({ name: 'p', elements: ['a', 'b', 'c'].flatMap(x => [el(x, null), el(`${x}.f`, x)]), relations: [{ source: 'a.f', target: 'b.f', title: '' }, { source: 'b.f', target: 'a.f', title: '' }, { source: 'a.f', target: 'c.f', title: '' }] })
    const p = siblingPartners(t)
    expect(['a', 'b', 'c'].map(x => p[t.byId.get(x)!])).toEqual([2, 1, 1])
  })
})

describe('spans', () => {
  // A system of an app holding 12 files, a small app with 2, an actor and a database.
  const files = (parent: string, n: number) => Array.from({ length: n }, (_, k) => el(`${parent}.f${k}`, parent))
  const big: ModelJson = {
    name: 'm',
    elements: [el('user', null), el('db', null), el('app', null), el('app.core', 'app'), ...files('app.core', 12), el('tool', null), ...files('tool', 2)],
    relations: [],
  }
  const tree = new Tree(big)
  const span = spans(tree)
  const id = (s: string) => tree.byId.get(s)!

  it('gives a child holding far more files than its siblings two cells per side', () => {
    expect(span[id('app')]).toBe(2)
    expect([span[id('user')], span[id('db')], span[id('tool')]]).toEqual([1, 1, 1])
  })

  it('never grows files, or an only child', () => {
    expect(span[id('app.core')]).toBe(1)
    expect(span[id('app.core.f0')]).toBe(1)
  })

  it('grows only what carries a feature, once the map names features', () => {
    // A big pile of tooling beside a smaller app that carries the product's feature.
    const featured: ModelJson = {
      name: 'm',
      elements: [el('user', null), el('db', null), el('app', null), el('app.core', 'app'), ...files('app.core', 12), el('tools', null), el('tools.cli', 'tools'), ...files('tools.cli', 40), el('lib', null), ...files('lib', 2)],
      relations: [],
    }
    featured.elements.find(e => e.id === 'app.core')!.features = ['Checkout']
    const t = new Tree(featured), s = spans(t)
    expect(s[t.byId.get('app')!]).toBe(2)
    expect(s[t.byId.get('tools')!]).toBe(1)
    // Without features, size alone decides.
    featured.elements.find(e => e.id === 'app.core')!.features = []
    const u = new Tree(featured)
    expect(spans(u)[u.byId.get('tools')!]).toBe(2)
  })

  it('places a two-cell card as two cells and the gutter between them', () => {
    const local = new Map<number, LocalLayout>()
    const top = tree.children[0]
    local.set(0, { id: 0, w: 2000, h: 600, children: top, pos: top.flatMap((_, k) => [400 * k, 0]), spans: top.map(c => span[c]), heights: top.map(c => cardH(span[c])), routes: [] })
    const w = placeWorld(tree, local)
    expect([w.rect[id('app') * 4 + 2], w.rect[id('app') * 4 + 3]]).toEqual([cardW(2), cardH(2)])
    expect([w.rect[id('user') * 4 + 2], w.rect[id('user') * 4 + 3]]).toEqual([CARD_W, CARD_H])
    expect(cardW(2)).toBe(2 * CARD_W + 56)
  })
})

describe('placeWorld', () => {
  it('fits each container layout inside its card content area, below the header', () => {
    const tree = new Tree(model)
    const local = new Map<number, LocalLayout>()
    for (let i = 0; i < tree.size; i++) {
      const c = tree.children[i]
      if (!c.length) continue
      local.set(i, { id: i, w: 300 * c.length, h: 200, children: c, pos: c.flatMap((_, k) => [24 + 300 * k, 24]), spans: c.map(() => 1), heights: c.map(() => CARD_H), routes: [] })
    }
    const w = placeWorld(tree, local)
    for (let i = 1; i < tree.size; i++) {
      const p = tree.parent[i]
      const [x, y, cw, ch] = w.rect.slice(i * 4, i * 4 + 4)
      // A card may stretch to fill its container, by at most STRETCH on one axis.
      expect(cw / ch).toBeGreaterThanOrEqual(CARD_W / CARD_H / STRETCH - 1e-9)
      expect(cw / ch).toBeLessThanOrEqual((CARD_W / CARD_H) * STRETCH + 1e-9)
      if (p === 0) continue
      const b = contentBox(w.rect[p * 4], w.rect[p * 4 + 1], w.rect[p * 4 + 2], w.rect[p * 4 + 3])
      expect(x).toBeGreaterThanOrEqual(b.x - 1e-9)
      expect(y).toBeGreaterThanOrEqual(b.y - 1e-9)
      expect(x + cw).toBeLessThanOrEqual(b.x + b.w + 1e-9)
      expect(y + ch).toBeLessThanOrEqual(b.y + b.h + 1e-9)
    }
  })
})

describe('filling a container', () => {
  // An app holding n parts side by side, as a packer lays out a few; each part holds a file, or is one.
  const few = (n: number, files = false): ModelJson => ({
    name: 'few',
    elements: [el('app', null), ...Array.from({ length: n }, (_, k) => el(`app.c${k}`, 'app')), ...(files ? [] : Array.from({ length: n }, (_, k) => el(`app.c${k}.f`, `app.c${k}`)))],
    relations: [],
  })
  const placed = (n: number, files = false) => {
    const tree = new Tree(few(n, files))
    const local = new Map<number, LocalLayout>()
    const app = tree.byId.get('app')!
    local.set(0, { id: 0, w: CARD_W + 2 * GUTTER, h: CARD_H + 2 * GUTTER, children: [app], pos: [GUTTER, GUTTER], spans: [1], heights: [CARD_H], routes: [] })
    const c = tree.children[app]
    local.set(app, { id: app, w: c.length * (CARD_W + GUTTER) + GUTTER, h: CARD_H + 2 * GUTTER, children: c, pos: c.flatMap((_, k) => [GUTTER + k * (CARD_W + GUTTER), GUTTER]), spans: c.map(() => 1), heights: c.map(() => CARD_H), routes: [] })
    for (const k of c) if (tree.children[k].length) local.set(k, { id: k, w: CARD_W + 2 * GUTTER, h: CARD_H + 2 * GUTTER, children: tree.children[k], pos: [GUTTER, GUTTER], spans: [1], heights: [CARD_H], routes: [] })
    return { tree, w: placeWorld(tree, local), app, c }
  }
  const cover = (n: number) => {
    const { w, app, c } = placed(n)
    const b = contentBox(w.rect[app * 4], w.rect[app * 4 + 1], w.rect[app * 4 + 2], w.rect[app * 4 + 3])
    const x0 = Math.min(...c.map(k => w.rect[k * 4])), x1 = Math.max(...c.map(k => w.rect[k * 4] + w.rect[k * 4 + 2]))
    const y0 = Math.min(...c.map(k => w.rect[k * 4 + 1])), y1 = Math.max(...c.map(k => w.rect[k * 4 + 1] + w.rect[k * 4 + 3]))
    return ((x1 - x0) * (y1 - y0)) / (b.w * b.h)
  }

  it('keeps a lone part to a 2 × 2 grid card, as a lone file', () => {
    const { w, app, c } = placed(1)
    const b = contentBox(w.rect[app * 4], w.rect[app * 4 + 1], w.rect[app * 4 + 2], w.rect[app * 4 + 3])
    expect(w.rect[c[0] * 4 + 2]).toBeCloseTo(CARD_W * Math.min(b.w / (cardW(2) + 2 * GUTTER), b.h / (cardH(2) + 2 * GUTTER)))
  })

  it('grows two cards side by side past 60% (they covered under a fifth), and stretches a row that fills its width taller', () => {
    expect(cover(2)).toBeGreaterThan(0.6)
    // Three in one row covered 27%: as wide as the container, a third of its height.
    expect(cover(3)).toBeGreaterThan(0.4)
  })

  it('draws a file no larger than a 2 × 2 grid card, so a one-file app opens with its siblings', () => {
    const { w, app, c } = placed(1, true)
    const b = contentBox(w.rect[app * 4], w.rect[app * 4 + 1], w.rect[app * 4 + 2], w.rect[app * 4 + 3])
    const grid = Math.min(b.w / (cardW(2) + 2 * GUTTER), b.h / (cardH(2) + 2 * GUTTER))
    expect(w.rect[c[0] * 4 + 2]).toBeCloseTo(CARD_W * grid)
    expect(w.rect[c[0] * 4 + 3]).toBeCloseTo(CARD_H * grid)
  })

  it('opens a filled level when its grown cards can carry their names, by their shorter side', () => {
    const { w, app, c } = placed(2)
    expect(openScale(w, app)).toBeCloseTo(Math.min(w.rect[c[0] * 4 + 2] / CARD_W, w.rect[c[0] * 4 + 3] / CARD_H))
  })

  it('maps local route points to the world and back, inside the cards and in the margin around them', () => {
    const { w, app } = placed(2)
    for (const v of [0, GUTTER / 2, GUTTER, 300, 2 * CARD_W + 2 * GUTTER, 2 * CARD_W + 3 * GUTTER]) {
      expect(toLocal(w, app, toWorldX(w, app, v), true)).toBeCloseTo(v)
      expect(toLocal(w, app, toWorldY(w, app, v), false)).toBeCloseTo(v)
    }
    // The ring a route leaves by, half a gutter outside the cards, stays inside the container's body.
    const b = contentBox(w.rect[app * 4], w.rect[app * 4 + 1], w.rect[app * 4 + 2], w.rect[app * 4 + 3])
    expect(toWorldX(w, app, GUTTER / 2)).toBeGreaterThan(b.x)
    expect(toWorldY(w, app, GUTTER / 2)).toBeGreaterThan(b.y)
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

  it('keeps zooming at full speed while panning', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    for (let t = 16; t <= 2000; t += 16) {
      cam.panBy(3, 0)
      cam.zoomAt(500, 300, Math.exp(1 * 0.016))
      cam.step(t, 16)
    }
    // 2 s at 1 log unit/s is e^2; easing lags a little behind the target.
    expect(Math.log(cam.z)).toBeGreaterThan(1.8)
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
    let t = 0
    while (cam.flying && t < 10000) { t += 16; cam.step(t, 16) }
    expect(cam.flying).toBe(false)
    expect(cam.x).toBeCloseTo(505, 6)
    expect(cam.y).toBeCloseTo(503, 6)
    expect(cam.z).toBeCloseTo(100, 6)
  })

  it('a flight sent to a new end lands there when it was due, not later', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    cam.flyTo(500, 500, 10, 6, 0, 1)
    const due = cam.flightMs
    let t = 0
    // Sent on again and again, as a resize or a layout moving into place does each frame.
    while (cam.flying && t < 10000) { t += 16; cam.aim(-200 + t / 10, 40, 50 + t / 100); cam.step(t, 16) }
    expect(t).toBeLessThanOrEqual(due + 16)
    expect(cam.x).toBeCloseTo(-200 + t / 10, 6)
    expect(cam.y).toBeCloseTo(40, 6)
    expect(cam.z).toBeCloseTo(50 + t / 100, 6)
    expect(cam.aim(0, 0, 1)).toBe(false)
  })

  it('a flight sent to a new end starts where it was, with no jump', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    cam.flyTo(500, 500, 10, 6, 0, 1)
    cam.aim(-5000, 9000, 0.01)
    cam.step(0, 16)
    expect(cam.x).toBeCloseTo(0, 6)
    expect(cam.y).toBeCloseTo(0, 6)
    expect(cam.z).toBeCloseTo(1, 6)
    expect(cam.destination).toEqual([-5000, 9000, expect.closeTo(0.01, 9)])
  })

  it('a flight sent to a new end halfway goes on from where it is, with no jump', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    cam.flyTo(500, 500, 10, 6, 0, 1)
    let t = 0
    for (; t < cam.flightMs * 0.52; t += 16) cam.step(t, 16)
    const at = [cam.x, cam.y, cam.z]
    // Sent elsewhere twice, then stepped again at the same moment: the camera has not moved.
    cam.aim(300, -100, 20)
    cam.aim(250, -50, 30)
    cam.step(t - 16, 0)
    expect(cam.x).toBeCloseTo(at[0], 9)
    expect(cam.y).toBeCloseTo(at[1], 9)
    expect(cam.z).toBeCloseTo(at[2], 9)
    // And it lands on the last end it was sent to, when it was due.
    const due = cam.flightMs
    while (cam.flying) { t += 16; cam.step(t, 16) }
    expect(t).toBeLessThanOrEqual(due + 16)
    expect([cam.x, cam.y]).toEqual([expect.closeTo(250, 6), expect.closeTo(-50, 6)])
    expect(cam.z).toBeCloseTo(30, 6)
  })

  it('a sideways scroll (no zoom) neither stops a flight nor takes the camera', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    let hands = 0
    cam.onHand = () => { hands++ }
    cam.steer(() => cam.flyTo(500, 500, 10, 6, 0, 1))
    cam.zoomAt(500, 300, 1)
    expect(cam.flying).toBe(true)
    expect(hands).toBe(0)
  })

  it('a layout moved under a flight sent elsewhere moves its new end too', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    cam.flyTo(500, 500, 10, 6, 0, 1)
    cam.aim(100, 200, 4)
    // The world doubles about the origin and shifts by (10, 0).
    cam.remap(0, 0, 10, 0, 2)
    let t = 0
    while (cam.flying && t < 10000) { t += 16; cam.step(t, 16) }
    expect(cam.x).toBeCloseTo(210, 6)
    expect(cam.y).toBeCloseTo(400, 6)
    expect(cam.z).toBeCloseTo(2, 6)
  })

  it('tells the page when the reader moves it, never when the page steers it', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    let hands = 0
    cam.onHand = () => { hands++ }
    cam.steer(() => { cam.set(0, 0, 1); cam.flyTo(500, 500, 10, 6, 0, 1); cam.aim(1, 2, 3); cam.stop() })
    cam.resize(800, 600)
    cam.remap(0, 0, 1, 1, 2)
    // A press with no flight under way, and a release with no speed, move nothing.
    cam.stop()
    cam.release(0, 0)
    expect(hands).toBe(0)
    const moves: [string, () => void][] = [
      ['set', () => cam.set(5, 5, 2)],
      ['wheel', () => cam.zoomAt(10, 10, 1.1)],
      ['drag', () => cam.panBy(3, 0)],
      ['glide', () => cam.release(0.5, 0)],
      ['jump', () => cam.flyTo(0, 0, 10, 10, 0, 1)],
      ['press in a flight', () => cam.stop()],
    ]
    for (const [name, move] of moves) {
      const before = hands
      move()
      expect(hands, name).toBe(before + 1)
    }
    // Nested steering stays the page's until the outermost ends.
    cam.steer(() => cam.steer(() => cam.set(1, 1, 1)))
    cam.steer(() => { try { cam.steer(() => { throw new Error('x') }) } catch { /* */ } cam.set(2, 2, 2) })
    expect(hands).toBe(moves.length)
  })
})

describe('flight (van Wijk–Nuij)', () => {
  it('starts and ends exactly at both views, for far pans and pure zooms', () => {
    for (const [x0, y0, w0, x1, y1, w1] of [[0, 0, 1000, 50000, -20000, 30], [10, 10, 800, 10, 10, 0.05], [5, 5, 100, 5, 5, 4000]]) {
      const f = flight(x0, y0, w0, x1, y1, w1)
      const a = f.at(0), b = f.at(f.S)
      ;[x0, y0, w0].forEach((v, k) => expect(a[k]).toBeCloseTo(v, 6))
      ;[x1, y1, w1].forEach((v, k) => expect(b[k] / v).toBeCloseTo(1, 6))
    }
  })

  it('pulls back while crossing a long distance', () => {
    const f = flight(0, 0, 100, 100000, 0, 100)
    expect(f.at(f.S / 2)[2]).toBeGreaterThan(5000)
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

describe('repeatsNearby', () => {
  it('leaves out the same label a step away, keeps it far off or with other words', () => {
    const said: [string, number, number][] = [['User', 600, 700]]
    expect(repeatsNearby(said, 'User', 690, 700)).toBe(true)
    expect(repeatsNearby(said, 'User', 400, 500)).toBe(false)
    expect(repeatsNearby(said, 'Article', 610, 700)).toBe(false)
  })
})

describe('weightTier', () => {
  it('gives heavier edges thicker strokes, on a log scale', () => {
    expect([1, 2, 4, 5, 19, 20, 99, 100, 500].map(weightTier)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('junctions', () => {
  it('dots a line that bends off a trunk', () => {
    // Trunk along y = 0; a branch runs along it, then turns down at x = 50.
    expect(junctions([[0, 0, 100, 0], [0, 0, 50, 0, 50, 40]])).toEqual([50, 0])
  })

  it('leaves plain crossings and lone bends alone', () => {
    expect(junctions([[0, 20, 100, 20], [50, 0, 50, 40]])).toEqual([])
    expect(junctions([[0, 0, 50, 0, 50, 40]])).toEqual([])
    // Two lines bending at the same corner the same way are one line drawn twice.
    expect(junctions([[0, 0, 50, 0, 50, 40], [0, 0, 50, 0, 50, 40]])).toEqual([])
  })
})

describe('fitText', () => {
  it('keeps a line that fits and cuts one that does not, with an ellipsis', () => {
    // 10 characters, 0.5 px wide per px of font size each: 50 px wide at 10 px.
    expect(fitText('0123456789', 5, 50, 10)).toBe('0123456789')
    expect(fitText('0123456789', 5, 30, 10)).toBe('01234…')
    expect(fitText('0123456789', 5, 30, 10).length).toBeLessThanOrEqual(6)
    // A title sized to fill its room exactly is not cut by a rounding error.
    expect(fitText('Eras and rankings', 7.9775, 171.2 - 1e-9, 21.46)).toBe('Eras and rankings')
  })
})

describe('titlePx', () => {
  it('shrinks a long name a little before cutting it, so siblings read near one size', () => {
    // Fits at the level's size: the level's size.
    expect(titlePx(20, 200, 8)).toBe(20)
    // Too wide: shrinks to fit, down to 0.85 of the level's size, then is cut.
    expect(titlePx(20, 300, 16)).toBe(18.75)
    expect(titlePx(20, 200, 16)).toBe(17)
    // Never below 9 px when the level allows it.
    expect(titlePx(10, 50, 16)).toBe(9)
    // A small level never grows to the 9 px floor.
    expect(titlePx(7, 30, 16)).toBe(7)
  })
})

describe('glyphOf', () => {
  const g = (kind: string, shape = 'rectangle') => glyphOf({ kind, shape })

  it('reads people and stores from the shape first', () => {
    expect([g('actor', 'person'), g('staff', 'person'), g('db-table', 'storage'), g('queue', 'queue'), g('spa', 'browser'), g('mobileApp', 'mobile')])
      .toEqual(['person', 'person', 'database', 'queue', 'browser', 'mobile'])
  })

  it('matches map kinds and sample vocabularies by name', () => {
    expect([g('app'), g('service'), g('container'), g('system'), g('softwaresystem'), g('existingsystem'), g('external-system'), g('library'), g('component'), g('code')])
      .toEqual(['app', 'app', 'app', 'system', 'system', 'external', 'external', 'library', 'component', 'code'])
    expect(g('unknown-kind')).toBeNull()
  })
})

describe('code view', () => {
  it('keeps every box showing its minimap when boxes trade files', () => {
    // Just enough DOM: an element knows its parent, and appending moves a child.
    class Node { parentElement: Node | null = null; kids: Node[] = []
      append(c: Node) { c.remove(); c.parentElement = this; this.kids.push(c) }
      remove() { const p = this.parentElement; if (p) p.kids = p.kids.filter(k => k !== this); this.parentElement = null }
      replaceChildren() {} }
    const box = () => ({ wrap: new Node(), pre: new Node(), map: null, key: '', win: null }) as unknown as Parameters<typeof holdMinimap>[0]
    const [a, b] = [box(), box()]
    const [x, y, z] = [new Node(), new Node(), new Node()] as unknown as HTMLCanvasElement[]
    holdMinimap(a, x); holdMinimap(b, y)
    // The view moves: box a now shows y's file and box b shows z's. Box b must not take y back out of a.
    holdMinimap(a, y); holdMinimap(b, z)
    expect(y.parentElement).toBe(a.wrap)
    expect(z.parentElement).toBe(b.wrap)
    // And a box whose canvas was taken gets it back once it shows that file again.
    holdMinimap(b, y); holdMinimap(a, y)
    expect(y.parentElement).toBe(a.wrap)
  })

  it('collects cited lines per file, ranges included', () => {
    const t = new Tree({
      name: 'm', elements: [el('a', null), el('b', null)],
      relations: [{ source: 'a', target: 'b', title: '', evidence: [{ at: 'src/a.ts:3', line: 3, code: '' }, { at: 'src/a.ts:7-8', line: 7, code: '' }, { at: 'gone.ts:1', line: 1, code: null }] }],
    })
    const c = citedLines(t)
    expect([...c.get('src/a.ts')!]).toEqual([3, 7, 8])
    expect(c.has('gone.ts')).toBe(true)
  })

  it('numbers lines, marks cited ones and escapes markup', () => {
    expect(splitLines('a < b\r\n\tx\n\nc\n')).toEqual(['a < b', '  x', '', 'c'])
    expect(lineHtml(3, 2, [['', 'a < b']], true)).toBe('<span class="cited"><i> 3</i>a &lt; b</span>')
    expect(lineHtml(4, 1, [], false)).toBe('<span><i>4</i> </span>')
  })

  it('colours code and tags the lines the graph marked', () => {
    const html = lineHtml(1, 1, tokenize("const x = fetch('/a') // go", 'c', { open: '', close: '' }), false, parseMarks('1:call').get(1))
    expect(html).toContain('<span class="mark">')
    expect(html).toContain('<em class="kw">const</em>')
    expect(html).toContain(`<em class="str">'/a'</em>`)
    expect(html).toContain('<em class="com">// go</em>')
    expect(html).toContain('<b>call</b>')
    expect([...parseMarks('3:route 3:store 9:call')]).toEqual([[3, ['route', 'store']], [9, ['call']]])
  })

  it('puts only the lines in view, and a margin, in the page', () => {
    // 40-character lines: a column pitch of (40 + 4) × 9.6 = 422.4 px; lines 23.2 px apart.
    // A view of the second column, rows 10 to 20, of a 4-column file with 100 rows each.
    const w = viewWindow(430, 840, 232, 464, 40, 4, 100)
    expect(w).toEqual({ c0: 1, c1: 1, r0: 10, r1: 20 })
    // The margin widens it by half the view each way, clamped to the file.
    expect(viewWindow(430, 840, 232, 464, 40, 4, 100, 0.5)).toEqual({ c0: 0, c1: 2, r0: 5, r1: 25 })
    expect(viewWindow(0, 1e6, 0, 1e6, 40, 4, 100, 0.5)).toEqual({ c0: 0, c1: 3, r0: 0, r1: 100 })
  })
})

describe('tokenize', () => {
  const run = (lines: string[], lang: 'c' | 'py') => { const st: LineState = { open: '', close: '' }; return lines.map(l => tokenize(l, lang, st)) }

  it('reads comments, strings, numbers, keywords and type names', () => {
    expect(run(['func (db *DB) Open() error { return 42 } // ok'], 'c')[0]).toEqual([
      ['kw', 'func'], ['', ' (db *DB) '], ['ty', 'Open'], ['', '() error { '], ['kw', 'return'], ['', ' '], ['num', '42'], ['', ' } '], ['com', '// ok'],
    ])
  })

  it('carries block comments and multi-line strings to the next line', () => {
    const [a, b] = run(['x = 1 /* start', 'end */ y'], 'c')
    expect(a[a.length - 1]).toEqual(['com', '/* start'])
    expect(b[0]).toEqual(['com', 'end */'])
    const [p, q] = run(['s = """doc', 'more""" # note'], 'py')
    expect(p[p.length - 1]).toEqual(['str', '"""doc'])
    expect(q).toEqual([['str', 'more"""'], ['', ' '], ['com', '# note']])
  })

  it('picks the language from the file name', () => {
    expect([langOf('a/b.tsx'), langOf('main.go'), langOf('app/api.py'), langOf('index.html')]).toEqual(['c', 'c', 'py', 'plain'])
  })

  it('fits the whole file into the box, clipping only very long lines', () => {
    // A tall narrow box: one column, height decides. 100 lines in 1450 px is 10 px.
    expect(codeLayout(100, 40, 240, 1450)).toEqual({ columns: 1, px: 10 })
    // One very long line counts as 120 characters: width decides.
    expect(codeLayout(1, 5000, 720, 1e6).px).toBeCloseTo(10)
  })

  it('flows a long file into columns when the box is wide', () => {
    // 300 lines of 40 characters in a 1600 × 600 box: columns beat one tall strip.
    const one = Math.min(600 / (300 * 1.45), 1600 / (40 * 0.6))
    const r = codeLayout(300, 40, 1600, 600)
    expect(r.columns).toBeGreaterThan(1)
    expect(r.px).toBeGreaterThan(one * 2)
  })
})

describe('zoom ceiling', () => {
  const settle = (cam: Camera) => { for (let t = 0; t < 3000; t += 16) cam.step(t, 16) }

  it('stops wheeling in at the ceiling, never out', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 1)
    for (let k = 0; k < 20; k++) cam.zoomAt(500, 300, 2, 8)
    settle(cam)
    expect(cam.z).toBeCloseTo(8, 6)
    cam.zoomAt(500, 300, 0.5, 8)
    settle(cam)
    expect(cam.z).toBeCloseTo(4, 6)
  })

  it('does not pull back when the ceiling is below where the camera already is', () => {
    const cam = new Camera()
    cam.resize(1000, 600)
    cam.set(0, 0, 50)
    cam.zoomAt(500, 300, 2, 8)
    settle(cam)
    expect(cam.z).toBeCloseTo(50, 6)
  })
})

describe('linePoint', () => {
  it('puts a line where the code view draws it, at the layout font size', () => {
    // A 2400 × 1500 card holding 300 lines of 40 characters.
    const box = codeBox(0, 0, 2400, 1500)
    const { columns, px } = codeLayout(300, 40, box.w, box.h)
    const first = linePoint(0, 0, 2400, 1500, 300, 40, 1)
    expect(first.font).toBeCloseTo(px)
    expect(first.y).toBeCloseTo(box.y + 0.5 * 23.2 * (px / 16))
    const per = Math.ceil(300 / columns)
    // The first line of the second column is level with line 1, one column pitch to the right.
    const next = linePoint(0, 0, 2400, 1500, 300, 40, per + 1)
    expect(next.y).toBeCloseTo(first.y)
    expect(next.x - first.x).toBeCloseTo((40 + 4) * 9.6 * (px / 16))
    // Lines past the end clamp to the last.
    expect(linePoint(0, 0, 2400, 1500, 300, 40, 9999)).toEqual(linePoint(0, 0, 2400, 1500, 300, 40, 300))
  })
})

describe('relation kinds', () => {
  const m: ModelJson = {
    name: 'k',
    elements: [el('a', null), el('b', null), el('c', null)],
    relations: [
      { source: 'a', target: 'b', title: 'Item', kind: 'types' },
      { source: 'a', target: 'b', title: 'load', kind: 'code', lines: [3, 9] },
      { source: 'b', target: 'c', title: 'GET /x', evidence: [{ at: 'b.ts:4', line: 4, code: 'fetch()' }] },
      { source: 'c', target: 'a', title: 'Shape', kind: 'types' },
    ],
  }
  it('leaves type-only imports out unless asked, and reads an old link with evidence as runtime', () => {
    const t = new Tree(m)
    expect(t.relKind).toEqual(['code', 'runtime'])
    expect(t.relLines).toEqual([[3, 9], []])
    expect(new Tree(m, { types: true }).relKind).toEqual(['types', 'code', 'runtime', 'types'])
  })
  it('marks an edge runtime if any relation is, and types-only if every one is', () => {
    const t = new Tree(m, { types: true })
    const e = aggregateEdges(t, i => i)
    const at = (a: string, b: string) => e.find(x => t.els[x.s].id === a && t.els[x.t].id === b)!
    expect([at('a', 'b').runtime, at('a', 'b').typesOnly]).toEqual([false, false])
    expect(at('b', 'c').runtime).toBe(true)
    expect(at('c', 'a').typesOnly).toBe(true)
  })
})

describe('dashes', () => {
  it('cuts a line into dashes and gaps along its whole length, round corners too', () => {
    const d = dashes([0, 0, 20, 0, 20, 10], 7, 5)
    expect(d.length).toBe(3)
    expect(d[0]).toEqual([0, 0, 7, 0])
    expect(d[1]).toEqual([12, 0, 19, 0])
    expect(d[2]).toEqual([20, 4, 20, 10])
  })
})

describe('lanePlace', () => {
  it('puts the types a request names on short rows of their own, after its branches', () => {
    // Four steps, two branches (full height), two types (short).
    const children = [1, 2, 3, 4, 5, 6, 7, 8]
    const lane = [0, 1, 2, 3, -1, -1, -1, -1]
    const heights = [CARD_H, CARD_H, CARD_H, CARD_H, CARD_H, CARD_H, TYPE_H, TYPE_H]
    const { pos } = lanePlace({ id: 0, children, spans: children.map(() => 1), heights, headed: children.map(() => false), edges: [], lane })
    const row = (k: number) => pos[k * 2 + 1]
    expect(row(4)).toBe(row(5))
    expect(row(6)).toBe(row(7))
    expect(row(6)).toBeGreaterThan(row(4))
    // The branches' row is a full card tall; the types' row starts right after it.
    expect(row(6) - row(4)).toBe(CARD_H + GUTTER)
  })
})

describe('breaks', () => {
  it('breaks a title at its word gaps, or its longest CamelCase word at each hump, nearest the middle first', () => {
    expect(breaks('3 · KingdomReadRepository')).toEqual(['3 · KingdomReadRepository', '3 · KingdomRead Repository', '3 · Kingdom ReadRepository'])
    expect(breaks('MarketTransactionTimeRangeAveragesJpaRepository')[0]).toBe('MarketTransactionTime RangeAveragesJpaRepository')
    expect(breaks('short Words only')).toEqual(['short Words only'])
    expect(breaks('lowercaseonlyverylongword')).toEqual([])
    expect(breaks('')).toEqual([])
    expect(breaks('ÄnderungsÜbersicht2Plan')).toEqual(['Änderungs Übersicht2Plan', 'ÄnderungsÜbersicht2 Plan'])
    // A letter outside the BMP is two UTF-16 units: the break goes after both.
    expect(breaks('Long𐐨Repository')).toEqual(['Long𐐨 Repository'])
  })
})
