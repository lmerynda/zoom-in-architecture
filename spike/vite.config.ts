import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

/** Runs a script with node; resolves with its exit code and what it printed. */
const run = (args: string[]) => new Promise<{ code: number; out: string }>(resolve => {
  const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  p.stdout.on('data', d => { out += d; process.stdout.write(d) })
  p.on('exit', code => resolve({ code: code ?? 1, out }))
})

const SOURCE = /\.(cs|rs|tsx?|mts|cts|jsx?|mjs|cjs|csproj)$|(^|[/\\])(Cargo\.toml|package\.json)$/
const IGNORED = /(^|[/\\])(node_modules|bin|obj|target|dist|build|\.git)[/\\]/

/**
 * Live models: when a LikeC4 file changes, re-extract that workspace and tell the open viewers,
 * which swap the model in place. An imported codebase's source changes re-run its import first,
 * and POST /__import {path} imports a new one.
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
      const later = (key: string, ms: number, fn: () => Promise<void>) => {
        clearTimeout(timers.get(key))
        timers.set(key, setTimeout(async () => {
          if (busy.has(key)) return later(key, ms, fn)
          busy.add(key)
          try { await fn() } finally { busy.delete(key) }
        }, ms))
      }
      const extract = (name: string) => later(`extract:${name}`, 150, async () => {
        const t0 = Date.now()
        if ((await run(['scripts/extract-likec4.mjs', name])).code !== 0) return
        server.ws.send({ type: 'custom', event: 'model:update', data: { name, ms: Date.now() - t0 } })
      })

      // Node's recursive fs.watch, not Vite's watcher: Vite does not report files outside its
      // module graph, such as the .c4 sources.
      mkdirSync('imports', { recursive: true })
      const sources = new Map<string, FSWatcher[]>()
      const unfollow = (name: string) => { sources.get(name)?.forEach(w => w.close()); sources.delete(name) }
      const watchers: FSWatcher[] = ['model', 'imports'].map(root => watch(root, { recursive: true }, (_ev, f) => {
        const p = f?.replace(/\\/g, '/') ?? ''
        const m = p.match(/^([^/]+)\/[^/]+\.c4$/)
        if (m) extract(m[1])
        // A deleted import stops being followed.
        const gone = p.match(/^([^/]+)(\/source\.json)?$/)
        if (root === 'imports' && gone && sources.has(gone[1]) && !existsSync(join('imports', gone[1], 'source.json'))) unfollow(gone[1])
      }))

      // Each import remembers its repository and config; edits there re-run it, which rewrites
      // imports/<name>/*.c4, which the watcher above then extracts.
      const importArgs = (name: string) => {
        const s = JSON.parse(readFileSync(join('imports', name, 'source.json'), 'utf8')) as { repo: string; config: string | null }
        return { s, args: ['scripts/import-code.mjs', s.repo, '--name', name, ...(s.config ? ['--config', s.config] : [])] }
      }
      const follow = (name: string) => {
        unfollow(name)
        const { s, args } = importArgs(name)
        if (!existsSync(s.repo)) return
        const rescan = () => later(`import:${name}`, 400, async () => { await run(args) })
        const ws = [watch(s.repo, { recursive: true }, (_ev, f) => { if (f && SOURCE.test(f) && !IGNORED.test(f)) rescan() })]
        if (s.config && existsSync(s.config)) ws.push(watch(s.config, rescan))
        // The repository can disappear under the watcher; that must not take the server down.
        for (const w of ws) w.on('error', () => unfollow(name))
        sources.set(name, ws)
        log(`following ${name} at ${s.repo}`)
      }
      for (const name of readdirSync('imports')) if (existsSync(join('imports', name, 'source.json'))) follow(name)

      // Vite only serves public files it saw at startup or through its watcher, which ignores
      // public/models so updates do not reload the page; imports made since need serving here.
      server.middlewares.use('/models', (req, res, next) => {
        const file = join('public/models', decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!/^public[/\\]models[/\\][\w.-]+\.json$/.test(file) || !existsSync(file)) return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(readFileSync(file))
      })

      server.middlewares.use('/__import', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
        let body = ''
        req.on('data', d => { body += d })
        req.on('end', async () => {
          const reply = (status: number, data: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)) }
          try {
            const { path, name } = JSON.parse(body || '{}') as { path?: string; name?: string }
            if (!path) return reply(400, { error: 'path is required' })
            const imported = await run(['scripts/import-code.mjs', path, ...(name ? ['--name', name] : []), '--json'])
            const result = JSON.parse(imported.out.trim().split('\n').pop() || '{}')
            if (imported.code !== 0) return reply(400, result)
            if ((await run(['scripts/extract-likec4.mjs', result.name])).code !== 0) return reply(500, { error: 'the imported model did not compile; see the dev server log' })
            follow(result.name)
            reply(200, result)
          } catch (e) { reply(500, { error: String(e) }) }
        })
      })
      server.httpServer?.on('close', () => { watchers.forEach(w => w.close()); sources.forEach(ws => ws.forEach(w => w.close())) })
    },
  }
}

export default defineConfig({
  plugins: [liveModels()],
  server: {
    // Extracted JSON is fetched by the viewer on its own schedule; changes must not reload the page.
    watch: { ignored: ['**/public/models/**', '**/shots/**', '**/imports/**'] },
  },
})
