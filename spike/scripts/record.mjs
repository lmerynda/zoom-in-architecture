// Records scripted fly-throughs as video: the app runs on a manual clock, every frame is
// screenshotted (HUD included) and encoded in a second tab by src/recorder.ts.
// usage: node scripts/record.mjs [scene ...]   (dev server running) → shots/video/<scene>.mp4|webm
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SELF, selfImport } from './self-import.mjs'

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
    /** Real key presses, then a few frames so the result shows. */
    key: async (k, mods = []) => {
      for (const m of mods) await page.keyboard.down(m)
      await page.keyboard.press(k)
      for (const m of [...mods].reverse()) await page.keyboard.up(m)
      await frames(2)
    },
    type: async text => { for (const ch of text) { await page.keyboard.type(ch); await frames(3) } },
    /** Screen centre of an element right now. */
    at: id => page.evaluate(id => {
      const s = window.__spike, i = s.id(id), r = s.world.rect
      return s.cam.toScreen(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2)
    }, id),
    /** Screen centre of the first element matching a selector, and with this text if given. */
    centreOf: (sel, text) => page.evaluate(([sel, text]) => {
      const e = [...document.querySelectorAll(sel)].find(e => text == null || e.textContent.startsWith(text))
      if (!e) throw new Error(`no ${sel} ${text ?? ''}`)
      const r = e.getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    }, [sel, text]),
    /** Glides the pointer to a point over a few frames, so the cursor path reads on video. */
    move: async (x, y, ms = 400) => {
      const n = Math.max(1, Math.round((ms / 1000) * FPS))
      const from = s.mouse ?? [W / 2, H / 2]
      for (let i = 1; i <= n; i++) {
        const u = i / n, e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
        await page.mouse.move(from[0] + (x - from[0]) * e, from[1] + (y - from[1]) * e)
        await frames(1)
      }
      s.mouse = [x, y]
    },
    click: async (button = 'left') => { const [x, y] = s.mouse ?? [W / 2, H / 2]; await page.mouse.click(x, y, { button }); await frames(2) },
  }
  await script(s)
  const b64 = await rec.evaluate(() => window.rec.finish())
  const file = join(outDir, `${name}.${ext}`)
  writeFileSync(file, Buffer.from(b64, 'base64'))
  console.log(`${file}: ${count} frames, ${(count / FPS).toFixed(1)} s, ${(Buffer.byteLength(b64, 'base64') / 1e6).toFixed(1)} MB`)
  await rec.close()
  await page.close()
}

// Code-level scenes run on this repository, imported as a model (see scripts/self-import.mjs).
const FILE = 'viewer.controls.install'
const scenes = {
  // One continuous dive from the landscape to a single file, then lock on to it.
  'code-dive': () => { selfImport(); return record('code-dive', SELF, async s => {
    await s.hold(800)
    await s.dive(FILE, 14, 1.15)
    await s.hold(500)
    await s.select(FILE)
    await s.hold(3200)
  }) },
  // Far jumps between distant elements: pull back, glide, dive in, with warp streaks.
  'acme-warp': () => record('acme-warp', 'acme', async s => {
    await s.fly('acme.ordering.checkout')
    await s.land(200)
    await s.select('acme.ordering.checkout')
    await s.hold(1200)
    await s.select('acme.fulfilment.shipping')
    await s.fly('acme.fulfilment.shipping')
    await s.land(1800)
    await s.select('acme.customer.notify')
    await s.fly('acme.customer.notify')
    await s.land(1800)
    await s.select(null)
    await s.fly(null)
    await s.land(1200)
  }),
  // Strategy-game lenses over the viewer's own code: lines, coupling and git churn.
  'code-lenses': () => { selfImport(); return record('code-lenses', SELF, async s => {
    await s.fly('viewer')
    await s.land(1000)
    for (const l of ['size', 'coupling', 'churn', 'structure']) { await s.lens(l); await s.hold(1800) }
  }) },
  // The game-style controls in use: palette travel, target cycling, walk, back, the command
  // wheel, a route from the wheel with its waypoints, and the controls screen.
  'acme-controls': () => record('acme-controls', 'acme', async s => {
    await s.hold(700)
    await s.key('k', ['Control'])
    await s.type('chkout')
    await s.hold(700)
    await s.key('Enter')
    await s.land(900)
    await s.key(']'); await s.land(1300)
    await s.key(']'); await s.land(1300)
    await s.key('Enter'); await s.land(1100)
    await s.key('Backspace'); await s.land(1100)
    const [rx, ry] = await s.at('acme.ordering.checkout')
    await s.move(rx, ry, 500)
    await s.click('right')
    await s.hold(400)
    await s.move(rx + 92, ry - 40, 350)
    await s.hold(900)
    await s.key('Escape')
    await s.select('acme.storefront.web')
    await s.fly('acme'); await s.land(500)
    const [dx, dy] = await s.at('acme.payments')
    await s.move(dx, dy, 600)
    await s.click('right')
    await s.hold(500)
    const [ix, iy] = await s.centreOf('.radial .item', 'Route here')
    await s.move(ix, iy, 350)
    await s.click()
    await s.land(1600)
    for (const k of [1, 2]) {
      const [px, py] = await s.centreOf(`.rp-stop:nth-of-type(${k + 1})`)
      await s.move(px, py, 300)
      await s.click()
      await s.land(1000)
    }
    await s.key('Escape'); await s.key('Escape')
    await s.key('?'); await s.hold(1800)
    await s.key('Escape'); await s.hold(400)
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
