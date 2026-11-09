import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
// @ts-expect-error: plain JS module, shared with the CLI
import { storeBundle, storedMap, storedPublished, storedSource } from './scripts/store.mjs'

/** Runs a script with node; resolves with its exit code. */
const run = (args: string[]) => new Promise<number>(resolve => {
  spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'] }).on('exit', code => resolve(code ?? 1))
})

/**
 * Live models: whenever public/models/<name>.json is rewritten, the open viewers swap that model
 * in place, and a new entry in index.json adds its tab. Writers are the sample extractor (on a
 * .c4 save under model/) and uploads: a mapped project sends its bundle to POST /upload, once
 * or on every change (zoom.mjs publish --watch). This server never reads a mapped project.
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
      ]

      // An upload from a mapped project: the bundle is all the server keeps of it.
      server.middlewares.use('/upload', (req, res, next) => {
        if (req.method !== 'POST') return next()
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const b = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            storeBundle(b)
            log(`stored ${b.name}: ${Object.keys(b.sources ?? {}).length} files' source`)
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ stored: b.name }))
          } catch (e) {
            res.statusCode = 400
            res.end(e instanceof Error ? e.message : String(e))
          }
        })
      })
      // The map an import was published with, for an agent starting a re-map.
      server.middlewares.use('/maps', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '').replace(/\.json$/, '')
        const map = storedMap(name)
        if (map === null) return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(map)
      })
      // What that map's upload was built from: the project's commit, for listing what changed since.
      server.middlewares.use('/published', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '').replace(/\.json$/, '')
        if (storedMap(name) === null) return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(storedPublished(name)))
      })

      // Vite only serves public files it saw at startup; models published since need serving here.
      server.middlewares.use('/models', (req, res, next) => {
        const file = join('public/models', decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!/^public[/\\]models[/\\][\w.-]+\.json$/.test(file) || !existsSync(file)) return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(readFileSync(file))
      })
      // A file's source for the code view: only a file the stored model shows, as it was uploaded.
      server.middlewares.use('/source', (req, res) => {
        const url = new URL(req.url ?? '', 'http://local')
        const text = storedSource(decodeURIComponent(url.pathname.slice(1)), url.searchParams.get('path') ?? '')
        if (text === null) { res.statusCode = 404; res.end(); return }
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(text)
      })
      server.httpServer?.on('close', () => { watchers.forEach(w => w.close()) })
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
