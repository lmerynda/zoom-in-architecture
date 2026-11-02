// Scripted screenshot tour of the Acme model and the 10k synthetic model.
// usage: node scripts/tour.mjs [outDir]   (dev server running; DPR env sets device pixel ratio)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/tour'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--window-size=1600,1000', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: Number(process.env.DPR ?? 1) },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const open = async q => {
  await page.goto(`${base}?${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await sleep(600)
}
const shot = async name => { await sleep(1100); await page.screenshot({ path: join(outDir, `${name}.png`) }); console.log('shot', name) }
const fit = id => page.evaluate(id => { const s = window.__spike; s.fit(s.id(id)) }, id)
const select = id => page.evaluate(id => { const s = window.__spike; s.select(id ? s.id(id) : -1) }, id)
/** Moves the pointer onto the centre of an element, which hovers it. */
const hover = async id => {
  const p = await page.evaluate(id => {
    const s = window.__spike, i = s.id(id), r = s.world.rect
    return s.cam.toScreen(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2)
  }, id)
  await page.mouse.move(p[0], p[1])
}
const wheelAt = async (id, ticks) => {
  for (let k = 0; k < ticks; k++) {
    await hover(id)
    await page.mouse.wheel({ deltaY: -100 })
    await sleep(40)
  }
}

await open('model=acme')
await page.mouse.move(1590, 500)
await shot('01-landscape')
await fit('acme')
await page.mouse.move(1590, 500)
await shot('02-domains')
await fit('acme')
await sleep(900)
await hover('acme.ordering.checkout')
await shot('03-hover-ordering')
await select('acme.ordering.checkout')
await page.mouse.move(1590, 500)
await shot('04-select-checkout')
await fit('acme.ordering')
await page.mouse.move(1590, 500)
await shot('05-ordering-domain')
await select(null)
await fit('acme.ordering.checkout')
await sleep(900)
await hover('acme.ordering.checkout.flow')
await shot('06-checkout-service-hover')
await select('acme.ordering.checkout.flow')
await fit('acme.ordering.checkout.flow')
await page.mouse.move(1590, 500)
await shot('07-orchestrator-dossier')
await select(null)
await fit('acme.payments')
await sleep(900)
await wheelAt('acme.payments.gateway.stripeAdapter', 6)
await shot('08-wheel-into-payments')

// One continuous wheel zoom from the landscape to a single component, as a contact sheet.
await select(null)
await open('model=acme')
const frames = []
const target = 'acme.ordering.checkout.flow'
for (let k = 0; k < 6; k++) {
  if (k > 0) await wheelAt(target, 9)
  await page.mouse.move(1590, 990)
  await sleep(900)
  frames.push((await page.screenshot({ encoding: 'base64' })))
}
const sheet = await browser.newPage()
await sheet.setViewport({ width: 2400, height: 1000, deviceScaleFactor: 1 })
await sheet.setContent(`<body style="margin:0;background:#05070b;display:grid;grid-template-columns:repeat(3,1fr);align-content:start;gap:8px;padding:8px">${frames.map((f, k) => `<div style="position:relative"><img src="data:image/png;base64,${f}" style="width:100%;display:block;border-radius:6px"><span style="position:absolute;left:10px;top:8px;font:600 18px Segoe UI;color:#fbbf24;background:#0b0f17cc;padding:2px 8px;border-radius:4px">${k + 1}</span></div>`).join('')}</body>`)
await sheet.screenshot({ path: join(outDir, '00-zoom-sequence.png'), fullPage: true })
await sheet.close()
console.log('shot 00-zoom-sequence')

await open('model=synthetic&n=10000')
await page.mouse.move(1590, 500)
await shot('09-synthetic-10k-overview')
const deep = await page.evaluate(() => {
  const t = window.__spike.tree
  let best = 1
  for (let i = 1; i < t.size; i++) if (t.depth[i] > t.depth[best]) best = i
  return t.els[t.parent[t.parent[best]]].id
})
await fit(deep)
await sleep(900)
await select(deep)
await page.mouse.move(1590, 500)
await shot('10-synthetic-10k-deep-select')
console.log(JSON.stringify({ errors }))
await browser.close()
