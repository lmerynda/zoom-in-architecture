// Builds the file graph of a codebase's application code: the source files that make up the
// running app, and the references between them. Deterministic, no AI. Tests, build configs and
// other tooling are left out:
// - JS/TS files count when an entry point reaches them through imports (index.html scripts,
//   package.json main/exports/bin and the `node <file>` npm scripts, conventional src/main.*).
//   eslint.config, vite.config, playwright.config and the like are never imported, so they drop.
// - C#, Rust and Java files count when a non-test project compiles them (.csproj, Cargo src/,
//   Maven/Gradle src/main/java).
// scripts/map.mjs turns the graph and an agent-written map into a viewer model.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'

const LANG = { '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.cs': 'cs', '.rs': 'rs', '.java': 'java' }
const GENERATED = /(\.Designer\.cs|\.g\.cs|AssemblyInfo\.cs|\.d\.ts|\.min\.js)$|(^|\/)Migrations\/.*\.cs$/
const TEST = /(^|\/)(tests?|__tests__|__mocks__|specs?|e2e|cypress|playwright|benches|examples|fixtures)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)setupTests\.[jt]sx?$|Tests?\.cs$/
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'target', 'dist', 'build', 'out', 'coverage', 'Library', 'Temp', 'Logs'])
// npm scripts that run checks, not the app.
const CHECK_SCRIPT = /test|lint|format|prettier|e2e|coverage|storybook|typecheck|check/

const extOf = p => { const m = p.match(/\.[^./]+$/); return m ? m[0] : '' }
const dirOf = p => (posix.dirname(p) === '.' ? '' : posix.dirname(p))
const under = (p, dir) => dir === '' || p.startsWith(`${dir}/`)
const readJson = (file, fallback = null) => {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return fallback }
  try { return JSON.parse(text) } catch { /* tsconfig allows comments and trailing commas */ }
  // Strings first in the alternation, so a glob such as "src/**/*.ts" is not read as a comment.
  const bare = text.replace(/("(?:[^"\\\n]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m, s) => s ?? '').replace(/,(\s*[}\]])/g, '$1')
  try { return JSON.parse(bare) } catch { return fallback }
}
const stripC = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ').replace(/@?"(?:[^"\\\n]|\\.)*"/g, '""')

