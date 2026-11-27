import { describe, expect, it } from 'vitest'
import { Tree, type ModelJson, type RelKind } from './model'
import { COUPLING_MIN, findProblem, findProblems, isEntry, judgedRelations, MAX_COUPLINGS, namedLayer, problemKey, problemLine, problemsAt, ringCuts, sccs } from './problems'

/** A part (with children) or a file (with a path), titled by the last word of its id unless given. */
const part = (id: string, title?: string, extra = {}) => ({ id, parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null, title: title ?? id.split('.').pop()!, kind: 'component', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle', ...extra })
const file = (id: string, title?: string) => part(id, title, { kind: 'code', metadata: { path: `src/${id.replace(/\./g, '/')}.ts` } })
/** n relations from a to b, of a kind; each a distinct pair of files when the ends hold several. */
const uses = (a: string, b: string, n = 1, kind: RelKind = 'code') => Array.from({ length: n }, () => ({ source: a, target: b, title: b.split('.').pop()!, kind }))
const build = (elements: ReturnType<typeof part>[], relations: ReturnType<typeof uses>) => new Tree({ name: 'm', elements, relations } as ModelJson)
const titles = (t: Tree, r: ReturnType<typeof findProblems>) => r.list.map(p => `${p.kind}:${p.title}`)

/** Two sibling parts under an app, each with one file. */
const pair = (aTitle = 'Billing', bTitle = 'Orders') => [part('app'), part('app.a', aTitle), file('app.a.x', 'X'), part('app.b', bTitle), file('app.b.y', 'Y')]

describe('findProblems: cycles', () => {
  it('finds nothing on an empty map, or one with no relations', () => {
    expect(findProblems(build([], [])).list).toEqual([])
    expect(findProblems(build(pair(), [])).list).toEqual([])
  })

  it('names the lighter way of two parts using each other as the one to cut', () => {
    const t = build(pair(), [...uses('app.a.x', 'app.b.y', 9), ...uses('app.b.y', 'app.a.x', 1)])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['cycle:Orders → Billing'])
    const p = r.list[0]
    expect([p.a, p.b]).toEqual([t.byId.get('app.b'), t.byId.get('app.a')])
    expect(p.rels).toHaveLength(1)
    expect(p.level).toBe(t.byId.get('app'))
    expect(p.why).toContain('1 use this way against 9 the other')
  })

  it('calls two parts using each other about equally a tangle, both ways suspect', () => {
    const t = build(pair(), [...uses('app.a.x', 'app.b.y', 3), ...uses('app.b.y', 'app.a.x', 2)])
    const r = findProblems(t)
    expect(r.list).toHaveLength(1)
    expect(r.list[0].title).toBe('Billing ↔ Orders')
    expect(r.list[0].rels).toHaveLength(5)
    expect(r.list[0].why).toContain('tangle')
  })

  it('leaves files of one part using each other alone: that is the part holding together', () => {
    const t = build([part('app'), file('app.x'), file('app.y')], [...uses('app.x', 'app.y'), ...uses('app.y', 'app.x')])
    expect(findProblems(t).list).toEqual([])
  })

  it('finds a ring of three and the use that closes it, with the ring in order', () => {
    const els = [part('app'), ...['a', 'b', 'c'].flatMap(k => [part(`app.${k}`, k.toUpperCase()), file(`app.${k}.f`, `${k}F`)])]
    const t = build(els, [...uses('app.a.f', 'app.b.f', 5), ...uses('app.b.f', 'app.c.f', 5), ...uses('app.c.f', 'app.a.f', 1)])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['cycle:C → A'])
    expect(r.list[0].ring!.map(i => t.els[i].title)).toEqual(['C', 'A', 'B', 'C'])
    expect(r.list[0].why).toContain('ring of 3')
    expect(problemLine(t, r.list[0], t.byId.get('app')!)).toBe('Cycle · ring of 3 · 1 use')
  })

  it('does not judge an entry file’s wiring, calls at runtime or type-only imports', () => {
    const els = [part('app'), part('app.shell', 'Shell'), file('app.shell.main', 'main'), file('app.shell.errors', 'Errors'), part('app.cmd', 'Commands'), file('app.cmd.run', 'Run')]
    const wiring = build(els, [...uses('app.shell.main', 'app.cmd.run'), ...uses('app.cmd.run', 'app.shell.errors', 4)])
    expect(findProblems(wiring).list).toEqual([])
    const runtime = build(pair(), [...uses('app.a.x', 'app.b.y', 4), ...uses('app.b.y', 'app.a.x', 1, 'runtime')])
    expect(findProblems(runtime).list).toEqual([])
    const typed = new Tree({ name: 'm', elements: pair(), relations: [...uses('app.a.x', 'app.b.y', 4), ...uses('app.b.y', 'app.a.x', 1, 'types')] } as ModelJson, { types: true })
    expect(findProblems(typed).list).toEqual([])
  })

  it('lists the clearest cycles first: a few uses against many before an even pair', () => {
    const els = [part('app'), ...['a', 'b', 'c', 'd'].flatMap(k => [part(`app.${k}`, k.toUpperCase()), file(`app.${k}.f`, `${k}F`)])]
    const t = build(els, [
      ...uses('app.a.f', 'app.b.f', 3), ...uses('app.b.f', 'app.a.f', 1),
      ...uses('app.c.f', 'app.d.f', 12), ...uses('app.d.f', 'app.c.f', 1),
    ])
    expect(titles(t, findProblems(t))).toEqual(['cycle:D → C', 'cycle:B → A'])
  })
})

