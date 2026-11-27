// End-to-end check of "what changed since the upload before": a copy of the fixture repo is
// published twice with `zoom.mjs publish`, the second time with a new endpoint and its repository
// moved into a component of its own. The first upload shows no changes; the second says how many
// beside the breadcrumb, turns the Changed lens on from there (mouse or keyboard, over a selection
// too), lights the cards and draws the new arrows green, and lists each change in the panel, a new
// one a jump to its card or arrow. Publishes under a name of its own and removes only that import.
// usage: node scripts/changes-test.mjs [outDir]   (dev server running; SPIKE_URL names it)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeIndex } from './store.mjs'

const outDir = process.argv[2] ?? 'shots/changes'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
// A name no developer's map has, so the clean-up below never removes one.
const NAME = `zoom-changes-test-${process.pid}`
mkdirSync(outDir, { recursive: true })
const repo = join(mkdtempSync(join(tmpdir(), 'zoom-')), 'shop')
cpSync('test/fixtures/polyglot', repo, { recursive: true })
const scratch = join(repo, '..', 'map.json')
const cli = join(import.meta.dirname, 'zoom.mjs')
const zoom = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [cli, ...args, '--to', base], { encoding: 'utf8', cwd: join(repo, '..') }) } } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` } }
}
const map = JSON.parse(readFileSync('test/fixtures/polyglot-map.json', 'utf8'))

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
const open = async (q = '') => {
  await page.goto(`${base}?model=${NAME}${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { const w = document.getElementById('welcome'); if (w && !w.hidden) w.querySelector('.ok')?.click() })
  await sleep(800)
}
const chip = () => page.evaluate(() => { const a = document.getElementById('changes'); return a && !a.hidden && a.getBoundingClientRect().width > 0 ? { text: a.textContent, on: a.getAttribute('aria-pressed') } : null })
const lensNames = () => page.evaluate(() => [...document.querySelectorAll('.lens-menu button')].map(b => b.dataset.lens))

