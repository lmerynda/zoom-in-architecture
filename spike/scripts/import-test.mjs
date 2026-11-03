// End-to-end check of importing a codebase from the app: a copy of the fixture repo is imported
// through the Import button, opens as its own model, and follows edits to its source.
// Removes the copy and its import afterwards.
// usage: node scripts/import-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/import'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
// The folder name becomes the model name.
const repo = join(mkdtempSync(join(tmpdir(), 'zoom-')), 'shop-e2e')
cpSync('test/fixtures/polyglot', repo, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--window-size=1600,1000', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
// The refused import's 400 is expected; any other console error is not.
page.on('console', m => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) })
const results = {}
const check = (name, ok, detail = '') => { results[name] = ok ? 'pass' : `FAIL ${detail}`; console.log(ok ? 'pass' : 'FAIL', name, detail) }

try {
  await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready && document.getElementById('import'), { timeout: 60000 })

  // A path that does not exist is refused in place.
  await page.click('#import')
  await page.type('.import-box input', join(repo, 'missing'))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /failed/.test(document.querySelector('.import-status').textContent), { timeout: 30000 })
  const refusal = await page.$eval('.import-status', e => e.textContent)
  check('a bad path is refused', /no repository/.test(refusal), refusal)
  await shot('01-refused')

  // The real path imports and opens.
  await page.$eval('.import-box input', e => { e.value = '' })
  await page.type('.import-box input', repo)
  const t0 = Date.now()
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.keyboard.press('Enter')])
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  const ms = Date.now() - t0
  const opened = await page.evaluate(() => ({ url: location.search, ids: window.__spike.tree.els.map(e => e.id), tab: document.querySelector('#models a.on')?.textContent }))
  check('import opens the new model', opened.url === '?model=shop-e2e', `${opened.url} after ${ms} ms`)
  check('its projects are on the map', ['shopE2e.src.api', 'shopE2e.web.web', 'shopE2e.engine.gameEngine'].every(id => opened.ids.includes(id)), opened.ids.slice(0, 6).join(' '))
  check('it gets its own tab', opened.tab === 'Shop E2e', opened.tab)
  await page.evaluate(() => { const s = window.__spike; s.unhover(); s.fit(s.id('shopE2e.src')) })
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await sleep(600)
  await shot('02-imported')

  // Editing the source re-imports it, and the open map updates in place.
  writeFileSync(join(repo, 'src/Core/Refund.cs'), 'public class Refund\n{\n    public Order For;\n}\n')
  const t1 = Date.now()
  await page.waitForFunction(() => window.__spike.liveVersion > 0, { timeout: 30000 })
  await page.waitForFunction(() => !window.__spike.morphing)
  const live = await page.evaluate(() => ({ ids: window.__spike.tree.els.map(e => e.id), toast: document.querySelector('.toast').textContent }))
  check('source edits update the map', live.ids.includes('shopE2e.src.core.refund'), `${Date.now() - t1} ms · ${live.toast}`)
  await sleep(400)
  await shot('03-source-edit')
} finally {
  console.log(JSON.stringify({ results, errors }, null, 1))
  await browser.close()
  rmSync(join(repo, '..'), { recursive: true, force: true })
  rmSync('imports/shop-e2e', { recursive: true, force: true })
  rmSync('public/models/shop-e2e.json', { force: true })
}
