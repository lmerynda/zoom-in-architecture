// Turns each LikeC4 workspace into public/models/<name>.json for the viewer, and lists them all
// in public/models/index.json. Workspaces are the samples under model/ and the local imports
// under imports/ (see scripts/import-code.mjs).
import { LikeC4 } from 'likec4'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const roots = { model: 'sample', imports: 'import' }
const out = 'public/models'
mkdirSync(out, { recursive: true })

const text = v => (v == null ? '' : typeof v === 'string' ? v : String(v.text ?? ''))
const workspaces = Object.entries(roots).flatMap(([root, source]) =>
  existsSync(root) ? readdirSync(root).filter(n => statSync(join(root, n)).isDirectory()).map(name => ({ name, dir: join(root, name), source })) : [])

// Workspace names on the command line limit extraction to them (the live watcher passes one).
const only = new Set(process.argv.slice(2))
for (const { name, dir } of workspaces) {
  if (only.size && !only.has(name)) continue
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

const titleOf = ({ dir, name }) => { try { return JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8')).title } catch { return name } }
writeFileSync(join(out, 'index.json'), JSON.stringify(workspaces.filter(w => existsSync(join(out, `${w.name}.json`))).map(w => ({ name: w.name, title: titleOf(w), source: w.source }))))
process.exit()
