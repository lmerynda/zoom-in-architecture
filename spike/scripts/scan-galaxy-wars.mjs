// Generates a LikeC4 model of the Galaxy Wars repository from its code.
// Levels: system → area → project → folder (→ name cluster) → file. Relations are real type
// references between files, limited to the projects each project references; network seams
// that code references cannot see (WebSocket, TCP, database) are declared below.
// usage: node scripts/scan-galaxy-wars.mjs [repoRoot]   → writes model/galaxy-wars/*.c4
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const repo = process.argv[2] ?? 'F:/projects/galaxy-wars'
const out = 'model/galaxy-wars'
if (!existsSync(repo)) throw new Error(`no repository at ${repo}`)

const AREAS = {
  server: { title: 'Server', description: 'Authoritative simulation, persistence and transport.' },
  shared: { title: 'Shared Contracts', description: 'Protocol, wire codec and movement rules shared by server and clients.' },
  clients: { title: 'Clients', description: 'Browser, Unity and headless clients of the same server.' },
  tools: { title: 'Tooling', description: 'Developer and operator tools.' },
}

const CS = 'C# · .NET 10'
const PROJECTS = [
  { area: 'server', title: 'Game Server', dir: 'src/Game.Server', proj: 'Game.Server', kind: 'app', tech: CS, description: 'Authoritative server process.' },
  { area: 'server', title: 'Game Core', dir: 'src/Game.Core', proj: 'Game.Core', kind: 'library', tech: CS, description: 'Deterministic, Unity-free game simulation.' },
  { area: 'shared', title: 'Protocol', dir: 'src/Game.Protocol', proj: 'Game.Protocol', kind: 'library', tech: 'C# · .NET Standard', description: 'Transport-neutral client/server contracts.' },
  { area: 'shared', title: 'Wire Protobuf', dir: 'src/Game.Wire.Protobuf', proj: 'Game.Wire.Protobuf', kind: 'library', tech: 'C# · protobuf', description: 'Generated protobuf codec for continuous replication frames.' },
  { area: 'shared', title: 'Movement', dir: 'src/Game.Movement', proj: 'Game.Movement', kind: 'library', tech: 'C# · .NET Standard', description: 'Shared Unity-free movement integration.' },
  { area: 'clients', title: 'Browser Client', dir: 'experiments/browser-client/rust-client/src', lang: 'rust', kind: 'webapp', tech: 'Rust · Wasm · WebGL2', description: 'Maintained Rust/Wasm + WebGL2 browser client: protocol and prediction in Rust, no engine.' },
  { area: 'clients', title: 'Rust Movement', dir: 'experiments/browser-client/rust-movement/src', lang: 'rust', kind: 'library', tech: 'Rust', description: 'gw_movement: client prediction matching the shared movement rules.' },
  { area: 'clients', title: 'Browser Bridge', dir: 'experiments/browser-client/bridge', proj: 'Bridge', kind: 'app', tech: CS, description: 'Loopback WebSocket relay and browser static host.' },
  { area: 'clients', title: 'Unity Client', dir: 'client/Assets/Scripts', proj: 'Unity', kind: 'app', tech: 'Unity 6 · URP · C# 9', description: 'Unity 6 URP presentation client.' },
  { area: 'clients', title: 'Client Transport', dir: 'src/Game.Client.Transport', proj: 'Game.Client.Transport', kind: 'library', tech: 'C# · .NET Standard', description: 'Unity-free client TCP transport with JSON messages and protobuf motion.' },
  { area: 'clients', title: 'Client Gameplay', dir: 'src/Game.Client.Gameplay', proj: 'Game.Client.Gameplay', kind: 'library', tech: 'C# · .NET Standard', description: 'Shared engine-free client targeting policy.' },
  { area: 'clients', title: 'Headless Pilot', dir: 'src/Game.Client.Headless', proj: 'Game.Client.Headless', kind: 'library', tech: CS, description: 'Reusable normal-protocol headless pilot runtime.' },
  { area: 'tools', title: 'CLI', dir: 'tools/Game.Cli', proj: 'Game.Cli', kind: 'app', tech: CS, description: 'Interactive and JSONL headless client.' },
  { area: 'tools', title: 'DevTool', dir: 'tools/Game.DevTool', proj: 'Game.DevTool', kind: 'app', tech: CS, description: 'Tests, Unity validation, player acceptance, captures, launcher and asset packs.' },
  { area: 'tools', title: 'Operator', dir: 'tools/Game.Operator', proj: 'Game.Operator', kind: 'app', tech: 'C# · ASP.NET Core', description: 'Token-protected operator web service for the server profiles.' },
  { area: 'tools', title: 'Load Profile', dir: 'tools/Game.LoadProfile', proj: 'Game.LoadProfile', kind: 'app', tech: CS, description: 'Release-mode galaxy load matrix for simulation, projection and serialization.' },
]
// Unity references the shared source packages directly instead of through a csproj.
const UNITY_REFS = ['Game.Protocol', 'Game.Movement', 'Game.Wire.Protobuf', 'Game.Client.Transport', 'Game.Client.Gameplay']