describe('findProblems: against the grain', () => {
  const layered = [part('app'), part('app.store', 'Kingdom state and storage'), file('app.store.e', 'KingdomEntity'), file('app.store.t', 'KingdomTurn'),
    part('app.war', 'War'), file('app.war.svc', 'ArmyService'), file('app.war.kind', 'AttackType'), part('app.api', 'Kingdom API'), file('app.api.c', 'KingdomController')]

  it('flags a store reaching into a feature that names itself, said once between the two parts', () => {
    const t = build(layered, [...uses('app.store.e', 'app.war.svc', 2), ...uses('app.store.t', 'app.war.svc')])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['grain:Kingdom state and storage → War'])
    expect(r.list[0].rels).toHaveLength(3)
    expect(r.list[0].why).toBe('A model or store using a feature: 3 uses against the grain.')
  })

  it('does not guess: a target whose file and parts name no layer is not judged', () => {
    expect(findProblems(build(layered, uses('app.store.e', 'app.war.kind', 3))).list).toEqual([])
  })

  it('judges a feature using the front only where a part names the front', () => {
    const els = [...layered, part('app.game', 'Game loop'), file('app.game.c', 'SessionController')]
    expect(findProblems(build(els, uses('app.war.svc', 'app.game.c'))).list).toEqual([])
    const t = build(els, uses('app.war.svc', 'app.api.c'))
    expect(findProblems(t).list.map(p => p.why)).toEqual(['A feature using the API or UI in front: 1 use against the grain.'])
  })

  it('gives each reason when one pair holds uses of two kinds', () => {
    const els = [part('app'), part('app.low', 'Low'), file('app.low.h', 'MathHelpers'), file('app.low.s', 'OrderStore'), part('app.up', 'Up'), file('app.up.svc', 'OrderService'), file('app.up.c', 'OrderController')]
    const mixed = build(els, [...uses('app.low.h', 'app.up.svc'), ...uses('app.low.s', 'app.up.c')])
    expect(findProblems(mixed).list.map(p => p.why)).toEqual(['A shared part using a feature (1), a model or store using the API or UI in front (1): 2 uses against the grain.'])
  })

  it('flags a store using the API in front of it', () => {
    const t = build(layered, uses('app.store.e', 'app.api.c'))
    expect(titles(t, findProblems(t))).toEqual(['grain:Kingdom state and storage → Kingdom API'])
  })

  it('does not take an unnamed file for a feature: a DTO naming an enum beside it is fine', () => {
    const t = build([part('app'), part('app.war', 'War'), file('app.war.dto', 'AttackDto'), file('app.war.kind', 'AttackType'), file('app.war.svc', 'AttackService')],
      uses('app.war.dto', 'app.war.kind'))
    expect(findProblems(t).list).toEqual([])
    // A file that names its layer is judged against one that names a higher one.
    const up = build([part('app'), part('app.war', 'War'), file('app.war.dto', 'AttackDto'), file('app.war.svc', 'AttackService')], uses('app.war.dto', 'app.war.svc'))
    expect(titles(up, findProblems(up))).toEqual(['grain:AttackDto → AttackService'])
  })

  it('keeps shared parts and models one band: a config naming a DTO is not against the grain', () => {
    const t = build([part('app'), part('app.cfg', 'Balance config'), file('app.cfg.c', 'Costs'), part('app.m', 'Shared model'), file('app.m.d', 'UnitsDto')], uses('app.cfg.c', 'app.m.d'))
    expect(findProblems(t).list).toEqual([])
  })

  it('says a use against the grain that closes a cycle once, on the cycle', () => {
    const t = build(layered, [...uses('app.war.svc', 'app.store.e', 6), ...uses('app.store.e', 'app.war.svc')])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['cycle:Kingdom state and storage → War'])
    expect(r.list[0].why).toContain('It also runs against the grain: a model or store using a feature.')
  })

  it('counts the parts whose names say a layer and those that do not', () => {
    const r = findProblems(build(layered, []))
    // app and War name none; the store and the API do.
    expect([r.layered, r.unlayered]).toEqual([2, 2])
  })
})

