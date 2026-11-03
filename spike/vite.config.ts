import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

/** Galaxy Wars source the scanner reads; set GALAXY_WARS_REPO to point elsewhere. */
const GALAXY_WARS = process.env.GALAXY_WARS_REPO ?? 'F:/projects/galaxy-wars'
const GALAXY_DIRS = ['src', 'tools', 'client/Assets/Scripts', 'experiments/browser-client/rust-client/src', 'experiments/browser-client/rust-movement/src', 'experiments/browser-client/bridge']

const run = (args: string[]) => new Promise<number>(resolve => {
  const p = spawn(process.execPath, args, { stdio: 'inherit' })
  p.on('exit', code => resolve(code ?? 1))
})

/**
 * Live models: when a LikeC4 file changes, re-extract that workspace and tell the open viewers,
 * which swap the model in place. Galaxy Wars source changes re-run its scanner first.
 */
function liveModels(): Plugin {
  return {
    name: 'live-models',
    configureServer(server: ViteDevServer) {
      // Vitest also builds a Vite server; watchers there would keep the test run from exiting.
      if (process.env.VITEST) return
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
        if (await run(['scripts/extract-likec4.mjs', name]) !== 0) return
        server.ws.send({ type: 'custom', event: 'model:update', data: { name, ms: Date.now() - t0 } })
      })
      // Node's recursive fs.watch, not Vite's watcher: Vite does not report files outside its
      // module graph, such as the .c4 sources.
      const watchers = [watch('model', { recursive: true }, (_ev, f) => {
        const m = f?.replace(/\\/g, '/').match(/^([^/]+)\/[^/]+\.c4$/)
        if (m) extract(m[1])
      })]

      if (existsSync('model/galaxy-wars') && existsSync(GALAXY_WARS)) {
        const dirs = GALAXY_DIRS.map(d => join(GALAXY_WARS, d)).filter(existsSync)
        // The scanner rewrites model/galaxy-wars/*.c4, which the model watcher then extracts.
        const rescan = () => later('scan', 400, async () => { await run(['scripts/scan-galaxy-wars.mjs', GALAXY_WARS]) })
        for (const d of dirs) {
          watchers.push(watch(d, { recursive: true }, (_ev, f) => {
            if (f && /\.(cs|rs)$/.test(f) && !/(^|[/\\])(obj|bin)[/\\]/.test(f)) rescan()
          }))
        }
        server.config.logger.info(`live-models: watching ${dirs.length} Galaxy Wars source folders`)
      }
      server.httpServer?.on('close', () => watchers.forEach(w => w.close()))
    },
  }
}

export default defineConfig({
  plugins: [liveModels()],
  server: {
    // Extracted JSON is fetched by the viewer on its own schedule; changes must not reload the page.
    watch: { ignored: ['**/public/models/**', '**/shots/**'] },
  },
})