const SKIP_DIRS = new Set(['obj', 'bin', 'artifacts', 'Properties', 'wwwroot', 'node_modules', 'target'])
const GROUP_OVER = 20

// ---------- ids and text ----------

const used = new Map()
function idFor(parentFqn, name) {
  let base = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '')
  base = base ? base[0].toLowerCase() + base.slice(1) : 'x'
  const seen = used.get(parentFqn) ?? new Set()
  used.set(parentFqn, seen)
  let id = base, k = 2
  while (seen.has(id)) id = `${base}${k++}`
  seen.add(id)
  return id
}
const q = s => `'${String(s).replace(/\s+/g, ' ').trim().replace(/\\/g, '/').replace(/'/g, '’')}'`

function walk(dir, ext) {
  const files = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) files.push(...walk(p, ext)) }
    else if (name.endsWith(ext) && !name.endsWith('.Designer.cs') && name !== 'AssemblyInfo.cs') files.push(p)
  }
  return files
}

function stripCs(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ').replace(/@?"(?:[^"\\\n]|\\.)*"/g, '""')
}

function summaryCs(src) {
  const m = src.match(/\/\/\/\s*<summary>([\s\S]*?)<\/summary>/)
  if (!m) return ''
  return m[1].replace(/^\s*\/\/\/\s?/gm, ' ').replace(/<see\s+cref="(?:[A-Z]:)?([^"]+)"\s*\/>/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function summaryRs(src) {
  const lines = []
  for (const l of src.split('\n')) {
    const m = l.match(/^\s*\/\/[!/]\s?(.*)$/)
    if (m) lines.push(m[1])
    else if (lines.length || l.trim()) break
  }
  return lines.join(' ').trim()
}

const words = name => name.replace(/\..*$/, '').match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) ?? [name]

// ---------- tree ----------

const nodes = new Map() // fqn → node
function node(parent, kind, title, extra = {}) {
  const fqn = parent ? `${parent.fqn}.${idFor(parent.fqn, extra.idName ?? title)}` : idFor('', extra.idName ?? title)
  const n = { fqn, kind, title, children: [], parent, ...extra }
  if (parent) parent.children.push(n)
  nodes.set(fqn, n)
  return n
}

/** Splits a large flat folder into clusters by file-name prefix, so no level holds 80 cards. */
function cluster(folder) {
  const files = folder.children.filter(c => c.kind === 'code')
  if (files.length <= GROUP_OVER) return
  const keyOf = (f, n) => (/Experience$/.test(f.title) ? 'Experiences' : words(f.title).slice(0, n).join(''))
  const split = (list, n) => {
    const groups = new Map()
    for (const f of list) { const k = keyOf(f, n); groups.set(k, [...(groups.get(k) ?? []), f]) }
    const small = [...groups].filter(([, g]) => g.length < 3)
    if (small.length) { groups.set('Other', small.flatMap(([, g]) => g)); for (const [k] of small) groups.delete(k) }
    return groups
  }
  const groups = split(files, 1)
  // Names with no shared prefixes would all land in Other: a flat folder reads better then.
  if (groups.size < 2 || (groups.get('Other')?.length ?? 0) > files.length * 0.6) return
  folder.children = folder.children.filter(c => c.kind !== 'code')
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const g = node(folder, 'cluster', key === 'Other' ? 'Other' : key, { description: `${list.length} files${key === 'Other' ? '' : ` named ${key}…`}` })
    for (const f of list) moveUnder(f, g)
    if (list.length > GROUP_OVER + 4) {
      const sub = split(list, 2)
      if (sub.size > 1) {
        g.children = []
        for (const [k2, l2] of sub) {
          const s = node(g, 'cluster', k2, { description: `${l2.length} files` })
          for (const f of l2) moveUnder(f, s)
        }
      }
    }
  }
}

function moveUnder(n, parent) {
  nodes.delete(n.fqn)
  const rename = (x, p) => {
    nodes.delete(x.fqn)
    x.fqn = `${p.fqn}.${idFor(p.fqn, x.idName ?? x.title)}`
    x.parent = p
    nodes.set(x.fqn, x)
    for (const c of x.children) rename(c, x)
  }
  rename(n, parent)
  parent.children.push(n)
}

