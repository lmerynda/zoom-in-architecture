// Small commands for mapping a codebase, meant to be called by an agent (see skills/map-repo).
// usage:
//   node scripts/zoom.mjs install-skill                  install the map-repo skill for Claude Code and Codex, so a
//                                                         session in any project can map and upload it
//   node scripts/zoom.mjs graph <repo> [--folders|--under <dir>|--json]   the application's file graph
//                                                         (--folders: an overview by folder; --under: one part)
//   node scripts/zoom.mjs check <repo> <map.json> [--uncited]   what is wrong or missing in a map (--uncited: marked lines no link cites)
//   node scripts/zoom.mjs audit <repo> <map.json>         files whose users sit mostly in a sibling node
//   node scripts/zoom.mjs publish <repo> <map.json> [--name <name>] [--to <url>] [--watch]
//                                                         check, then upload the map, its models and the shown files'
//                                                         source to the viewer (default http://localhost:5180, or ZOOM_URL);
//                                                         --watch uploads again whenever the repo's code changes
//   node scripts/zoom.mjs pull <name> [--to <url>]       the map an import was last published with, to start a re-map from;
//                                                         on stderr, the commit it was built from
//   node scripts/zoom.mjs why <repo> <map.json> <file>…   where files sit, and who uses them and what they use, by node
//   node scripts/zoom.mjs compare <repo> <a.json> <b.json>   how alike two maps of one repo are
import { cpSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildGraph } from './graph.mjs'
import { auditPlacement, buildModel, bundle, compareMaps, toName } from './map.mjs'

/** Files whose change can change the map: code, project manifests and server-side views. */
const SOURCE = /\.(cs|rs|java|kt|go|py|tsx?|mts|cts|jsx?|mjs|cjs|vue|svelte|csproj|html|cshtml|razor|jinja2?|j2)$|(^|[/\\])(Cargo\.toml|package\.json|tsconfig[^/\\]*\.json|pom\.xml|build\.gradle(\.kts)?|go\.mod|pyproject\.toml|setup\.py)$/
const IGNORED = /(^|[/\\])(node_modules|bin|obj|target|dist|build|out|\.git|\.venv|venv|__pycache__)[/\\]/

/** This checkout of zoom-in-architecture, with forward slashes, as installed skills name it. */
const ZOOM = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

/**
 * Installs the repository's skills (`skills/<name>/`) for Claude Code and Codex under `home`, so a
 * session in any project can map it and upload the map. `<zoom>` in a skill becomes `zoom`, and the
 * installed copy says where its source is. Returns the folders written.
 */
export function installSkills(home, zoom = ZOOM) {
  const written = []
  for (const name of readdirSync(join(zoom, 'skills'))) {
    for (const dest of [join(home, '.claude', 'skills', name), join(home, '.codex', 'skills', name)]) {
      rmSync(dest, { recursive: true, force: true })
      cpSync(join(zoom, 'skills', name), dest, { recursive: true })
      const file = join(dest, 'SKILL.md')
      const note = `<!-- Installed by \`node ${zoom}/spike/scripts/zoom.mjs install-skill\` from ${zoom}/skills/${name}: edit it there and install again. -->`
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('<zoom>', zoom).replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1\n${note}\n`))
      written.push(dest)
    }
  }
  return written
}

/** Sends a bundle to the viewer service, which stores it and serves only from it. */
export async function upload(b, service) {
  let res
  try {
    res = await fetch(new URL('/upload', service), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  } catch {
    throw new Error(`no viewer answers at ${service}: start it with \`npm run dev\` in the viewer's spike/ folder, or pass --to`)
  }
  if (!res.ok) throw new Error(`the viewer at ${service} refused the upload: ${await res.text()}`)
}

