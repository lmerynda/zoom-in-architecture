import { describe, expect, it } from 'vitest'
import { Tree, type ModelJson } from '../model'
import { elementScore, fuzzy, same } from './logic'

const el = (id: string, parent: string | null) => ({ id, parent, title: id, kind: 'k', description: '', technology: '', tags: [], color: 'primary', shape: 'rectangle' })
// web → api → db, and ops → api (so db reaches ops only against direction).
const model: ModelJson = {
  name: 'm',
  elements: [el('web', null), el('svc', null), el('svc.api', 'svc'), el('svc.db', 'svc'), el('ops', null), el('lone', null)],
  relations: [
    { source: 'web', target: 'svc.api', title: 'calls' },
    { source: 'svc.api', target: 'svc.db', title: 'queries' },
    { source: 'ops', target: 'svc.api', title: 'deploys' },
  ],
}
const tree = new Tree(model)
const id = (s: string) => tree.byId.get(s)!

describe('same', () => {
  it('reads views close together as one place', () => {
    expect(same({ x: 0, y: 0, z: 1, selected: null }, { x: 10, y: 0, z: 1.05, selected: null }, 1000)).toBe(true)
    expect(same({ x: 0, y: 0, z: 1, selected: null }, { x: 5000, y: 0, z: 1, selected: null }, 1000)).toBe(false)
    expect(same({ x: 0, y: 0, z: 1, selected: 'a' }, { x: 0, y: 0, z: 1, selected: null }, 1000)).toBe(false)
  })
})

describe('fuzzy', () => {
  it('needs every character in order', () => {
    expect(fuzzy('srt', 'SectorRuntime')).toBeGreaterThan(0)
    expect(fuzzy('xyz', 'SectorRuntime')).toBe(-1)
  })

  it('reads a space as any separator, or none', () => {
    expect(fuzzy('sign in', 'Accounts and sign-in')).toBeGreaterThan(0)
    expect(fuzzy('sign in', 'SignInPage')).toBeGreaterThan(0)
  })

  it('prefers word starts and runs', () => {
    expect(fuzzy('sr', 'SectorRuntime')).toBeGreaterThan(fuzzy('sr', 'Snapshot Broadcaster Rx'))
    expect(fuzzy('sector', 'SectorRuntime')).toBeGreaterThan(fuzzy('sector', 'SnapshotEncoderTor'))
  })

  it('finds an element by a feature it carries', () => {
    const travel = { id: 'server.travel', title: 'Jump coordinator', features: ['Fast travel'] }
    expect(elementScore('fast travel', travel)).toBeGreaterThan(0)
    expect(elementScore('fast travel', { ...travel, features: [] })).toBe(-1)
  })

  it('finds an element by its file path or description, below any name match', () => {
    const file = { id: 'api.tokenUtils', title: 'token.utils', description: 'Signs the log-in token.', metadata: { path: 'src/app/routes/auth/token.utils.ts' } }
    expect(elementScore('routes/auth', file)).toBeGreaterThan(0)
    expect(elementScore('login', file)).toBeGreaterThan(0)
    expect(elementScore('login', file)).toBeLessThan(elementScore('login', { id: 'login', title: 'Login page' }))
    expect(elementScore('payments', file)).toBe(-1)
  })
})
