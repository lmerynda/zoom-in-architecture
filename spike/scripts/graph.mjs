// Builds the file graph of a codebase's application code: the source files that make up the
// running app, and the references between them. Deterministic, no AI. Tests, build configs and
// other tooling are left out:
// - JS/TS files count when an entry point reaches them through imports (index.html scripts,
//   package.json main/exports/bin and the `node <file>` npm scripts, conventional src/main.*).
//   eslint.config, vite.config, playwright.config and the like are never imported, so they drop.
// - C#, Rust, Java and Go files count when a non-test project compiles them (.csproj, Cargo src/,
//   Maven/Gradle src/main/java, go.mod).
// - Python files count when they are in a package (frameworks find modules by convention), or are a
//   script with an entry point (__main__, manage.py, wsgi/asgi), or one of those imports them.
// scripts/map.mjs turns the graph and an agent-written map into a viewer model.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'

const LANG = { '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.cs': 'cs', '.rs': 'rs', '.java': 'java', '.py': 'py', '.go': 'go' }
// Generated code, vendored dependencies and Java's package and module docs are not the application's own.
const GENERATED = /(^|\/)(package|module)-info\.java$|(\.Designer\.cs|\.g\.cs|AssemblyInfo\.cs|\.d\.ts|\.min\.js|_pb2(_grpc)?\.py|\.pb(\.gw)?\.go|_gen\.go)$|(^|\/)Migrations\/.*\.cs$|(^|\/)(migrations|alembic\/versions)\/[^/]*\.py$|(^|\/)vendor\//
const TEST = /(^|\/)(tests?|__tests__|__mocks__|mocks?|specs?|e2e|cypress|playwright|benches|fixtures)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|[.-]test[.-]?helpers?\.[cm]?[jt]sx?$|(^|\/)(setupTests|test-utils|testUtils)\.[cm]?[jt]sx?$|Tests?\.cs$|_test\.go$|(^|\/)testdata\/|(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/
// Server-side view templates (Thymeleaf, Jinja, Razor, ERB, Handlebars and the like).
const VIEW = /\.(html?|jinja2?|j2|cshtml|razor|erb|hbs|handlebars|mustache|ejs|pug|jade|twig|ftlh?|vm|jsp|tmpl|gohtml|liquid|njk)$/
// Where a bare view name is a view: returned or passed to a view or render call, or a template's
// layout, fragment or include.
const VIEW_AT = /(\breturn\s+|\b(?:ModelAndView|setViewName|View|render\w*|TemplateResponse|get_template|PartialView)\s*\((?:[^()'"]*,\s*)?|~\{\s*|\b(?:extends|include|import|partial|layout|th:(?:replace|insert|include))\b[=\s(]*)["'`~]?$/
// Python files that configure tooling rather than run the app.
const PY_TOOLING = /(^|\/)(setup|noxfile|fabfile)\.py$|(^|\/)docs?\/.*\.py$/
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'target', 'dist', 'build', 'out', 'coverage', 'Library', 'Temp', 'Logs'])
// npm scripts that check, build, release or measure the code rather than run the app.
const CHECK_SCRIPT = /test|lint|format|prettier|e2e|coverage|storybook|typecheck|check|build|release|publish|deploy|prepare|install|version|clean|docs?\b|locales?|stats|size|analy[sz]e|bump|changeset/

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
    } else if (file === 'go.mod') {
      const src = read(p)
      const module = src.match(/^module\s+(\S+)/m)?.[1] ?? ''
      projects.push({ lang: 'go', dir, root: dir, name: module || basename(dir || resolve(repo)), module, kind: 'library', technology: `Go${src.match(/^go\s+(\d+\.\d+)/m) ? ` ${src.match(/^go\s+(\d+\.\d+)/m)[1]}` : ''}` })
    } else if (['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'].includes(file)) {
      // One Python project per folder, whichever manifest it has.
      const src = read(p)
      if (file === 'pyproject.toml' && !/^\[(project|tool\.poetry)\]/m.test(src)) continue
      const known = projects.find(x => x.lang === 'py' && x.dir === dir)
      const frameworks = ['Django', 'FastAPI', 'Flask', 'Starlette', 'aiohttp', 'Celery', 'SQLAlchemy', 'SQLModel'].filter(fw => new RegExp(`(^|[\\s"'\\[,])${fw}\\b`, 'im').test(src))
      const scripts = [...(src.match(/^\[(?:project|tool\.poetry)\.scripts\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? '').matchAll(/=\s*['"]([\w.]+):/g)].map(m => m[1])
      if (known) { known.frameworks = [...new Set([...known.frameworks, ...frameworks])]; known.scripts.push(...scripts); continue }
      const name = (file === 'pyproject.toml' && toml(src, 'name')) || src.match(/\bname\s*=\s*['"]([^'"]+)/)?.[1] || basename(dir || resolve(repo))
      projects.push({ lang: 'py', dir, root: dir, name, frameworks, scripts, kind: 'library', technology: '', description: toml(src, 'description') })
    } else if (file === 'package.json') {
      const pkg = readJson(join(repo, p))
      if (!pkg || (!pkg.name && !pkg.scripts)) continue
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const tech = ['react', 'vue', 'svelte', 'next', 'express', 'fastify', 'vite'].filter(d => deps[d]).map(d => d[0].toUpperCase() + d.slice(1))
      const lib = !!(pkg.main || pkg.module || pkg.exports) && !pkg.bin && !deps.vite && !deps.next
      projects.push({ lang: 'js', dir, root: dir, name: pkg.name ?? basename(dir || resolve(repo)), kind: lib ? 'library' : 'app', technology: tech.join(' · '), description: pkg.description ?? '', pkg })
    }
  }
  for (const p of projects.filter(x => x.lang === 'py')) {
    p.kind = p.frameworks.some(fw => ['Django', 'FastAPI', 'Flask', 'Starlette', 'aiohttp'].includes(fw)) || p.scripts.length ? 'app' : 'library'
    p.technology = ['Python', ...p.frameworks].join(' · ')
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
  // Python: the module docstring. Go: the comment above the package clause.
  if (lang === 'py') return src.match(/^(?:\s*#[^\n]*\n)*\s*[rRuU]?("""|''')([\s\S]*?)\1/)?.[2]?.replace(/\s+/g, ' ').trim() ?? ''
  if (lang === 'go') return (src.match(/((?:^\/\/[^\n]*\n)+)package\s/m)?.[1] ?? '').replace(/^\/\/\s?/gm, ' ').replace(/\s+/g, ' ').trim()
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
  ['store', /\b(localStorage|sessionStorage)\.(setItem|getItem|removeItem)\s*\(.*|\bindexedDB\.open\s*\(.*|\bcreateStore\s*\(\s*['"].*|\b(extends|implements)\s+\w*(Jpa|Crud|PagingAndSorting|Mongo|Reactive\w*)Repository\b.*|\b(extends|implements)\s+Repository\s*<.*|\b(getFirestore|getStorage|getDatabase|initializeFirestore)\s*\(.*|:\s*DbContext\b.*|\b(new\s+)?(NpgsqlConnection|NpgsqlDataSource|SqlConnection|SqliteConnection|MySqlConnection)\b\s*[(.].*|\.Use(Npgsql|SqlServer|Sqlite|MySql)\s*\(.*|\bnew\s+PrismaClient\b.*|\bmongoose\.connect\s*\(.*|\bcreatePool\s*\(.*|\bsqlx::query\w*!?\s*\(.*|\bJdbcTemplate\b.*/],
  ['socket', /\bnew\s+(WebSocket|EventSource|HubConnectionBuilder)\b.*|\b(socketIOClient|io\.connect)\s*\(.*|\b(WebSocket|TcpStream|UdpSocket)::(new|connect)\s*\(.*|\bTcpListener::bind\s*\(.*|\bClientWebSocket\b.*|\.(UseWebSockets|AcceptWebSocketAsync)\s*\(.*|\bNamedPipe(Server|Client)Stream\b.*|\bio\s*\(\s*['"`].*|\bTcpListener\b.*|\bTcpClient\b.*/],
  ['message', /\.postMessage\s*\(.*|\baddEventListener\s*\(\s*['"]message['"].*|\bonmessage\s*=.*/],
  ['process', /\bnew\s+(?:Shared)?Worker\s*\(.*|\b(execFileSync|execFile|execSync|spawnSync|spawn|Process\.Start|ProcessBuilder|Command::new|CreateProcess\w*)\s*\(.*|\bnew\s+ProcessStartInfo\b.*/],
  // Files one process writes for another to read.
  ['file', /\b(writeFileSync|writeFile|renameSync|createWriteStream|File\.(WriteAll\w+|Move)|Files\.(write|move))\s*\(.*/],
  // fetch with any string, or a string that looks like a URL path or an absolute URL, passed to a call.
  // HttpClient calls take relative paths from a BaseAddress, so any string literal counts there.
  // Python and Go seams.
  ['route', /@(app|bp|blueprint|router|api|\w+_router)\.(route|get|post|put|delete|patch|websocket|api_route)\s*\(.*|\b(re_)?path\s*\(\s*r?['"][^'"]*['"]\s*,.*|\.(HandleFunc|Handle)\s*\(\s*"\/.*|\b\w+\.(GET|POST|PUT|DELETE|PATCH|Get|Post|Put|Delete|Patch)\s*\(\s*"\/.*|\bhttp\.ListenAndServe(TLS)?\s*\(.*|\.(PathPrefix|Path|Methods|Host)\s*\(\s*"\/.*|\bAPIRouter\s*\(.*|\.include_router\s*\(.*|\bBlueprint\s*\(.*|\.register_blueprint\s*\(.*|\.mount\s*\(\s*['"]\/.*|\bStaticFiles\s*\(.*/],
  ['queue', /\bCelery\s*\(.*|@(shared_task|\w+\.task)\b.*|\.(delay|apply_async)\s*\(.*|\bpika\.\w*Connection\s*\(.*|\bKafka(Producer|Consumer)\s*\(.*|\bamqp\.Dial\s*\(.*|\bnats\.Connect\s*\(.*|\bkafka\.New(Writer|Reader)\s*\(.*/],
  ['store', /\bsession\.(exec|add|add_all|commit|delete|query|execute|scalars|merge|refresh|flush)\s*\(.*|\bSession\s*\(\s*engine\b.*|\b(tx|db|conn|stmt)\.(Exec|Query|QueryRow|Prepare)(Context)?\s*\(.*|\bcreate_(async_)?engine\s*\(.*|\b(psycopg2?|sqlite3|pymysql|asyncpg|aiosqlite)\.connect\s*\(.*|\bredis\.(Redis|StrictRedis|from_url)\s*\(.*|\bMongoClient\s*\(.*|\bclass\s+\w+\s*\((models\.Model|[^)]*table\s*=\s*True)[^)]*\).*|\bsql\.Open\s*\(.*|\bgorm\.Open\s*\(.*|\bpgx(pool)?\.(Connect|New)\w*\s*\(.*|\bredis\.NewClient\s*\(.*|\bmongo\.Connect\s*\(.*|\bbolt\.Open\s*\(.*/],
  ['socket', /\bautocert\.(NewListener|Manager)\b.*|\bwebsockets\.(connect|serve)\s*\(.*|\bsocket\.socket\s*\(.*|\bnet\.(Listen|Dial)\w*\s*\(.*|\bwebsocket\.Upgrader\b.*|\bgrpc\.(NewServer|Dial|NewClient)\s*\(.*/],
  ['process', /\bsubprocess\.(run|Popen|call|check_output|check_call)\s*\(.*|\bos\.system\s*\(.*|\bexec\.Command(Context)?\s*\(.*/],
  ['call', /\b\w*[Cc]lient\.Do\s*\(.*|\bhttp\.DefaultClient\.\w+\s*\(.*|\.Exchange\s*\(\s*ctx\b.*|\brollbar\.\w+\s*\(.*|\bsentry_sdk\.init\s*\(.*|\bsmtplib\.SMTP\w*\s*\(.*|\.send\s*\([^)]*\bsmtp\s*=.*|\b(requests|httpx)\.(get|post|put|patch|delete|request|AsyncClient|Client)\s*\(.*|\burlopen\s*\(.*|\bhttp\.(Get|Post|PostForm|Head)\s*\(.*|\bhttp\.NewRequest(WithContext)?\s*\(.*/],
  // Generated API clients pass the path in an options object.
  ['call', /\b(url|baseURL|baseUrl)\s*:\s*['"`](\$\{[^}]+\})?(https?:\/\/|\/)[^'"`]*['"`](?!\s*;).*/],
  ['call', /\bfetch\s*\(.*|\bwindow\.open\s*\(.*|\bSentry\.init\s*\(.*|\b(Get|Post|Put|Patch|Delete|Send)(AsJson|FromJson|String|ByteArray|Stream)?Async\s*\(\s*\$?@?".*|\bHttpMethod\.\w+\s*,\s*\$?".*|\bnew\s+Uri\s*\(\s*\$?"(https?|wss?):\/\/.*|\b(axios(\.\w+)?|\w*[Ff]etch\w*|request|get|post|put|patch|delete|GetAsync|PostAsync|PutAsync|DeleteAsync|SendAsync|uri|exchange|getForObject|postForObject)\s*\(\s*(['"`])(\$\{[^}]+\})?(https?:\/\/|\/)[^'"`]*\3.*/],
]
const CONFIG = /(^|\/)(application[\w-]*\.(properties|ya?ml)|appsettings[\w.-]*\.json|\.env[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Dockerfile[\w.-]*|nginx[\w.-]*\.conf|Procfile|fly\.toml|vercel\.json|netlify\.toml|serverless\.ya?ml|launchSettings\.json|Makefile|alembic\.ini|[\w.-]+\.service)$|(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)(k8s|helm|deploy|infra|charts)\/.*\.(ya?ml|json|tf)$|\.tf$/

/** Route, call, schedule, store, queue, socket, message, process and file lines of a file, with their line numbers. */
function hintsOf(src) {
  const out = []
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|#)/.test(line)) return
    for (const [kind, re] of HINTS) {
      const m = line.match(re)
      // A call split over lines (`@router.get(` then the path): the next line says where it goes.
      const text = m && (/\($/.test(m[0].trim()) && lines[i + 1] ? `${m[0].trim()} ${lines[i + 1].trim()}` : m[0].trim())
      if (m) { out.push({ line: i + 1, kind, text: text.slice(0, 140) }); break }
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
  // An edge is type-only while every reference along it is a type import, and a re-export while
  // every one is an export … from (a barrel passing a module on, not using it).
  const relate = (from, to, name, types = false, reexport = false) => {
    if (!from || !to || from === to) return
    const e = from.edges.get(to.path) ?? { names: new Set(), types: true, reexport: true }
    if (name) e.names.add(name)
    e.types &&= types
    e.reexport &&= reexport
    from.edges.set(to.path, e)
  }

  // Compiled languages: whatever a non-test project compiles, Unity Editor scripts included (like
  // any dev tool with an entry point, they are part of the system; a map can group them apart).
  const testProjects = projects.filter(pr => pr.kind === 'test')
  for (const p of candidates) {
    const pr = owner.get(p)
    if (!pr || pr.lang === 'js' || pr.lang === 'py' || pr.kind === 'test') continue
    if (testProjects.some(t => under(p, t.dir))) continue
    // Go files for build tags the normal build never sets (tools, ignore) are tooling.
    if (pr.lang === 'go' && /^\/\/(go:build|\s*\+build)\s+!?(tools|ignore)\b/m.test(readFileSync(join(repo, p), 'utf8'))) continue
    rec(p)
  }
  // Go //go:embed: the embedded scripts are served by the binary, so they are application code.
  const embeds = []
  for (const f of [...recs.values()].filter(r => r.lang === 'go')) {
    for (const m of f.src.matchAll(/^\/\/go:embed\s+(.+)$/gm)) {
      for (const pat of m[1].trim().split(/\s+/).map(x => x.replace(/^"|"$/g, ''))) {
        const re = new RegExp(`^${posix.join(dirOf(f.path) || '.', pat).replace(/^\.\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}(\/.*)?$`)
        for (const t of all) if (re.test(t)) embeds.push([f.path, t])
      }
    }
  }

  // Python: whole packages, since frameworks find modules by convention (Django apps, Celery
  // tasks), plus scripts with an entry point and whatever they import.
  const pyFiles = new Set(candidates.filter(p => LANG[extOf(p)] === 'py' && !PY_TOOLING.test(p)))
  const pySrc = new Map()
  const pyRead = p => pySrc.get(p) ?? pySrc.set(p, readFileSync(join(repo, p), 'utf8')).get(p)
  const pyr = pythonResolver(pyFiles, new Set(all), pyRead)
  const pyScripts = new Set(projects.filter(p => p.lang === 'py').flatMap(p => p.scripts))
  // Scripts only CI runs (release helpers) are tooling, not entry points.
  const ciRuns = all.filter(p => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).flatMap(p => [...readFileSync(join(repo, p), 'utf8').matchAll(/(?:python3?|uv run|poetry run|pipenv run)\s+(?:-m\s+([\w.]+)|([\w./-]+\.py))/g)].map(m => m[2] ?? m[1]))
  const ciOnly = p => ciRuns.some(r => r === p || r === pyr.nameOf.get(p))
  const pyEntries = [...pyFiles].filter(p => !ciOnly(p) && (/(^|\/)(__main__|manage|wsgi|asgi)\.py$/.test(p) || /(^|\/)(alembic|migrations)\/env\.py$/.test(p) || /^if\s+__name__\s*==\s*['"]__main__['"]\s*:/m.test(pyRead(p)) || /^\w+\s*=\s*(FastAPI|Flask|Starlette|Quart|Sanic|Litestar)\s*\(/m.test(pyRead(p)) || /\bget_(asgi|wsgi)_application\s*\(/.test(pyRead(p)) || pyScripts.has(pyr.nameOf.get(p))))
  const pyQueue = [...new Set([...[...pyFiles].filter(p => pyr.isPkg(dirOf(p)) || /(^|\/)src\//.test(p)), ...pyEntries])]
  const pySeen = new Set(pyQueue)
  while (pyQueue.length) {
    const p = pyQueue.shift(), f = rec(p)
    for (const imp of pyr.importsOf(p, f.src)) {
      for (const [t, name] of pyr.resolveImport(p, imp)) {
        relate(f, rec(t), name, imp.types)
        if (!pySeen.has(t)) { pySeen.add(t); pyQueue.push(t) }
      }
    }
  }

  // JS/TS: what the entry points reach through imports.
  const fileSet = new Set(candidates.filter(p => LANG[extOf(p)] === 'js'))
  const js = jsResolver(repo, projects, fileSet, new Set(all))
  const pages = js.pages()
  const entries = [...pages.scripts, ...projects.filter(p => p.lang === 'js').flatMap(p => js.entries(p, pages.scripts)), ...embeds.map(([, t]) => t).filter(t => fileSet.has(t))]
  // Static and dynamic imports, require, workers or assets loaded with new URL(…, import.meta.url),
  // and workers started from a path (new Worker('w.js'), serviceWorker.register('sw.js')).
  const importSpec = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url|(?:serviceWorker\.register|new\s+(?:Shared)?Worker)\(\s*['"]([^'"]+)['"]/g
  const codeOf = f => (f.lang === 'html' ? inlineScripts(f.src) : f.src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  // What a module exports: names it declares, names it re-exports from elsewhere, and export * sources.
  const exportsOf = new Map()
  const exportInfo = path => {
    if (exportsOf.has(path)) return exportsOf.get(path)
    const f = rec(path), code = codeOf(f)
    const info = { locals: new Set(), named: new Map(), stars: [] }
    for (const m of code.matchAll(/\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g)) info.locals.add(m[1])
    if (/\bexport\s+default\b/.test(code)) info.locals.add('default')
    for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g)) {
      for (const s of m[1].split(',').map(x => x.trim().replace(/^type\s+/, '')).filter(Boolean)) {
        const [orig, as = orig] = s.split(/\s+as\s+/)
        if (m[2]) info.named.set(as, { spec: m[2], orig })
        else info.locals.add(as)
      }
    }
    for (const m of code.matchAll(/\bexport\s+\*\s+as\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]/g)) info.named.set(m[1], { spec: m[2], orig: null })
    for (const m of code.matchAll(/\bexport\s+\*\s+from\s*['"]([^'"]+)['"]/g)) info.stars.push(m[1])
    exportsOf.set(path, info)
    return info
  }
  // The file that defines `name`, followed through barrels (index files that only re-export).
  const definer = (path, name, depth = 0) => {
    if (depth > 8 || !fileSet.has(path)) return null
    const info = exportInfo(path), f = recs.get(path)
    if (info.locals.has(name)) return path
    const n = info.named.get(name)
    if (n) { const t = js.resolve(path, n.spec, f.project); return t && (n.orig ? definer(t, n.orig, depth + 1) ?? t : t) }
    for (const spec of info.stars) { const t = js.resolve(path, spec, f.project); const d = t && definer(t, name, depth + 1); if (d) return d }
    return null
  }
  // Static imports and re-exports with their clause, so names and type-only imports are known.
  const staticSpec = /\b(import|export)\s+(type\s+)?([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]/g
  const queue = [...new Set([...entries, ...pages.inline])]
  const seen = new Set(queue)
  const reach = target => { if (!seen.has(target) && fileSet.has(target)) { seen.add(target); queue.push(target) } }
  while (queue.length) {
    const f = rec(queue.shift())
    const code = codeOf(f)
    const label = spec => (spec.startsWith('.') ? posix.basename(spec).replace(/\.\w+$/, '') : spec)
    for (const m of code.matchAll(staticSpec)) {
      const target = js.resolve(f.path, m[4], f.project)
      if (!target) continue
      reach(target)
      const clause = m[3].trim()
      const braces = clause.match(/\{([^}]*)\}/)?.[1].split(',').map(x => x.trim()).filter(Boolean) ?? []
      const types = !!m[2] || (braces.length > 0 && braces.every(x => x.startsWith('type ')) && !/^[\w$]+\s*,/.test(clause))
      const names = braces.map(x => x.replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      if (/^[\w$]+(\s*,|$)/.test(clause) && m[1] === 'import') names.push('default')
      // Named imports go to the file defining each name; default, namespace and export * to the module.
      const reexport = m[1] === 'export'
      if (!names.length || !fileSet.has(target)) { relate(f, rec(target), label(m[4]), types, reexport); continue }
      for (const name of names) {
        const d = definer(target, name) ?? target
        reach(d)
        relate(f, rec(d), name === 'default' ? label(m[4]) : name, types, reexport)
      }
    }
    for (const m of code.matchAll(importSpec)) {
      if (m[1] != null) continue // static imports were handled above
      // A worker path is a URL, so a bare name is relative to the file, not a package.
      const spec = m[2] ?? m[3] ?? m[4] ?? m[5] ?? (m[6] && (/^[./]/.test(m[6]) ? m[6] : `./${m[6]}`))
      const target = js.resolve(f.path, spec, f.project)
      if (!target) continue
      relate(f, rec(target), label(spec))
      // A Rust crate behind wasm-pack output is linked to, not read as JS.
      reach(target)
    }
  }

  // Server-side views: templates in a templates/ or views/ folder of a project with application code.
  // A controller names its view by its path ("owners/ownerDetails"), and a template names the
  // layouts and fragments it uses the same way, so those strings become edges.
  const codeDirs = [...new Set([...recs.values()].map(r => r.project?.dir).filter(d => d != null))]
  const viewRoot = p => p.match(/^(.*?(?:^|\/)(?:templates|views|Views))\//)?.[1]
  const views = new Map() // key (path in its root, with and without extension) → path
  for (const p of all) {
    const root = viewRoot(p)
    if (root == null || !VIEW.test(p) || TEST.test(p) || !codeDirs.some(d => under(p, d))) continue
    const f = rec(p)
    f.lang = 'view'
    const key = p.slice(root.length + 1)
    views.set(key, p).set(key.replace(/\.[^./]+(\.[^./]+)?$/, ''), p)
  }
  if (views.size) {
    const named = /["'`]\s*(?:~\{\s*)?([\w][\w./-]*)|~\{\s*([\w][\w./-]*)/g
    for (const f of recs.values()) {
      const text = f.lang === 'view' ? f.src : f.src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/|#).*$/gm, ' ')
      for (const m of text.matchAll(named)) {
        const key = (m[1] ?? m[2]).replace(/^\/+/, ''), t = views.get(key)
        if (!t || t === f.path) continue
        // A one-word name ("error") is also a flash key or a label: it names a view only where a view is chosen.
        if (!/[/.]/.test(key) && !VIEW_AT.test(text.slice(Math.max(0, m.index - 40), m.index + 1))) continue
        relate(f, recs.get(t), f.lang === 'view' ? 'uses' : 'view')
      }
    }
  }

  for (const [from, t] of embeds) if (recs.has(t)) relate(recs.get(from), recs.get(t), 'go:embed')
  const files = [...recs.values()]
  relateCs(files, projects, relate)
  relateRs(files, projects, relate)
  relateJava(files, relate)
  relateGo(files, projects, relate)

  // Commits touching each file in the last 90 days, for the churn lens.
  const churn = new Map()
  try {
    const log = execFileSync('git', ['-C', repo, 'log', '--since=90.days', '--name-only', '--relative', '--pretty=format:'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    for (const line of log.split('\n')) if (line.trim()) churn.set(line.trim(), (churn.get(line.trim()) ?? 0) + 1)
  } catch { /* not a git checkout: no churn lens */ }

  const byFolder = (a, b) => (dirOf(a.path) === dirOf(b.path) ? a.path.localeCompare(b.path) : dirOf(a.path) < dirOf(b.path) ? -1 : 1)
  const appFiles = files.sort(byFolder)
  // Compiled entry points: main methods. More than one in a project usually means a dev tool.
  const mains = appFiles.filter(f => f.lang === 'go' ? /^package\s+main\b/m.test(f.src) && /^func\s+main\s*\(/m.test(f.src) : f.lang === 'java' ? /\bstatic\s+void\s+main\s*\(/.test(f.src) : f.lang === 'cs' ? /\bstatic\s+(async\s+)?[\w<>]+\s+Main\s*\(/.test(f.src) || posix.basename(f.path) === 'Program.cs' : f.lang === 'rs' && (posix.basename(f.path) === 'main.rs' || /\/bin\//.test(f.path))).map(f => f.path)
  return {
    repo,
    // Manifests with no application code, and why: a docs site or a monorepo root, say.
    unmapped: projects.filter(p => p.kind !== 'test' && !p.unity && !appFiles.some(f => f.project === p)).map(p => ({ dir: p.dir, name: p.name, reason: candidates.some(c => owner.get(c) === p) ? 'no entry point reaches its code' : 'no source files' })),
    projects: projects.filter(p => p.kind !== 'test' && appFiles.some(f => f.project === p)).map(({ lang, dir, name, kind, technology, description, pkg }) => ({ lang, dir, name, kind: lang === 'go' && mains.some(m => recs.get(m)?.project?.dir === dir && recs.get(m)?.project?.lang === 'go') ? 'app' : kind, technology, description: description ?? '', ...(lang === 'js' && kind === 'library' && !pkg?.private ? { published: true } : {}) })),
    entries: [...new Set([...entries, ...pages.inline, ...pyEntries, ...mains])].sort(),
    // Config and deploy files name the other processes: datasources, base URLs, ports, services.
    config: all.filter(p => CONFIG.test(p) && !TEST.test(p)).sort(),
    files: appFiles.map(f => ({ path: f.path, lang: f.lang, project: f.project?.dir ?? null, lines: f.src.split('\n').length, churn: churn.get(f.path) ?? 0, doc: summary(f.src, f.lang), hints: hintsOf(f.src) })),
    edges: appFiles.flatMap(f => [...f.edges].map(([to, e]) => ({ from: f.path, to, names: [...e.names], ...(e.types ? { types: true } : {}), ...(e.reexport ? { reexport: true } : {}) }))),
    dropped: { generated: all.filter(p => LANG[extOf(p)] && GENERATED.test(p) && !/(^|\/)vendor\//.test(p)).length, tests: tests.length + candidates.filter(p => testProjects.some(t => under(p, t.dir))).length, unreached: candidates.filter(p => !recs.has(p) && !testProjects.some(t => under(p, t.dir))).sort() },
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

/**
 * Python: module names from package folders (__init__.py) or a src/ layout, and import
 * resolution: absolute and relative imports, submodules, sibling scripts, and names a package's
 * __init__.py re-exports. Imports under `if TYPE_CHECKING:` are type-only.
 */
function pythonResolver(pyFiles, allSet, read) {
  const isPkg = d => allSet.has(d ? `${d}/__init__.py` : '__init__.py')
  const nameOf = new Map(), byName = new Map()
  for (const p of pyFiles) {
    const parts = p.replace(/\.py$/, '').split('/')
    const dirs = parts.slice(0, -1)
    const chain = parts.at(-1) === '__init__' ? [] : [parts.at(-1)]
    let consumed = 0
    while (dirs.length && isPkg(dirs.join('/'))) { chain.unshift(dirs.pop()); consumed++ }
    // A src/ layout without __init__.py files names modules from src/ (namespace packages).
    const src = parts.lastIndexOf('src')
    const name = !consumed && src >= 0 && src < parts.length - 1 ? parts.slice(src + 1).filter(x => x !== '__init__').join('.') : chain.join('.')
    nameOf.set(p, name)
    byName.set(name, [...(byName.get(name) ?? []), p])
  }
  const shared = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
  // The same module name in two roots: the one nearest the importer wins.
  const pick = (name, from) => [...(byName.get(name) ?? [])].sort((a, b) => shared(b, from) - shared(a, from))[0] ?? null
  const packageOf = p => { const n = nameOf.get(p) ?? ''; return p.endsWith('__init__.py') ? n : n.split('.').slice(0, -1).join('.') }
  const absolute = (from, base) => {
    const dots = base.match(/^\.*/)[0].length
    if (!dots) return base
    const pkg = packageOf(from).split('.').filter(Boolean)
    return [...pkg.slice(0, pkg.length - (dots - 1)), ...base.slice(dots).split('.').filter(Boolean)].join('.')
  }
  /** A file's imports: [{ module, names, types }] with relative modules made absolute. */
  const importsOf = (path, src) => {
    const code = src.replace(/("""|''')[\s\S]*?\1/g, '').replace(/(from\s+[.\w]+\s+import\s+)\(([^)]*)\)/g, (m, a, b) => a + b.replace(/#.*$/gm, '').replace(/\s+/g, ' '))
    const out = []
    let typeIndent = -1
    for (const line of code.split('\n')) {
      if (!line.trim() || /^\s*#/.test(line)) continue
      const indent = line.match(/^\s*/)[0].length
      if (typeIndent >= 0 && indent <= typeIndent) typeIndent = -1
      if (/^\s*if\s+(typing\.)?TYPE_CHECKING\s*:/.test(line)) { typeIndent = indent; continue }
      const types = typeIndent >= 0
      let m = line.match(/^\s*import\s+([\w.,\s]+?)\s*(#.*)?$/)
      if (m) for (const x of m[1].split(',')) { const mod = x.trim().split(/\s+as\s+/)[0]; if (mod) out.push({ module: mod, names: [], types }) }
      m = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/)
      if (m) out.push({ module: absolute(path, m[1]), names: m[2].replace(/#.*$/, '').split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(x => /^\w+$/.test(x)), types })
    }
    return out
  }
  const mod = (name, from) => {
    if (!name) return null
    const hit = pick(name, from)
    if (hit) return hit
    // A script's own folder is on the path, so `import util` finds util.py beside it.
    const beside = `${dirOf(from) ? `${dirOf(from)}/` : ''}${name}.py`
    return !name.includes('.') && pyFiles.has(beside) ? beside : null
  }
  /** [file, name] pairs an import reaches: submodules, the module, or a re-export's source. */
  const resolveImport = (from, imp) => {
    if (!imp.names.length) {
      // import a.b.c (or from a import *): the longest prefix that is a module of this repo.
      const parts = imp.module.split('.')
      for (let n = parts.length; n > 0; n--) { const t = mod(parts.slice(0, n).join('.'), from); if (t) return [[t, parts.at(-1)]] }
      return []
    }
    const base = mod(imp.module, from)
    const out = []
    for (const name of imp.names) {
      const sub = mod(imp.module ? `${imp.module}.${name}` : name, from)
      if (sub) out.push([sub, name])
      else if (base) out.push([definer(base, name) ?? base, name])
    }
    return out
  }
  // `from .orders import place_order` in a package's __init__.py: follow it to orders.py.
  const definer = (path, name, depth = 0) => {
    if (depth > 4 || !path.endsWith('__init__.py')) return null
    for (const imp of importsOf(path, read(path))) {
      if (!imp.names.includes(name)) continue
      const [t] = resolveImport(path, { ...imp, names: [name] })[0] ?? []
      if (t && t !== path) return definer(t, name, depth + 1) ?? t
    }
    return null
  }
  return { isPkg, nameOf, importsOf, resolveImport }
}

/**
 * Go: imports of the module's own packages resolved to the file declaring each name used
 * (`store.Open` → the file with `func Open`), and top-level names shared by the files of a package.
 */
function relateGo(files, projects, relate) {
  const go = files.filter(f => f.lang === 'go')
  const mods = projects.filter(p => p.lang === 'go' && p.module)
  const byDir = new Map()
  for (const f of go) {
    f.code = stripC(f.src).replace(/`[^`]*`/g, '``')
    f.pkg = f.code.match(/^package\s+(\w+)/m)?.[1] ?? ''
    f.declares = new Set()
    for (const m of f.code.matchAll(/^func\s+([A-Za-z_]\w*)\s*[[(]/gm)) f.declares.add(m[1])
    for (const m of f.code.matchAll(/^(?:type|var|const)\s+([A-Za-z_]\w*)/gm)) f.declares.add(m[1])
    for (const m of f.code.matchAll(/^(?:type|var|const)\s*\(([\s\S]*?)^\)/gm)) for (const l of m[1].split('\n')) { const n = l.match(/^\s+([A-Za-z_]\w*)\b/)?.[1]; if (n) f.declares.add(n) }
    byDir.set(dirOf(f.path), [...(byDir.get(dirOf(f.path)) ?? []), f])
  }
  const dirFor = path => {
    const m = mods.filter(p => path === p.module || path.startsWith(`${p.module}/`)).sort((a, b) => b.module.length - a.module.length)[0]
    if (!m) return null
    const d = posix.join(m.dir || '.', path.slice(m.module.length + 1) || '.')
    return d === '.' ? '' : d
  }
  for (const f of go) {
    const raw = f.src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    const imports = []
    for (const m of raw.matchAll(/^import\s+(?:([\w.]+)\s+)?"([^"]+)"/gm)) imports.push([m[1], m[2]])
    for (const m of raw.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) for (const l of m[1].split('\n')) { const x = l.trim().match(/^(?:([\w.]+)\s+)?"([^"]+)"/); if (x) imports.push([x[1], x[2]]) }
    for (const [alias, path] of imports) {
      if (alias === '_' || alias === '.') continue
      const dir = dirFor(path)
      const pkgFiles = dir != null ? byDir.get(dir) : null
      if (!pkgFiles) continue
      const name = alias ?? (pkgFiles[0].pkg || path.split('/').at(-1))
      for (const used of new Set([...f.code.matchAll(new RegExp(`\\b${name}\\.([A-Z]\\w*)`, 'g'))].map(x => x[1]))) {
        // Build-tag variants declare the same name in several files: each is a dependency.
        const ts = pkgFiles.filter(g => g.declares.has(used))
        for (const t of ts) relate(f, t, used)
        // A name no file declares comes from generated code (go generate, templates): the package still counts.
        if (!ts.length) relate(f, pkgFiles.find(g => posix.basename(g.path, '.go') === name) ?? [...pkgFiles].sort((a, b) => b.declares.size - a.declares.size)[0], used)
      }
    }
    // Within a package, files use each other's top-level names without imports.
    const used = new Set(f.code.replace(/^package\s+\w+/m, '').match(/\b[A-Za-z_]\w{2,}\b/g) ?? [])
    for (const g of byDir.get(dirOf(f.path)) ?? []) {
      if (g === f || g.pkg !== f.pkg) continue
      for (const n of g.declares) if (used.has(n) && !f.declares.has(n)) relate(f, g, n)
    }
  }
}
