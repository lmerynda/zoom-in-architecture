// Imports a codebase as a LikeC4 model the viewer can browse.
// Projects come from manifests: .csproj, Cargo.toml, package.json, and Unity's Assets folder.
// Levels: system → area (top folder) → project → folder (→ name cluster) → file. Relations are
// references between files: C# type names within referenced projects, Rust module paths and
// workspace crates, JS/TS relative and workspace-package imports. An optional JSON config adds
// titles, actors, external systems and the network seams code references cannot show.
// usage: node scripts/import-code.mjs <repo> [--name <name>] [--config <file.json>] [--json]
//        → imports/<name>/*.c4; `npm run extract` (or the dev server) turns it into a viewer model
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'target', 'dist', 'build', 'out', 'coverage', 'artifacts', 'Library', 'Temp', 'Logs'])
const EXT = { cs: ['.cs'], rs: ['.rs'], js: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] }
const GENERATED = /(\.Designer\.cs|\.g\.cs|AssemblyInfo\.cs|\.d\.ts|\.min\.js)$/
const GROUP_OVER = 20
// LikeC4's keywords (from its grammar) and this spec's element kinds; generated ids avoid them.
const RESERVED = new Set(['agent', 'alt', 'amber', 'and', 'auto', 'autoLayout', 'blue', 'border', 'bottom', 'break', 'browser', 'bucket', 'catch', 'color', 'component', 'crow', 'cylinder', 'dashed', 'deployment', 'deploymentNode', 'description', 'diagram', 'diamond', 'document', 'dot', 'dotted', 'dynamic', 'dynamicPredicateGroup', 'element', 'else', 'exclude', 'extend', 'extends', 'finally', 'fixed', 'from', 'global', 'gray', 'green', 'group', 'head', 'icon', 'iconColor', 'iconPosition', 'iconSize', 'icons', 'if', 'import', 'include', 'includeAncestors', 'indigo', 'instance', 'instanceOf', 'is', 'kind', 'large', 'left', 'lg', 'likec4lib', 'line', 'link', 'loop', 'max', 'md', 'medium', 'metadata', 'min', 'mobile', 'model', 'multiple', 'muted', 'navigateTo', 'node', 'none', 'normal', 'not', 'notation', 'notes', 'odiamond', 'odot', 'of', 'onormal', 'opacity', 'open', 'opt', 'or', 'order', 'ortho', 'padding', 'par', 'parallel', 'person', 'predicate', 'predicateGroup', 'primary', 'queue', 'rank', 'rectangle', 'red', 'relationship', 'rgb', 'rgba', 'right', 'routing', 'same', 'secondary', 'sequence', 'shape', 'sink', 'size', 'sizing', 'sky', 'slate', 'sm', 'small', 'solid', 'source', 'specification', 'spline', 'storage', 'style', 'styleGroup', 'summary', 'tag', 'tail', 'target', 'technology', 'textSize', 'title', 'top', 'try', 'variant', 'vee', 'view', 'views', 'when', 'where', 'with', 'xl', 'xlarge', 'xs', 'xsmall', 'it', 'this', 'true', 'false', 'actor', 'system', 'area', 'app', 'webapp', 'library', 'database', 'external', 'folder', 'cluster', 'code'])