const player = node(null, 'actor', 'Player', { description: 'Flies, fights, mines and trades in the shared galaxy as a Human or Alien.' })
const developer = node(null, 'actor', 'Developer', { description: 'Builds, tests and operates the game, often through coding agents.' })
const gw = node(null, 'system', 'Galaxy Wars', { description: 'Persistent shared-space PvPvE game with an authoritative server and browser, Unity and headless clients.' })
const db = node(gw, 'database', 'PostgreSQL', { technology: 'PostgreSQL 18', description: 'Accounts, ships, items, loadouts, missions and reward receipts.' })
const areas = Object.fromEntries(Object.entries(AREAS).map(([k, a]) => [k, node(gw, 'area', a.title, { description: a.description })]))

const files = [] // { node, project, path, src }
const projectNode = new Map()

for (const p of PROJECTS) {
  const root = join(repo, p.dir)
  const pn = node(areas[p.area], p.kind, p.title, { technology: p.tech, description: p.description })
  projectNode.set(p.proj ?? p.title, pn)
  p.node = pn
  const ext = p.lang === 'rust' ? '.rs' : '.cs'
  const folders = new Map([['', pn]])
  const folderFor = rel => {
    if (folders.has(rel)) return folders.get(rel)
    const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    const f = node(folderFor(parentRel), 'folder', basename(rel))
    folders.set(rel, f)
    return f
  }
  for (const path of walk(root, ext)) {
    const rel = relative(root, path).replace(/\\/g, '/')
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    if (/(^|\/)Migrations(\/|$)/.test(dir)) continue
    const src = readFileSync(path, 'utf8')
    const title = basename(rel, ext)
    const n = node(folderFor(dir), 'code', title, {
      description: p.lang === 'rust' ? summaryRs(src) : summaryCs(src),
      technology: p.lang === 'rust' ? 'Rust module' : '',
      idName: title.replace(/\./g, '_'),
    })
    files.push({ node: n, project: p, path: rel, src })
  }
  // EF Core migrations are generated: one leaf stands for all of them.
  const mig = join(root, 'Persistence', 'Migrations')
  if (existsSync(mig)) {
    const count = walk(mig, '.cs').length
    node(folderFor('Persistence'), 'code', 'Migrations', { description: `${count} generated EF Core migrations.`, technology: 'EF Core' })
  }
}
for (const n of [...nodes.values()]) if (n.kind !== 'cluster') cluster(n)

// ---------- relations from code ----------

function refsOf(p) {
  if (p.proj === 'Unity') return new Set(UNITY_REFS)
  if (!p.proj) return new Set()
  const seen = new Set(), stack = [p.proj]
  while (stack.length) {
    const name = stack.pop()
    const def = PROJECTS.find(x => x.proj === name)
    if (!def) continue
    const csproj = readdirSync(join(repo, def.dir)).find(f => f.endsWith('.csproj'))
    if (!csproj) continue
    for (const m of readFileSync(join(repo, def.dir, csproj), 'utf8').matchAll(/ProjectReference\s+Include="[^"]*?([A-Za-z.]+)\.csproj"/g)) {
      if (!seen.has(m[1])) { seen.add(m[1]); stack.push(m[1]) }
    }
  }
  return seen
}

const rels = new Map() // "a>b" → { from, to, types:Set }
function relate(from, to, label) {
  if (from === to) return
  const key = `${from.fqn}>${to.fqn}`
  const r = rels.get(key) ?? { from, to, types: new Set() }
  r.types.add(label)
  rels.set(key, r)
}

// C#: declared types per file, then PascalCase identifiers that name a type in a visible project.
const typeFiles = new Map()
for (const f of files) {
  if (f.project.lang === 'rust') continue
  f.code = stripCs(f.src)
  f.declares = new Set([...f.code.matchAll(/\b(?:class|struct|record|interface|enum)\s+([A-Z]\w*)/g)].map(m => m[1]))
  for (const t of f.declares) typeFiles.set(t, [...(typeFiles.get(t) ?? []), f])
}
for (const p of PROJECTS) p.visible = p.proj ? new Set([p.proj, ...refsOf(p)]) : new Set()
for (const f of files) {
  if (f.project.lang === 'rust') continue
  const ids = new Set(f.code.match(/\b[A-Z]\w{2,}\b/g) ?? [])
  for (const t of ids) {
    if (f.declares.has(t)) continue
    const cands = (typeFiles.get(t) ?? []).filter(g => f.project.visible.has(g.project.proj))
    if (!cands.length) continue
    const same = cands.filter(g => g.project === f.project)
    const pool = same.length ? same : cands
    const target = pool.find(g => g.node.title === t) ?? pool[0]
    relate(f.node, target.node, t)
  }
}

