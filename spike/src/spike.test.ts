import { describe, expect, it } from 'vitest'
import { Camera, flight } from './camera'
import { CARD_H, CARD_W, cardH, cardW, contentBox, placeWorld, spans, type LocalLayout } from './layout'
import { aggregateEdges, plainDoc, Tree, type ModelJson } from './model'
import { citedLines, codeBox, codeLayout, holdMinimap, lineHtml, linePoint, parseMarks, splitLines, viewWindow } from './code'
import { langOf, tokenize, type LineState } from './syntax'
import { glyphOf } from './icons'
import { clipToScreen, fitText, junctions, shortText, titlePx } from './render'
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
    local.set(0, { id: 0, w: 2000, h: 600, children: top, pos: top.flatMap((_, k) => [400 * k, 0]), spans: top.map(c => span[c]), routes: [] })
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
      local.set(i, { id: i, w: 300 * c.length, h: 200, children: c, pos: c.flatMap((_, k) => [24 + 300 * k, 24]), spans: c.map(() => 1), routes: [] })
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
  it('shrinks a long name before cutting it, down to a readable size', () => {
    // Fits at the level's size: the level's size.
    expect(titlePx(20, 200, 8)).toBe(20)
    // Too wide: shrinks to fit, below the 0.45 floor's pull only as far as 9 px.
    expect(titlePx(20, 200, 16)).toBe(12.5)
    expect(titlePx(20, 100, 16)).toBe(9)
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
