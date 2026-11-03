// End-to-end check of live mode: edit a LikeC4 file while the map is open, and verify the
// open map updates in place. Restores the file afterwards.
// usage: node scripts/live-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/live'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
const file = 'model/acme/model.c4'
mkdirSync(outDir, { recursive: true })
const original = readFileSync(file, 'utf8')

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--window-size=1600,1000', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) })
const results = {}
const check = (name, ok, detail = '') => { results[name] = ok ? 'pass' : `FAIL ${detail}`; console.log(ok ? 'pass' : 'FAIL', name, detail) }

try {
  await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { const s = window.__spike; s.unhover(); s.select(s.id('acme.ordering.checkout')); s.fit(s.id('acme.ordering')) })
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await sleep(600)
  await shot('01-before')
  const snapshot = () => page.evaluate(() => {
    const s = window.__spike, out = {}
    s.tree.els.forEach((e, i) => { if (i) out[e.id] = [...s.world.rect.subarray(i * 4, i * 4 + 4)] })
    const sel = s.renderer.selected
    return { rects: out, cam: [s.cam.x, s.cam.y, s.cam.z], selected: sel > 0 ? s.tree.els[sel].id : null, version: s.liveVersion, screen: s.renderer.screenRectOf(s.id('acme.ordering.checkout')) }
  })
  const before = await snapshot()

  // Edit: a new service with relations in Ordering, and a changed description elsewhere.
  const edited = original
    .replace(`description 'Carts, checkout and the order lifecycle.'`, `description 'Carts, checkout and the order lifecycle.'

      returns = service 'Returns Service' {
        technology 'Kotlin'
        description 'Return requests, labels and refunds once the parcel is back.'
      }`)
    .replace(`description 'Weekly merchant payouts net of fees.'`, `description 'Weekly merchant payouts net of fees and return deductions.'`)
    .replace(/\n}\s*$/, `
  acme.ordering.returns -> acme.ordering.orders.orderApi 'marks returned'
  acme.ordering.returns -> acme.payments.gateway.paymentApi 'refunds'
  acme.customer.support -> acme.ordering.returns 'opens returns'
}
`)
  writeFileSync(file, edited)
  const t0 = Date.now()
  await page.waitForFunction(v => window.__spike.liveVersion > v, { timeout: 30000 }, before.version)
  const latency = Date.now() - t0
  await sleep(300)
  await shot('02-mid-morph')
  await page.waitForFunction(() => !window.__spike.morphing)
  await sleep(400)
  await shot('03-after')
  const after = await snapshot()

  check('update arrives', true, `${latency} ms from save to swap`)
  check('new element appears', 'acme.ordering.returns' in after.rects)
  check('selection survives', after.selected === 'acme.ordering.checkout', after.selected)
  const outside = Object.keys(before.rects).filter(id => !id.startsWith('acme.ordering') && id !== 'acme' && id !== 'acme.ordering' && id in after.rects)
  const moved = outside.filter(id => before.rects[id].some((v, k) => Math.abs(v - after.rects[id][k]) > 1e-6))
  // Siblings of Ordering may move if their container re-laid out; Payments' internals must not.
  const payments = outside.filter(id => id.startsWith('acme.payments.'))
  check('unchanged containers keep exact positions', payments.every(id => !moved.includes(id)), `${moved.length}/${outside.length} moved outside Ordering`)
  const ds = after.screen.map((v, k) => Math.abs(v - before.screen[k]))
  check('selected card stays put on screen', Math.max(...ds) < 40, ds.map(d => d.toFixed(1)).join(','))
  const toast = await page.$eval('.toast', e => e.textContent)
  check('toast reports the change', /added/.test(toast), toast)

  // Revert: the service disappears again.
  writeFileSync(file, original)
  await page.waitForFunction(v => window.__spike.liveVersion > v, { timeout: 30000 }, after.version)
  await page.waitForFunction(() => !window.__spike.morphing)
  await sleep(400)
  await shot('04-reverted')
  const back = await snapshot()
  check('revert removes it', !('acme.ordering.returns' in back.rects))
  const toast2 = await page.$eval('.toast', e => e.textContent)
  check('revert toast names the removal', /removed/.test(toast2), toast2)
} finally {
  writeFileSync(file, original)
  console.log(JSON.stringify({ results, errors }, null, 1))
  await browser.close()
}
