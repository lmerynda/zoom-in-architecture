import { describe, expect, it } from 'vitest'
import { Camera, flight } from './camera'
import { CARD_H, CARD_W, cardH, cardW, contentBox, placeWorld, spans, type LocalLayout } from './layout'
import { aggregateEdges, Tree, type ModelJson } from './model'
import { citedLines, codeHtml, codeLayout, parseMarks } from './code'
import { langOf, tokenize, type LineState } from './syntax'
import { glyphOf } from './icons'
import { clipToScreen, fitText, junctions, shortText } from './render'
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
    const r = codeHtml('a < b\n\nc\n', { cited: new Set([3]) })
    expect(r.lines).toBe(3)
    expect(r.html).toBe('<div style="width:384px"><span><i>1</i>a &lt; b</span><span><i>2</i> </span><span class="cited"><i>3</i>c</span></div>')
    expect(codeHtml(['1', '2', '3', '4', '5'].join(String.fromCharCode(10)), {}, 2).html.match(/<div/g)).toHaveLength(2)
  })

  it('colours code and tags the lines the graph marked', () => {
    const r = codeHtml("const x = fetch('/a') // go", { marks: parseMarks('1:call'), lang: 'c' })
    expect(r.html).toContain('<span class="mark">')
    expect(r.html).toContain('<em class="kw">const</em>')
    expect(r.html).toContain(`<em class="str">'/a'</em>`)
    expect(r.html).toContain('<em class="com">// go</em>')
    expect(r.html).toContain('<b>call</b>')
    expect([...parseMarks('3:route 3:store 9:call')]).toEqual([[3, ['route', 'store']], [9, ['call']]])
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
