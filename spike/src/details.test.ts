import { describe, expect, it } from 'vitest'
import { foldEvidence, kindWord, relationRows, seenText, tableRows } from './details'
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
