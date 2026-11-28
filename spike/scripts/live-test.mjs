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
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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

  // What the reader asked to see survives the races between a live update, a repeated one and the
  // window: the card stays framed as pressing it again frames it. The updates are handed to the page
  // as the dev server's would be (swapModel), so no file is written.
  const card = 'backend.market.offers.gameMarketService'
  const still = async () => {
    for (let k = 0; k < 2; k++) {
      await page.waitForFunction(() => !window.__spike.morphing && !window.__spike.cam.flying, { timeout: 30000 })
      // The relayout a resize asks for waits 300 ms for the window to settle.
      await sleep(600)
    }
  }
  const framing = id => page.evaluate(id => { const s = window.__spike, i = id ? s.id(id) : 0; return { cam: [s.cam.x, s.cam.y, s.cam.z], rect: s.renderer.screenRectOf(i).map(Math.round), w: s.cam.w, h: s.cam.h, panel: document.getElementById('details').getBoundingClientRect().left } }, id)
  /** Opens the map at 1600×1000 with an update ready that adds three parts at the top, moving every card. */
  const fresh = async () => {
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(`${base}?model=knights-of-darkness`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
    await page.evaluate(async () => {
      try { localStorage.setItem('zoom.introSeen', '1') } catch { /* */ }
      document.querySelector('#welcome .ok')?.click()
      const json = await (await fetch('/models/knights-of-darkness.json')).json()
      const part = k => ({ id: `extra${k}`, parent: null, title: `Extra ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} })
      json.elements.unshift(part(1), part(2), part(3))
      json.relations.push({ source: 'extra1', target: 'backend.market.offers.gameMarketService', title: 'uses' })
      window.__update = json
      window.__spike.unhover()
    })
    await sleep(300)
  }
  const update = () => page.evaluate(() => { void window.__spike.swapModel(window.__update) })
  const midMorph = async () => { await page.waitForFunction(() => window.__spike.morphing, { timeout: 30000 }); await sleep(250) }
  /** After the race: the card on screen, left of the panel, and framed as a fresh press frames it. */
  const framedAfter = async (name, id, press) => {
    await still()
    const got = await framing(id)
    await shot(name)
    await page.evaluate(press, id)
    await still()
    const want = await framing(id)
    const off = Math.max(...got.rect.map((v, k) => Math.abs(v - want.rect[k])))
    const r = got.rect, onScreen = r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= got.panel && r[1] + r[3] <= got.h
    return { ok: off <= 2 && onScreen, detail: JSON.stringify({ off, got: got.rect, want: want.rect, panel: got.panel, h: got.h }) }
  }
  const pressCard = id => window.__spike.controls.goSelect(window.__spike.id(id))

  // 1. A card framed before a resize; a live update's morph; the same update again during it.
  await fresh()
  await page.evaluate(pressCard, card)
  await still()
  await page.setViewport({ width: 1600, height: 760 })
  await still()
  await update()
  await midMorph()
  await update()
  const repeated = await framedAfter('05-race-repeated-update', card, pressCard)
  check('a card framed before a resize stays framed when the same update arrives during its morph', repeated.ok, repeated.detail)

  // 2. The same, with the window's height changing during the morph.
  await fresh()
  await page.evaluate(pressCard, card)
  await still()
  await page.setViewport({ width: 1200, height: 1000 })
  await still()
  await update()
  await midMorph()
  await page.setViewport({ width: 1600, height: 1000 })
  const resized = await framedAfter('06-race-height-change', card, pressCard)
  check('a card framed before a resize stays framed when the window changes during a live update\'s morph', resized.ok, resized.detail)

  // 3. The whole map, Fit pressed: an update, the same again and a height change during its morph.
  await fresh()
  await page.evaluate(() => window.__spike.fly(0))
  await still()
  await update()
  await midMorph()
  await update()
  await sleep(100)
  await page.setViewport({ width: 1600, height: 800 })
  const whole = await framedAfter('07-race-whole-map', null, () => window.__spike.fly(0))
  check('the whole map stays framed through a repeated update and a height change during the morph', whole.ok, whole.detail)

  // 4. A drag during the morph makes the camera the reader's: the morph, and the update repeated
  // after it, leave it where the drag put it.
  await fresh()
  await page.evaluate(pressCard, card)
  await still()
  await update()
  await midMorph()
  await page.mouse.move(700, 500)
  await page.mouse.down()
  for (let k = 1; k <= 10; k++) await page.mouse.move(700 + k * 20, 500 + k * 10)
  await sleep(150)
  await page.mouse.up()
  const dropped = await page.evaluate(() => [window.__spike.cam.x, window.__spike.cam.y, window.__spike.cam.z])
  await still()
  const kept = await page.evaluate(() => [window.__spike.cam.x, window.__spike.cam.y, window.__spike.cam.z])
  check('a drag during a live update\'s morph is kept', Math.hypot(kept[0] - dropped[0], kept[1] - dropped[1]) * kept[2] < 2 && Math.abs(kept[2] / dropped[2] - 1) < 1e-3, JSON.stringify({ dropped, kept }))

  // 5. A jump of the reader's own under way when an update arrives (the minimap, Back) flies on to
  // where it was going: the morph does not cut it short. On acme, whose Ordering is laid out again by
  // the update, so the selection moves and the morph has a camera path of its own.
  await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(pressCard, 'acme.ordering.checkout')
  await still()
  // On the page's manual clock, so the flight is still under way when the update moves into place.
  const headed = await page.evaluate(async () => {
    const s = window.__spike, c = s.cam
    const json = await (await fetch('/models/acme.json')).json()
    const part = k => ({ id: `acme.ordering.extra${k}`, parent: 'acme.ordering', title: `Extra ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} })
    json.elements.unshift(part(1), part(2), part(3))
    s.manual(true)
    // As the minimap's pick flies: a point to the centre, at this zoom.
    c.flyTo(c.x - c.w / c.z / 2 + 30, c.y - c.h / c.z / 2 + 20, c.w / c.z, c.h / c.z, s.now(), 1)
    const dest = c.destination
    s.advance(100)
    await s.swapModel(json)
    for (let k = 0; k < 80; k++) s.advance(16)
    s.manual(false)
    return dest
  })
  await still()
  const landedAt = await page.evaluate(() => [window.__spike.cam.x, window.__spike.cam.y, window.__spike.cam.z])
  check('a jump under way when a live update arrives lands where it was going', Math.hypot(landedAt[0] - headed[0], landedAt[1] - headed[1]) * landedAt[2] < 2 && Math.abs(landedAt[2] / headed[2] - 1) < 1e-3, JSON.stringify({ headed, landedAt }))
} finally {
  writeFileSync(file, original)
  console.log(JSON.stringify({ results, errors }, null, 1))
  await browser.close()
}
