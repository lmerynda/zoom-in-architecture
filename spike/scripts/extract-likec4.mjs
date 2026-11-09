// Turns each LikeC4 sample workspace under model/ into public/models/<name>.json for the viewer,
// and lists every model in public/models/index.json. Imported codebases are published by
// scripts/zoom.mjs instead.
import { LikeC4 } from 'likec4'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic, writeIndex } from './store.mjs'

const out = 'public/models'
mkdirSync(out, { recursive: true })

const text = v => (v == null ? '' : typeof v === 'string' ? v : String(v.text ?? ''))
const workspaces = readdirSync('model').filter(n => statSync(join('model', n)).isDirectory()).map(name => ({ name, dir: join('model', name) }))

// Workspace names on the command line limit extraction to them (the live watcher passes one).
const only = new Set(process.argv.slice(2))
for (const { name, dir } of workspaces) {
  if (only.size && !only.has(name)) continue
  const t0 = Date.now()
  const likec4 = await LikeC4.fromWorkspace(dir, { printErrors: true, watch: false })
  if (likec4.hasErrors()) process.exitCode = 1
  const model = await likec4.computedModel()
  const elements = [...model.elements()].map(e => ({
    id: e.id,
    parent: e.parent?.id ?? null,
    title: e.title,
    kind: e.kind,
    description: text(e.description),
    technology: text(e.technology),
    tags: [...(e.tags ?? [])],
    color: String(e.color ?? 'primary'),
    shape: String(e.shape ?? 'rectangle'),
    metadata: { ...(e.getMetadata?.() ?? {}) },
  }))
  const relations = [...model.relationships()].map(r => ({
    source: r.source.id,
    target: r.target.id,
    title: text(r.title),
  }))
  writeAtomic(join(out, `${name}.json`), JSON.stringify({ name, elements, relations, buildMs: Date.now() - t0 }))
  console.log(`${name}: ${elements.length} elements, ${relations.length} relations`)
  await likec4.dispose?.()
}

writeIndex()
process.exit()