/** Repo-relative paths of every file: git's view (honouring .gitignore) when it is a checkout. */
function listFiles(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\0').filter(p => p && existsSync(join(repo, p)))
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

/** Projects from manifests: hints for the deployables, and the scope of each language's files. */
function discover(repo, files) {
  const projects = []
  const read = p => readFileSync(join(repo, p), 'utf8')
  const unityRoots = new Set(files.filter(p => /(^|\/)ProjectSettings\/ProjectVersion\.txt$/.test(p)).map(p => p.replace(/\/?ProjectSettings\/ProjectVersion\.txt$/, '')))
  for (const u of unityRoots) {
    const version = read(`${u ? `${u}/` : ''}ProjectSettings/ProjectVersion.txt`).match(/m_EditorVersion:\s*(\S+)/)?.[1]
    // Unity references other source through file: packages in its manifest, not through csproj.
    const manifest = `${u ? `${u}/` : ''}Packages/manifest.json`
    const packages = Object.values(readJson(join(repo, manifest))?.dependencies ?? {}).filter(v => typeof v === 'string' && v.startsWith('file:')).map(v => posix.normalize(posix.join(dirOf(manifest), v.slice(5))))
    projects.push({ lang: 'cs', unity: true, dir: u, root: u ? `${u}/Assets` : 'Assets', name: basename(u || resolve(repo)), kind: 'app', technology: `Unity${version ? ` ${version.split('.')[0]}` : ''} · C#`, packages })
  }
  for (const p of files) {
    const dir = dirOf(p), file = posix.basename(p)
    if (file.endsWith('.csproj')) {
      // Unity regenerates csproj files next to Assets; the Unity project stands for them.
      if (unityRoots.has(dir)) continue
      const xml = read(p)
      const test = /Include="(xunit|nunit|NUnit|MSTest\.TestFramework|Microsoft\.NET\.Test\.Sdk)"/.test(xml)
      const app = /Sdk="Microsoft\.NET\.Sdk\.(Web|Worker)"/.test(xml) || /<OutputType>\s*(Win)?Exe\s*</.test(xml)
      const fw = tag(xml, 'TargetFramework') || tag(xml, 'TargetFrameworks').split(';')[0]
      const refs = [...xml.matchAll(/ProjectReference\s+Include="([^"]+)"/g)].map(m => posix.normalize(posix.join(dir, m[1].replace(/\\/g, '/'))))
      projects.push({ lang: 'cs', dir, root: dir, manifest: p, name: file.slice(0, -'.csproj'.length), kind: test ? 'test' : app ? 'app' : 'library', technology: `C#${fw ? ` · ${fw}` : ''}`, description: tag(xml, 'Description'), refs })
    } else if (file === 'Cargo.toml') {
      const src = read(p)
      if (!/^\s*\[package\]/m.test(src)) continue
      const name = toml(src, 'name') || basename(dir)
      const has = f => files.includes(dir ? `${dir}/${f}` : f)
      const wasm = /cdylib/.test(src) && /wasm-bindgen/.test(src)
      projects.push({ lang: 'rs', dir, root: dir ? `${dir}/src` : 'src', name, crate: name.replace(/-/g, '_'), kind: has('src/main.rs') || /\[\[bin\]\]/.test(src) ? 'app' : wasm ? 'webapp' : 'library', technology: wasm ? 'Rust · Wasm' : 'Rust', description: toml(src, 'description') })
    } else if (file === 'pom.xml' || /^build\.gradle(\.kts)?$/.test(file)) {
      const src = read(p)
      const spring = /spring-boot|springframework\.boot/.test(src)
      const settings = ['settings.gradle', 'settings.gradle.kts'].map(s => (dir ? `${dir}/${s}` : s)).find(s => files.includes(s))
      const name = (file === 'pom.xml' ? tag(src, 'artifactId') : settings && read(settings).match(/rootProject\.name\s*=\s*['"]([^'"]+)/)?.[1]) || basename(dir || resolve(repo))
      projects.push({ lang: 'java', dir, root: dir ? `${dir}/src/main/java` : 'src/main/java', name, kind: spring || /application|mainClass/.test(src) ? 'app' : 'library', technology: `Java${spring ? ' · Spring Boot' : ''}`, description: tag(src, 'description') })
    } else if (file === 'package.json') {
      const pkg = readJson(join(repo, p))
      if (!pkg || (!pkg.name && !pkg.scripts)) continue
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const tech = ['react', 'vue', 'svelte', 'next', 'express', 'fastify', 'vite'].filter(d => deps[d]).map(d => d[0].toUpperCase() + d.slice(1))
      const lib = !!(pkg.main || pkg.module || pkg.exports) && !pkg.bin && !deps.vite && !deps.next
      projects.push({ lang: 'js', dir, root: dir, name: pkg.name ?? basename(dir || resolve(repo)), kind: lib ? 'library' : 'app', technology: tech.join(' · '), description: pkg.description ?? '', pkg })
    }
  }
  return projects
}

/** The module code of a page's inline scripts. */
const inlineScripts = html => [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

/**
 * JS/TS module resolution: relative paths, tsconfig paths and baseUrl, the repo's own packages,
 * and wasm-pack output (pkg/<crate>.js) back to the Rust crate it is built from.
 */
function jsResolver(repo, projects, fileSet, allSet) {
  const tryExts = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs']
  const find = base => {
    base = posix.normalize(base)
    const stem = base.replace(/\.(m|c)?jsx?$/, '')
    for (const b of base === stem ? [base] : [base, stem]) for (const e of tryExts) if (fileSet.has(b + e)) return b + e
    return null
  }
  const pkgs = projects.filter(p => p.lang === 'js')
  // Every tsconfig*.json in a package: Vite's templates keep paths in tsconfig.app.json.
  for (const p of pkgs) {
    p.aliases = []
    for (const f of [...allSet].filter(f => dirOf(f) === p.dir && /^tsconfig.*\.json$/.test(posix.basename(f)))) {
      const o = readJson(join(repo, f))?.compilerOptions ?? {}
      const base = posix.join(p.dir, o.baseUrl ?? '.')
      for (const [k, v] of Object.entries(o.paths ?? {})) p.aliases.push({ prefix: k.replace(/\*$/, ''), to: (v[0] ?? '').replace(/\*$/, ''), base })
      if (o.baseUrl) p.baseUrl = base
    }
  }
  const entryOf = p => {
    const ex = p.pkg?.exports
    const main = (typeof ex === 'string' ? ex : ex?.['.']?.import ?? ex?.['.']?.default ?? (typeof ex?.['.'] === 'string' ? ex['.'] : null)) ?? p.pkg?.module ?? p.pkg?.main
    return (main && find(posix.join(p.dir, main))) || find(posix.join(p.dir, 'src/index')) || find(posix.join(p.dir, 'index'))
  }
  const crates = projects.filter(p => p.lang === 'rs')
  const wasmPkg = spec => {
    const name = spec.match(/(?:^|\/)pkg\/([\w-]+)\.js$/)?.[1]?.replace(/-/g, '_')
    const c = name && crates.find(x => x.crate === name)
    return c ? ['lib.rs', 'main.rs'].map(f => `${c.root}/${f}`).find(f => allSet.has(f)) ?? null : null
  }
  return {
    find,
    resolve(from, spec, owner) {
      if (spec.startsWith('.')) return find(posix.join(dirOf(from), spec)) ?? wasmPkg(spec)
      // A leading slash is the web root: the package, or the nearest served folder above the file.
      if (spec.startsWith('/')) {
        const webRoot = from.match(/^(.*?\/)?(wwwroot|public|www|static)\//)?.[0]
        return (owner && find(posix.join(owner.dir, spec.slice(1)))) || (webRoot && find(posix.join(webRoot, spec.slice(1)))) || find(posix.join(dirOf(from), spec.slice(1)))
      }
      for (const a of owner?.aliases ?? []) if (spec.startsWith(a.prefix)) { const r = find(posix.join(a.base, a.to, spec.slice(a.prefix.length))); if (r) return r }
      const p = pkgs.find(x => x !== owner && (spec === x.name || spec.startsWith(`${x.name}/`)))
      if (p) return spec === p.name ? entryOf(p) : find(posix.join(p.dir, spec.slice(p.name.length + 1)))
      return owner?.baseUrl ? find(posix.join(owner.baseUrl, spec)) : null
    },
    /**
     * Every page in the repo: its local script files are entry points, and a page with inline
     * module code is an application file itself, whose imports are followed.
     */
    pages() {
      const scripts = [], inline = []
      for (const page of [...allSet].filter(f => extOf(f) === '.html' && !TEST.test(f))) {
        const html = readFileSync(join(repo, page), 'utf8')
        const pkg = pkgs.filter(p => under(page, p.dir)).sort((a, b) => b.dir.length - a.dir.length)[0]
        for (const m of html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) {
          if (/^(https?:)?\/\//.test(m[1])) continue
          // A leading slash means the page's server root: the page's folder, or its package's.
          const f = m[1].startsWith('/') ? find(posix.join(dirOf(page), m[1].slice(1))) ?? (pkg && find(posix.join(pkg.dir, m[1].slice(1)))) : find(posix.join(dirOf(page), m[1]))
          if (f) scripts.push(f)
        }
        if (/\bimport\b/.test(inlineScripts(html))) inline.push(page)
      }
      return { scripts, inline }
    },
    /** Where a package's app starts: its pages' scripts, package.json entries, npm scripts. */
    entries(p, pageScripts) {
      const out = new Set(pageScripts.filter(f => under(f, p.dir)))
      const add = rel => { const f = find(posix.join(p.dir, rel)); if (f) out.add(f) }
      const e = entryOf(p)
      if (e && (p.pkg?.main || p.pkg?.module || p.pkg?.exports)) out.add(e)
      const bin = p.pkg?.bin
      for (const b of typeof bin === 'string' ? [bin] : Object.values(bin ?? {})) add(b)
      for (const [k, cmd] of Object.entries(p.pkg?.scripts ?? {})) {
        if (CHECK_SCRIPT.test(k)) continue
        for (const m of String(cmd).matchAll(/(?:^|[\s;&|])(?:node|tsx|ts-node|bun|vite-node|deno run)\s+(?:-{1,2}\S+\s+)*([\w./@-]+\.[cm]?[jt]sx?)/g)) add(m[1])
      }
      // Next.js routes are entry points by convention.
      if (p.pkg?.dependencies?.next) for (const f of fileSet) if (LANG[extOf(f)] === 'js' && /^(src\/)?(app|pages)\//.test(f.slice(p.dir ? p.dir.length + 1 : 0)) && under(f, p.dir)) out.add(f)
      if (!out.size) for (const c of ['src/main', 'src/index', 'index', 'main', 'server', 'app']) add(c)
      return [...out]
    },
  }
}

function summary(src, lang) {
  if (lang === 'html') return src.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''
  if (lang === 'cs') {
    const m = src.match(/\/\/\/\s*<summary>([\s\S]*?)<\/summary>/)
    return m ? m[1].replace(/^\s*\/\/\/\s?/gm, ' ').replace(/<see\s+cref="(?:[A-Z]:)?([^"]+)"\s*\/>/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''
  }
  const lines = []
  if (lang === 'rs') {
    for (const l of src.split('\n')) {
      const m = l.match(/^\s*\/\/[!/]\s?(.*)$/)
      if (m) lines.push(m[1])
      else if (lines.length || l.trim()) break
    }
    return lines.join(' ').trim()
  }
  // Java: the Javadoc on the top-level type. JS/TS: a leading block or line comment.
  const block = lang === 'java'
    ? src.match(/\/\*\*([\s\S]*?)\*\/\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+|final\s+|abstract\s+)*(?:class|interface|enum|record)\b/)
    : src.match(/^\s*(?:#![^\n]*\n\s*)?\/\*\*?([\s\S]*?)\*\//)
  if (block) return block[1].replace(/^\s*\*\s?/gm, ' ').replace(/@\w+.*$/gm, '').replace(/\s+/g, ' ').trim()
  if (lang === 'java') return ''
  for (const l of src.split('\n')) {
    const m = l.match(/^\s*\/\/\s?(.*)$/)
    if (m) lines.push(m[1])
    else break
  }
  return lines.join(' ').trim()
}

// Lines that show where one process talks to another, for the links a map adds. First match wins.
const HINTS = [
  ['route', /@(Get|Post|Put|Delete|Patch|Request)Mapping\b.*|\[(Http(Get|Post|Put|Delete|Patch)|Route)\b[^\]]*\]|\.Map(Get|Post|Put|Delete|Patch|Hub|Fallback\w*)?\s*\(\s*\$?"\/.*|\.Use(StaticFiles|DefaultFiles|FileServer)\s*\(.*|\b(app|router|server|fastify)\.(get|post|put|delete|patch|all)\s*\(\s*['"`].*|\.route\(\s*"[^"]*".*|\bhttps?\.createServer\s*\(.*|\bexpress\.static\s*\(.*/],
  ['schedule', /@Scheduled\b.*|\bclass\s+\w+\s*:\s*BackgroundService\b|\bsetInterval\s*\(.*|\bcron\.schedule\s*\(.*|\bPeriodicTimer\b.*/],
  ['store', /\b(extends|implements)\s+\w*(Jpa|Crud|PagingAndSorting|Mongo|Reactive\w*)Repository\b.*|:\s*DbContext\b.*|\b(new\s+)?(NpgsqlConnection|NpgsqlDataSource|SqlConnection|SqliteConnection|MySqlConnection)\b\s*[(.].*|\.Use(Npgsql|SqlServer|Sqlite|MySql)\s*\(.*|\bnew\s+PrismaClient\b.*|\bmongoose\.connect\s*\(.*|\bcreatePool\s*\(.*|\bsqlx::query\w*!?\s*\(.*|\bJdbcTemplate\b.*/],
  ['socket', /\bnew\s+(WebSocket|EventSource|HubConnectionBuilder)\b.*|\b(WebSocket|TcpStream|UdpSocket)::(new|connect)\s*\(.*|\bTcpListener::bind\s*\(.*|\bClientWebSocket\b.*|\.(UseWebSockets|AcceptWebSocketAsync)\s*\(.*|\bNamedPipe(Server|Client)Stream\b.*|\bio\s*\(\s*['"`].*|\bTcpListener\b.*|\bTcpClient\b.*/],
  ['process', /\b(execFileSync|execFile|execSync|spawnSync|spawn|Process\.Start|ProcessBuilder|Command::new|CreateProcess\w*)\s*\(.*|\bnew\s+ProcessStartInfo\b.*/],
  // Files one process writes for another to read.
  ['file', /\b(writeFileSync|writeFile|renameSync|createWriteStream|File\.(WriteAll\w+|Move)|Files\.(write|move))\s*\(.*/],
  // fetch with any string, or a string that looks like a URL path or an absolute URL, passed to a call.
  // HttpClient calls take relative paths from a BaseAddress, so any string literal counts there.
  ['call', /\bfetch\s*\(.*|\b(Get|Post|Put|Patch|Delete|Send)(AsJson|FromJson|String|ByteArray|Stream)?Async\s*\(\s*\$?@?".*|\bHttpMethod\.\w+\s*,\s*\$?".*|\bnew\s+Uri\s*\(\s*\$?"(https?|wss?):\/\/.*|\b(axios(\.\w+)?|\w*[Ff]etch\w*|request|get|post|put|patch|delete|GetAsync|PostAsync|PutAsync|DeleteAsync|SendAsync|uri|exchange|getForObject|postForObject)\s*\(\s*(['"`])(\$\{[^}]+\})?(https?:\/\/|\/)[^'"`]*\3.*/],
]
const CONFIG = /(^|\/)(application[\w-]*\.(properties|ya?ml)|appsettings[\w.-]*\.json|\.env[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Dockerfile[\w.-]*|nginx[\w.-]*\.conf|Procfile|fly\.toml|vercel\.json|netlify\.toml|serverless\.ya?ml|launchSettings\.json)$|(^|\/)(k8s|helm|deploy|infra|charts)\/.*\.(ya?ml|json|tf)$|\.tf$/

/** Route, call, schedule, store, socket, process and file lines of a file, with their line numbers. */
function hintsOf(src) {
  const out = []
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|#)/.test(line)) return
    for (const [kind, re] of HINTS) {
      const m = line.match(re)
      if (m) { out.push({ line: i + 1, kind, text: m[0].trim().slice(0, 140) }); break }
    }
  })
  return out
}

/**
 * The file graph of a repository's application code.
 * @returns {{ repo, projects, entries, config, files, edges, dropped }}
 */
export function buildGraph(repo) {
  repo = resolve(repo)
  if (!existsSync(repo)) throw new Error(`no repository at ${repo}`)
  const all = listFiles(repo)
  const projects = discover(repo, all)
  const source = all.filter(p => LANG[extOf(p)] && !GENERATED.test(p))
  const tests = source.filter(p => TEST.test(p))
  const candidates = source.filter(p => !TEST.test(p))

  // Each file belongs to the deepest project of its language whose root holds it.
  const owner = new Map()
  for (const p of candidates) {
    let best = null
    for (const pr of projects) if (pr.lang === LANG[extOf(p)] && under(p, pr.root) && (!best || pr.root.length > best.root.length)) best = pr
    owner.set(p, best)
  }
  const recs = new Map()
  const rec = p => {
    if (!recs.has(p)) {
      const src = readFileSync(join(repo, p), 'utf8')
      recs.set(p, { path: p, lang: extOf(p) === '.html' ? 'html' : LANG[extOf(p)], project: owner.get(p) ?? null, src, edges: new Map() })
    }
    return recs.get(p)
  }
  const relate = (from, to, name) => {
    if (!from || !to || from === to) return
    const names = from.edges.get(to.path) ?? new Set()
    if (name) names.add(name)
    from.edges.set(to.path, names)
  }

  // Compiled languages: whatever a non-test project compiles, Unity Editor scripts included (like
  // any dev tool with an entry point, they are part of the system; a map can group them apart).
  const testProjects = projects.filter(pr => pr.kind === 'test')
  for (const p of candidates) {
    const pr = owner.get(p)
    if (!pr || pr.lang === 'js' || pr.kind === 'test') continue
    if (testProjects.some(t => under(p, t.dir))) continue
    rec(p)
  }

  // JS/TS: what the entry points reach through imports.
  const fileSet = new Set(candidates.filter(p => LANG[extOf(p)] === 'js'))
  const js = jsResolver(repo, projects, fileSet, new Set(all))
  const pages = js.pages()
  const entries = [...pages.scripts, ...projects.filter(p => p.lang === 'js').flatMap(p => js.entries(p, pages.scripts))]
  // Static and dynamic imports, require, workers or assets loaded with new URL(…, import.meta.url),
  // and workers started from a path (new Worker('w.js'), serviceWorker.register('sw.js')).
  const importSpec = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url|(?:serviceWorker\.register|new\s+(?:Shared)?Worker)\(\s*['"]([^'"]+)['"]/g
  const queue = [...new Set([...entries, ...pages.inline])]
  const seen = new Set(queue)
  while (queue.length) {
    const f = rec(queue.shift())
    const code = (f.lang === 'html' ? inlineScripts(f.src) : f.src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    for (const m of code.matchAll(importSpec)) {
      // A worker path is a URL, so a bare name is relative to the file, not a package.
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? (m[6] && (/^[./]/.test(m[6]) ? m[6] : `./${m[6]}`))
      const target = js.resolve(f.path, spec, f.project)
      if (!target) continue
      relate(f, rec(target), spec.startsWith('.') ? posix.basename(spec).replace(/\.\w+$/, '') : spec)
      // A Rust crate behind wasm-pack output is linked to, not read as JS.
      if (!seen.has(target) && fileSet.has(target)) { seen.add(target); queue.push(target) }
    }
  }

  const files = [...recs.values()]
  relateCs(files, projects, relate)
  relateRs(files, projects, relate)
  relateJava(files, relate)

  // Commits touching each file in the last 90 days, for the churn lens.
  const churn = new Map()
  try {
    const log = execFileSync('git', ['-C', repo, 'log', '--since=90.days', '--name-only', '--relative', '--pretty=format:'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    for (const line of log.split('\n')) if (line.trim()) churn.set(line.trim(), (churn.get(line.trim()) ?? 0) + 1)
  } catch { /* not a git checkout: no churn lens */ }

  const byFolder = (a, b) => (dirOf(a.path) === dirOf(b.path) ? a.path.localeCompare(b.path) : dirOf(a.path) < dirOf(b.path) ? -1 : 1)
  const appFiles = files.sort(byFolder)
  // Compiled entry points: main methods. More than one in a project usually means a dev tool.
  const mains = appFiles.filter(f => f.lang === 'java' ? /\bstatic\s+void\s+main\s*\(/.test(f.src) : f.lang === 'cs' ? /\bstatic\s+(async\s+)?[\w<>]+\s+Main\s*\(/.test(f.src) || posix.basename(f.path) === 'Program.cs' : f.lang === 'rs' && (posix.basename(f.path) === 'main.rs' || /\/bin\//.test(f.path))).map(f => f.path)
  return {
    repo,
    projects: projects.filter(p => p.kind !== 'test' && appFiles.some(f => f.project === p)).map(({ lang, dir, name, kind, technology, description }) => ({ lang, dir, name, kind, technology, description: description ?? '' })),
    entries: [...new Set([...entries, ...pages.inline, ...mains])].sort(),
    // Config and deploy files name the other processes: datasources, base URLs, ports, services.
    config: all.filter(p => CONFIG.test(p) && !TEST.test(p)).sort(),
    files: appFiles.map(f => ({ path: f.path, lang: f.lang, project: f.project?.dir ?? null, lines: f.src.split('\n').length, churn: churn.get(f.path) ?? 0, doc: summary(f.src, f.lang), hints: hintsOf(f.src) })),
    edges: appFiles.flatMap(f => [...f.edges].map(([to, names]) => ({ from: f.path, to, names: [...names] }))),
    dropped: { tests: tests.length + candidates.filter(p => testProjects.some(t => under(p, t.dir))).length, unreached: candidates.filter(p => !recs.has(p) && !testProjects.some(t => under(p, t.dir))).sort() },
  }
}

/**
 * Types another file can name: declared at the file's top level (inside a namespace in C#), and
 * not private or protected. Nested helper types such as a private `struct Rect` stay local.
 */
function topLevelTypes(code, lang) {
  const width = s => s.replace(/\t/g, '    ').length
  let top = 0
  if (lang === 'cs' && !/^\s*namespace\s+[\w.]+\s*;/m.test(code)) {
    const ns = code.match(/^([ \t]*)namespace\s+[\w.]+\s*\{?/m)
    if (ns) top = width(ns[1]) + 4
  }
  const out = new Set()
  for (const m of code.matchAll(/^([ \t]*)((?:public|internal|private|protected|static|sealed|abstract|partial|readonly|ref|unsafe|file|new|final)\s+)*(?:class|struct|record(?:\s+(?:class|struct))?|interface|enum|@interface)\s+([A-Z]\w*)/gm)) {
    if (width(m[1]) <= top && !/\b(private|protected)\b/.test(m[0])) out.add(m[3])
  }
  return out
}

/** C#: PascalCase identifiers that name a type declared in this project or one it references. */
function relateCs(files, projects, relate) {
  const cs = files.filter(f => f.lang === 'cs')
  const byManifest = new Map(projects.filter(p => p.manifest).map(p => [p.manifest, p]))
  const typeFiles = new Map()
  for (const f of cs) {
    f.code = stripC(f.src)
    f.declares = new Set([...f.code.matchAll(/\b(?:class|struct|record|interface|enum)\s+([A-Z]\w*)/g)].map(m => m[1]))
    // Only top-level, non-private types can be named from another file.
    for (const t of topLevelTypes(f.code, 'cs')) typeFiles.set(t, [...(typeFiles.get(t) ?? []), f])
  }
  const csProjects = projects.filter(x => x.lang === 'cs')
  for (const p of csProjects) {
    // Unity sees the projects its manifest's file: packages point at, and what those reference.
    const start = p.unity ? (p.packages ?? []).map(d => csProjects.find(q => !q.unity && q.dir === d)).filter(Boolean) : []
    const seen = new Set([p, ...start]), stack = [p, ...start]
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
      relate(f, pool.find(g => posix.basename(g.path, '.cs') === t) ?? pool[0], t)
    }
  }
}

/** Rust: module paths within a crate, and paths into other crates of the repo. */
function relateRs(files, projects, relate) {
  const crates = projects.filter(p => p.lang === 'rs')
  const stem = f => posix.basename(f.path, '.rs')
  const entry = new Map(crates.map(c => [c.crate, files.find(f => f.project === c && ['lib', 'main'].includes(stem(f)))]))
  for (const c of crates) {
    const mine = files.filter(f => f.project === c)
    const mods = new Map(mine.map(f => [stem(f) === 'mod' ? posix.basename(dirOf(f.path)) : stem(f), f]))
    for (const f of mine) {
      const code = f.src.replace(/\/\/.*$/gm, ' ').replace(/^\s*(pub\s+)?mod\s+\w+\s*;/gm, ' ')
      for (const m of code.matchAll(/\b(?:crate|super)::(\w+)|\b(\w+)::/g)) {
        const name = m[1] ?? m[2]
        const t = mods.get(name)
        if (t && t !== f) relate(f, t, `${name}::`)
        else if (name !== c.crate && entry.get(name)) relate(f, entry.get(name), name)
      }
    }
  }
}

/** Java: types of the same package, explicit imports, and wildcard imports. */
function relateJava(files, relate) {
  const java = files.filter(f => f.lang === 'java')
  const byFqn = new Map(), byPkg = new Map()
  for (const f of java) {
    f.code = stripC(f.src)
    f.pkg = f.code.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? ''
    f.declares = new Set([...f.code.matchAll(/\b(?:class|interface|enum|record|@interface)\s+([A-Z]\w*)/g)].map(m => m[1]))
    // Nested types are reached through imports of Outer.Inner; only top-level ones are package-visible.
    for (const t of f.declares) byFqn.set(`${f.pkg}.${t}`, f)
    for (const t of topLevelTypes(f.code, 'java')) byPkg.set(f.pkg, [...(byPkg.get(f.pkg) ?? []), [t, f]])
  }
  // An import names a type, a nested type, or (static) a member: the longest known prefix wins.
  const typeAt = fqn => { for (let s = fqn; s.includes('.'); s = s.slice(0, s.lastIndexOf('.'))) if (byFqn.has(s)) return [s, byFqn.get(s)]; return null }
  for (const f of java) {
    const visible = new Map(byPkg.get(f.pkg) ?? [])
    for (const m of f.code.matchAll(/^\s*import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/gm)) {
      if (m[3] && !m[1]) for (const [t, g] of byPkg.get(m[2]) ?? []) visible.set(t, g)
      const hit = typeAt(m[2])
      if (hit) { visible.set(hit[0].slice(hit[0].lastIndexOf('.') + 1), hit[1]); if (m[1]) relate(f, hit[1], hit[0].slice(hit[0].lastIndexOf('.') + 1)) }
    }
    for (const t of new Set(f.code.match(/\b[A-Z]\w*\b/g) ?? [])) {
      if (f.declares.has(t)) continue
      const g = visible.get(t)
      if (g && g !== f) relate(f, g, t)
    }
  }
}