/** The graph's header: what was left out, the projects, entry points and config files. */
function header(g) {
  return [
    `${g.repo}`,
    `${g.files.length} application files, ${g.edges.length} references (${g.edges.filter(e => e.types).length} type-only). Left out: ${g.dropped.tests} test files; ${g.dropped.generated} generated files (migrations, protobuf, designer code); ${g.dropped.unreached.length} files no entry point reaches${g.dropped.unreached.length ? `: ${g.dropped.unreached.slice(0, 20).join(', ')}${g.dropped.unreached.length > 20 ? ', …' : ''}` : ''}.`,
    'Projects (from manifests; hints for the deployables):',
    ...g.projects.map(p => `  ${p.dir || '.'}  ${p.lang}  ${p.kind}  ${p.name}${p.technology ? `  · ${p.technology}` : ''}${p.description ? `  — ${p.description}` : ''}`),
    ...g.unmapped.map(p => `  ${p.dir || '.'}  ${p.name}: not mapped, ${p.reason}`),
    `Entry points (JS/TS and scripts count when one reaches them; C#, Rust, Java and Go projects and Python packages count whole): ${g.entries.join(', ') || '(none found)'}`,
    ...g.projects.filter(p => g.entries.filter(e => g.files.find(f => f.path === e)?.project === p.dir).length > 1 && p.lang !== 'js').map(p => p.lang === 'go' ? `  ${p.dir || '.'} has several package main binaries (cmd/*): each one users run is a deployable; dev-only ones are tools` : `  ${p.dir || '.'} has several entry points; extra ones are often dev tools, not the service`),
    `Config and deploy files (read them for datasources, base URLs, ports, other services): ${g.config.join(', ') || '(none)'}`,
  ]
}

/** The graph as compact text an agent can read: files by folder, with what each uses and who uses it. */
export function graphText(g, under = '') {
  const stems = new Map()
  for (const f of g.files) { const s = posix.basename(f.path); stems.set(s, (stems.get(s) ?? 0) + 1) }
  const short = p => (stems.get(posix.basename(p)) > 1 ? p : posix.basename(p))
  // Type-only imports are listed apart: they couple files at compile time, but the map does not draw them.
  const out = new Map(), inn = new Map(), typed = new Map()
  const add = (m, k, v) => m.set(k, [...(m.get(k) ?? []), v])
  for (const e of g.edges) { if (e.types) add(typed, e.from, e.to); else { add(out, e.from, e.to); add(inn, e.to, e.from) } }
  const lines = [
    ...header(g),
    'Files: name · lines · → uses · types → type-only imports (not drawn) · ← used by · doc; indented below: :line kind text, for routes, calls, stores, queues, schedules, sockets, messages, processes and file handoffs',
  ]
  let dir = null
  if (under) lines.push(`Only files under ${under}:`)
  for (const f of g.files.filter(x => x.path.startsWith(under))) {
    const d = posix.dirname(f.path)
    if (d !== dir) { lines.push(`${d}/`); dir = d }
    const o = out.get(f.path) ?? [], i = inn.get(f.path) ?? [], t = typed.get(f.path) ?? []
    const cap = (a, n) => (a.length > n ? `${a.slice(0, n).map(short).join(', ')} +${a.length - n} more` : a.map(short).join(', '))
    lines.push(`  ${posix.basename(f.path)} · ${f.lines}${o.length ? ` · → ${cap(o, 12)}` : ''}${t.length ? ` · types → ${cap(t, 6)}` : ''}${i.length ? ` · ← ${i.length > 8 ? `${i.length} files` : i.map(short).join(', ')}` : ''}${f.doc ? ` · ${f.doc.slice(0, 120)}` : ''}`)
    for (const h of f.hints.slice(0, 16)) lines.push(`      :${h.line} ${h.kind} ${h.text}`)
    if (f.hints.length > 16) lines.push(`      … ${f.hints.length - 16} more`)
  }
  return lines.join('\n')
}