try {
  // The first upload has nothing to compare with: no count, no Changed lens.
  writeFileSync(scratch, JSON.stringify(map))
  const first = zoom('publish', repo, scratch, '--name', NAME)
  check('the first version publishes', first.code === 0, first.out.trim().split('\n').pop())
  await open()
  check('a first upload shows no changes and has no Changed lens', (await chip()) === null && !(await lensNames()).includes('changed'), JSON.stringify(await lensNames()))
  await shot('1-first-upload')

  // Version two: a new endpoint in the controller, and the repository moved into a component of its own.
  const ctl = join(repo, 'server/src/main/java/com/shop/orders/OrderController.java')
  writeFileSync(ctl, readFileSync(ctl, 'utf8').replace(/\n}\s*$/, `\n\n    @DeleteMapping("/api/orders/{id}")\n    public void remove(long id) { repository.deleteById(id); }\n}\n`))
  const v2 = structuredClone(map)
  v2.nodes.splice(v2.nodes.findIndex(n => n.id === 'server.orders') + 1, 0, { id: 'server.store', kind: 'component', title: 'Order store', files: ['server/src/main/java/com/shop/orders/OrderRepository.java'] })
  writeFileSync(scratch, JSON.stringify(v2))
  // The open viewer swaps the model in place and gains the count and the lens without a reload.
  await page.evaluate(() => { window.__sameDocument = true })
  const second = zoom('publish', repo, scratch, '--name', NAME)
  check('the second version publishes', second.code === 0, second.out.trim().split('\n').pop())
  await page.waitForFunction(() => !document.getElementById('changes').hidden, { timeout: 15000 }).catch(() => {})
  const live = await chip()
  check('the open viewer gains the count without a reload', !!live && /^\d+ changes?$/.test(live.text) && (await page.evaluate(() => window.__sameDocument === true)) && (await lensNames()).includes('changed'), JSON.stringify(live))
  const stored = JSON.parse(readFileSync(`public/models/${NAME}.json`, 'utf8')).changed
  check('the store compared it with the first upload', stored?.endpoints.added.some(e => e.title === 'DELETE /api/orders/{id}') && stored.dependencies.added.some(d => d.from === 'server.orders' && d.to === 'server.store') && stored.dependencies.added.some(d => d.from === 'server.store' && d.to === 'db'), JSON.stringify(stored))
  await shot('2-second-upload-structure')

  // The count turns the lens on, by keyboard too (Space), and keeps the focus; over a selection, the
  // list replaces it in the panel.
  await page.evaluate(() => window.__spike.select(window.__spike.id('web')))
  await sleep(300)
  await page.focus('#changes')
  await page.keyboard.press('Space')
  await sleep(900)
  check('Space on the count turns the lens on, keeps the focus there and puts the selection down', await page.evaluate(() => document.activeElement?.id === 'changes' && window.__spike.renderer.selected <= 0 && !!document.querySelector('#details .d-changes')))
  const lit = await page.evaluate(() => {
    const s = window.__spike, t = s.tree, lens = s.renderer.lens
    const heat = id => lens?.heat[t.byId.get(id)]
    return { lens: lens?.name, server: heat('server'), store: heat('server.store'), web: heat('web'), on: document.getElementById('changes').getAttribute('aria-pressed'), legend: document.querySelector('.lens-legend')?.textContent }
  })
  check('the count turns the Changed lens on, lighting the cards where something changed', lit.lens === 'changed' && lit.server === 1 && lit.store === 1 && lit.web === 0 && lit.on === 'true' && /lit where something changed/.test(lit.legend), JSON.stringify(lit))
  const list = await page.evaluate(() => ({ head: document.querySelector('#details h2')?.textContent, sections: [...document.querySelectorAll('#details .d-changes h3')].map(h => h.textContent), rows: [...document.querySelectorAll('#details .d-changes .d-rel')].map(b => b.textContent) }))
  check('the panel lists what changed, by kind', /changes since/.test(list.head ?? '') && list.sections.includes('New endpoints · 1') && list.sections.some(s => s.startsWith('New dependencies between components')) && list.rows.some(r => r.startsWith('DELETE /api/orders/{id}')), JSON.stringify(list))
  // Enter the server, where the new arrows are, and see them drawn green.
  await page.evaluate(() => window.__spike.fly(window.__spike.id('server')))
  await sleep(1500)
  const fresh = await page.evaluate(() => ({ known: window.__spike.tree.relNew.filter(Boolean).length, drawn: window.__spike.last().fresh }))
  check('the arrows new since then are drawn green', fresh.known >= 2 && fresh.drawn >= 2, JSON.stringify(fresh))
  await shot('3-changed-lens')

  // A new endpoint in the list is a jump to the file that serves it.
  const jumped = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('#details .d-changes button')].find(x => x.textContent.startsWith('DELETE'))
    b?.click()
    await new Promise(r => setTimeout(r, 1200))
    const s = window.__spike
    return s.tree.els[s.renderer.selected]?.metadata?.path ?? null
  })
  check('a new endpoint jumps to the file that serves it', jumped === 'server/src/main/java/com/shop/orders/OrderController.java', jumped)
  await shot('4-jump-to-endpoint')
  // A new dependency jumps to its arrow.
  await page.evaluate(() => window.__spike.select(0))
  await sleep(500)
  const arrow = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('#details .d-changes button')].find(x => x.textContent.startsWith('Orders → Order store'))
    b?.click()
    await new Promise(r => setTimeout(r, 1200))
    return document.querySelector('#details h2')?.textContent ?? null
  })
  check('a new dependency opens its arrow', !!arrow && /Orders/.test(arrow) && /Order store/.test(arrow), arrow)
  await shot('5-jump-to-arrow')
  // Over an open arrow, the count brings the list back.
  await page.click('#changes')
  await page.click('#changes')
  await sleep(600)
  check('the count shows the list over an open arrow', await page.evaluate(() => !!document.querySelector('#details .d-changes') && window.__spike.renderer.lens?.name === 'changed'))

  // A narrow screen still shows the count, at the whole map too.
  await page.setViewport({ width: 390, height: 800 })
  await open()
  const narrow = await chip()
  check('a narrow screen shows the count at the whole map', !!narrow, JSON.stringify(narrow))
  await shot('5b-narrow')
  await page.setViewport({ width: 1600, height: 1000 })

  // The requests view marks the endpoint itself.
  await open('&view=requests&lens=changed')
  const req = await page.evaluate(() => ({ chip: (document.getElementById('changes').hidden ? null : document.getElementById('changes').textContent), rows: [...document.querySelectorAll('#details .d-changes .d-rel')].map(b => b.textContent) }))
  check('the requests view lists the new endpoint too, from the address', !!req.chip && req.rows.some(r => r.startsWith('DELETE /api/orders/{id}')), JSON.stringify(req))
  await shot('6-requests-view')

  // The count turns the lens off again.
  await open('&lens=changed')
  await page.click('#changes')
  await sleep(500)
  const off = await page.evaluate(() => ({ lens: window.__spike.renderer.lens?.name ?? null, outline: !!document.querySelector('#details .d-outline:not(.d-changes)') }))
  check('the count turns the lens off, and the outline comes back', off.lens === null && off.outline, JSON.stringify(off))

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  rmSync(join(repo, '..'), { recursive: true, force: true })
  rmSync(join('imports', NAME), { recursive: true, force: true })
  for (const f of [`${NAME}.json`, `${NAME}.requests.json`]) rmSync(join('public/models', f), { force: true })
  writeIndex()
}
const failed = Object.entries(results).filter(([, v]) => v !== 'pass')
console.log(`${Object.keys(results).length - failed.length}/${Object.keys(results).length} pass`)
if (failed.length) process.exitCode = 1
