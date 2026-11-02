// Records scripted fly-throughs as video: the app runs on a manual clock, every frame is
// screenshotted (HUD included) and encoded in a second tab by src/recorder.ts.
// usage: node scripts/record.mjs [scene ...]   (dev server running) → shots/video/<scene>.mp4|webm
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
const outDir = 'shots/video'
const W = Number(process.env.W ?? 1600), H = Number(process.env.H ?? 1000), FPS = 30
mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [`--window-size=${W},${H}`, '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
})
const errors = []

async function record(name, model, script) {
  const page = await browser.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e}`))
  await page.goto(`${base}?model=${model}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { window.__spike.unhover(); window.__spike.manual(true) })
  const rec = await browser.newPage()
  await rec.goto(`${base}recorder.html`, { waitUntil: 'load' })
  await rec.waitForFunction(() => window.rec)
  const ext = await rec.evaluate((w, h, fps) => window.rec.start(w, h, fps), W, H, FPS)

  let count = 0
  const frames = async (n, before) => {
    for (let i = 0; i < n; i++) {
      if (before) await page.evaluate(before, i)
      await page.evaluate(ms => window.__spike.advance(ms), 1000 / FPS)
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92, encoding: 'base64' })
      await rec.evaluate(f => window.rec.frame(f), jpeg)
      // Stills every half second, to review motion without a video player.
      if (count % 15 === 0) writeFileSync(join(outDir, `${name}-${String(count).padStart(4, '0')}.jpg`), Buffer.from(jpeg, 'base64'))
      count++
    }
  }
  const s = {
    hold: ms => frames(Math.round((ms / 1000) * FPS)),
    run: fn => page.evaluate(fn),
    /** Waits for the current flight to land, then lingers. */
    land: async (linger = 500) => {
      for (let i = 0; i < FPS * 6; i++) {
        if (!(await page.evaluate(() => window.__spike.cam.flying))) break
        await frames(1)
      }
      await s.hold(linger)
    },
    /**
     * Wheel-style dive toward an element: zoom anchored on it while drifting it to the centre,
     * until it spans `frac` of the screen width (or `seconds` run out).
     */
    dive: async (id, seconds, rate = 1.3, frac = 0.45) => {
      for (let i = 0; i < seconds * FPS; i++) {
        const wide = await page.evaluate(([id, factor]) => {
          const s = window.__spike, n = s.id(id), r = s.world.rect, c = s.cam
          const centre = () => c.toScreen(r[n * 4] + r[n * 4 + 2] / 2, r[n * 4 + 1] + r[n * 4 + 3] / 2)
          let [x, y] = centre()
          c.panBy((c.w / 2 - x) * 0.05, (c.h / 2 - y) * 0.05)
          ;[x, y] = centre()
          c.zoomAt(x, y, factor)
          return (r[n * 4 + 2] * c.z) / c.w
        }, [id, Math.exp(rate / FPS)])
        if (wide >= frac) break
        await frames(1)
      }
      // Let the zoom ease settle.
      await s.hold(400)
    },
    fly: id => page.evaluate(id => { const s = window.__spike; s.fly(id ? s.id(id) : 0) }, id),
    select: id => page.evaluate(id => { const s = window.__spike; s.select(id ? s.id(id) : -1) }, id),
    lens: name => page.evaluate(name => window.__spike.setLens(name), name),
  }
  await script(s)
  const b64 = await rec.evaluate(() => window.rec.finish())
  const file = join(outDir, `${name}.${ext}`)
  writeFileSync(file, Buffer.from(b64, 'base64'))
  console.log(`${file}: ${count} frames, ${(count / FPS).toFixed(1)} s, ${(Buffer.byteLength(b64, 'base64') / 1e6).toFixed(1)} MB`)
  await rec.close()
  await page.close()
}

const SR = 'galaxyWars.server.gameServer.simulation.sector.sectorRuntime'
const scenes = {
  // One continuous dive from the landscape to a single class, then lock on to it.
  'gw-dive': () => record('gw-dive', 'galaxy-wars', async s => {
    await s.hold(800)
    await s.dive(SR, 14, 1.15)
    await s.hold(500)
    await s.select(SR)
    await s.hold(3200)
  }),
  // Far jumps between distant elements: pull back, glide, dive in, with warp streaks.
  'gw-warp': () => record('gw-warp', 'galaxy-wars', async s => {
    await s.fly(SR)
    await s.land(200)
    await s.select(SR)
    await s.hold(1200)
    await s.select('galaxyWars.clients.browserBridge')
    await s.fly('galaxyWars.clients.browserBridge')
    await s.land(1800)
    await s.select('galaxyWars.tooling.devTool')
    await s.fly('galaxyWars.tooling.devTool')
    await s.land(1800)
    await s.select(null)
    await s.fly(null)
    await s.land(1200)
  }),
  // Strategy-game lenses over the server.
  'gw-lenses': () => record('gw-lenses', 'galaxy-wars', async s => {
    await s.fly('galaxyWars.server')
    await s.land(1000)
    for (const l of ['size', 'coupling', 'churn', 'structure']) { await s.lens(l); await s.hold(1800) }
  }),
  // The hand-written Acme model: dive into Ordering, select Checkout, watch the traffic.
  'acme-flow': () => record('acme-flow', 'acme', async s => {
    await s.hold(600)
    await s.dive('acme.ordering.checkout', 10, 1.1, 0.4)
    await s.select('acme.ordering.checkout')
    await s.hold(3500)
  }),
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes)) await scenes[name]()
console.log(JSON.stringify({ errors }))
await browser.close()