describe('findProblems: heaviest couplings', () => {
  const many = (k: number) => [part('app'), ...Array.from({ length: k }, (_, j) => [part(`app.p${j}`, `Part ${j}`), file(`app.p${j}.f`, `F${j}`)]).flat()]

  it(`lists a pair from ${COUPLING_MIN} uses, not below, heaviest first by count (12 before 10)`, () => {
    const t = build(many(4), [...uses('app.p0.f', 'app.p1.f', COUPLING_MIN - 1), ...uses('app.p2.f', 'app.p3.f', COUPLING_MIN), ...uses('app.p1.f', 'app.p2.f', 12)])
    expect(titles(t, findProblems(t))).toEqual(['coupling:Part 1 → Part 2', 'coupling:Part 2 → Part 3'])
  })

  it(`lists at most ${MAX_COUPLINGS}`, () => {
    const rels = Array.from({ length: 7 }, (_, j) => uses(`app.p${j}.f`, `app.p${j + 1}.f`, 20 + j)).flat()
    expect(findProblems(build(many(8), rels)).list.filter(p => p.kind === 'coupling')).toHaveLength(MAX_COUPLINGS)
  })

  it('leaves a pair to the nested pair that carries most of it', () => {
    const els = [part('app'), part('app.a', 'A'), part('app.a.in', 'A inner'), file('app.a.in.f', 'Af'), part('app.b', 'B'), part('app.b.in', 'B inner'), file('app.b.in.f', 'Bf')]
    const t = build(els, uses('app.a.in.f', 'app.b.in.f', 15))
    // The rolled-up pair A → B carries the same 15 as A inner → B inner, which is not siblings: A → B stays.
    expect(titles(t, findProblems(t))).toEqual(['coupling:A → B'])
  })

  it('says a coupling that is also a cycle on the cycle’s row', () => {
    const t = build(pair(), [...uses('app.a.x', 'app.b.y', 30), ...uses('app.b.y', 'app.a.x', 2)])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['cycle:Orders → Billing'])
    expect(r.list[0].why).toContain('One of the 5 heaviest couplings: 32 uses in all.')
  })
})

