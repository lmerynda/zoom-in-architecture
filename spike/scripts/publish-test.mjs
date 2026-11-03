// End-to-end check of publishing a map the way an agent does: a copy of the fixture repo is
// published with `zoom.mjs publish` while a viewer is open, its tab appears without a reload, it
// opens as its own model, and an edit to its source re-publishes it live.
// Removes the copy and its import afterwards.
// usage: node scripts/publish-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeIndex } from './map.mjs'

const outDir = process.argv[2] ?? 'shots/publish'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
const repo = join(mkdtempSync(join(tmpdir(), 'zoom-')), 'shop')
cpSync('test/fixtures/polyglot', repo, { recursive: true })
const scratch = join(repo, '..', 'map.json')
const zoom = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, ['scripts/zoom.mjs', ...args], { encoding: 'utf8' }) } } catch (e) { return { code: e.status, out: e.stdout } }
}

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
  await page.evaluate(() => { window.__sameDocument = true })

  // A map with a guessed link is refused, and nothing is published.
  const map = JSON.parse(readFileSync('test/fixtures/polyglot-map.json', 'utf8'))
  writeFileSync(scratch, JSON.stringify({ ...map, links: [...map.links, { from: 'web.orders', to: 'db', title: 'guess' }] }))
  const refused = zoom('publish', repo, scratch, '--name', 'shop')
  check('a map with an unproven link is refused', refused.code === 1 && /needs evidence/.test(refused.out), refused.out.split('\n').find(l => l.startsWith('error:')))

  // The real map publishes, and the open viewer gets its tab live.
  writeFileSync(scratch, JSON.stringify(map))
  const t0 = Date.now()
  const published = zoom('publish', repo, scratch, '--name', 'shop')
  check('the map publishes', published.code === 0, published.out.trim().split('\n').pop())
  await page.waitForFunction(() => [...document.querySelectorAll('#models a')].some(a => a.textContent === 'Shop'), { timeout: 15000 })
  check('its tab appears without a reload', await page.evaluate(() => window.__sameDocument === true), `${Date.now() - t0} ms`)
  await shot('01-tab-appears')

  await page.evaluate(() => [...document.querySelectorAll('#models a')].find(a => a.textContent === 'Shop').click())
  await page.waitForFunction(() => location.search === '?model=shop' && window.__spike?.ready, { timeout: 60000 })
  const ids = await page.evaluate(() => window.__spike.tree.els.map(e => e.id))
  check('it opens with the map’s levels', ['customer', 'web.shopping.main', 'server.orders.orderController', 'game', 'db'].every(id => ids.includes(id)), ids.slice(0, 8).join(' '))
  check('tests and configs are not on it', !ids.some(id => /vite|eslint|test|orphan/i.test(id)), ids.filter(id => /vite|eslint|test|orphan/i.test(id)).join(' '))
  await page.evaluate(() => { const s = window.__spike; s.unhover(); s.select(s.id('web.orders.api')); s.fit(0) })
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await sleep(600)
  await shot('02-opened')

  // A new file in the repo is published live, beside the files it talks to.
  writeFileSync(join(repo, 'web/src/ui/checkout.ts'), "import { cart } from './cart'\nexport const checkout = () => cart()\n")
  writeFileSync(join(repo, 'web/src/main.ts'), `${readFileSync(join(repo, 'web/src/main.ts'), 'utf8')}import { checkout } from './ui/checkout'\ncheckout()\n`)
  const t1 = Date.now()
  await page.waitForFunction(() => window.__spike.liveVersion > 0 && window.__spike.tree.byId.has('web.shopping.checkout'), { timeout: 30000 })
  await page.waitForFunction(() => !window.__spike.morphing)
  check('source edits re-publish it live', true, `${Date.now() - t1} ms · ${await page.$eval('.toast', e => e.textContent)}`)
  await sleep(400)
  await shot('03-source-edit')
} finally {
  console.log(JSON.stringify({ results, errors }, null, 1))
  await browser.close()
  rmSync(join(repo, '..'), { recursive: true, force: true })
  rmSync('imports/shop', { recursive: true, force: true })
  rmSync('public/models/shop.json', { force: true })
  writeIndex()
}