export const toName = s => basename(resolve(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
const humanize = s => s.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const q = s => `'${String(s).replace(/\s+/g, ' ').trim().replace(/\\/g, '/').replace(/'/g, '’')}'`
const words = name => name.replace(/\..*$/, '').match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) ?? [name]
const extOf = p => { const m = p.match(/\.[^./]+$/); return m ? m[0] : '' }

/** Repo-relative paths of every file: git's view (honouring .gitignore) when it is a checkout. */
function listFiles(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    // Test fixtures are sample repos of their own, not part of the architecture.
    return out.split('\0').filter(p => p && !/(^|\/)(__)?fixtures(__)?\//.test(p) && existsSync(join(repo, p)))
  } catch {
    const files = []
    const walk = rel => {
      for (const name of readdirSync(join(repo, rel))) {
        const p = rel ? `${rel}/${name}` : name
        if (statSync(join(repo, p)).isDirectory()) { if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(p) }
        else files.push(p)
      }
    }
    walk('')
    return files
  }
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? ''
const toml = (src, key) => src.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? ''

/** Projects from manifests; each has a root folder its source files live under. */
function discover(repo, files) {
  const projects = []
  const unityRoots = new Set(files.filter(p => /(^|\/)ProjectSettings\/ProjectVersion\.txt$/.test(p)).map(p => p.replace(/\/?ProjectSettings\/ProjectVersion\.txt$/, '')))
  for (const u of unityRoots) {
    const version = readFileSync(join(repo, u, 'ProjectSettings/ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/)?.[1]
    projects.push({ lang: 'cs', unity: true, dir: u, root: u ? `${u}/Assets` : 'Assets', name: basename(u || resolve(repo)), title: humanize(basename(u || resolve(repo))), kind: 'app', technology: `Unity${version ? ` ${version.split('.')[0]}` : ''} · C#`, description: '' })
  }
  for (const p of files) {
    const dir = posix.dirname(p) === '.' ? '' : posix.dirname(p)
    const file = posix.basename(p)
    if (file.endsWith('.csproj')) {
      // Unity regenerates csproj files next to Assets; the Unity project stands for them.
      if (unityRoots.has(dir)) continue
      const xml = readFileSync(join(repo, p), 'utf8')
      const name = file.slice(0, -'.csproj'.length)
      const app = /Sdk="Microsoft\.NET\.Sdk\.(Web|Worker)"/.test(xml) || /<OutputType>\s*(Win)?Exe\s*</.test(xml)
      const fw = tag(xml, 'TargetFramework') || tag(xml, 'TargetFrameworks').split(';')[0]
      const refs = [...xml.matchAll(/ProjectReference\s+Include="([^"]+)"/g)].map(m => posix.normalize(posix.join(dir, m[1].replace(/\\/g, '/'))))
      projects.push({ lang: 'cs', dir, root: dir, manifest: p, name, title: name, kind: app ? 'app' : 'library', technology: `C#${fw ? ` · ${fw}` : ''}`, description: tag(xml, 'Description'), refs })
    } else if (file === 'Cargo.toml') {
      const src = readFileSync(join(repo, p), 'utf8')
      if (!/^\s*\[package\]/m.test(src)) continue
      const name = toml(src, 'name') || basename(dir)
      const has = f => files.includes(dir ? `${dir}/${f}` : f)
      const wasm = /cdylib/.test(src) && /wasm-bindgen/.test(src)
      projects.push({ lang: 'rs', dir, root: has('src/lib.rs') || has('src/main.rs') ? (dir ? `${dir}/src` : 'src') : dir, name, crate: name.replace(/-/g, '_'), title: name, kind: has('src/main.rs') || /\[\[bin\]\]/.test(src) ? 'app' : wasm ? 'webapp' : 'library', technology: wasm ? 'Rust · Wasm' : 'Rust', description: toml(src, 'description') })
    } else if (file === 'package.json') {
      let pkg
      try { pkg = JSON.parse(readFileSync(join(repo, p), 'utf8')) } catch { continue }
      if (!pkg.name && !pkg.scripts) continue
      const lib = !!(pkg.main || pkg.module || pkg.exports || pkg.types) && !pkg.bin
      projects.push({ lang: 'js', dir, root: dir, name: pkg.name ?? basename(dir), title: pkg.name ?? humanize(basename(dir || resolve(repo))), kind: lib ? 'library' : 'app', technology: '', description: pkg.description ?? '', pkg })
    }
  }
  return projects
}

/**
 * Scans a repository into a tree of nodes and relations between them.
 * Pure apart from reading the repo, so tests can run it on a fixture.
 */
export function scan(repo, config = {}) {
  repo = resolve(repo)
  if (!existsSync(repo)) throw new Error(`no repository at ${repo}`)
  const files = listFiles(repo)
  let projects = discover(repo, files)

  // Each source file belongs to the deepest project of its language whose root holds it.
  const owner = new Map()
  for (const p of files) {
    if (GENERATED.test(p)) continue
    const lang = Object.keys(EXT).find(l => EXT[l].includes(extOf(p)))
    if (!lang) continue
    let best = null
    for (const pr of projects) if (pr.lang === lang && (pr.root === '' || p.startsWith(`${pr.root}/`)) && (!best || pr.root.length > best.root.length)) best = pr
    if (best) owner.set(p, best)
  }
  // No manifests at all: the repo is one project in its most common language.
  if (!projects.length) {
    const counts = {}
    for (const p of files) for (const l of Object.keys(EXT)) if (EXT[l].includes(extOf(p)) && !GENERATED.test(p)) counts[l] = (counts[l] ?? 0) + 1
    const lang = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (lang) {
      const pr = { lang, dir: '', root: '', name: basename(repo), title: humanize(basename(repo)), kind: 'app', technology: '', description: '' }
      projects = [pr]
      for (const p of files) if (EXT[lang].includes(extOf(p)) && !GENERATED.test(p)) owner.set(p, pr)
    }
  }
  projects = projects.filter(pr => [...owner.values()].includes(pr))
  for (const pr of projects.filter(x => x.lang === 'js')) pr.technology ||= [...owner].some(([p, o]) => o === pr && /\.(m|c)?tsx?$/.test(p)) ? 'TypeScript' : 'JavaScript'

  // ---------- tree ----------
  const used = new Map()
  const idFor = (parentFqn, name) => {
    let base = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '')
    base = base ? base[0].toLowerCase() + base.slice(1) : 'x'
    if (RESERVED.has(base)) base += '_'
    const seen = used.get(parentFqn) ?? new Set()
    used.set(parentFqn, seen)
    let id = base, k = 2
    while (seen.has(id)) id = `${base}${k++}`
    seen.add(id)
    return id
  }
  const nodes = new Map()
  const node = (parent, kind, title, extra = {}) => {
    const fqn = parent ? `${parent.fqn}.${idFor(parent.fqn, extra.idName ?? title)}` : idFor('', extra.idName ?? title)
    const n = { fqn, kind, title, children: [], parent, ...extra }
    if (parent) parent.children.push(n)
    nodes.set(fqn, n)
    return n
  }
  const moveUnder = (n, parent) => {
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
  /** Splits a large flat folder into clusters by file-name prefix, so no level holds 80 cards. */
  const cluster = folder => {
    const leaves = folder.children.filter(c => c.kind === 'code')
    if (leaves.length <= GROUP_OVER) return
    const split = (list, n) => {
      const groups = new Map()
      for (const f of list) { const k = words(f.title).slice(0, n).join(''); groups.set(k, [...(groups.get(k) ?? []), f]) }
      const small = [...groups].filter(([, g]) => g.length < 3)
      if (small.length) { groups.set('Other', small.flatMap(([, g]) => g)); for (const [k] of small) groups.delete(k) }
      return groups
    }
    const groups = split(leaves, 1)
    // Names with no shared prefixes would all land in Other: a flat folder reads better then.
    if (groups.size < 2 || (groups.get('Other')?.length ?? 0) > leaves.length * 0.6) return
    folder.children = folder.children.filter(c => c.kind !== 'code')
    for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const g = node(folder, 'cluster', key, { description: `${list.length} files${key === 'Other' ? '' : ` named ${key}…`}` })
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

  const top = []
  const extras = new Map()
  for (const e of config.elements ?? []) if (e.kind === 'actor') { const n = node(null, 'actor', e.title, { description: e.description ?? '', idName: e.id }); top.push(n); extras.set(e.id, n) }
  const system = node(null, 'system', config.title ?? humanize(basename(repo)), { description: config.description ?? '' })
  top.push(system)
  for (const e of config.elements ?? []) if (e.kind !== 'actor') extras.set(e.id, node(system, ['database', 'queue', 'external', 'system'].includes(e.kind) ? e.kind : 'external', e.title, { description: e.description ?? '', technology: e.technology ?? '', idName: e.id }))

  // Areas: the config's, else each project's top folder; one area only is no level at all.
  const override = pr => config.projects?.[pr.dir || '.'] ?? {}
  const areaOf = pr => override(pr).area ?? (pr.dir.includes('/') ? pr.dir.slice(0, pr.dir.indexOf('/')) : pr.dir ? pr.dir : '')
  const areaNames = [...new Set(projects.map(areaOf))]
  const areas = new Map()
  if (areaNames.length > 1) for (const a of areaNames) areas.set(a, a ? node(system, 'area', config.areas?.[a]?.title ?? humanize(a), { description: config.areas?.[a]?.description ?? '' }) : system)

  // Commits touching each file in the last 90 days, for the churn lens.
  const churn = new Map()
  try {
    const log = execFileSync('git', ['-C', repo, 'log', '--since=90.days', '--name-only', '--relative', '--pretty=format:'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    for (const line of log.split('\n')) if (line.trim()) churn.set(line.trim(), (churn.get(line.trim()) ?? 0) + 1)
  } catch { /* not a git checkout: no churn lens */ }

  const fileRecs = [] // { node, project, path, src }
  const byPath = new Map() // repo-relative path → file or folder node
  for (const pr of projects) {
    const o = override(pr)
    const pn = node(areas.get(areaOf(pr)) ?? system, o.kind ?? pr.kind, o.title ?? pr.title, { technology: o.technology ?? pr.technology, description: o.description ?? pr.description })
    pr.node = pn
    byPath.set(pr.dir, pn)
    if (pr.root !== pr.dir) byPath.set(pr.root, pn)
    const folders = new Map([['', pn]])
    const folderFor = rel => {
      if (folders.has(rel)) return folders.get(rel)
      const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      const f = node(folderFor(parentRel), 'folder', posix.basename(rel))
      folders.set(rel, f)
      byPath.set(pr.root ? `${pr.root}/${rel}` : rel, f)
      return f
    }
    const mine = [...owner].filter(([, o]) => o === pr).map(([p]) => p).sort()
    const migrations = new Map()
    for (const path of mine) {
      const rel = pr.root ? path.slice(pr.root.length + 1) : path
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      // Generated EF Core migrations: one leaf stands for all of a folder's.
      const seg = dir.split('/'), mi = seg.indexOf('Migrations')
      if (pr.lang === 'cs' && mi >= 0) { const k = seg.slice(0, mi + 1).join('/'); migrations.set(k, (migrations.get(k) ?? 0) + 1); continue }
      const src = readFileSync(join(repo, path), 'utf8')
      const ext = extOf(path)
      const title = posix.basename(rel, ext)
      const n = node(folderFor(dir), 'code', title, {
        description: summary(src, pr.lang),
        technology: pr.lang === 'rs' ? 'Rust module' : '',
        idName: title.replace(/\./g, '_'),
        metrics: { lines: src.split('\n').length, churn: churn.get(path) ?? 0 },
      })
      byPath.set(path, n)
      fileRecs.push({ node: n, project: pr, path, src })
    }
    for (const [k, count] of migrations) {
      const parentRel = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : ''
      node(folderFor(parentRel), 'code', 'Migrations', { description: `${count} generated migrations.` })
    }
  }
  for (const n of [...nodes.values()]) if (n.kind !== 'cluster' && n.kind !== 'code') cluster(n)

  // ---------- relations ----------
  const rels = new Map()
  const relate = (from, to, label) => {
    if (!from || !to || from === to) return
    const key = `${from.fqn}>${to.fqn}`
    const r = rels.get(key) ?? { from, to, types: new Set() }
    r.types.add(label)
    rels.set(key, r)
  }
  relateCs(fileRecs, projects, relate)
  relateRs(fileRecs, projects, relate)
  relateJs(fileRecs, projects, byPath, relate)

  // Links from the config: element ids, or repo paths of a file, folder or project.
  const resolveEnd = s => extras.get(s) ?? byPath.get(String(s).replace(/\\/g, '/').replace(/\/$/, ''))
  const missing = []
  for (const l of config.links ?? []) {
    const a = resolveEnd(l.from), b = resolveEnd(l.to)
    if (a && b) relate(a, b, l.title ?? '')
    else missing.push(a ? l.to : l.from)
  }
  return { top, nodes, rels, projects, missing }
}

function summary(src, lang) {
  if (lang === 'cs') {
    const m = src.match(/\/\/\/\s*<summary>([\s\S]*?)<\/summary>/)
    return m ? m[1].replace(/^\s*\/\/\/\s?/gm, ' ').replace(/<see\s+cref="(?:[A-Z]:)?([^"]+)"\s*\/>/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''
  }
  if (lang === 'rs') {
    const lines = []
    for (const l of src.split('\n')) {
      const m = l.match(/^\s*\/\/[!/]\s?(.*)$/)
      if (m) lines.push(m[1])
      else if (lines.length || l.trim()) break
    }
    return lines.join(' ').trim()
  }
  // JS/TS: a leading block or line comment.
  const block = src.match(/^\s*(?:#![^\n]*\n\s*)?\/\*\*?([\s\S]*?)\*\//)
  if (block) return block[1].replace(/^\s*\*\s?/gm, ' ').replace(/\s+/g, ' ').trim()
  const lines = []
  for (const l of src.split('\n')) {
    const m = l.match(/^\s*\/\/\s?(.*)$/)
    if (m) lines.push(m[1])
    else break
  }
  return lines.join(' ').trim()
}

/** C#: PascalCase identifiers that name a type declared in a project this one references. */
function relateCs(files, projects, relate) {
  const cs = files.filter(f => f.project.lang === 'cs')
  const byManifest = new Map(projects.filter(p => p.manifest).map(p => [p.manifest, p]))
  const typeFiles = new Map()
  for (const f of cs) {
    f.code = f.src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ').replace(/@?"(?:[^"\\\n]|\\.)*"/g, '""')
    f.declares = new Set([...f.code.matchAll(/\b(?:class|struct|record|interface|enum)\s+([A-Z]\w*)/g)].map(m => m[1]))
    for (const t of f.declares) typeFiles.set(t, [...(typeFiles.get(t) ?? []), f])
  }
  for (const p of projects.filter(x => x.lang === 'cs')) {
    // Unity sees every C# project: it references shared source through packages, not csproj.
    if (p.unity) { p.visible = new Set(projects.filter(x => x.lang === 'cs')); continue }
    const seen = new Set([p]), stack = [p]
    while (stack.length) for (const r of stack.pop().refs ?? []) { const q = byManifest.get(r); if (q && !seen.has(q)) { seen.add(q); stack.push(q) } }
    p.visible = seen
  }
  for (const f of cs) {
    for (const t of new Set(f.code.match(/\b[A-Z]\w{2,}\b/g) ?? [])) {
      if (f.declares.has(t)) continue
      const cands = (typeFiles.get(t) ?? []).filter(g => f.project.visible.has(g.project))
      if (!cands.length) continue
      const same = cands.filter(g => g.project === f.project)
      const pool = same.length ? same : cands
      relate(f.node, (pool.find(g => g.node.title === t) ?? pool[0]).node, t)
    }
  }
}

/** Rust: module paths within a crate, and paths into other crates of the repo. */
function relateRs(files, projects, relate) {
  const crates = projects.filter(p => p.lang === 'rs')
  const entry = new Map(crates.map(c => [c.crate, files.find(f => f.project === c && (f.node.title === 'lib' || f.node.title === 'main'))?.node ?? c.node]))
  for (const c of crates) {
    const mine = files.filter(f => f.project === c)
    const mods = new Map(mine.map(f => [f.node.title, f]))
    for (const f of mine) {
      const code = f.src.replace(/\/\/.*$/gm, ' ').replace(/^\s*(pub\s+)?mod\s+\w+\s*;/gm, ' ')
      for (const m of code.matchAll(/\b(?:crate|super)::(\w+)|\b(\w+)::/g)) {
        const name = m[1] ?? m[2]
        const t = mods.get(name)
        if (t && t !== f) relate(f.node, t.node, `${name}::`)
        else if (name !== c.crate && entry.has(name)) relate(f.node, entry.get(name), name)
      }
    }
  }
}

/** JS/TS: relative imports between files, and imports of other packages in the repo. */
function relateJs(files, projects, byPath, relate) {
  const pkgs = projects.filter(p => p.lang === 'js')
  const tryExts = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs']
  const find = base => {
    const stem = base.replace(/\.(m|c)?jsx?$/, '')
    for (const b of base === stem ? [base] : [base, stem]) for (const e of tryExts) { const n = byPath.get(posix.normalize(b + e)); if (n?.kind === 'code') return n }
    return null
  }
  const entry = new Map(pkgs.map(p => {
    const ex = p.pkg?.exports
    const main = (typeof ex === 'string' ? ex : ex?.['.']?.import ?? ex?.['.']?.default ?? (typeof ex?.['.'] === 'string' ? ex['.'] : null)) ?? p.pkg?.module ?? p.pkg?.main ?? p.pkg?.types
    const at = rel => posix.join(p.dir, rel)
    return [p.name, (main && find(at(main.replace(/^\.\//, '')))) || find(at('src/index')) || find(at('index')) || p.node]
  }))
  const spec = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const f of files.filter(x => x.project.lang === 'js')) {
    const code = f.src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    for (const m of code.matchAll(spec)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4]
      if (s.startsWith('.')) relate(f.node, find(posix.join(posix.dirname(f.path), s)), posix.basename(s).replace(/\.\w+$/, ''))
      else {
        const p = pkgs.find(x => x.name !== f.project.name && (s === x.name || s.startsWith(`${x.name}/`)))
        if (p) relate(f.node, (s === p.name ? null : find(posix.join(p.dir, s.slice(p.name.length + 1)))) ?? entry.get(p.name), s)
      }
    }
  }
}

const SPEC = `specification {
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
  element queue {
    style {
      shape queue
      color slate
    }
  }
  element external {
    style {
      color muted
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

/** LikeC4 source for a scan: the specification and the model. */
export function toLikeC4(result, origin) {
  const emit = (n, indent) => {
    const pad = ' '.repeat(indent)
    const body = []
    if (n.technology) body.push(`${pad}  technology ${q(n.technology)}`)
    if (n.description) body.push(`${pad}  description ${q(n.description.slice(0, 300))}`)
    if (n.metrics) body.push(`${pad}  metadata {\n${Object.entries(n.metrics).map(([k, v]) => `${pad}    ${k} '${v}'`).join('\n')}\n${pad}  }`)
    for (const c of n.children) body.push(emit(c, indent + 2))
    const id = n.fqn.slice(n.fqn.lastIndexOf('.') + 1)
    return `${pad}${id} = ${n.kind} ${q(n.title)}${body.length ? ` {\n${body.join('\n')}\n${pad}}` : ''}`
  }
  const relLines = [...result.rels.values()].map(r => {
    const types = [...r.types].filter(Boolean)
    const title = types.length > 3 ? `${types.slice(0, 3).join(', ')} +${types.length - 3}` : types.join(', ')
    return `  ${r.from.fqn} -> ${r.to.fqn}${title ? ` ${q(title)}` : ''}`
  })
  const head = `// Generated from ${origin} by scripts/import-code.mjs; do not edit.\n`
  return {
    spec: head + SPEC,
    model: `${head}model {\n${result.top.map(n => emit(n, 2)).join('\n\n')}\n\n${relLines.join('\n')}\n}\n`,
  }
}

/** Scans `repo` and writes imports/<name>/, remembering where it came from for re-imports. */
export function importCode(repo, { name = toName(repo), config: configPath = null, out = 'imports' } = {}) {
  if (existsSync(join('model', name))) throw new Error(`"${name}" is a sample model's name; pass --name`)
  const config = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  const t0 = Date.now()
  const result = scan(repo, config)
  const { spec, model } = toLikeC4(result, basename(resolve(repo)))
  const dir = join(out, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '_spec.c4'), spec)
  writeFileSync(join(dir, 'model.c4'), model)
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ repo: resolve(repo), config: configPath && resolve(configPath), title: config.title ?? humanize(basename(resolve(repo))) }, null, 2))
  const count = k => [...result.nodes.values()].filter(n => n.kind === k).length
  return { name, dir, elements: result.nodes.size, files: count('code'), projects: result.projects.length, relations: result.rels.size, missing: result.missing, ms: Date.now() - t0 }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined }
  const json = args.includes('--json') && !!args.splice(args.indexOf('--json'), 1)
  const name = opt('--name'), config = opt('--config')
  if (!args[0]) { console.error('usage: node scripts/import-code.mjs <repo> [--name <name>] [--config <file.json>] [--json]'); process.exit(2) }
  try {
    const r = importCode(args[0], { name, config })
    if (json) console.log(JSON.stringify(r))
    else {
      console.log(`${r.name}: ${r.projects} projects, ${r.files} files, ${r.elements} elements, ${r.relations} relations in ${r.ms} ms → ${r.dir}`)
      if (r.missing.length) console.log(`config links not found: ${r.missing.join(', ')}`)
    }
  } catch (e) {
    if (json) console.log(JSON.stringify({ error: e.message }))
    else console.error(e.message)
    process.exit(1)
  }
}
