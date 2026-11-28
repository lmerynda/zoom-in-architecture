import { describe, expect, it } from 'vitest'
import { arrowSummary, arrowTitle, measureText, foldEvidence, kindWord, offPath, relationRows, seenText, tableRows } from './details'
import { Tree, type ModelJson } from './model'

const el = (id: string, parent: string | null, extra = {}) => ({ id, parent, title: id.split('.').pop()!, kind: 'component', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle', ...extra })
const model: ModelJson = {
  name: 'm',
  elements: [el('a', null), el('a.x', 'a'), el('a.y', 'a'), el('b', null), el('b.f', 'b', { metadata: { path: 'b/f.ts' } }), el('c', null)],
  relations: [],
}
const tree = new Tree(model)
const id = (s: string) => tree.byId.get(s)!

describe('relationRows', () => {
  it('lists a container’s relations one row per card at its own level, naming what they reach', () => {
    const rows = relationRows(tree, id('a'), [
      { other: id('b.f'), title: 'fetch' },
      { other: id('b'), title: 'uses' },
      { other: id('c'), title: 'calls', evidence: [{ at: 'a/x.ts:3', line: 3, code: 'c()' }] },
    ])
    // The linked row (with evidence) leads; every relation is in some row.
    expect(rows.map(r => tree.els[r.other].id)).toEqual(['c', 'b'])
    expect(rows[1].names).toEqual(['f'])
  })

  it('never drops a row, however many', () => {
    const many = Array.from({ length: 150 }, () => ({ other: id('c'), title: 'x' }))
    expect(relationRows(tree, id('b.f'), [...many, { other: id('a.x'), title: 'y' }]).length).toBe(2)
  })
})

describe('foldEvidence', () => {
  it('shows an identical excerpt once, with every place it stands', () => {
    const g = foldEvidence([
      { at: 'a.ts:1', line: 1, code: 'db.query()' },
      { at: 'b.ts:9', line: 9, code: '  db.query()' },
      { at: 'c.ts:4', line: 4, code: 'send()' },
    ])
    expect(g.map(x => [x.code?.trim(), x.at.length])).toEqual([['send()', 1], ['db.query()', 2]])
  })
})

describe('kindWord', () => {
  it('says what a card is in words', () => {
    expect(kindWord(tree, id('a'))).toBe('Component · 2 inside')
    expect(kindWord(tree, id('b.f'))).toBe('File')
  })
})

describe('seenText', () => {
  const traced = (elements: ModelJson['elements']) => new Tree({ name: 't', elements, relations: [], published: { at: '2026-11-20T10:00:00Z', traced: { at: '2026-11-20T10:00:00Z', command: 'gradle e2e', exit: 0, seen: 1, total: 2 } } })
  it('counts an endpoint in HTTP requests, statuses with separators', () => {
    const t = traced([el('ep', null, { metadata: { method: 'POST', route: '/buy', seen: '6675', statuses: '200 ×6670 · 401 ×5' } })])
    expect(seenText(t, t.byId.get('ep')!).lines).toEqual(['Seen in tests: 6,675 HTTP requests · 200 ×6,670 · 401 ×5'])
  })
  it('never gives a step its endpoint’s count', () => {
    const t = traced([el('ep', null, { metadata: { method: 'POST', route: '/buy', seen: '3' } }), el('ep.s', 'ep', { metadata: { role: 'step', step: '4', path: 'r.java', seen: '3' } })])
    expect(seenText(t, t.byId.get('ep.s')!).lines).toEqual(['Ran in tests: its code ran during this endpoint’s tested requests'])
  })
  it('says an endpoint no test called, and nothing on an untraced map', () => {
    const t = traced([el('ep', null, { metadata: { method: 'GET', route: '/x', seen: '0' } })])
    expect(seenText(t, t.byId.get('ep')!).unseen).toBe(true)
    expect(seenText(tree, id('b.f')).lines).toEqual([])
  })
  it('counts calls into a file’s code, one and many', () => {
    const t = traced([el('f', null, { metadata: { path: 'f.ts', seen: '1' } }), el('g', null, { metadata: { path: 'g.ts', seen: '1200' } })])
    expect([seenText(t, t.byId.get('f')!).lines, seenText(t, t.byId.get('g')!).lines]).toEqual([['Ran in tests: 1 call into its code'], ['Ran in tests: 1,200 calls into its code']])
  })
})

describe('tableRows', () => {
  it('lists each table with what was done to it, writes first, then by name', () => {
    expect(tableRows('user_entity: SELECT · kingdom_entity: SELECT, UPDATE · offer: DELETE, SELECT · ü_tabelle: MERGE')).toEqual([
      { table: 'kingdom_entity', ops: 'updates, reads' },
      { table: 'offer', ops: 'deletes, reads' },
      { table: 'ü_tabelle', ops: 'writes' },
      { table: 'user_entity', ops: 'reads' },
    ])
    expect(tableRows('')).toEqual([])
  })
})

describe('arrowTitle', () => {
  const t = new Tree({ name: 'm', elements: [el('a', null), el('a.x', 'a'), el('b', null), el('b.y', 'b')], relations: [{ source: 'a.x', target: 'b.y', title: 'uses' }, { source: 'b', target: 'a', title: 'calls' }] })
  const at = (s: string) => t.byId.get(s)!
  const k = (src: string) => [...Array(t.rels.length / 2).keys()].filter(i => t.els[t.rels[i * 2]].id === src)
  it('points one way when every relation runs one way, either order given', () => {
    expect(arrowTitle(t, at('a'), at('b'), k('a.x'))).toBe('a → b')
    expect(arrowTitle(t, at('a'), at('b'), k('b'))).toBe('b → a')
  })
  it('says ↔ only when both ways have a relation', () => {
    expect(arrowTitle(t, at('a'), at('b'), [...k('a.x'), ...k('b')])).toBe('a ↔ b')
    expect(arrowTitle(t, at('a'), at('b'), [])).toBe('a → b')
  })
})

describe('offPath', () => {
  it('names the tested tables no store call on the code path names', () => {
    expect(offPath(['kingdom_entity', 'market_offer_entity'], ['kingdoms (JPA)'])).toEqual(['market_offer_entity'])
    expect(offPath(['spy_report_entity', 'user_entity'], ['reads spy_report_entity · reads user_entity'])).toEqual([])
    expect(offPath(['orders'], [])).toEqual(['orders'])
    expect(offPath([], ['x'])).toEqual([])
  })
})

describe('store arrows: a mapped relation apart from what the trace measured', () => {
  const els = ['app', 'app.repo', 'app.ctl', 'db'].map(id => ({ id, parent: id.includes('.') ? 'app' : null, title: id, kind: id === 'db' ? 'database' : 'component', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' }))
  const model: ModelJson = {
    name: 'm',
    elements: els,
    relations: [
      { source: 'app.repo', target: 'db', title: 'offers', kind: 'runtime', via: 'JPA', evidence: [], seen: 3, seenOf: 'requests', tables: 'updates and reads offers' },
      { source: 'app.ctl', target: 'db', title: 'inserts offers', kind: 'runtime', seen: 1, seenOf: 'requests', tables: 'inserts offers', origin: 'trace' },
      { source: 'app.ctl', target: 'app.repo', title: 'OfferRepository' },
    ],
  }
  const tree = new Tree(model)

  it('carries what a count counts, the tables, and whether only the trace knows the link', () => {
    expect(tree.relSeenOf).toEqual(['requests', 'requests', ''])
    expect(tree.relTables).toEqual(['updates and reads offers', 'inserts offers', ''])
    expect(tree.relTraceOnly).toEqual([false, true, false])
  })

  it('counts a row’s seen relations, never a sum of counts that measure different things', () => {
    const [row] = relationRows(tree, tree.byId.get('app')!, [{ other: tree.byId.get('db')!, title: 'offers', seen: 3 }, { other: tree.byId.get('db')!, title: 'inserts offers', seen: 1 }, { other: tree.byId.get('db')!, title: 'x' }])
    expect(row.seen).toBe(2)
  })

  it('counts mapped calls apart from those the trace added', () => {
    expect(arrowSummary(tree, [0, 1, 2])).toBe('1 mapped runtime link · 1 the trace added · 1 use in code')
    expect(arrowSummary(tree, [0])).toBe('1 mapped runtime link')
    expect(arrowSummary(tree, [1])).toBe('1 the trace added')
    expect(arrowSummary(tree, [])).toBe('')
  })

  it('says a count in its unit, and that the call itself was not measured', () => {
    expect(measureText(3, 'requests')).toBe('3 requests of its endpoint · this call not measured')
    expect(measureText(1, 'requests')).toBe('1 request of its endpoint · this call not measured')
    // The unit a file's panel says too: calls into its code.
    expect(measureText(48872, 'code')).toBe('48,872 calls into its code · this call not measured')
    expect(measureText(1, 'code')).toBe('1 call into its code · this call not measured')
    // Unseen, or a count that does not say what it counts: nothing to say.
    expect(measureText(0, 'requests')).toBe('')
    expect(measureText(5, '')).toBe('')
  })
})
