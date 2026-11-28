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
const check = (name, ok, detail = '') => { results[name] = ok ? 'pass' : `FAIL ${detail}`; if (!ok) process.exitCode = 1; console.log(ok ? 'pass' : 'FAIL', name, detail) }

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
  /** Opens acme at 1600×1000 with an update ready that adds three parts to Ordering, which is laid out again. */
  const openAcme = async () => {
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
    await page.evaluate(async () => {
      document.querySelector('#welcome .ok')?.click()
      const json = await (await fetch('/models/acme.json')).json()
      const part = k => ({ id: `acme.ordering.extra${k}`, parent: 'acme.ordering', title: `Extra ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} })
      json.elements.unshift(part(1), part(2), part(3))
      window.__acme = json
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
  await page.setViewport({ width: 1200, height: 760 })
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

  // 4. A drag during the morph makes the camera the reader's: the morph, and the same update
  // repeated before it ends, leave it where the drag put it. On acme, whose Ordering the update lays
  // out again, so the morph has a camera path of its own to take it back along.
  await openAcme()
  await page.evaluate(pressCard, 'acme.ordering.checkout')
  await still()
  // On the page's manual clock, so the repeated update arrives while the first still moves into place.
  await page.evaluate(async () => { const s = window.__spike; s.manual(true); await s.swapModel(window.__acme); for (let k = 0; k < 15; k++) s.advance(16) })
  await page.mouse.move(700, 500)
  await page.mouse.down()
  for (let k = 1; k <= 10; k++) await page.mouse.move(700 + k * 18, 500 + k * 6)
  await sleep(150)
  await page.mouse.up()
  const dropped = await page.evaluate(() => [window.__spike.cam.x, window.__spike.cam.y, window.__spike.cam.z])
  const kept = await page.evaluate(async () => {
    const s = window.__spike
    s.advance(16)
    const midway = s.morphing
    await s.swapModel(window.__acme)
    for (let k = 0; k < 60; k++) s.advance(16)
    s.manual(false)
    return [s.cam.x, s.cam.y, s.cam.z, midway]
  })
  if (!kept.pop()) check('the repeated update arrives during the first one\'s morph', false)
  await still()
  check('a drag during a live update\'s morph is kept', Math.hypot(kept[0] - dropped[0], kept[1] - dropped[1]) * kept[2] < 2 && Math.abs(kept[2] / dropped[2] - 1) < 1e-3, JSON.stringify({ dropped, kept }))

  // 5. A jump of the reader's own under way when an update arrives (the minimap, Back) flies on to
  // where it was going: the morph does not cut it short. On acme, whose Ordering is laid out again by
  // the update, so the selection moves and the morph has a camera path of its own.
  await openAcme()
  await page.evaluate(pressCard, 'acme.ordering.checkout')
  await still()
  // On the page's manual clock, so the flight is still under way when the update moves into place.
  const headed = await page.evaluate(async () => {
    const s = window.__spike, c = s.cam
    s.manual(true)
    // As the minimap's pick flies: a point to the centre, at this zoom.
    c.flyTo(c.x - c.w / c.z / 2 + 30, c.y - c.h / c.z / 2 + 20, c.w / c.z, c.h / c.z, s.now(), 1)
    const dest = c.destination
    s.advance(100)
    await s.swapModel(window.__acme)
    for (let k = 0; k < 80; k++) s.advance(16)
    s.manual(false)
    return dest
  })
  await still()
  const landedAt = await page.evaluate(() => [window.__spike.cam.x, window.__spike.cam.y, window.__spike.cam.z])
  check('a jump under way when a live update arrives lands where it was going', Math.hypot(landedAt[0] - headed[0], landedAt[1] - headed[1]) * landedAt[2] < 2 && Math.abs(landedAt[2] / headed[2] - 1) < 1e-3, JSON.stringify({ headed, landedAt }))

  // 6. A card framed as a file that an update gives its first part: every step of the move keeps the
  // map in view (a container opening from nothing has no framing of its own halfway), and it ends
  // framed as a container, as pressing it then frames it.
  await openAcme()
  await page.evaluate(pressCard, 'acme.ordering.cartCache')
  await still()
  const grown = await page.evaluate(async () => {
    const s = window.__spike, c = s.cam
    const json = await (await fetch('/models/acme.json')).json()
    json.elements.push({ id: 'acme.ordering.cartCache.ttl', parent: 'acme.ordering.cartCache', title: 'TTL sweeper', kind: 'component', description: '', technology: '', tags: [], metadata: {} })
    s.manual(true)
    const z0 = c.z
    await s.swapModel(json)
    let most = 0, emptiest = Infinity
    for (let k = 0; k < 60; k++) { s.advance(16); most = Math.max(most, c.z / z0); emptiest = Math.min(emptiest, s.last().nodes) }
    s.manual(false)
    return { most, emptiest }
  })
  const opened = await framedAfter('08-first-child', 'acme.ordering.cartCache', pressCard)
  check('a framed card given its first part stays in view as it opens, and ends framed', grown.most < 4 && grown.emptiest > 0 && opened.ok, JSON.stringify({ ...grown, ...JSON.parse(opened.detail) }))

  // 7. A sideways scroll is no zoom: the whole map framed stays framed through a resize after it.
  await fresh()
  await page.evaluate(() => window.__spike.fly(0))
  await still()
  await page.mouse.move(600, 500)
  await page.mouse.wheel({ deltaX: 120, deltaY: 0 })
  await sleep(100)
  await page.setViewport({ width: 1600, height: 600 })
  const sideways = await framedAfter('09-sideways-scroll', null, () => window.__spike.fly(0))
  check('a sideways scroll leaves the whole map framed through a resize', sideways.ok, sideways.detail)

  // 8. On a phone with reduced motion: a card selected again with its sheet folded is framed for the
  // sheet that opens, and stays framed when the phone turns.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.goto(`${base}?model=knights-of-darkness`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => document.querySelector('#welcome .ok')?.click())
  await page.evaluate(pressCard, card)
  await still()
  await page.evaluate(() => document.querySelector('#details > .d-grip')?.click())
  await sleep(200)
  await page.evaluate(id => window.__spike.select(window.__spike.id(id)), card)
  await still()
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true })
  const turned = await page.evaluate(() => document.getElementById('details').getBoundingClientRect().top)
  const phone = await framedAfter('10-phone-turned', card, pressCard)
  // On a phone the sheet, not a column, bounds the free stage: the check's panel edge is the screen's.
  const p = JSON.parse(phone.detail)
  check('on a phone, a card selected again with its sheet folded stays framed when the phone turns', p.off <= 2 && p.got[1] >= 0, JSON.stringify({ ...p, sheetTop: turned }))

  // 9. Still on a phone with reduced motion: the phone turned while an update moves into place keeps
  // the card clear of the bar at once, and framed once it is in place.
  await page.evaluate(async id => {
    const s = window.__spike
    s.controls.goSelect(s.id(id))
    window.__same = await (await fetch('/models/knights-of-darkness.json')).json()
  }, card)
  await still()
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await still()
  await page.evaluate(async () => { const s = window.__spike; s.manual(true); await s.swapModel(window.__same); s.advance(16); s.advance(16) })
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true })
  await sleep(150)
  const turning = await page.evaluate(id => { const s = window.__spike, r = s.renderer.screenRectOf(s.id(id)); s.advance(16); const r2 = s.renderer.screenRectOf(s.id(id)); s.manual(false); return { bar: document.getElementById('top').getBoundingClientRect().bottom, top: Math.min(r[1], r2[1]) } }, card)
  const turnedMid = await framedAfter('12-phone-turned-mid-move', card, pressCard)
  const tm = JSON.parse(turnedMid.detail)
  check('on a phone turned while an update moves into place, the card stays clear of the bar and ends framed', turning.top >= turning.bar - 1 && tm.off <= 2, JSON.stringify({ ...turning, ...tm }))

  // 10. Fit pressed (reduced motion, so it lands at once) while an update moves into place holds.
  await page.setViewport({ width: 1600, height: 1000 })
  await openAcme()
  await page.evaluate(pressCard, 'acme.ordering.checkout')
  await still()
  const fitHeld = await page.evaluate(async () => {
    const s = window.__spike, c = s.cam
    const same = await (await fetch('/models/acme.json')).json()
    s.manual(true)
    await s.swapModel(same)
    for (let k = 0; k < 9; k++) s.advance(16)
    s.controls.go(0)
    const fitZ = c.z
    let most = 0
    for (let k = 0; k < 50; k++) { s.advance(16); most = Math.max(most, c.z) }
    s.manual(false)
    return { fitZ, most }
  })
  check('Fit pressed while an update moves into place holds', fitHeld.most <= fitHeld.fitZ * 1.05, JSON.stringify(fitHeld))
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])

  // 11. A flight that lands while an update still moves its card lands on the card, and it ends framed.
  await openAcme()
  const payouts = 'acme.merchants.portal.payoutsUi'
  const landing = await page.evaluate(async id => {
    const s = window.__spike, c = s.cam
    const json = await (await fetch('/models/acme.json')).json()
    for (let k = 1; k <= 3; k++) json.elements.push({ id: `acme.extra${k}`, parent: 'acme', title: `Extra ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} })
    s.manual(true)
    s.controls.goSelect(s.id(id))
    for (let t = 0; t < c.flightMs - 144; t += 16) s.advance(16)
    await s.swapModel(json)
    while (c.flying) s.advance(16)
    const r = s.renderer.screenRectOf(s.id(id))
    for (let k = 0; k < 60; k++) s.advance(16)
    s.manual(false)
    return { r: r.map(Math.round), w: c.w, h: c.h }
  }, payouts)
  const landed11 = await framedAfter('13-landing-mid-move', payouts, pressCard)
  const lr = landing.r
  check('a flight landing while its card still moves lands on the card, and it ends framed', lr[0] >= 0 && lr[1] >= 0 && lr[0] + lr[2] <= landing.w && lr[1] + lr[3] <= landing.h && landed11.ok, JSON.stringify({ landing, ...JSON.parse(landed11.detail) }))

  // 12. A framed container that an update fills never outgrows its framing halfway through the move.
  await openAcme()
  await page.evaluate(pressCard, 'acme.merchants.portal')
  await still()
  const widths = await page.evaluate(async () => {
    const s = window.__spike, i = () => s.id('acme.merchants.portal')
    const json = await (await fetch('/models/acme.json')).json()
    for (let k = 1; k <= 40; k++) json.elements.push({ id: `acme.more${k}`, parent: 'acme', title: `More ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} }, { id: `acme.merchants.more${k}`, parent: 'acme.merchants', title: `More ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} })
    const w0 = s.renderer.screenRectOf(i())[2]
    s.manual(true)
    await s.swapModel(json)
    let most = 0
    for (let k = 0; k < 60; k++) { s.advance(16); most = Math.max(most, s.renderer.screenRectOf(i())[2]) }
    s.manual(false)
    return { w0, most, end: s.renderer.screenRectOf(i())[2], stage: document.getElementById('details').getBoundingClientRect().left }
  })
  check('a framed container an update fills keeps within its framing through the move', widths.most <= Math.max(widths.w0, widths.end) * 1.02 + 1 && widths.most <= widths.stage, JSON.stringify(widths))

  // 13. A drag during one update's move, then a different update: the selection moves with the
  // camera from where the drag left it, never off screen.
  await openAcme()
  const orderApi = 'acme.ordering.orders.orderApi'
  await page.evaluate(pressCard, orderApi)
  await still()
  await page.evaluate(async id => {
    const s = window.__spike
    const json = await (await fetch('/models/acme.json')).json()
    json.elements.find(e => e.id === id).description = 'Order placement, lookup and cancellation.'
    const big = await (await fetch('/models/acme.json')).json()
    for (let k = 1; k <= 16; k++) big.elements.push({ id: `acme.ordering.svc${k}`, parent: 'acme.ordering', title: `Service ${k}`, kind: 'service', description: '', technology: '', tags: [], metadata: {} })
    window.__big = big
    s.manual(true)
    await s.swapModel(json)
    for (let k = 0; k < 15; k++) s.advance(16)
  }, orderApi)
  await page.mouse.move(700, 500)
  await page.mouse.down()
  for (let k = 1; k <= 8; k++) await page.mouse.move(700 + k * 4, 500 + k * 1.5)
  await sleep(150)
  await page.mouse.up()
  const moved13 = await page.evaluate(async id => {
    const s = window.__spike
    const before = s.renderer.screenRectOf(s.id(id))
    await s.swapModel(window.__big)
    for (let k = 0; k < 60; k++) s.advance(16)
    s.manual(false)
    return { before: before.map(Math.round), after: s.renderer.screenRectOf(s.id(id)).map(Math.round), w: s.cam.w, h: s.cam.h }
  }, orderApi)
  const a13 = moved13.after
  check('a drag, then a different update: the selection stays on screen', a13[0] + a13[2] > 0 && a13[0] < moved13.w && a13[1] + a13[3] > 0 && a13[1] < moved13.h && Math.abs(a13[0] - moved13.before[0]) < 200, JSON.stringify(moved13))

  // 14. A sideways scroll during a jump is no trip of its own: one Back returns to where the jump began.
  await openAcme()
  await page.evaluate(() => window.__spike.fly(0))
  await still()
  await page.evaluate(id => { const s = window.__spike; s.manual(true); s.controls.goSelect(s.id(id)); for (let t = 0; t < s.cam.flightMs * 0.2; t += 16) s.advance(16) }, orderApi)
  await page.mouse.move(600, 500)
  await page.mouse.wheel({ deltaX: 120, deltaY: 0 })
  await sleep(100)
  await page.evaluate(() => { const s = window.__spike; while (s.cam.flying) s.advance(16); s.manual(false) })
  await sleep(800)
  await page.evaluate(() => window.__spike.controls.back())
  await still()
  const backTo = await page.evaluate(() => window.__spike.controls.view())
  check('a sideways scroll during a jump adds no Back step', backTo.selected === null && backTo.here === null, JSON.stringify(backTo))

  // 15. On a phone, closing the code reader frames the card clear of the sheet it hid.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.goto(`${base}?model=knights-of-darkness`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => document.querySelector('#welcome .ok')?.click())
  await page.evaluate(pressCard, card)
  await still()
  for (let k = 0; k < 2; k++) {
    const r = await page.evaluate(id => window.__spike.renderer.screenRectOf(window.__spike.id(id)), card)
    await page.mouse.click(r[0] + r[2] / 2, r[1] + Math.min(r[3] / 2, 30), { count: 2, clickCount: 2 })
    await page.waitForFunction(() => document.body.classList.contains('reading'), { timeout: 15000 })
    await sleep(400)
    await page.keyboard.press('Escape')
    await still()
  }
  const clear = await page.evaluate(id => { const s = window.__spike, r = s.renderer.screenRectOf(s.id(id)); return { r: r.map(Math.round), sheet: document.getElementById('details').getBoundingClientRect().top, bar: document.getElementById('top').getBoundingClientRect().bottom } }, card)
  await shot('14-phone-reader-closed')
  check('on a phone, closing the code reader leaves the card clear of the sheet', clear.r[1] + clear.r[3] <= clear.sheet + 1 && clear.r[1] >= clear.bar - 1, JSON.stringify(clear))
  await page.setViewport({ width: 1600, height: 1000 })
} finally {
  writeFileSync(file, original)
  console.log(JSON.stringify({ results, errors }, null, 1))
  await browser.close()
}
