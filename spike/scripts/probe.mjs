// Drives the spike in Chrome: wheel-zooms from the overview into the deepest element, takes
// screenshots along the way and reports frame times.
// usage: node scripts/probe.mjs <query, e.g. "model=synthetic&n=10000"> [outDir] [--headed]
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const query = process.argv[2] ?? 'model=boutique'
const outDir = process.argv[3] ?? 'shots'
const headed = process.argv.includes('--headed')
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
const tag = query.replace(/[^a-z0-9]+/gi, '-') + (process.env.DPR ? `-dpr${process.env.DPR}` : '')
mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: !headed,
  args: ['--window-size=1440,900', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-webgpu'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: Number(process.env.DPR ?? 1) },
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.goto(`${base}?${query}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 }).catch(async e => {
  console.error('not ready:', await page.$eval('#stats', n => n.textContent).catch(() => '?'), errors)
  await browser.close()
  process.exit(1)
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
await sleep(800)

const info = await page.evaluate(() => {
  const s = window.__spike
  return { gpu: s.gpu, layoutMs: Math.round(s.layoutMs), loadMs: Math.round(s.loadMs), elements: s.tree.size - 1, relations: s.tree.rels.length / 2, depth: s.tree.maxDepth }
})
const shot = async name => page.screenshot({ path: join(outDir, `${tag}-${name}.png`) })
await shot('00-overview')

// Target: a leaf at the deepest level, reached by repeatedly wheel-zooming at its screen centre.
const target = await page.evaluate(() => {
  const t = window.__spike.tree
  let best = 1
  for (let i = 1; i < t.size; i++) if (t.depth[i] > t.depth[best]) best = i
  return best
})
const where = () => page.evaluate(i => {
  const s = window.__spike, r = s.world.rect
  const [x, y] = s.cam.toScreen(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2)
  return { x, y, w: r[i * 4 + 2] * s.cam.z, path: s.renderer.breadcrumb().map(n => s.tree.els[n].title) }
}, target)

await page.evaluate(() => window.__spike.resetFrames())
const t0 = Date.now()
let step = 0
for (; step < 80; step++) {
  const p = await where()
  if (p.w > 900) break
  // Re-centre gently so the target never leaves the screen while zooming toward it.
  const x = Math.min(1400, Math.max(40, p.x)), y = Math.min(860, Math.max(40, p.y))
  await page.mouse.move(x, y)
  for (let k = 0; k < 6; k++) { await page.mouse.wheel({ deltaY: -60 }); await sleep(16) }
  await sleep(120)
  if (step % 4 === 0) await shot(`z${String(step).padStart(2, '0')}`)
}
await sleep(600)
await shot('zz-deepest')
const journey = await where()
const zoomSpan = await page.evaluate(() => { const s = window.__spike; return s.cam.z / (s.cam.w * 0.92 / s.world.rect[2]) })
const frames = await page.evaluate(() => window.__spike.frames())
const last = await page.evaluate(() => window.__spike.last())

// Fly back out to the overview and in again, the camera animation path.
await page.evaluate(() => window.__spike.resetFrames())
await page.keyboard.press('0')
await sleep(1000)
await shot('back-out')
const flyFrames = await page.evaluate(() => window.__spike.frames())

// Pan the overview in circles: the most cards on screen at once.
await sleep(400)
await page.evaluate(() => window.__spike.resetFrames())
await page.mouse.move(720, 450)
await page.mouse.down()
for (let k = 0; k < 180; k++) {
  const a = (k / 180) * Math.PI * 4
  await page.mouse.move(720 + Math.cos(a) * 160, 450 + Math.sin(a) * 100)
  await sleep(8)
}
await page.mouse.up()
const panFrames = await page.evaluate(() => window.__spike.frames())
const panLast = await page.evaluate(() => window.__spike.last())

const stat = v => {
  const s = [...v].sort((a, b) => a - b), q = p => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(2)
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: q(1) }
}
const report = {
  query, ...info, steps: step, journeyMs: Date.now() - t0, zoomSpan: Number(zoomSpan.toExponential(2)),
  endedAt: journey.path.join(' › '), lastFrame: last,
  zoomCpuMs: stat(frames.cpu), zoomFrameIntervalMs: stat(frames.delta),
  flyCpuMs: stat(flyFrames.cpu), flyFrameIntervalMs: stat(flyFrames.delta),
  overviewPan: { drawn: panLast, cpuMs: stat(panFrames.cpu), frameIntervalMs: stat(panFrames.delta) },
  errors: errors.slice(0, 10),
}
writeFileSync(join(outDir, `${tag}-report.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