// Rust: module paths within a crate, and the gw_movement crate.
for (const p of PROJECTS.filter(x => x.lang === 'rust')) {
  const mods = new Map(files.filter(f => f.project === p).map(f => [f.node.title, f]))
  const movementLib = files.find(f => f.project.title === 'Rust Movement' && f.node.title === 'lib')
  for (const f of files.filter(x => x.project === p)) {
    const code = f.src.replace(/\/\/.*$/gm, ' ').replace(/^\s*(pub\s+)?mod\s+\w+\s*;/gm, ' ')
    for (const m of code.matchAll(/\b(?:crate|super)::(\w+)|\b(\w+)::/g)) {
      const name = m[1] ?? m[2]
      const t = mods.get(name)
      if (t && t !== f) relate(f.node, t.node, `${name}::`)
    }
    if (movementLib && p.title !== 'Rust Movement' && /\bgw_movement::/.test(code)) relate(f.node, movementLib.node, 'gw_movement')
  }
}

// ---------- seams code references cannot see ----------

const fileByPath = (proj, suffix) => files.find(f => (f.project.proj ?? f.project.title) === proj && f.path.endsWith(suffix))?.node
const seams = [
  [player, projectNode.get('Browser Client'), 'plays in the browser'],
  [player, projectNode.get('Unity'), 'plays in the Unity client'],
  [developer, projectNode.get('Game.DevTool'), 'builds, tests and releases'],
  [developer, projectNode.get('Game.Cli'), 'drives headless pilots'],
  [developer, projectNode.get('Game.Operator'), 'operates server profiles'],
  [files.find(f => f.project.title === 'Browser Client' && /WebSocket::new/.test(f.src))?.node, fileByPath('Bridge', 'Program.cs') ?? projectNode.get('Bridge'), 'WebSocket: JSON and protobuf frames'],
  [fileByPath('Game.Client.Transport', 'JsonFrameClient.cs'), fileByPath('Game.Server', 'Transport/TcpGameServer.cs'), 'TCP: JSON messages, protobuf motion'],
  [fileByPath('Game.Server', 'Persistence/GameDbContextFactory.cs') ?? projectNode.get('Game.Server'), db, 'EF Core over Npgsql'],
  [fileByPath('Game.DevTool', 'Infrastructure/OwnedDatabase.cs'), db, 'leases isolated test databases'],
  [fileByPath('Game.DevTool', 'Commands/ServerCommands.cs'), projectNode.get('Game.Server'), 'starts and stops server profiles'],
  [projectNode.get('Game.Operator'), projectNode.get('Game.Server'), 'controls server profiles'],
]
for (const [a, b, label] of seams) if (a && b) relate(a, b, label)

// ---------- write LikeC4 ----------

function emit(n, indent) {
  const pad = ' '.repeat(indent)
  const body = []
  if (n.technology) body.push(`${pad}  technology ${q(n.technology)}`)
  if (n.description) body.push(`${pad}  description ${q(n.description.slice(0, 300))}`)
  for (const c of n.children) body.push(emit(c, indent + 2))
  const id = n.fqn.slice(n.fqn.lastIndexOf('.') + 1)
  return `${pad}${id} = ${n.kind} ${q(n.title)}${body.length ? ` {\n${body.join('\n')}\n${pad}}` : ''}`
}

const spec = `// Generated by scripts/scan-galaxy-wars.mjs; do not edit.
specification {
  element actor {
    style {
      shape person
      color green
    }
  }
  element system
  element area {
    style {
      color indigo
    }
  }
  element app
  element webapp {
    style {
      shape browser
      color secondary
    }
  }
  element library {
    style {
      color amber
    }
  }
  element database {
    style {
      shape storage
      color slate
    }
  }
  element folder {
    style {
      color blue
    }
  }
  element cluster {
    style {
      color gray
    }
  }
  element code {
    style {
      color sky
    }
  }
}
`
const top = [player, developer, gw]
const relLines = [...rels.values()].map(r => {
  const types = [...r.types]
  const title = types.length > 3 ? `${types.slice(0, 3).join(', ')} +${types.length - 3}` : types.join(', ')
  return `  ${r.from.fqn} -> ${r.to.fqn} ${q(title)}`
})
mkdirSync(out, { recursive: true })
writeFileSync(join(out, '_spec.c4'), spec)
writeFileSync(join(out, 'model.c4'), `// Generated from ${repo} by scripts/scan-galaxy-wars.mjs; do not edit.\nmodel {\n${top.map(n => emit(n, 2)).join('\n\n')}\n\n${relLines.join('\n')}\n}\n`)
const count = k => [...nodes.values()].filter(n => n.kind === k).length
console.log(`galaxy-wars: ${nodes.size} elements (${count('code')} files, ${count('folder')} folders, ${count('cluster')} clusters), ${rels.size} relations`)
