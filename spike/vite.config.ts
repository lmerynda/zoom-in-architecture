import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

/** Runs a script with node; resolves with its exit code. */
const run = (args: string[]) => new Promise<number>(resolve => {
  spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'] }).on('exit', code => resolve(code ?? 1))
})

const SOURCE = /\.(cs|rs|java|tsx?|mts|cts|jsx?|mjs|cjs|csproj|html)$|(^|[/\\])(Cargo\.toml|package\.json|tsconfig[^/\\]*\.json|pom\.xml|build\.gradle(\.kts)?)$/
const IGNORED = /(^|[/\\])(node_modules|bin|obj|target|dist|build|\.git)[/\\]/

/**
 * Live models: whenever public/models/<name>.json is rewritten, the open viewers swap that model
 * in place, and a new entry in index.json adds its tab. Writers are the sample extractor (on a
 * .c4 save under model/) and scripts/zoom.mjs: an agent publishing a map, or this server
 * re-publishing an import from its stored map when that repository's source changes.
 */
function liveModels(): Plugin {
  return {
    name: 'live-models',
    configureServer(server: ViteDevServer) {
      // Vitest also builds a Vite server; watchers there would keep the test run from exiting.
      if (process.env.VITEST) return
      const log = (s: string) => server.config.logger.info(`live-models: ${s}`)
      const timers = new Map<string, ReturnType<typeof setTimeout>>()
      const busy = new Set<string>()
      const later = (key: string, ms: number, fn: () => Promise<void> | void) => {
        clearTimeout(timers.get(key))
        timers.set(key, setTimeout(async () => {
          if (busy.has(key)) return later(key, ms, fn)
          busy.add(key)
          try { await fn() } finally { busy.delete(key) }
        }, ms))
      }

      // Node's recursive fs.watch, not Vite's watcher: Vite does not report files outside its
      // module graph, and it ignores public/models so updates do not reload the page.
      mkdirSync('imports', { recursive: true })
      mkdirSync('public/models', { recursive: true })
      const sources = new Map<string, FSWatcher>()
      const unfollow = (name: string) => { sources.get(name)?.close(); sources.delete(name) }
      const republish = (name: string) => later(`import:${name}`, 400, async () => { await run(['scripts/zoom.mjs', 'republish', name]) })
      const watchers: FSWatcher[] = [
        watch('model', { recursive: true }, (_ev, f) => {
          const m = f?.replace(/\\/g, '/').match(/^([^/]+)\/[^/]+\.c4$/)
          if (m) later(`extract:${m[1]}`, 150, async () => { await run(['scripts/extract-likec4.mjs', m[1]]) })
        }),
        watch('public/models', (_ev, f) => {
          const m = f?.match(/^([\w.-]+)\.json$/)
          if (!m) return
          if (m[1] === 'index') later('index', 100, () => { server.ws.send({ type: 'custom', event: 'models:index', data: {} }) })
          else later(`update:${m[1]}`, 100, () => { server.ws.send({ type: 'custom', event: 'model:update', data: { name: m[1] } }) })
        }),
        // A published import is followed from then on; a deleted one stops being followed.
        watch('imports', { recursive: true }, (_ev, f) => {
          const name = f?.replace(/\\/g, '/').split('/')[0]
          if (!name) return
          const known = existsSync(join('imports', name, 'source.json')) && existsSync(join('imports', name, 'map.json'))
          if (known && !sources.has(name)) follow(name)
          else if (!known && sources.has(name)) unfollow(name)
        }),
      ]

      // Each import remembers its repository; edits there re-publish it from its stored map.
      const follow = (name: string) => {
        unfollow(name)
        const { repo } = JSON.parse(readFileSync(join('imports', name, 'source.json'), 'utf8')) as { repo: string }
        if (!existsSync(repo)) return
        const w = watch(repo, { recursive: true }, (_ev, f) => { if (f && SOURCE.test(f) && !IGNORED.test(f)) republish(name) })
        // The repository can disappear under the watcher; that must not take the server down.
        w.on('error', () => unfollow(name))
        sources.set(name, w)
        log(`following ${name} at ${repo}`)
      }
      // On start, every import is rebuilt against its repository as it is now.
      for (const name of readdirSync('imports')) if (existsSync(join('imports', name, 'map.json'))) { follow(name); republish(name) }

      // Vite only serves public files it saw at startup; models published since need serving here.
      server.middlewares.use('/models', (req, res, next) => {
        const file = join('public/models', decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!/^public[/\\]models[/\\][\w.-]+\.json$/.test(file) || !existsSync(file)) return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(readFileSync(file))
      })
      server.httpServer?.on('close', () => { watchers.forEach(w => w.close()); sources.forEach(w => w.close()) })
    },
  }
}

export default defineConfig({
  plugins: [liveModels()],
  server: {
    // Extracted JSON is fetched by the viewer on its own schedule; changes must not reload the page.
    watch: { ignored: ['**/public/models/**', '**/shots/**', '**/imports/**', '**/test/fixtures/**'] },
  },
})