describe('layers from names', () => {
  const t = build([
    part('a', 'Kingdom state and storage'), part('a.f', 'x'), part('b', 'API client'), part('b.f', 'x'), part('c', 'Kingdom API'), part('c.f', 'x'),
    part('d', 'Données et état'), part('d.f', 'x'), part('e', 'Data and API'), part('e.f', 'x'), part('g', 'UI kit'), part('g.f', 'x'),
    part('h', 'Game database', { kind: 'database' }), part('h.f', 'x'),
    file('z.KingdomEntity'), file('z.ChatPresentationModel'), file('z.MarketService'), file('z.AuthController'), file('z.AttackType'),
  ].map(e => (e.id.startsWith('z.') ? { ...e, parent: null } : e)), [])
  const at = (id: string) => namedLayer(t, t.byId.get(id)!)

  it('reads a part’s title, its kind, and a file’s last word', () => {
    expect(['a', 'b', 'c', 'g', 'h'].map(at)).toEqual(['data', 'data', 'edge', 'shared', 'data'])
    expect(['z.KingdomEntity', 'z.ChatPresentationModel', 'z.MarketService', 'z.AuthController', 'z.AttackType'].map(at)).toEqual(['data', 'edge', 'feature', 'edge', null])
  })

  it('says nothing for a title in other words, or one naming a low and a high layer', () => {
    expect([at('d'), at('e')]).toEqual([null, null])
  })
})

describe('entry files, order and scope', () => {
  it('knows an entry file by its name', () => {
    const t = build([file('Program'), file('main'), file('index'), file('App'), file('GameApplication'), file('Programs'), file('domain')].map(e => ({ ...e, parent: null })), [])
    // index.ts is a module's front, not a program's start: it is judged like any file.
    expect(t.els.slice(1).map((_, k) => isEntry(t, k + 1))).toEqual([true, true, false, true, true, false, false])
  })

  it('cuts a ring at its lightest use, and two rings sharing a use at that use alone', () => {
    const ring = [new Map([[1, 5]]), new Map([[2, 5]]), new Map([[0, 1]])]
    expect(ringCuts([0, 1, 2], ring)).toEqual([[2, 0]])
    expect(ring[2].get(0)).toBe(1)
    // 0 → 1 → 2 → 0 and 0 → 1 → 3 → 0 share 0 → 1: cutting it (2) beats cutting both ways back (3 + 3).
    const two = [new Map([[1, 2]]), new Map([[2, 9], [3, 9]]), new Map([[0, 3]]), new Map([[0, 3]])]
    expect(ringCuts([0, 1, 2, 3], two)).toEqual([[0, 1]])
  })

  it('finds a problem again by what it is: a tangle either way round, a one-way cycle only its own way', () => {
    const tangle = build(pair(), [...uses('app.a.x', 'app.b.y', 4), ...uses('app.b.y', 'app.a.x', 4)])
    const flipped = build(pair(), [...uses('app.a.x', 'app.b.y', 4), ...uses('app.b.y', 'app.a.x', 5)])
    const key = problemKey(tangle, findProblems(tangle).list[0])
    expect(key.both).toBe(true)
    expect(findProblem(flipped, findProblems(flipped), key)).toBe(0)
    const one = build(pair(), [...uses('app.a.x', 'app.b.y', 9), ...uses('app.b.y', 'app.a.x', 1)])
    const other = build(pair(), [...uses('app.a.x', 'app.b.y', 1), ...uses('app.b.y', 'app.a.x', 9)])
    const k1 = problemKey(one, findProblems(one).list[0])
    expect(findProblem(one, findProblems(one), k1)).toBe(0)
    expect(findProblem(other, findProblems(other), k1)).toBe(-1)
    expect(findProblem(one, findProblems(one), null)).toBe(-1)
  })

  it('does not take a tangle for the ring it replaced between the same two parts', () => {
    const ks = ['a', 'b', 'c']
    const els = [part('app'), ...ks.flatMap(k => [part(`app.${k}`, k.toUpperCase()), file(`app.${k}.f`, `${k}F`)])]
    const ring = build(els, [...uses('app.a.f', 'app.b.f', 5), ...uses('app.b.f', 'app.c.f', 5), ...uses('app.c.f', 'app.a.f', 2)])
    const key = problemKey(ring, findProblems(ring).list[0])
    expect(key.ring).toBe('app.c>app.a>app.b>app.c')
    // A use back from A to C makes C and A a tangle: the ring is gone, not found as the tangle.
    const tangled = build(els, [...uses('app.a.f', 'app.b.f', 5), ...uses('app.b.f', 'app.c.f', 5), ...uses('app.c.f', 'app.a.f', 2), ...uses('app.a.f', 'app.c.f', 2)])
    expect(findProblems(tangled).list.map(p => p.title)).toEqual(['C ↔ A'])
    expect(findProblem(tangled, findProblems(tangled), key)).toBe(-1)
  })

  it('lists at a place the problems at or under it', () => {
    const els = [part('top'), part('top.app'), part('top.app.a', 'A'), file('top.app.a.f', 'Af'), part('top.app.b', 'B'), file('top.app.b.f', 'Bf'), part('other'), file('other.f', 'Of')]
    const t = build(els, [...uses('top.app.a.f', 'top.app.b.f', 4), ...uses('top.app.b.f', 'top.app.a.f', 1)])
    const r = findProblems(t)
    expect(problemsAt(t, r, 0)).toEqual([0])
    expect(problemsAt(t, r, t.byId.get('top')!)).toEqual([0])
    expect(problemsAt(t, r, t.byId.get('other')!)).toEqual([])
    expect(problemLine(t, r.list[0], 0)).toBe('Cycle · 1 use · in app')
  })
})

