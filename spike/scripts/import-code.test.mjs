import { LikeC4 } from 'likec4'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scan, toLikeC4 } from './import-code.mjs'

const repo = join(import.meta.dirname, '../test/fixtures/polyglot')
const config = {
  title: 'Shop',
  elements: [
    { id: 'customer', kind: 'actor', title: 'Customer' },
    { id: 'db', kind: 'database', title: 'PostgreSQL' },
  ],
  links: [
    { from: 'customer', to: 'web', title: 'shops' },
    { from: 'src/Core/OrderService.cs', to: 'db', title: 'stores orders' },
    { from: 'nowhere/at/all.cs', to: 'db' },
  ],
}
const r = scan(repo, config)
// Titles, or "Project/Title" where a title repeats across projects.
const byTitle = t => {
  const [p, leaf] = t.includes('/') ? t.split('/') : [null, t]
  return [...r.nodes.values()].find(n => n.title === leaf && (!p || r.projects.some(x => x.node.title === p && n.fqn.startsWith(`${x.node.fqn}.`))))
}
const linked = (a, b) => [...r.rels.values()].find(x => x.from === byTitle(a) && x.to === byTitle(b))

describe('scan', () => {
  it('finds a project per manifest, with kind and technology from it', () => {
    const p = Object.fromEntries(r.projects.map(x => [x.node.title, [x.lang, x.node.kind, x.node.technology]]))
    expect(p).toEqual({
      Api: ['cs', 'app', 'C# · net10.0'],
      Core: ['cs', 'library', 'C# · net10.0'],
      web: ['js', 'app', 'TypeScript'],
      shared: ['js', 'library', 'JavaScript'],
      'game-engine': ['rs', 'library', 'Rust'],
      game: ['rs', 'app', 'Rust'],
    })
    expect(byTitle('Api').description).toBe('HTTP API for orders.')
  })

  it('groups projects into areas by top folder, under one system', () => {
    expect(byTitle('Shop').kind).toBe('system')
    expect(byTitle('Api').parent.title).toBe('Src')
    expect(byTitle('web').parent.title).toBe('Web')
    expect(byTitle('Customer').parent).toBeNull()
  })

  it('relates files through C# types, Rust paths and JS imports', () => {
    expect(linked('OrdersController', 'OrderService')).toBeTruthy()
    expect(linked('OrderService', 'Order')).toBeTruthy()
    expect(linked('lib', 'physics')).toBeTruthy()
    expect(linked('web/main', 'api')).toBeTruthy()
    // Workspace packages and crates resolve to their entry files.
    expect(linked('web/main', 'index')).toBeTruthy()
    expect(linked('game/main', 'lib')).toBeTruthy()
  })

  it('folds generated migrations into one leaf and keeps doc comments', () => {
    expect(byTitle('Migrations').description).toBe('2 generated migrations.')
    expect(byTitle('OrdersController').description).toBe('Takes orders over HTTP.')
    expect(byTitle('lib').description).toBe("The engine's entry point.")
  })

  it('adds config links by element id or repo path, and reports the ones it cannot place', () => {
    expect(linked('Customer', 'web').types).toEqual(new Set(['shops']))
    expect(linked('OrderService', 'PostgreSQL')).toBeTruthy()
    expect(r.missing).toEqual(['nowhere/at/all.cs'])
  })

  it('writes LikeC4 that compiles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-'))
    const { spec, model } = toLikeC4(r, 'polyglot')
    writeFileSync(join(dir, '_spec.c4'), spec)
    writeFileSync(join(dir, 'model.c4'), model)
    const likec4 = await LikeC4.fromWorkspace(dir, { printErrors: true, watch: false })
    expect(likec4.hasErrors()).toBe(false)
    const m = await likec4.computedModel()
    expect([...m.elements()].length).toBe(r.nodes.size)
    await likec4.dispose?.()
  }, 30000)
})
