// Turns each LikeC4 workspace under model/ into public/models/<name>.json for the viewer.
import { LikeC4 } from 'likec4'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'model'
const out = 'public/models'
mkdirSync(out, { recursive: true })

const text = v => (v == null ? '' : typeof v === 'string' ? v : String(v.text ?? ''))

// Workspace names on the command line limit extraction to them (the live watcher passes one).
const only = new Set(process.argv.slice(2))
for (const name of readdirSync(root)) {
  if (only.size && !only.has(name)) continue
  const dir = join(root, name)
  if (!statSync(dir).isDirectory()) continue
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
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ name, elements, relations }))
  console.log(`${name}: ${elements.length} elements, ${relations.length} relations`)
  await likec4.dispose?.()
}
process.exit()