/** A folder-level overview for large repos: each folder's size, hints, and the folders it references. */
export function folderText(g) {
  const dir = p => posix.dirname(p)
  const folders = new Map()
  for (const f of g.files) {
    const d = folders.get(dir(f.path)) ?? { files: 0, lines: 0, hints: {}, out: new Map() }
    d.files++
    d.lines += f.lines
    for (const h of f.hints) d.hints[h.kind] = (d.hints[h.kind] ?? 0) + 1
    folders.set(dir(f.path), d)
  }
  for (const e of g.edges) if (!e.types && dir(e.from) !== dir(e.to)) { const o = folders.get(dir(e.from)).out; o.set(dir(e.to), (o.get(dir(e.to)) ?? 0) + 1) }
  return [
    ...header(g),
    `${folders.size} folders. Folder · files · lines · hints · → folders it references (runtime references)`,
    ...[...folders].map(([d, x]) => `${d}/ · ${x.files} · ${x.lines}${Object.keys(x.hints).length ? ` · ${Object.entries(x.hints).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}${x.out.size ? ` · → ${[...x.out].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', ')}` : ''}`),
  ].join('\n')
}

const report = r => {
  for (const n of r.tree) console.log(`${'  '.repeat(n.id.split('.').length - 1)}${n.id}  ${n.title} (${n.kind})${n.files ? `  ${n.files} file${n.files === 1 ? '' : 's'}` : ''}${n.voted ? ` (${n.voted} placed by neighbours, not by the map)` : ''}`)
  for (const e of r.errors) console.log(`error: ${e}`)
  for (const w of r.warnings) console.log(`warning: ${w}`)
  const s = r.stats
  console.log(`${s.nodes} nodes, ${s.files} files, ${s.relations} relations (${s.links} links), ${s.unplaced} files not in the map`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined }
  const flag = k => { const i = args.indexOf(k); return i >= 0 && !!args.splice(i, 1) }
  const [cmd, a, b] = (() => { const name = opt('--name'); const under = opt('--under'); const to = opt('--to'); const json = flag('--json'); const folders = flag('--folders'); const uncited = flag('--uncited'); const watching = flag('--watch'); Object.assign(args, { name, under, to, json, folders, uncited, watching }); return args })()
  const service = args.to ?? process.env.ZOOM_URL ?? 'http://localhost:5180'
  const readMap = f => JSON.parse(readFileSync(f, 'utf8'))
  try {
    if (cmd === 'graph' && a) {
      const g = buildGraph(a)
      console.log(args.json ? JSON.stringify(g, null, 1) : args.folders ? folderText(g) : graphText(g, args.under ?? ''))
    } else if (cmd === 'check' && a && b) {
      const r = buildModel(buildGraph(a), readMap(b), { name: toName(a) })
      report(r)
      // Routes nothing in the map calls are pages people open or an API outside callers use: listed apart, not as gaps.
      const open = r.uncited.filter(u => u.kind !== 'route'), routes = r.uncited.filter(u => u.kind === 'route')
      if (args.uncited) {
        console.log(`${open.length} marked lines no link cites:`)
        for (const u of open) console.log(`  ${u.path}:${u.line} ${u.kind} ${u.text.slice(0, 100)}`)
        if (routes.length) console.log(`${routes.length} routes no link reaches (pages people open, or an API outside callers use; link them only when an app in the map calls them):`)
        for (const u of routes) console.log(`  ${u.path}:${u.line} ${u.kind} ${u.text.slice(0, 100)}`)
      } else if (open.length) console.log(`${open.length} marked lines no link cites (--uncited lists them)`)
      if (r.errors.length) process.exitCode = 1
    } else if (cmd === 'publish' && a && b) {
      const name = args.name ?? toName(a)
      const r = bundle(a, readMap(b), { name })
      report(r)
      if (!r.bundle) { console.log('not published: fix the errors above'); process.exitCode = 1 }
      else {
        await upload(r.bundle, service)
        console.log(`published "${name}" in ${r.ms} ms: ${Object.keys(r.bundle.sources).length} files' source uploaded to ${service}; open ?model=${name}`)
      }
      // Live: the project re-uploads when its code changes. The map is re-read each time, and files
      // it does not place yet go beside the files they reference, as a re-map would start.
      if (r.bundle && args.watching) {
        let timer, running = false, again = false
        const send = async () => {
          if (running) { again = true; return }
          running = true
          try {
            const next = bundle(a, readMap(b), { name, loose: true })
            if (!next.bundle) console.log(`not uploaded: ${next.errors[0]}`)
            else { await upload(next.bundle, service); console.log(`${new Date().toLocaleTimeString()} uploaded "${name}" again (${next.stats.files} files${next.warnings.length ? `, ${next.warnings.length} warnings` : ''})`) }
          } catch (e) { console.log(`not uploaded: ${e.message}`) }
          running = false
          if (again) { again = false; send() }
        }
        watch(a, { recursive: true }, (_ev, f) => { if (f && SOURCE.test(f) && !IGNORED.test(f)) { clearTimeout(timer); timer = setTimeout(send, 400) } })
        watch(b, () => { clearTimeout(timer); timer = setTimeout(send, 400) })
        console.log(`watching ${a}; Ctrl+C stops`)
      }
    } else if (cmd === 'audit' && a && b) {
      const found = auditPlacement(buildGraph(a), readMap(b))
      console.log(`${found.length} files used mostly from a sibling node (a feature's own interfaces can stay; the rest may move):`)
      for (const x of found) console.log(`  ${x.path}  in ${x.own} (${x.ownUsers} users), mostly used from ${x.top} (${x.topUsers})`)
    } else if (cmd === 'why' && a && b && args[3]) {
      const g = buildGraph(a)
      const { model } = buildModel(g, readMap(b), { name: toName(a), loose: true })
      const nodeOf = new Map(model.elements.filter(e => e.metadata?.path).map(e => [e.metadata.path, e.parent]))
      // A basename, or the path when two application files share it.
      const counts = new Map()
      for (const f of g.files) counts.set(posix.basename(f.path), (counts.get(posix.basename(f.path)) ?? 0) + 1)
      const label = p => (counts.get(posix.basename(p)) > 1 ? p : posix.basename(p))
      const byNode = paths => { const m = new Map(); for (const p of paths) m.set(nodeOf.get(p), [...(m.get(nodeOf.get(p)) ?? []), label(p)]); return [...m].sort((x, y) => y[1].length - x[1].length) }
      const list = (label, paths) => { console.log(`${label} ${paths.length} files:`); for (const [n, fs] of byNode(paths)) console.log(`  ${n}  ${fs.length}  ${fs.join(', ')}`) }
      // Several files in one call; type-only imports are left out, as in the map.
      for (const file of args.slice(3).map(x => x.replace(/\\/g, '/'))) {
        if (!nodeOf.has(file)) { console.log(`${file} is not an application file`); process.exitCode = 1; continue }
        console.log(`${file} is in ${nodeOf.get(file)}`)
        list('Used by', g.edges.filter(e => e.to === file && !e.types).map(e => e.from))
        list('Uses', g.edges.filter(e => e.from === file && !e.types).map(e => e.to))
      }
    } else if (cmd === 'compare' && a && b && args[3]) {
      const c = compareMaps(buildGraph(a), readMap(b), readMap(args[3]))
      const pct = x => `${Math.round(x * 100)}%`
      console.log(`Grouping agreement (adjusted Rand index; 1 = identical, 0 = chance): processes ${c.topLevel.toFixed(2)}, leaf nodes ${c.leaf.toFixed(2)} (${c.groups.a} vs ${c.groups.b} groups)${c.skipped ? `; ${c.skipped} files left out because one map does not place them` : ''}`)
      console.log('Each group of A, its closest group in B, and the share of files they have in common:')
      for (const p of c.pairs) console.log(`  ${p.a} (${p.files}) → ${p.b}  ${pct(p.overlap)}`)
      console.log(`Process-level links: ${c.processLinks.shared} shared, ${c.processLinks.onlyA.length} only in A, ${c.processLinks.onlyB.length} only in B`)
      for (const l of c.processLinks.onlyA) console.log(`  only A: ${l}`)
      for (const l of c.processLinks.onlyB) console.log(`  only B: ${l}`)
      console.log(`File-to-file links: ${c.fileLinks.shared} shared of ${c.fileLinks.a} in A and ${c.fileLinks.b} in B`)
    } else if (cmd === 'pull' && a) {
      let res
      try { res = await fetch(new URL(`/maps/${encodeURIComponent(a)}.json`, service)) } catch { throw new Error(`no viewer answers at ${service}`) }
      if (!res.ok) throw new Error(`the viewer at ${service} has no import "${a}"`)
      process.stdout.write(await res.text())
      // On stderr, so the map on stdout stays a clean file: what the upload was built from.
      const p = await fetch(new URL(`/published/${encodeURIComponent(a)}.json`, service)).then(r => (r.ok ? r.json() : null)).catch(() => null)
      console.error(p?.commit
        ? `published ${p.at} from commit ${p.commit}${p.dirty ? ' plus uncommitted changes' : ''}; what changed since: git log --oneline ${p.commit}..HEAD`
        : `published ${p?.at ?? 'at an unknown time'}, from no recorded commit`)
    } else if (cmd === 'install-skill') {
      for (const d of installSkills(homedir())) console.log(`installed ${d}`)
    } else {
      console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, all) => all.slice(0, i + 1).every(x => x.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
      process.exitCode = 2
    }
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
