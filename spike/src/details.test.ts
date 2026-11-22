import { describe, expect, it } from 'vitest'
import { foldEvidence, kindWord, relationRows } from './details'
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
