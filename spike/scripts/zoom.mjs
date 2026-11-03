// Small commands for mapping a codebase, meant to be called by an agent (see .claude/skills/map-repo).
// usage:
//   node scripts/zoom.mjs graph <repo> [--json]           the application's file graph
//   node scripts/zoom.mjs check <repo> <map.json>         what is wrong or missing in a map
//   node scripts/zoom.mjs publish <repo> <map.json> [--name <name>]   check, then publish to the viewer
//   node scripts/zoom.mjs republish <name>                rebuild an import from its stored map (live mode)
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGraph } from './graph.mjs'
import { buildModel, publish, toName } from './map.mjs'

/** The graph as compact text an agent can read: files by folder, with what each uses and who uses it. */
export function graphText(g) {
  const stems = new Map()
  for (const f of g.files) { const s = posix.basename(f.path); stems.set(s, (stems.get(s) ?? 0) + 1) }
  const short = p => (stems.get(posix.basename(p)) > 1 ? p : posix.basename(p))
  const out = new Map(), inn = new Map()
  for (const e of g.edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); inn.set(e.to, [...(inn.get(e.to) ?? []), e.from]) }
  const lines = [
    `${g.repo}`,
    `${g.files.length} application files, ${g.edges.length} references. Left out: ${g.dropped.tests} test files; ${g.dropped.unreached.length} files no entry point reaches${g.dropped.unreached.length ? `: ${g.dropped.unreached.slice(0, 20).join(', ')}${g.dropped.unreached.length > 20 ? ', …' : ''}` : ''}.`,
    'Projects (from manifests; hints for the deployables):',
    ...g.projects.map(p => `  ${p.dir || '.'}  ${p.lang}  ${p.kind}  ${p.name}${p.technology ? `  · ${p.technology}` : ''}${p.description ? `  — ${p.description}` : ''}`),
    `Entry points: ${g.entries.join(', ') || '(none found)'}`,
    ...g.projects.filter(p => g.entries.filter(e => g.files.find(f => f.path === e)?.project === p.dir).length > 1 && p.lang !== 'js').map(p => `  ${p.dir || '.'} has several entry points; extra ones are often dev tools, not the service`),
    `Config and deploy files (read them for datasources, base URLs, ports, other services): ${g.config.join(', ') || '(none)'}`,
    'Files: name · lines · → uses · ← used by · doc; indented below: :line kind text, for routes, calls, schedules, stores and sockets',
  ]
  let dir = null
  for (const f of g.files) {
    const d = posix.dirname(f.path)
    if (d !== dir) { lines.push(`${d}/`); dir = d }
    const o = out.get(f.path) ?? [], i = inn.get(f.path) ?? []
    lines.push(`  ${posix.basename(f.path)} · ${f.lines}${o.length ? ` · → ${o.map(short).join(', ')}` : ''}${i.length ? ` · ← ${i.length > 8 ? `${i.length} files` : i.map(short).join(', ')}` : ''}${f.doc ? ` · ${f.doc.slice(0, 120)}` : ''}`)
    for (const h of f.hints.slice(0, 16)) lines.push(`      :${h.line} ${h.kind} ${h.text}`)
    if (f.hints.length > 16) lines.push(`      … ${f.hints.length - 16} more`)
  }
  return lines.join('\n')
}

const report = r => {
  for (const n of r.tree) console.log(`${'  '.repeat(n.id.split('.').length - 1)}${n.id}  ${n.title} (${n.kind})${n.files ? `  ${n.files} files` : ''}`)
  for (const e of r.errors) console.log(`error: ${e}`)
  for (const w of r.warnings) console.log(`warning: ${w}`)
  const s = r.stats
  console.log(`${s.nodes} nodes, ${s.files} files, ${s.relations} relations (${s.links} links), ${s.unplaced} files not in the map`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined }
  const flag = k => { const i = args.indexOf(k); return i >= 0 && !!args.splice(i, 1) }
  const [cmd, a, b] = (() => { const name = opt('--name'); const json = flag('--json'); args.name = name; args.json = json; return args })()
  const readMap = f => JSON.parse(readFileSync(f, 'utf8'))
  try {
    if (cmd === 'graph' && a) {
      const g = buildGraph(a)
      console.log(args.json ? JSON.stringify(g, null, 1) : graphText(g))
    } else if (cmd === 'check' && a && b) {
      const r = buildModel(buildGraph(a), readMap(b), { name: toName(a) })
      report(r)
      if (r.errors.length) process.exitCode = 1
    } else if (cmd === 'publish' && a && b) {
      const r = publish(a, readMap(b), { name: args.name ?? toName(a) })
      report(r)
      console.log(r.published ? `published "${r.name}" in ${r.ms} ms; open ?model=${r.name}` : 'not published: fix the errors above')
      if (!r.published) process.exitCode = 1
    } else if (cmd === 'republish' && a) {
      const { repo } = JSON.parse(readFileSync(join('imports', a, 'source.json'), 'utf8'))
      const r = publish(repo, readMap(join('imports', a, 'map.json')), { name: a, loose: true })
      report(r)
      if (!r.published) process.exitCode = 1
    } else {
      console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 6).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
      process.exitCode = 2
    }
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