/** Per level, the rings of parts still using each other once every relation a cycle flags is cut. */
function ringsLeft(t: Tree, r: ReturnType<typeof findProblems>): string[] {
  const cut = new Set(r.list.filter(p => p.kind === 'cycle').flatMap(p => p.rels))
  const levels = new Map<number, Map<number, number>[]>()
  for (const k of judgedRelations(t)) {
    if (cut.has(k)) continue
    const s = t.rels[k * 2], u = t.rels[k * 2 + 1], c = t.lca(s, u), kids = t.children[c]
    const a = kids.indexOf(t.childUnder(c, s)), b = kids.indexOf(t.childUnder(c, u))
    if (t.els[kids[a]].metadata?.path || t.els[kids[b]].metadata?.path) continue
    const adj = levels.get(c) ?? kids.map(() => new Map<number, number>())
    levels.set(c, adj)
    adj[a].set(b, 1)
  }
  return [...levels].flatMap(([c, adj]) => sccs(adj.length, adj).map(ring => `${t.els[c].title}: ${ring.map(j => t.els[t.children[c][j]].title).join(', ')}`))
}

describe('findProblems: what the flags leave', () => {
  const parts = (ks: string[]) => [part('app'), ...ks.flatMap(k => [part(`app.${k}`, k.toUpperCase()), file(`app.${k}.f`, `${k}F`)])]

  it('finds a ring left once a pair’s lighter way is cut', () => {
    const t = build(parts(['a', 'b', 'c']), [...uses('app.a.f', 'app.b.f', 5), ...uses('app.b.f', 'app.a.f', 1), ...uses('app.b.f', 'app.c.f', 5), ...uses('app.c.f', 'app.a.f', 5)])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['cycle:B → A', 'cycle:C → A'])
    expect(ringsLeft(t, r)).toEqual([])
  })

  it('flags one use for a simple ring, however its weights fall', () => {
    const t = build(parts(['a', 'b', 'c', 'd']), [...uses('app.a.f', 'app.b.f', 5), ...uses('app.b.f', 'app.c.f', 9), ...uses('app.c.f', 'app.d.f', 1), ...uses('app.d.f', 'app.a.f', 5)])
    const r = findProblems(t)
    expect(titles(t, r)).toEqual(['cycle:C → D'])
    expect(r.list[0].ring!.map(i => t.els[i].title)).toEqual(['C', 'D', 'A', 'B', 'C'])
  })

  it('leaves no ring on random maps once every flagged use is cut (seeded)', () => {
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const ks = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    for (let trial = 0; trial < 40; trial++) {
      const rels = ks.flatMap(x => ks.flatMap(y => (x !== y && rand() < 0.3 ? uses(`app.${x}.f`, `app.${y}.f`, 1 + Math.floor(rand() * 6)) : [])))
      const t = build(parts(ks), rels)
      expect(ringsLeft(t, findProblems(t)), `trial ${trial}`).toEqual([])
    }
  })

  it('opens a map whose parts chain 10,000 deep without overflowing the stack', () => {
    const n = 10_000
    const els = [part('app'), ...Array.from({ length: n }, (_, j) => [part(`app.p${j}`, `P${j}`), file(`app.p${j}.f`, `F${j}`)]).flat()]
    const t = build(els, Array.from({ length: n - 1 }, (_, j) => uses(`app.p${j}.f`, `app.p${j + 1}.f`)).flat())
    expect(findProblems(t).list).toEqual([])
    const adj = Array.from({ length: n }, (_, j) => new Map([[(j + 1) % n, 1]]))
    expect(sccs(n, adj)[0]).toHaveLength(n)
  })

  it('does not judge a link drawn between parts, only a file’s use of a file', () => {
    const t = build([part('app'), part('app.a', 'A'), part('app.b', 'B')], [...uses('app.a', 'app.b', 12), ...uses('app.b', 'app.a', 1)])
    expect(findProblems(t).list).toEqual([])
  })

  it('names the heaviest couplings five at most, counting those said on a cycle', () => {
    const ks = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const rels = ks.slice(0, -1).flatMap((x, j) => uses(`app.${x}.f`, `app.${ks[j + 1]}.f`, 20 + j))
    const r = findProblems(build(parts(ks), [...rels, ...uses('app.g.f', 'app.f.f', 1)]))
    const named = r.list.filter(p => p.kind === 'coupling' || /heaviest couplings/.test(p.why)).length
    expect(named).toBe(MAX_COUPLINGS)
    expect(r.list[0].title).toBe('G → F')
    expect(r.list[0].why).toContain('One of the 5 heaviest couplings: 26 uses in all.')
  })

  it('leaves an entry file’s wiring out of couplings too', () => {
    const els = [part('app'), part('app.shell', 'Shell'), file('app.shell.main', 'main'), part('app.cmd', 'Commands'), file('app.cmd.run', 'Run')]
    expect(findProblems(build(els, uses('app.shell.main', 'app.cmd.run', 30))).list).toEqual([])
  })

  it('takes errors for shared words: a model throwing the shell’s exceptions is not against the grain', () => {
    const els = [part('app'), part('app.shell', 'Command shell'), file('app.shell.x', 'ToolExceptions'), part('app.s', 'Sessions'), file('app.s.m', 'SessionModel')]
    expect(findProblems(build(els, uses('app.s.m', 'app.shell.x'))).list).toEqual([])
  })

  it('cuts a 10,000-part ring and a dense level of 51 parts quickly', () => {
    const n = 10_000
    const ring = Array.from({ length: n }, (_, j) => new Map([[(j + 1) % n, j === 7 ? 1 : 2]]))
    let t0 = performance.now()
    expect(ringCuts(Array.from({ length: n }, (_, j) => j), ring)).toEqual([[7, 8]])
    expect(performance.now() - t0).toBeLessThan(2000)
    // Every pair of 51 parts used one way or the other: 1,275 uses, many rings.
    const ks = Array.from({ length: 51 }, (_, j) => `p${j}`)
    const rels = ks.flatMap((x, i) => ks.slice(i + 1).map((y, j) => ((i + j) % 3 ? uses(`app.${x}.f`, `app.${y}.f`) : uses(`app.${y}.f`, `app.${x}.f`))[0]))
    t0 = performance.now()
    const t = build(parts(ks), rels)
    const r = findProblems(t)
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(ringsLeft(t, r)).toEqual([])
  })
})
